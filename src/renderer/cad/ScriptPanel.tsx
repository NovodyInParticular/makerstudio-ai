// The sizes of a part script, as fields: change them and build. Shown in place of the
// inspector while a script is open.

import { useEffect, useState } from "react";
import type { ScriptParameter, ScriptValue } from "../../shared/ipc";
import { useProject } from "../state";
import type { CadObject } from "../../core/cad/model";
import { useCad } from "./cadState";
import { SizeReadout } from "./Inspector";
import { buildOpenScript, fileName, partsFromScript, useScript } from "./scriptParts";

/** A number field that only commits a valid number (on Enter or when leaving the field). */
function NumberField({ value, original, onChange, label }: { value: number; original: number; onChange(v: number): void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.trim().replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(n)) setText(String(value));
    else if (n !== value) onChange(n);
  };
  return (
    <input
      className={`script-num ${value !== original ? "changed" : ""}`}
      value={text}
      inputMode="decimal"
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(String(value)); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/** Edits a value of the same form as the script's: number, true/false, or a list of those. */
function ValueEditor({ value, original, onChange, label }: { value: ScriptValue; original: ScriptValue; onChange(v: ScriptValue): void; label: string }) {
  if (typeof original === "boolean") {
    return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={label} />;
  }
  if (Array.isArray(original)) {
    const list = Array.isArray(value) ? value : original;
    return (
      <span className="script-list">
        (
        {original.map((o, i) => (
          <ValueEditor key={i} value={list[i] ?? o} original={o} label={`${label} ${i + 1}`} onChange={(v) => onChange(list.map((x, k) => (k === i ? v : x)))} />
        ))}
        )
      </span>
    );
  }
  return <NumberField value={typeof value === "number" ? value : (original as number)} original={original as number} onChange={onChange} label={label} />;
}

function Row({ p }: { p: ScriptParameter }) {
  const changed = useScript((s) => s.values[p.name]);
  const set = useScript((s) => s.set);
  const value = changed ?? p.value!;
  return (
    <div className={`script-row ${changed !== undefined ? "is-changed" : ""}`} data-testid={`script-param-${p.name}`}>
      <div className="script-name">
        <code>{p.name}</code>
        {changed !== undefined && <button className="link-btn small" onClick={() => set(p.name, undefined)} title={`Back to the script's value: ${p.text}`}>reset</button>}
      </div>
      {p.editable ? <ValueEditor value={value} original={p.value!} onChange={(v) => set(p.name, v)} label={p.name} /> : <span className="muted small" title="Worked out from other sizes in the script">= {p.text}</span>}
      {p.comment && <div className="muted small script-comment">{p.comment}</div>}
    </div>
  );
}

export function ScriptPanel() {
  const { path, parameters, values, building, log } = useScript();
  const objects = useProject((s) => s.project.document.workspaces.cad.objects);
  const [filter, setFilter] = useState("");
  const [showLog, setShowLog] = useState(false);
  const selection = useCad((s) => s.selection);
  if (!path) return null;
  const existing = partsFromScript(path);
  // Size of the selected parts made by this script (or all of them), so changes can be checked here.
  const mine = new Set(existing.map((o) => o.id));
  const picked = selection.filter((id) => mine.has(id));
  const measured = picked.length ? picked : existing.map((o) => o.id);
  const changed = Object.keys(values).length;
  const shown = (parameters ?? []).filter((p) => !filter || `${p.name} ${p.comment} ${p.group}`.toLowerCase().includes(filter.toLowerCase()));
  const groups = [...new Set(shown.map((p) => p.group))];
  return (
    <aside className="inspector script-panel" data-testid="script-panel">
      <div className="script-head">
        <h3 title={path}>{fileName(path)}</h3>
        <button className="btn plain small" onClick={() => useScript.getState().close()} data-testid="script-close">Close</button>
      </div>
      <p className="muted small">
        Sizes from the script's PARAMETERS block, in mm. Builds use a temporary copy: <strong>your script and its out folder are not changed</strong>.
      </p>
      {measured.length > 0 && (
        <div className="script-size">
          <span className="muted small">{picked.length === 1 ? (objects as CadObject[]).find((o) => o.id === picked[0])?.name : picked.length ? `${picked.length} selected parts` : "All its parts"}:</span>
          <SizeReadout ids={measured} objects={objects as CadObject[]} />
        </div>
      )}
      <div className="script-actions">
        <button className="btn primary small" disabled={building} onClick={() => void buildOpenScript()} data-testid="script-build">
          {building ? "Building…" : existing.length ? `Rebuild ${existing.length === 1 ? "part" : `${existing.length} parts`}` : "Build and add"}
        </button>
        {changed > 0 && <span className="muted small">{changed} changed</span>}
      </div>
      {parameters === null ? (
        <p className="muted small">This script has no "# === PARAMETERS ===" block, so there are no sizes to change here.</p>
      ) : (
        <>
          <input className="script-filter" placeholder="Find a size…" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="script-filter" />
          {groups.map((g) => (
            <section key={g || "general"} className="script-group">
              <h4>{g || "General"}</h4>
              {shown.filter((p) => p.group === g).map((p) => <Row key={p.name} p={p} />)}
            </section>
          ))}
          {shown.length === 0 && <p className="muted small">No size matches "{filter}".</p>}
        </>
      )}
      {log && (
        <section className="script-group">
          <button className="link-btn small" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide" : "Show"} the script's output</button>
          {showLog && <pre className="script-log" data-testid="script-log">{log}</pre>}
        </section>
      )}
    </aside>
  );
}
