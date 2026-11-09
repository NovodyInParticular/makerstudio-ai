// Parts Library: searchable catalog where every spec shows its source and how sure it is.

import { useMemo, useState } from "react";
import { addObject, cadObjects } from "../../core/cad/commands";
import { IDENTITY, PALETTE, type CadObject } from "../../core/cad/model";
import { componentDef } from "../../core/circuit/catalog";
import { addPart, circuitOf } from "../../core/circuit/commands";
import { addScreen } from "../../core/display/commands";
import { DEFAULT_FACE, type Screen } from "../../core/display/face";
import { CATEGORIES, LIBRARY, STATUS_INFO, searchParts, type LibraryPart, type PartSpec } from "../../core/parts/library";
import type { Command } from "../../core/document/commands";
import { newId } from "../../shared/format";
import { projectStore, useUi } from "../state";

function run(command: Command, done: string): boolean {
  try {
    projectStore.getState().execute(command);
    useUi.getState().notify("success", done);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

const fmt = (s: PartSpec) => (s.value === null ? "unknown" : `${Number(s.value.toFixed(3))}${s.unit ? ` ${s.unit}` : ""}`);

function addToCircuit(p: LibraryPart) {
  const def = componentDef(p.circuitType!)!;
  const parts = circuitOf(projectStore.getState().project).components;
  const x = parts.reduce((m, c) => Math.max(m, c.x + 20), 0);
  const used = new Set(parts.map((c) => c.label));
  let label = def.name.split(" (")[0]!;
  for (let n = 2; used.has(label); n++) label = `${def.name.split(" (")[0]} ${n}`;
  run(addPart({ component: { id: newId(), type: def.id, label, x, y: 0, rotation: 0, props: Object.fromEntries(def.props.map((q) => [q.key, q.default])) } }), `Added "${label}" to Circuit Studio.`);
}

function addBlock(p: LibraryPart) {
  const { x, y, z } = p.size!;
  const n = cadObjects(projectStore.getState().project).length;
  const object: CadObject = {
    id: newId(), name: `${p.name} (size block)`, kind: "box", params: { width: x.value!, depth: y.value!, height: z.value! },
    transform: { ...IDENTITY }, hole: false, color: PALETTE[n % PALETTE.length]!, parentId: null, visible: true, locked: false,
  };
  run(addObject({ object }), `Added a ${x.value} × ${y.value} × ${z.value} mm block for "${p.name}" to 3D Studio (outer size only, to design around).`);
}

function addDisplay(p: LibraryPart) {
  const screens = projectStore.getState().project.document.workspaces.displays.screens as Screen[];
  let k = 1;
  while (screens.some((s) => s.name === `Face ${k}`)) k++;
  run(addScreen({ screen: { id: newId(), name: `Face ${k}`, display: p.displayId!, face: { ...DEFAULT_FACE } } }), `Added a face for "${p.name}" in Display Studio.`);
}

export function PartsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sel, setSel] = useState<string>(LIBRARY[0]!.id);
  const results = useMemo(() => searchParts(q, cat), [q, cat]);
  const part = LIBRARY.find((p) => p.id === sel) ?? results[0];
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, LIBRARY.filter((p) => p.category === c).length])), []);
  return (
    <div className="parts-page">
      <aside className="parts-list">
        <input className="parts-search" placeholder={`Search ${LIBRARY.length} parts (e.g. "camera", "i2c", "608")`} value={q} onChange={(e) => setQ(e.target.value)} data-testid="parts-search" autoFocus />
        <div className="parts-cats">
          <button className={!cat ? "on" : ""} onClick={() => setCat(null)}>All</button>
          {CATEGORIES.filter((c) => counts[c]).map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)} data-testid={`parts-cat-${c}`}>{c} <span className="muted">{counts[c]}</span></button>)}
        </div>
        <div className="parts-results" data-testid="parts-results">
          {results.length === 0 && <p className="muted small">No parts match.</p>}
          {results.map((p) => (
            <button key={p.id} className={`parts-row ${part?.id === p.id ? "on" : ""}`} onClick={() => setSel(p.id)} data-testid={`part-row-${p.id}`}>
              <span>{p.name}</span>
              <span className="muted small">{p.category}{p.generic ? " · generic" : p.manufacturer ? ` · ${p.manufacturer}` : ""}</span>
            </button>
          ))}
        </div>
      </aside>
      {part && (
        <section className="parts-detail card" data-testid="part-detail">
          <h1>{part.name}</h1>
          <p className="muted">{part.category}{part.manufacturer ? ` · ${part.manufacturer}` : ""}{part.generic ? " · generic part: sold by many makers, details vary" : ""}</p>
          <p>{part.summary}</p>
          <div className="button-row">
            {part.circuitType && <button className="btn primary small" onClick={() => addToCircuit(part)} data-testid="part-add-circuit">Add to Circuit Studio</button>}
            {part.displayId && <button className="btn primary small" onClick={() => addDisplay(part)} data-testid="part-add-display">Design a face for it</button>}
            {part.size && [part.size.x, part.size.y, part.size.z].every((s) => s.value !== null) && <button className="btn plain small" onClick={() => addBlock(part)} data-testid="part-add-block">Add size block to 3D Studio</button>}
          </div>
          <h3>Specifications</h3>
          <table className="spec-table" data-testid="spec-table">
            <thead><tr><th>Spec</th><th>Value</th><th>How sure</th><th>Source</th></tr></thead>
            <tbody>
              {[...part.specs, ...(part.size ? [part.size.x, part.size.y, part.size.z] : [])].map((s, i) => (
                <tr key={i}>
                  <td>{s.label}</td>
                  <td className="mono">{fmt(s)}</td>
                  <td><span className={`spec-badge ${s.status}`} title={STATUS_INFO[s.status]}>{s.status}</span></td>
                  <td className="muted small">{s.source ?? "—"}</td>
                </tr>
              ))}
              {part.specs.length === 0 && <tr><td colSpan={4} className="muted">No specs recorded yet.</td></tr>}
            </tbody>
          </table>
          {part.interfaces.length > 0 && <p className="small"><b>Interfaces:</b> {part.interfaces.join(", ")}</p>}
          {part.notes && <p className="small">{part.notes}</p>}
          <p className="muted small"><b>Sources:</b> {part.sources.join("; ")}</p>
          <p className="muted small">Badges: <b>manufacturer</b> / <b>standard</b> = from the document named; <b>estimated</b> = typical value, check your part; <b>unknown</b> = not recorded rather than guessed.</p>
        </section>
      )}
    </div>
  );
}
