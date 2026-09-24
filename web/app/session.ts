import type { PointRow, LinkFeature, Matches } from "./MapMatcher";

export type MapView = { center: [number, number]; zoom: number };
export type Session = {
  points: PointRow[]; links: LinkFeature[]; matches: Matches;
  pointFile: string; networkFile: string;
  pointMapping: { id: string; label: string; direction: string }; linkIdColumn: string;
  selectedPointId?: string; search: string; view?: MapView;
  checkedPoints: string[]; matchTargets: string[]; chosenLinkIds: string[];
  matching: boolean; candidateIds: string[]; candidateId?: string;
};
type Dataset = { version: 1; points: PointRow[]; links: LinkFeature[] };
type Progress = Omit<Session, "points" | "links" | "matches"> & {
  version: 1; savedAt: string;
  pairs: { pointId: string; linkId: string; matchedAt: string }[];
};

export function encodeSession(session: Session): { dataset: Dataset; progress: Progress } {
  const { points, links, matches, ...rest } = session;
  return {
    dataset: { version: 1, points, links },
    progress: { ...rest, version: 1, savedAt: new Date().toISOString(),
      pairs: [...matches].flatMap(([pointId, records]) => records.map(record => ({
        pointId, linkId: record.link.properties.__uid, matchedAt: record.matchedAt,
      }))),
    },
  };
}

export function decodeSession(dataset?: Dataset, progress?: Progress): Session | undefined {
  if (!dataset && !progress) return undefined;
  if (!dataset || !progress || dataset.version !== 1 || progress.version !== 1
      || !Array.isArray(dataset.points) || !Array.isArray(dataset.links) || !Array.isArray(progress.pairs)
      || !progress.pointMapping || typeof progress.linkIdColumn !== "string") {
    throw new Error("Saved workspace is incomplete or unsupported. It has NOT been overwritten.");
  }
  const pointIds = new Set(dataset.points.map(point => point.id));
  if (dataset.points.some(point => typeof point.id !== "string" || !point.properties || !Number.isFinite(point.lon) || !Number.isFinite(point.lat))
      || dataset.links.some(link => link.geometry?.type !== "LineString" || typeof link.properties?.__uid !== "string" || !Array.isArray(link.geometry.coordinates))
      || (progress.view && (!Array.isArray(progress.view.center) || progress.view.center.length !== 2 || !progress.view.center.every(Number.isFinite) || !Number.isFinite(progress.view.zoom)))) {
    throw new Error("Saved workspace data is invalid. It has NOT been overwritten.");
  }
  const links = new Map(dataset.links.map(link => [link.properties.__uid, link]));
  if (pointIds.size !== dataset.points.length || links.size !== dataset.links.length) throw new Error("Saved workspace has duplicate IDs.");
  const matches: Matches = new Map();
  for (const pair of progress.pairs) {
    const link = links.get(pair.linkId);
    if (!link || !pointIds.has(pair.pointId)) throw new Error("Saved match references missing data. Saved workspace was preserved.");
    const records = matches.get(pair.pointId) || [];
    if (!records.some(record => record.link.properties.__uid === pair.linkId)) records.push({link, matchedAt: pair.matchedAt});
    matches.set(pair.pointId, records);
  }
  const {version: _version, savedAt: _savedAt, pairs: _pairs, ...rest} = progress;
  return { ...rest, points: dataset.points, links: dataset.links, matches };
}

// Queue writes in order. A failed write must not block a later retry.
export function serialWriter<T>(write: (value: T) => Promise<void>) {
  let pending = Promise.resolve();
  return (value: T) => {
    pending = pending.catch(() => {}).then(() => write(value));
    return pending;
  };
}

export function createSessionStore() {
  let dbPromise: Promise<IDBDatabase> | undefined;
  let lastPoints: PointRow[] | undefined, lastLinks: LinkFeature[] | undefined;
  const open = () => dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Browser storage is unavailable. Use a normal browser window.")); return; }
    const request = indexedDB.open("linkmatch-local-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = undefined; reject(request.error || new Error("Could not open browser storage.")); };
    request.onblocked = () => { dbPromise = undefined; reject(new Error("Close other LinkMatch tabs and retry.")); };
  });
  const load = async () => {
    const db = await open();
    const [dataset, progress] = await new Promise<[Dataset | undefined, Progress | undefined]>((resolve, reject) => {
      const tx = db.transaction("workspace", "readonly"), store = tx.objectStore("workspace");
      const data = store.get("dataset"), state = store.get("progress");
      tx.oncomplete = () => resolve([data.result, state.result]);
      tx.onabort = () => reject(tx.error || new Error("Could not read saved workspace."));
      tx.onerror = () => reject(tx.error || new Error("Could not read saved workspace."));
    });
    const restored = decodeSession(dataset, progress);
    if (restored) { lastPoints = restored.points; lastLinks = restored.links; }
    return restored;
  };
  const save = serialWriter<Session>(async session => {
    const db = await open();
    const {dataset, progress} = encodeSession(session);
    const datasetChanged = lastPoints !== session.points || lastLinks !== session.links;
    // Dataset and progress share one atomic transaction, so IDs never refer to a different network.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite"), store = tx.objectStore("workspace");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Local save failed. Export a CSV backup."));
      tx.onerror = () => reject(tx.error || new Error("Local save failed. Export a CSV backup."));
      if (datasetChanged) store.put(dataset, "dataset");
      store.put(progress, "progress");
    });
    lastPoints = session.points; lastLinks = session.links;
  });
  return { load, save };
}

// Keep a second tab from silently replacing this tab's autosave.
export function claimWorkspace(): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(new Error("This browser cannot safely lock the workspace. Use a current Chrome, Edge, Firefox, or Safari browser."));
  return new Promise((resolve, reject) => {
    navigator.locks.request("linkmatch-workspace-writer", { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error("Another LinkMatch tab is using this workspace. Close that tab, then retry.")); return; }
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
