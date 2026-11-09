// Right-hand panel of the 3D Studio: exact sizes, position, rotation and actions for the selection.

import { useEffect, useMemo, useState } from "react";
import { Vector3 } from "three";
import { setBooleanMode, setParams, setProps, setText, setTransforms } from "../../core/cad/commands";
import { cachedMeshInfo, meshInfo } from "./printWorker";
import { editScriptOf } from "./scriptParts";
import { worldBounds } from "../../core/cad/geometry";
import { getMesh } from "../../core/cad/meshes";
import { KIND_LABELS, paramLabel, type CadObject, type Transform } from "../../core/cad/model";
import { ask, useProject } from "../state";
import {
  alignSelected, booleanSelected, deleteSelected, dropSelected, duplicateSelected, groupSelected, run, toggleHoleSelected, ungroupSelected, useCad,
} from "./cadState";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function NumInput(props: { value: number; onCommit(v: number): void; step?: number; label: string; unit?: string; testId?: string; disabled?: boolean }) {
  const [text, setText] = useState(fmt(props.value));
  useEffect(() => setText(fmt(props.value)), [props.value]);
  const commit = () => {
    const v = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(v)) {
      if (v !== props.value) props.onCommit(v);
    }
    setText(fmt(props.value));
  };
  return (
    <label className="num-input" title={props.label}>
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step ?? 1}
        value={text}
        disabled={props.disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setText(fmt(props.value)); (e.target as HTMLInputElement).blur(); }
        }}
        data-testid={props.testId}
      />
      {props.unit && <em>{props.unit}</em>}
    </label>
  );
}

function TransformFields({ object }: { object: CadObject }) {
  const t = object.transform;
  const update = (key: keyof Transform, axis: number, value: number) => {
    const next = [...t[key]] as [number, number, number];
    next[axis] = value;
    run(setTransforms({ updates: [{ id: object.id, transform: { [key]: next } }], label: `Set ${key}` }));
  };
  const axes = ["X", "Y", "Z"];
  return (
    <>
      <h4>Position</h4>
      <div className="xyz">
        {axes.map((a, i) => <NumInput key={a} label={a} unit="mm" value={t.position[i]!} disabled={object.locked} onCommit={(v) => update("position", i, v)} testId={`pos-${a.toLowerCase()}`} />)}
      </div>
      <h4>Rotation</h4>
      <div className="xyz">
        {axes.map((a, i) => <NumInput key={a} label={a} unit="°" step={15} value={t.rotation[i]!} disabled={object.locked} onCommit={(v) => update("rotation", i, v)} />)}
      </div>
      <h4>Scale</h4>
      <div className="xyz">
        {axes.map((a, i) => <NumInput key={a} label={a} unit="×" step={0.1} value={t.scale[i]!} disabled={object.locked} onCommit={(v) => update("scale", i, v)} />)}
      </div>
    </>
  );
}

export function SizeReadout({ ids, objects }: { ids: string[]; objects: CadObject[] }) {
  const box = useMemo(() => worldBounds(ids, objects), [ids, objects]);
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  return (
    <div className="size-readout" data-testid="size-readout">
      <span>{fmt(size.x)} × {fmt(size.y)} × {fmt(size.z)} mm</span>
      <span className="muted small">bottom at Z {fmt(box.min.z)} mm</span>
    </div>
  );
}

function AlignTools() {
  const labels = { min: "Min", center: "Centre", max: "Max" } as const;
  return (
    <>
      <h4>Align</h4>
      <div className="align-grid">
        {(["X", "Y", "Z"] as const).map((axisName, axis) => (
          <div key={axisName} className="align-row">
            <span>{axisName}</span>
            {(["min", "center", "max"] as const).map((mode) => (
              <button key={mode} className="btn plain small" onClick={() => alignSelected(axis as 0 | 1 | 2, mode)} data-testid={`align-${axisName}-${mode}`}>
                {labels[mode]}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function BooleanTools() {
  const csgReady = useCad((s) => s.csgReady);
  return (
    <>
      <h4>Combine</h4>
      <div className="bool-row">
        <button className="btn plain small" disabled={!csgReady} onClick={() => booleanSelected("union")} title="Join the shapes into one solid" data-testid="bool-union">Union</button>
        <button className="btn plain small" disabled={!csgReady} onClick={() => booleanSelected("subtract")} title="Cut the other shapes out of the first one you selected" data-testid="bool-subtract">Subtract</button>
        <button className="btn plain small" disabled={!csgReady} onClick={() => booleanSelected("intersect")} title="Keep only the space shared by all shapes" data-testid="bool-intersect">Intersect</button>
      </div>
      <p className="muted small">Subtract keeps the object you selected first. Each result is a group, so Ungroup brings the pieces back.</p>
    </>
  );
}

function TextField({ object }: { object: CadObject }) {
  const [value, setValue] = useState(object.text ?? "");
  useEffect(() => setValue(object.text ?? ""), [object.text]);
  const commit = () => {
    if (value === object.text) return;
    if (!run(setText({ id: object.id, text: value }))) setValue(object.text ?? "");
  };
  return (
    <>
      <h4>Text</h4>
      <input
        className="text-input"
        type="text"
        maxLength={200}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setValue(object.text ?? ""); (e.target as HTMLInputElement).blur(); }
        }}
        data-testid="text-input"
      />
    </>
  );
}

function MeshInfo({ object }: { object: CadObject }) {
  const data = getMesh(object.mesh);
  const [checked, setChecked] = useState(() => cachedMeshInfo(object.mesh));
  useEffect(() => {
    let alive = true;
    setChecked(cachedMeshInfo(object.mesh));
    void meshInfo(object).then((r) => { if (alive && r) setChecked(r); });
    return () => { alive = false; };
  }, [object.mesh]); // eslint-disable-line react-hooks/exhaustive-deps
  // Checked in the background (a big figure takes seconds); "checking…" until then.
  const info = data ? { triangles: data.indices.length / 3, watertight: checked ? checked.watertight : null, volume: checked?.volume ?? 0 } : null;
  if (!info) return <p className="error-text small">The mesh data is missing.</p>;
  const s = object.transform.scale;
  const setScale = (f: number) => run(setTransforms({ updates: [{ id: object.id, transform: { scale: [s[0] * f, s[1] * f, s[2] * f] } }], label: "Scale" }));
  return (
    <>
      <h4>Imported mesh</h4>
      <dl className="key-list" data-testid="mesh-info">
        <dt>Triangles</dt><dd>{info.triangles.toLocaleString("en")}</dd>
        <dt>Watertight</dt><dd>{info.watertight === null ? "checking…" : info.watertight ? "Yes (closed solid)" : "No: cannot be cut or combined"}</dd>
        {info.watertight && <><dt>Volume</dt><dd>{fmt(info.volume / 1000)} cm³ (unscaled)</dd></>}
      </dl>
      {object.script ? (
        <div className="script-source" data-testid="script-source">
          <p className="small">Made by <code title={object.script.path}>{object.script.path.split(/[\\/]/).pop()}</code> ({object.script.output}){Object.keys(object.script.values).length ? `, ${Object.keys(object.script.values).length} size(s) changed` : ""}.</p>
          <button className="btn primary small" onClick={() => void editScriptOf(object)} data-testid="script-edit">Change sizes…</button>
        </div>
      ) : <p className="muted small">Mesh files have no units. Wrong size? Convert it:</p>}
      <div className="inspector-actions">
        <button className="btn plain small" disabled={object.locked} onClick={() => setScale(25.4)} title="The file was in inches">inches → mm</button>
        <button className="btn plain small" disabled={object.locked} onClick={() => setScale(10)} title="The file was in centimetres">cm → mm</button>
      </div>
    </>
  );
}

function GroupMode({ object }: { object: CadObject }) {
  const mode = object.boolean ?? "union";
  return (
    <>
      <h4>How shapes combine</h4>
      <div className="seg" data-testid="group-mode">
        <button className={mode === "union" ? "on" : ""} onClick={() => mode !== "union" && run(setBooleanMode({ id: object.id, mode: "union" }))}>Union</button>
        <button className={mode === "intersect" ? "on" : ""} onClick={() => mode !== "intersect" && run(setBooleanMode({ id: object.id, mode: "intersect" }))}>Intersect</button>
      </div>
      <p className="muted small">Holes inside the group are always cut out.</p>
    </>
  );
}

export function Inspector() {
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const rawSelection = useCad((s) => s.selection);
  const ids = useMemo(() => rawSelection.filter((id) => objects.some((o) => o.id === id)), [rawSelection, objects]);
  const selected = ids.map((id) => objects.find((o) => o.id === id)!);

  if (selected.length === 0) {
    return (
      <aside className="inspector" data-testid="inspector">
        <h3>Nothing selected</h3>
        <p className="muted small">Click a shape on the left to add it, or drag it onto the bed. Click an object to select it; Shift+click to select several.</p>
        <dl className="key-list">
          <dt>T / R / S</dt><dd>Move / rotate / scale handles</dd>
          <dt>Arrows</dt><dd>Nudge by one grid step (Shift: ×10)</dd>
          <dt>PgUp / PgDn</dt><dd>Raise / lower</dd>
          <dt>Ctrl+D</dt><dd>Duplicate</dd>
          <dt>Ctrl+G</dt><dd>Group (Ctrl+Shift+G: ungroup)</dd>
          <dt>H</dt><dd>Hole / solid</dd>
          <dt>D</dt><dd>Drop to bed</dd>
          <dt>M</dt><dd>Measure between two points</dd>
          <dt>W</dt><dd>Workplane: build on a face</dd>
          <dt>F</dt><dd>Fit view</dd>
          <dt>P</dt><dd>Perspective / orthographic</dd>
          <dt>Delete</dt><dd>Delete (undo with Ctrl+Z)</dd>
        </dl>
      </aside>
    );
  }

  if (selected.length > 1) {
    return (
      <aside className="inspector" data-testid="inspector">
        <h3>{selected.length} objects selected</h3>
        <SizeReadout ids={ids} objects={objects} />
        <BooleanTools />
        <AlignTools />
        <div className="inspector-actions">
          <button className="btn plain small" onClick={groupSelected}>Group</button>
          <button className="btn plain small" onClick={duplicateSelected}>Duplicate</button>
          <button className="btn plain small" onClick={toggleHoleSelected}>Hole / solid</button>
          <button className="btn plain small" onClick={dropSelected}>Drop to bed</button>
          <button className="btn danger small" onClick={deleteSelected}>Delete</button>
        </div>
      </aside>
    );
  }

  const object = selected[0]!;
  const rename = async () => {
    const { button, text } = await ask({
      title: "Rename",
      message: "New name for this object:",
      input: { label: "Name", value: object.name },
      buttons: [{ label: "Cancel", value: "cancel", variant: "plain" }, { label: "Rename", value: "ok", variant: "primary" }],
    });
    if (button === "ok" && text.trim()) run(setProps({ ids: [object.id], props: { name: text.trim() } }));
  };

  return (
    <aside className="inspector" data-testid="inspector">
      <div className="inspector-title">
        <h3 title="Click to rename"><button className="name-btn" onClick={() => void rename()}>{object.name}</button></h3>
        <span className="badge">{KIND_LABELS[object.kind]}</span>
      </div>
      <SizeReadout ids={ids} objects={objects} />

      {object.kind === "text" && <TextField object={object} />}
      {object.kind === "group" && <GroupMode object={object} />}
      {object.kind === "mesh" && <MeshInfo object={object} />}

      {object.kind !== "group" && object.kind !== "mesh" && (
        <>
          <h4>Dimensions</h4>
          <div className="params">
            {Object.entries(object.params).map(([key, value]) => {
              const meta = paramLabel(object.kind, key);
              return (
                <NumInput key={key} label={meta.label} unit={meta.unit} step={meta.integer ? 4 : 1} value={value}
                  onCommit={(v) => run(setParams({ id: object.id, params: { [key]: meta.integer ? Math.round(v) : v } }))}
                  testId={`param-${key}`} />
              );
            })}
          </div>
        </>
      )}

      <TransformFields object={object} />

      <h4>Appearance</h4>
      <div className="appearance">
        <label className="toggle">
          <input type="checkbox" checked={object.hole} onChange={toggleHoleSelected} data-testid="hole-toggle" />
          Hole <span className="muted small">(cut out of shapes it is grouped with)</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={object.locked} onChange={(e) => run(setProps({ ids: [object.id], props: { locked: e.target.checked } }))} />
          Locked
        </label>
        <label className="toggle">
          <input type="color" value={object.color} onChange={(e) => run(setProps({ ids: [object.id], props: { color: e.target.value } }))} />
          Colour
        </label>
      </div>

      <div className="inspector-actions">
        {object.kind === "group" && <button className="btn plain small" onClick={ungroupSelected}>Ungroup</button>}
        <button className="btn plain small" onClick={duplicateSelected}>Duplicate</button>
        <button className="btn plain small" onClick={dropSelected}>Drop to bed</button>
        <button className="btn danger small" onClick={deleteSelected} data-testid="delete">Delete</button>
      </div>
    </aside>
  );
}
