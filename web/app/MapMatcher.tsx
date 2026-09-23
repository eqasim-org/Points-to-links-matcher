"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import initSqlJs from "sql.js";
import { MappingDialog, ExportDialog, type ExportColumn } from "./FileDialogs";

type Properties = Record<string, string | number | null>;
type PointRow = { id: string; properties: Properties; lon: number; lat: number };
type LinkFeature = GeoJSON.Feature<GeoJSON.LineString, Properties & { __uid: string }>;
type MatchRecord = { link: LinkFeature; matchedAt: string };
type Matches = Map<string, MatchRecord[]>;

function sameRoadGeometry(a: LinkFeature, b: LinkFeature): boolean {
  const x = a.geometry.coordinates, y = b.geometry.coordinates;
  if (x.length !== y.length) return false;
  const equal = (p: GeoJSON.Position, q: GeoJSON.Position) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;
  return x.every((p, i) => equal(p, y[i])) || x.every((p, i) => equal(p, y[y.length - 1 - i]));
}

function nextUnmatchedPoint(queue: PointRow[], currentId: string | undefined, matches: Matches): PointRow | undefined {
  const start = queue.findIndex(point => point.id === currentId);
  for (let offset = 1; offset <= queue.length; offset++) {
    const point = queue[(start + offset) % queue.length];
    if (!matches.has(point.id)) return point;
  }
}

function addMatches(current: Matches, pointIds: string[], records: MatchRecord[]): Matches {
  const next = new Map(current);
  pointIds.forEach(id => {
    const pairs = new Map((next.get(id) || []).map(record => [record.link.properties.__uid, record]));
    records.forEach(record => { if (!pairs.has(record.link.properties.__uid)) pairs.set(record.link.properties.__uid, record); });
    if (pairs.size) next.set(id, [...pairs.values()]);
  });
  return next;
}

function removeMatch(current: Matches, pointId: string, uid: string): Matches {
  const next = new Map(current);
  const remaining = (next.get(pointId) || []).filter(record => record.link.properties.__uid !== uid);
  if (remaining.length) next.set(pointId, remaining); else next.delete(pointId);
  return next;
}

const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(field); field = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function pointsFromCsv(text: string, mapping?: Record<string, string>): PointRow[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV has no data rows.");
  const headers = rows[0].map((header) => header.trim());
  const lower = headers.map((header) => header.toLowerCase());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error("Column names must be nonempty and unique.");
  const lonIndex = mapping ? headers.indexOf(mapping.lon) : lower.findIndex((name) => ["lon", "lng", "longitude", "x"].includes(name));
  const latIndex = mapping ? headers.indexOf(mapping.lat) : lower.findIndex((name) => ["lat", "latitude", "y"].includes(name));
  if (lonIndex < 0 || latIndex < 0) throw new Error("The CSV needs lat/lon (or latitude/longitude) columns.");
  const idIndex = mapping ? headers.indexOf(mapping.id) : lower.findIndex((name) => ["id", "counter_id", "point_id"].includes(name));
  if (lonIndex === latIndex) throw new Error("Latitude and longitude must use different columns.");
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const properties: Properties = {};
    headers.forEach((header, column) => { properties[header] = values[column] ?? ""; });
    const lon = Number(values[lonIndex]);
    const lat = Number(values[latIndex]);
    if (!values[lonIndex]?.trim() || !values[latIndex]?.trim() || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new Error(`Invalid WGS84 coordinates at CSV row ${index + 2}.`);
    const id = idIndex < 0 ? String(index + 1) : normalized(values[idIndex]);
    if (!id || seen.has(id)) throw new Error(`Empty or duplicate point ID at CSV row ${index + 2}. Select a unique identifier column.`);
    seen.add(id);
    return { id, properties, lon, lat };
  }).filter((point): point is PointRow => point !== null);
}

function gpkgLineString(blob: Uint8Array): [number, number][] {
  if (blob[0] !== 71 || blob[1] !== 80) throw new Error("Invalid GeoPackage geometry.");
  const envelopeType = (blob[3] >> 1) & 7;
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeType];
  if (envelopeBytes === undefined) throw new Error("Unsupported GeoPackage envelope.");
  const offset = 8 + envelopeBytes;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const littleEndian = blob[offset] === 1;
  const geometryType = view.getUint32(offset + 1, littleEndian) % 1000;
  if (geometryType !== 2) throw new Error("The network must contain LINESTRING geometry.");
  const count = view.getUint32(offset + 5, littleEndian);
  const coordinates: [number, number][] = [];
  let cursor = offset + 9;
  for (let index = 0; index < count; index += 1) {
    coordinates.push([view.getFloat64(cursor, littleEndian), view.getFloat64(cursor + 8, littleEndian)]);
    cursor += 16;
  }
  return coordinates;
}

async function linksFromGpkg(file: File, layer?: string): Promise<LinkFeature[]> {
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
  const metadata = database.exec("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns")[0];
  if (!metadata?.values.length) throw new Error("No geometry layer was found in this GeoPackage.");
  const chosen = layer ? metadata.values.find(row => row[0] === layer) : metadata.values[0];
  if (!chosen) throw new Error("Selected layer was not found.");
  const [tableValue, geometryValue, srsValue] = chosen;
  if (Number(srsValue) !== 4326) throw new Error(`The network CRS must be EPSG:4326 (found EPSG:${srsValue}).`);
  const table = String(tableValue).replaceAll('"', '""');
  const geometryColumn = String(geometryValue);
  const schema = database.exec(`PRAGMA table_info("${table}")`)[0];
  const columns = schema.values.map((row) => String(row[1]));
  const attributes = columns.filter((column) => column !== geometryColumn);
  const select = [...attributes, geometryColumn].map((column) => `"${column.replaceAll('"', '""')}"`).join(",");
  const statement = database.prepare(`SELECT ${select} FROM "${table}"`);
  const links: LinkFeature[] = [];
  while (statement.step()) {
    const row = statement.getAsObject();
    const blob = row[geometryColumn];
    if (!(blob instanceof Uint8Array)) continue;
    const properties: Properties & { __uid: string } = { __uid: String(links.length + 1) };
    attributes.forEach((column) => { properties[column] = row[column] as string | number | null; });
    links.push({ type: "Feature", id: properties.__uid, properties, geometry: { type: "LineString", coordinates: gpkgLineString(blob) } });
  }
  statement.free();
  return links;
  } finally { database.close(); }
}

function pointCollection(points: PointRow[], matches: Matches, selectedId?: string, queuedIds: string[] = []): GeoJSON.FeatureCollection {
  const queued = new Set(queuedIds);
  return { type: "FeatureCollection", features: points.map((point) => ({
    type: "Feature", id: point.id,
    properties: { id: point.id, matched: matches.has(point.id) ? 1 : 0, selected: selectedId === point.id ? 1 : 0, queued: queued.has(point.id) ? 1 : 0 },
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
  })) };
}

function arrowCollection(link?: LinkFeature): GeoJSON.FeatureCollection {
  if (!link || link.geometry.coordinates.length < 2) return emptyCollection();
  const coordinates = link.geometry.coordinates;
  const segment = Math.max(0, Math.floor((coordinates.length - 1) / 2));
  const start = coordinates[segment], tip = coordinates[segment + 1];
  const dx = tip[0] - start[0], dy = tip[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const size = Math.max(length * 0.32, 0.00009);
  const ux = dx / length, uy = dy / length, px = -uy, py = ux;
  const baseX = tip[0] - ux * size, baseY = tip[1] - uy * size;
  const left: [number, number] = [baseX + px * size * 0.55, baseY + py * size * 0.55];
  const right: [number, number] = [baseX - px * size * 0.55, baseY - py * size * 0.55];
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
    { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [left, tip, right] } },
  ] };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function selectedLinkCollection(links: LinkFeature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: links.flatMap(link => arrowCollection(link).features.map(feature => ({
    ...feature, properties: { ...feature.properties, linkId: link.properties.__uid },
  }))) };
}

function shortCoordinate(coordinate: GeoJSON.Position) { return `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`; }

function normalized(value: unknown) { return value == null ? "" : String(value).trim(); }

export default function MapMatcher() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const linksById = useRef(new Map<string, LinkFeature>());
  const modeRef = useRef(false);
  const pointsRef = useRef<PointRow[]>([]);
  const linksRef = useRef<LinkFeature[]>([]);
  const matchesRef = useRef<Matches>(new Map());
  const selectedPointRef = useRef<string | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [links, setLinks] = useState<LinkFeature[]>([]);
  const [pointFile, setPointFile] = useState("sample-points.csv (3 demo points)");
  const [networkFile, setNetworkFile] = useState("sample-network.gpkg (Geneva clip)");
  const [selectedPointId, setSelectedPointId] = useState<string>();
  const [matches, setMatches] = useState<Matches>(new Map());
  const [checkedPoints, setCheckedPoints] = useState<string[]>([]);
  const [matchTargets, setMatchTargets] = useState<string[]>([]);
  const [chosenLinks, setChosenLinks] = useState<LinkFeature[]>([]);
  const [matching, setMatching] = useState(false);
  const [candidates, setCandidates] = useState<LinkFeature[]>([]);
  const [candidateId, setCandidateId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("Loading the Geneva sample…");
  const [search, setSearch] = useState("");
  const [pointMapping, setPointMapping] = useState({ id: "counter_id", label: "nom_voie", direction: "direction" });
  const [linkIdColumn, setLinkIdColumn] = useState("link_id");
  const [mappingDialog, setMappingDialog] = useState<{
    title: string; columns: string[]; fields: { key: string; label: string; optional?: boolean }[];
    initial: Record<string, string>; apply: (mapping: Record<string, string>) => void | Promise<void>;
  }>();
  const [exportOpen, setExportOpen] = useState(false);
  const queuedPointIds = matching ? matchTargets : checkedPoints;
  const selectionRef = useRef({ points: [] as string[], links: [] as LinkFeature[] });
  selectionRef.current = { points: queuedPointIds, links: matching ? chosenLinks : [] };
  const gestureRef = useRef({ cycle: () => {}, confirmNext: () => {} });
  const guess = (columns: string[], names: string[]) => columns.find(column => names.includes(column.toLowerCase())) || "";
  const pointLabel = (point: PointRow) => point.properties[pointMapping.label] || point.id;
  const pointDirection = (point: PointRow) => point.properties[pointMapping.direction];

  const selectedPoint = points.find((point) => point.id === selectedPointId);
  const candidate = candidateId ? linksById.current.get(candidateId) : undefined;
  const filteredPoints = useMemo(() => points.filter((point) => {
    const haystack = Object.values(point.properties).join(" ").toLowerCase();
    return haystack.includes(search.toLowerCase());
  }), [points, search]);

  useEffect(() => { modeRef.current = matching; }, [matching]);
  pointsRef.current = points;
  linksRef.current = links;
  matchesRef.current = matches;
  selectedPointRef.current = selectedPointId;

  useEffect(() => {
    Promise.all([
      fetch("/sample-points.csv").then((response) => response.text()),
      fetch("/sample-network.geojson").then((response) => response.json()),
    ]).then(([csv, geojson]) => {
      const parsedPoints = pointsFromCsv(csv);
      const parsedLinks = (geojson.features as LinkFeature[]).map((feature, index) => ({
        ...feature, id: String(feature.properties.__uid ?? feature.properties.fid ?? index + 1),
        properties: { ...feature.properties, __uid: String(feature.properties.__uid ?? feature.properties.fid ?? index + 1) },
      }));
      setPoints(parsedPoints); setLinks(parsedLinks); setSelectedPointId(parsedPoints[0]?.id);
      setNotice("Sample data ready"); setLoading(false);
    }).catch((error) => { setNotice(error instanceof Error ? error.message : "Could not load sample data"); setLoading(false); });
  }, []);

  useEffect(() => {
    linksById.current = new Map(links.map((link) => [String(link.properties.__uid), link]));
  }, [links]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      center: [6.1432, 46.2044], zoom: 11.3,
      style: {
        version: 8,
        sources: {
          basemap: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" },
          network: { type: "geojson", data: emptyCollection(), promoteId: "__uid" },
          direction: { type: "geojson", data: emptyCollection() },
          selection: { type: "geojson", data: emptyCollection() },
          points: { type: "geojson", data: emptyCollection() },
        },
        layers: [
          { id: "basemap", type: "raster", source: "basemap" },
          { id: "network-lines", type: "line", source: "network", paint: { "line-color": "#17365d", "line-opacity": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 15, 3.4] } },
          { id: "selection-halo", type: "line", source: "selection", paint: { "line-color": "#ffffff", "line-width": 15, "line-opacity": 0.9 } },
          { id: "selection-lines", type: "line", source: "selection", paint: { "line-color": "#7c3aed", "line-width": 12, "line-opacity": 0.85 } },
          { id: "direction-halo", type: "line", source: "direction", paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.95 } },
          { id: "direction-line", type: "line", source: "direction", paint: { "line-color": "#f04438", "line-width": 5 } },
          { id: "points-selection", type: "circle", source: "points", filter: ["==", ["get", "queued"], 1], paint: { "circle-radius": 15, "circle-color": "#ffffff", "circle-opacity": 0.7, "circle-stroke-color": "#7c3aed", "circle-stroke-width": 3 } },
          { id: "points-halo", type: "circle", source: "points", paint: { "circle-radius": ["case", ["==", ["get", "selected"], 1], 12, 9], "circle-color": "#ffffff", "circle-opacity": 0.96 } },
          { id: "points-circles", type: "circle", source: "points", paint: { "circle-radius": ["case", ["==", ["get", "selected"], 1], 8, 6], "circle-color": ["case", ["==", ["get", "matched"], 1], "#17875f", "#e53935"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } },
        ],
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.doubleClickZoom.disable();
    // Right-click is reserved for direction selection, not map rotation.
    map.dragRotate.disable();
    map.on("contextmenu", event => {
      if (!modeRef.current) return;
      event.preventDefault(); event.originalEvent.preventDefault();
      gestureRef.current.cycle();
    });
    map.on("style.load", () => {
      (map.getSource("network") as GeoJSONSource).setData({ type: "FeatureCollection", features: linksRef.current });
      (map.getSource("points") as GeoJSONSource).setData(pointCollection(pointsRef.current, matchesRef.current, selectedPointRef.current, selectionRef.current.points));
      (map.getSource("selection") as GeoJSONSource).setData(selectedLinkCollection(selectionRef.current.links));
      setMapReady(true);
    });
    map.on("mousemove", (event) => {
      const layers = modeRef.current ? ["network-lines"] : ["points-circles"];
      map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers }).length ? "pointer" : modeRef.current ? "crosshair" : "";
    });
    map.on("click", (event) => {
      if (modeRef.current && event.originalEvent.shiftKey) {
        if (event.originalEvent.detail <= 1) gestureRef.current.confirmNext();
        return;
      }
      const pointHit = map.queryRenderedFeatures(event.point, { layers: ["points-circles"] })[0];
      if (pointHit && !modeRef.current) { setSelectedPointId(String(pointHit.properties?.id)); setCandidates([]); setCandidateId(undefined); return; }
      if (!modeRef.current) return;
      const box: [[number, number], [number, number]] = [[event.point.x - 8, event.point.y - 8], [event.point.x + 8, event.point.y + 8]];
      const foundById = new Map<string, LinkFeature>();
      map.queryRenderedFeatures(box, { layers: ["network-lines"] }).forEach((feature) => {
        const uid = String(feature.properties?.__uid ?? feature.id);
        const original = linksById.current.get(uid);
        if (original) foundById.set(uid, original);
      });
      const found = [...foundById.values()];
      setCandidates(found); setCandidateId(found[0]?.properties.__uid);
      setNotice(found.length ? `${found.length} directed link${found.length === 1 ? "" : "s"} found here` : "No link found — zoom in and click closer");
    });
    map.on("dblclick", (event) => {
      const pointHit = map.queryRenderedFeatures(event.point, { layers: ["points-circles"] })[0];
      if (!pointHit) return;
      event.preventDefault();
      const point = pointsRef.current.find((item) => item.id === String(pointHit.properties?.id));
      if (!point) return;
      setSelectedPointId(point.id); setMatching(true); setCandidates([]); setCandidateId(undefined);
      setMatchTargets([point.id]); setChosenLinks([]);
      setNotice("Click a road link near the selected point");
      map.easeTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 16), duration: 350 });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("network") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: links });
  }, [links, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("points") as GeoJSONSource | undefined;
    source?.setData(pointCollection(points, matches, selectedPointId, queuedPointIds));
  }, [points, matches, selectedPointId, queuedPointIds, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("selection") as GeoJSONSource | undefined;
    source?.setData(selectedLinkCollection(matching ? chosenLinks : []));
  }, [chosenLinks, matching, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource("direction") as GeoJSONSource | undefined;
    source?.setData(arrowCollection(candidate));
  }, [candidate, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !points.length) return;
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((point) => bounds.extend([point.lon, point.lat]));
    const width = mapRef.current.getCanvas().clientWidth;
    mapRef.current.fitBounds(bounds, { padding: { top: 55, bottom: 60, left: 30, right: Math.min(380, width * 0.4) }, maxZoom: points.length <= 3 ? 17 : 14, duration: 700 });
  }, [points, mapReady]);

  function focusPoint(point: PointRow) {
    setSelectedPointId(point.id); setCandidates([]); setCandidateId(undefined); setMatching(false);
    mapRef.current?.easeTo({ center: [point.lon, point.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: 650 });
  }

  function startMatchingPoint(point: PointRow) {
    setMatchTargets([point.id]); setChosenLinks([]);
    setSelectedPointId(point.id); setMatching(true); setCandidates([]); setCandidateId(undefined);
    setNotice("Click a road link near the selected point");
    mapRef.current?.easeTo({ center: [point.lon, point.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 350 });
  }

  function cycleDirection() {
    if (!candidate) { setNotice("Click a road first, then right-click to change direction."); return; }
    const directions = candidates.filter(link => sameRoadGeometry(candidate, link));
    if (directions.length < 2) { setNotice("No other direction with the same geometry here."); return; }
    const index = directions.findIndex(link => link.properties.__uid === candidateId);
    const next = directions[(index + 1) % directions.length];
    setCandidateId(next.properties.__uid);
    setNotice(`Previewing link ${next.properties[linkIdColumn]}. Shift-click or Enter to save and go next.`);
  }

  function addPreview() {
    if (!candidate) return;
    setChosenLinks(current => current.some(link => link.properties.__uid === candidate.properties.__uid) ? current : [...current, candidate]);
    setNotice(`Link ${candidate.properties[linkIdColumn]} added. Click another road, or press Enter to save and go next.`);
  }

  function confirmAndNext() {
    if (!matching || mappingDialog || exportOpen || !matchTargets.length) return;
    const selected = [...new Map([...chosenLinks, ...(candidate ? [candidate] : [])].map(link => [link.properties.__uid, link])).values()];
    if (!selected.length) { setNotice("Click a road to preview a direction before confirming."); return; }
    const matchedAt = new Date().toISOString();
    const nextMatches = addMatches(matchesRef.current, matchTargets, selected.map(link => ({link, matchedAt})));
    matchesRef.current = nextMatches;
    setMatches(nextMatches); setCheckedPoints([]);
    const next = nextUnmatchedPoint(filteredPoints, selectedPointId, nextMatches);
    if (next) {
      startMatchingPoint(next);
      setNotice(`Saved ${matchTargets.length} point(s) to ${selected.length} link(s). Now matching ${next.id}.`);
    } else {
      setMatching(false); setCandidates([]); setCandidateId(undefined); setChosenLinks([]); setMatchTargets([]);
      setNotice(search ? "Saved. No unmatched points remain in the current search. Clear search to continue." : "Saved. All points are matched!");
    }
  }

  gestureRef.current = { cycle: cycleDirection, confirmNext: confirmAndNext };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!matching || mappingDialog || exportOpen || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable="true"], dialog')) return;
      if (event.key === "Enter") { event.preventDefault(); confirmAndNext(); }
      else if (event.key.toLowerCase() === "a") { event.preventDefault(); addPreview(); }
      else if (event.key.toLowerCase() === "d") { event.preventDefault(); cycleDirection(); }
      else if (event.key === "Escape") {
        event.preventDefault(); setMatching(false); setCandidates([]); setCandidateId(undefined); setChosenLinks([]); setMatchTargets([]);
        setNotice("Matching cancelled. Saved matches are unchanged.");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  async function loadPoints(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const columns = parseCsv(text.replace(/^\uFEFF/, ""))[0]?.map(column => column.trim()) || [];
      if (!columns.length) throw new Error("The CSV is empty.");
      setMappingDialog({ title: `Point columns — ${file.name}`, columns,
        fields: [{ key: "id", label: "Unique point ID" }, { key: "lon", label: "Longitude" }, { key: "lat", label: "Latitude" }, { key: "label", label: "Street / display name", optional: true }, { key: "direction", label: "Direction description", optional: true }],
        initial: { id: guess(columns, ["id", "counter_id", "point_id"]), lon: guess(columns, ["lon", "lng", "longitude", "x"]), lat: guess(columns, ["lat", "latitude", "y"]), label: guess(columns, ["nom_voie", "street", "name"]), direction: guess(columns, ["direction", "bearing"]) },
        apply: mapping => {
          const parsed = pointsFromCsv(text, mapping);
          setCheckedPoints([]); setMatchTargets([]); setChosenLinks([]);
          setPoints(parsed); setPointMapping({ id: mapping.id, label: mapping.label, direction: mapping.direction });
          setPointFile(file.name); setMatches(new Map()); setSelectedPointId(parsed[0]?.id); setMatching(false); setCandidates([]); setCandidateId(undefined);
          setNotice(`${parsed.length} points loaded`); setMappingDialog(undefined);
        },
      });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not read the CSV"); }
    finally { setLoading(false); event.target.value = ""; }
  }

  async function loadNetwork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      setLoading(true);
      const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
      const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
      let layers: string[];
      try { layers = (database.exec("SELECT table_name FROM gpkg_geometry_columns WHERE geometry_type_name = 'LINESTRING' AND srs_id = 4326")[0]?.values || []).map(row => String(row[0])); }
      finally { database.close(); }
      if (!layers.length) throw new Error("No EPSG:4326 LINESTRING layer found.");
      setMappingDialog({ title: `Network layer — ${file.name}`, columns: layers, fields: [{ key: "layer", label: "Road layer (geometry is read automatically)" }], initial: { layer: layers[0] }, apply: async mapping => {
        const parsed = await linksFromGpkg(file, mapping.layer);
        if (!parsed.length) throw new Error("The selected layer contains no links.");
        const columns = Object.keys(parsed[0].properties).filter(column => column !== "__uid");
        setMappingDialog({ title: "Network columns", columns, fields: [{ key: "id", label: "Unique directed link ID" }], initial: { id: guess(columns, ["link_id", "fid", "id"]) }, apply: selected => {
          const ids = parsed.map(link => normalized(link.properties[selected.id]));
          if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error("Choose a nonempty, unique ID for each directed link. An OSM way ID shared by opposite directions is not suitable.");
          setLinks(parsed); setLinkIdColumn(selected.id); setNetworkFile(file.name); setMatches(new Map()); setMatching(false); setCandidates([]); setCandidateId(undefined);
          setCheckedPoints([]); setMatchTargets([]); setChosenLinks([]);
          setNotice(`${parsed.length.toLocaleString()} directed links loaded`); setMappingDialog(undefined);
        } });
      } });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not read the GeoPackage"); }
    finally { setLoading(false); event.target.value = ""; }
  }

  async function loadMatchedCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      setLoading(true);
      const rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (rows.length < 2) throw new Error("The matched CSV has no data rows.");
      const headers = rows[0].map((header) => header.trim());
      if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error("Column names must be nonempty and unique.");
      setMappingDialog({ title: `Resume columns — ${file.name}`, columns: headers,
        fields: [{ key: "point", label: `Point ID (matches ${pointMapping.id})` }, { key: "link", label: `Link ID (matches ${linkIdColumn})` }, { key: "time", label: "Match timestamp", optional: true }],
        initial: { point: guess(headers, [pointMapping.id.toLowerCase(), "counter_id", "point_id", "id"]), link: guess(headers, [`link_${linkIdColumn}`.toLowerCase(), linkIdColumn.toLowerCase()]), time: guess(headers, ["matched_at"]) },
        apply: mapping => {
      const pointIdIndex = headers.indexOf(mapping.point), linkIndex = headers.indexOf(mapping.link), matchedAtIndex = headers.indexOf(mapping.time);
      if (pointIdIndex === linkIndex) throw new Error("Choose separate point and link ID columns.");
      const pointIds = new Set(points.map((point) => point.id));
      const linkLookup = new Map<string, LinkFeature>();
      links.forEach(link => {
        const id = normalized(link.properties[linkIdColumn]);
        if (!id || linkLookup.has(id)) throw new Error("The current network must have unique directed link IDs.");
        linkLookup.set(id, link);
      });
      let restored: Matches = new Map();
      let unknownPoints = 0, missingLinks = 0;
      rows.slice(1).forEach((values) => {
        const pointId = normalized(values[pointIdIndex]);
        if (!pointId || !pointIds.has(pointId)) { unknownPoints += 1; return; }
        const link = linkLookup.get(normalized(values[linkIndex]));
        if (!link) { missingLinks += 1; return; }
        restored = addMatches(restored, [pointId], [{ link, matchedAt: matchedAtIndex >= 0 && values[matchedAtIndex] ? values[matchedAtIndex] : new Date().toISOString() }]);
      });
      setMatches((current) => { let next = current; restored.forEach((records, pointId) => { next = addMatches(next, [pointId], records); }); return next; });
      const notes = [unknownPoints ? `${unknownPoints} unknown point${unknownPoints === 1 ? "" : "s"}` : "", missingLinks ? `${missingLinks} missing link${missingLinks === 1 ? "" : "s"}` : ""].filter(Boolean);
      setNotice(`Restored ${restored.size} matched point${restored.size === 1 ? "" : "s"}${notes.length ? ` (${notes.join(", ")})` : ""}`);
      setMappingDialog(undefined);
      } });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not restore the matched CSV"); }
    finally { setLoading(false); event.target.value = ""; }
  }

  function beginMatch(targets?: string[]) {
    const firstPoint = targets ? points.find(point => point.id === targets[0]) : selectedPoint;
    if (!firstPoint) return;
    setSelectedPointId(firstPoint.id);
    setMatchTargets(targets || [firstPoint.id]); setChosenLinks([]);
    setMatching(true); setCandidates([]); setCandidateId(undefined); setNotice("Click a road link near the selected point");
    mapRef.current?.easeTo({ center: [firstPoint.lon, firstPoint.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 500 });
  }

  function confirmMatch() {
    if (!matchTargets.length || !chosenLinks.length) return;
    const matchedAt = new Date().toISOString();
    setMatches(current => addMatches(current, matchTargets, chosenLinks.map(link => ({ link, matchedAt }))));
    setMatching(false); setCandidates([]); setCandidateId(undefined); setChosenLinks([]); setCheckedPoints([]);
    setNotice(`Matched ${matchTargets.length} point(s) to ${chosenLinks.length} link(s). Existing matches kept; duplicate pairs ignored.`);
  }

  const exportColumns: ExportColumn[] = useMemo(() => {
    const matched = points.filter(point => matches.has(point.id));
    const pointColumns = [...new Set(matched.flatMap(point => Object.keys(point.properties)))];
    const linkColumns = [...new Set(matched.flatMap(point => matches.get(point.id)!.flatMap(match => Object.keys(match.link.properties).filter(column => column !== "__uid"))))];
    const used = new Set<string>();
    return [...pointColumns.map(column => ({ key: `point:${column}`, label: `Point · ${column}`, header: column })), ...linkColumns.map(column => ({ key: `link:${column}`, label: `Link · ${column}`, header: `link_${column}` })), { key: "time", label: "Match timestamp", header: "matched_at" }].map(column => {
      let header = column.header, suffix = 2;
      while (used.has(header)) header = `${column.header}_${suffix++}`;
      used.add(header); return { ...column, header };
    });
  }, [points, matches]);

  function exportMatches(keys: string[]) {
    const matched = points.filter((point) => matches.has(point.id));
    const selected = exportColumns.filter(column => keys.includes(column.key));
    const header = selected.map(column => column.header);
    const rows = matched.flatMap((point) => matches.get(point.id)!.map(match => {
      return selected.map(column => column.key === "time" ? match.matchedAt : column.key.startsWith("point:") ? point.properties[column.key.slice(6)] : match.link.properties[column.key.slice(5)]);
    }));
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return csv;
  }

  async function stopApp() {
    try {
      const response = await fetch("http://127.0.0.1:3001/stop", { method: "POST" });
      if (!response.ok) throw new Error("Stop request failed");
      setStopping(true);
      setNotice("LinkMatch stopped — you can close this browser tab");
    } catch {
      setNotice("Use start_linkmatch.bat to enable the Stop app button");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">LM</span><div><strong>LinkMatch</strong><small>Directed network matching</small></div></div>
        <div className="dataset-strip">
          <label className="file-pill"><span>POINTS</span><b>{pointFile}</b><em>{points.length} rows</em><input type="file" accept=".csv,text/csv" onChange={loadPoints} /></label>
          <span className="plus">+</span>
          <label className="file-pill"><span>NETWORK</span><b>{networkFile}</b><em>{links.length.toLocaleString()} links</em><input type="file" accept=".gpkg,application/geopackage+sqlite3" onChange={loadNetwork} /></label>
        </div>
        <div className="top-actions">
          <label className="resume-button">Resume matched CSV <span>↥</span><input type="file" accept=".csv,text/csv" onChange={loadMatchedCsv} /></label>
          <button className="export-button" onClick={() => setExportOpen(true)} disabled={!matches.size}>Export matched CSV <span>↓</span></button>
          <button className="stop-button" onClick={stopApp} disabled={stopping}>{stopping ? "Stopped" : "Stop app"}<span>■</span></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="progress-card"><div><span>PROGRESS</span><strong>{matches.size} <small>/ {points.length}</small></strong></div><div className="progress-track"><i style={{ width: `${points.length ? matches.size / points.length * 100 : 0}%` }} /></div><p>{points.length - matches.size} points remaining</p></div>
          <div className="sidebar-title"><div><span className="eyebrow">POINT QUEUE</span><h1>Choose a point</h1></div><span className="count-badge">{filteredPoints.length}</span></div>
          <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search counters or roads…" aria-label="Search points" />
          <div className="point-list">
            <div className="batch-toolbar">
              <small>Tick points to match them together ({checkedPoints.length} selected, including hidden search results).</small>
              <button disabled={!checkedPoints.length || matching} onClick={() => beginMatch(checkedPoints)}>Match selected points</button>
              <button disabled={!checkedPoints.length || matching} onClick={() => setCheckedPoints([])}>Clear selection</button>
            </div>
            {filteredPoints.map((point) => {
              const isSelected = point.id === selectedPointId, isMatched = matches.has(point.id);
              return <div key={point.id} className={`point-choice ${queuedPointIds.includes(point.id) ? "in-batch" : ""}`}><input type="checkbox" aria-label={`Select point ${point.id} for batch matching`} checked={checkedPoints.includes(point.id)} disabled={matching} onChange={event => setCheckedPoints(current => event.target.checked ? [...current, point.id] : current.filter(id => id !== point.id))} /><button className={`point-row ${isSelected ? "selected" : ""}`} onClick={() => focusPoint(point)} onDoubleClick={() => startMatchingPoint(point)} title="Double-click to start matching">
                <span className={`status-dot ${isMatched ? "done" : ""}`}>{isMatched ? "✓" : ""}</span>
                <span><b>{pointLabel(point)}</b><small>{point.id} · {pointDirection(point) || `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`}</small></span>
                <em>›</em>
              </button></div>;
            })}
          </div>
        </aside>

        <div className="map-panel">
          <div ref={mapContainer} className="map" />
          {matching && <div className="gesture-help"><strong>Fast matching</strong><span>Click road: preview · Right-click / D: flip direction</span><span>Shift-click map / Enter: save preview + added links, then next point</span><span>A: add preview for multi-link match · Esc: cancel</span></div>}
          <div className={`toast ${loading ? "loading" : ""}`}><i />{notice}</div>
          <div className="legend"><span><i className="point-key" />Unmatched</span><span><i className="point-key matched" />Matched</span><span><i className="line-key" />Network</span><span><i className="selection-key" />Selected in batch</span>{matching && <span><i className="preview-key" />Direction preview</span>}</div>

          {selectedPoint && <section className={`match-card ${matching ? "matching" : ""}`}>
            <div className="match-heading">
              <div><span className="eyebrow">SELECTED POINT</span><h2>{pointLabel(selectedPoint)}</h2><p>{selectedPoint.id} · {pointDirection(selectedPoint) || "No direction label"}</p></div>
              {!matching && <button className="match-button" onClick={() => beginMatch()}>{matches.has(selectedPoint.id) ? "Add links" : "Match to links"}<span>→</span></button>}
              {matching && <button className="cancel-button" onClick={() => { setMatching(false); setCandidates([]); setCandidateId(undefined); }}>Cancel</button>}
            </div>
            {!matching && (matches.get(selectedPoint.id) || []).length > 0 && <div className="saved-matches"><strong>Saved links for this point</strong>{matches.get(selectedPoint.id)!.map(record => <div key={record.link.properties.__uid}><button onClick={() => setCandidateId(record.link.properties.__uid)}>Show link {record.link.properties[linkIdColumn]}</button><button onClick={() => setMatches(current => removeMatch(current, selectedPoint.id, record.link.properties.__uid))}>Remove match</button></div>)}</div>}
            {matching && <div className="batch-summary"><strong>Matching {matchTargets.length} point(s)</strong><small>Every selected point will be matched to every added link. Existing matches are kept.</small><small>Point IDs: {matchTargets.join(", ")}</small></div>}
            {matching && <div className="point-data">
              <div className="point-data-title"><span className="eyebrow">POINT DATA</span><small>{Object.keys(selectedPoint.properties).length} columns</small></div>
              <dl>{Object.entries(selectedPoint.properties).map(([column, value]) => <div key={column}><dt>{column}</dt><dd>{value == null || value === "" ? "—" : String(value)}</dd></div>)}</dl>
            </div>}
            {matching && !candidates.length && <div className="instruction"><b>1</b><span><strong>Click a road link on the map</strong><small>Zoom in for precise selection. Overlapping directions will appear separately.</small></span></div>}
            {matching && candidates.length > 0 && <div className="candidate-area">
              <div className="candidate-title"><span><b>2</b><strong>Choose direction</strong></span><small>{candidates.length} link{candidates.length === 1 ? "" : "s"} at this location</small></div>
              <div className="candidate-list">{candidates.map((link, index) => {
                const coords = link.geometry.coordinates, uid = String(link.properties.__uid);
                return <button key={uid} className={candidateId === uid ? "active" : ""} onClick={() => setCandidateId(uid)}>
                  <i>{index + 1}</i><span><b>Link {link.properties[linkIdColumn] ?? uid}{chosenLinks.some(item => item.properties.__uid === uid) ? " (added)" : ""}</b><small>{shortCoordinate(coords[0])} <em>→</em> {shortCoordinate(coords[coords.length - 1])}</small></span><strong className="radio" />
                </button>;
              })}</div>
              <button className="confirm-button" disabled={!candidate || chosenLinks.some(link => link.properties.__uid === candidateId)} onClick={() => { if (candidate) setChosenLinks(current => current.some(link => link.properties.__uid === candidate.properties.__uid) ? current : [...current, candidate]); }}>Add this direction to selection</button>
            </div>}
            {matching && <div className="chosen-links"><strong>{chosenLinks.length} link(s) selected</strong><small>Click other roads to add more links, or confirm below.</small>{chosenLinks.map(link => <div key={link.properties.__uid}><button onClick={() => setCandidateId(link.properties.__uid)}>Show link {link.properties[linkIdColumn]}</button><button onClick={() => setChosenLinks(current => current.filter(item => item.properties.__uid !== link.properties.__uid))}>Remove from selection</button></div>)}<button className="confirm-button" onClick={confirmMatch} disabled={!chosenLinks.length}>Confirm {matchTargets.length} point(s) × {chosenLinks.length} link(s)</button></div>}
          </section>}
        </div>
      </section>
      {mappingDialog && <MappingDialog key={mappingDialog.title} title={mappingDialog.title} columns={mappingDialog.columns} fields={mappingDialog.fields} initial={mappingDialog.initial} onApply={mappingDialog.apply} onClose={() => setMappingDialog(undefined)} />}
      {exportOpen && <ExportDialog columns={exportColumns} makeCsv={exportMatches} onClose={() => setExportOpen(false)} onSaved={setNotice} />}
    </main>
  );
}
