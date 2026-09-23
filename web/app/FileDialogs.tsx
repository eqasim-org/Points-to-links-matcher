"use client";
import { useRef, useState, useEffect } from "react";

export function FileDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="file-dialog" onCancel={onClose}><header><h2>{title}</h2><button onClick={onClose} aria-label="Close dialog">×</button></header>{children}</dialog>;
}

export function MappingDialog({ title, columns, fields, initial, onApply, onClose }: {
  title: string; columns: string[]; fields: { key: string; label: string; optional?: boolean }[];
  initial: Record<string, string>; onApply: (mapping: Record<string, string>) => void | Promise<void>; onClose: () => void;
}) {
  const [mapping, setMapping] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <FileDialog title={title} onClose={onClose}><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onApply(mapping); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }}><p>Choose how the file's columns should be used. Coordinates must be longitude/latitude in degrees (WGS84).</p>
    {fields.map(field => <label className="mapping-field" key={field.key}>{field.label}<select required={!field.optional} value={mapping[field.key] || ""} onChange={event => setMapping({ ...mapping, [field.key]: event.target.value })}><option value="">{field.optional ? "None" : "Select a column"}</option>{columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>)}
    {error && <p role="alert" className="file-error">{error}</p>}<footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button disabled={busy} type="submit">{busy ? "Loading…" : "Apply mapping"}</button></footer>
  </form></FileDialog>;
}

export type ExportColumn = { key: string; label: string; header: string };
export function ExportDialog({ columns, makeCsv, onClose, onSaved }: { columns: ExportColumn[]; makeCsv: (keys: string[]) => string; onClose: () => void; onSaved: (message: string) => void }) {
  const [selected, setSelected] = useState(columns.map(column => column.key));
  const [filename, setFilename] = useState("matched_points.csv");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = (window as typeof window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  return <FileDialog title="Export matched points" onClose={onClose}><form onSubmit={async event => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
      const blob = new Blob(["\uFEFF", makeCsv(selected)], { type: "text/csv;charset=utf-8" });
      if (picker) {
        const handle = await picker.call(window, { suggestedName: name, types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }] });
        const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
        onSaved("Matched CSV saved");
      } else {
        const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        onSaved("CSV downloaded. Your browser controls the download location.");
      }
      onClose();
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }}><label className="mapping-field">File name<input required value={filename} onChange={event => setFilename(event.target.value)} /></label>
    <p>{picker ? "Choose the folder and file name in the Save As dialog." : "This browser cannot open a Save As picker. Enable “Ask where to save each file” in its download settings, or open this app in Chrome or Edge."}</p>
    <p>Include the point ID and link ID columns if you want to resume from this CSV later. Geometry is always excluded.</p>
    <div className="column-actions"><button type="button" onClick={() => setSelected(columns.map(column => column.key))}>Select all</button><button type="button" onClick={() => setSelected([])}>Clear</button></div>
    <div className="export-columns">{columns.map(column => <label key={column.key}><input type="checkbox" checked={selected.includes(column.key)} onChange={event => setSelected(event.target.checked ? [...selected, column.key] : selected.filter(key => key !== column.key))} />{column.label}<small>{column.header}</small></label>)}</div>
    {error && <p className="file-error" role="alert">{error}</p>}<footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={!selected.length || busy}>{busy ? "Saving…" : picker ? "Save as…" : "Download CSV"}</button></footer>
  </form></FileDialog>;
}
