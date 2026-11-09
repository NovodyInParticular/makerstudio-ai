// The 3D Studio workspace: shapes and object list on the left, viewport in the middle, inspector on the right.

import { useEffect, useState } from "react";
import { setProps } from "../../core/cad/commands";
import type { Severity } from "../../core/cad/printcheck";
import type { SlicerStatus } from "../../shared/ipc";
import { PRIMITIVE_KINDS, KIND_LABELS, type CadObject, type PrimitiveKind } from "../../core/cad/model";
import { useProject } from "../state";
import { addPrimitive, run, useCad, type GizmoMode, type ViewPreset } from "./cadState";
import { exportEachPart, exportModel, importModels } from "./fileActions";
import { openInBambuStudio, orientForPrinting, runPrintCheck } from "./printActions";
import { Inspector } from "./Inspector";
import { ScriptPanel } from "./ScriptPanel";
import { openScript, useScript } from "./scriptParts";
import { Viewport } from "./Viewport";

// Small original pictograms for the shape palette.
const SHAPE_ICONS: Record<PrimitiveKind, string> = {
  box: "M5 8l7-4 7 4v8l-7 4-7-4zM5 8l7 4 7-4M12 12v8",
  sphere: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5",
  cylinder: "M6 6c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5S6 7.4 6 6zm0 0v12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6",
  cone: "M12 3 5.5 18c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5zM5.5 18c0-1.4 2.9-2.5 6.5-2.5s6.5 1.1 6.5 2.5",
  torus: "M12 7c4.7 0 8.5 2.2 8.5 5s-3.8 5-8.5 5-8.5-2.2-8.5-5 3.8-5 8.5-5zm0 3c-2.2 0-4 .9-4 2s1.8 2 4 2 4-.9 4-2-1.8-2-4-2z",
  wedge: "M4 19h16L4 7zM4 7l3-2 16 12-3 2",
  text: "M5 6h14M12 6v13M9 19h6",
};

function ShapePalette() {
  return (
    <section className="cad-section">
      <h4>Shapes</h4>
      <div className="shape-grid">
        {PRIMITIVE_KINDS.map((kind) => (
          <button
            key={kind}
            className="shape-btn"
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("application/x-makerstudio-shape", kind); e.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => addPrimitive(kind)}
            title={`Add a ${KIND_LABELS[kind].toLowerCase()} (click, or drag onto the bed)`}
            data-testid={`add-${kind}`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d={SHAPE_ICONS[kind]} /></svg>
            <span>{KIND_LABELS[kind]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function FilePanel() {
  const hasSelection = useCad((s) => s.selection.length > 0);
  const scope = hasSelection ? "selection" : "all";
  return (
    <section className="cad-section">
      <h4>Files</h4>
      <div className="file-actions">
        <button className="btn plain small" onClick={() => void importModels()} title="Import STL or OBJ (units: mm), STEP or 3MF files" data-testid="import-model">Import STL / OBJ / STEP / 3MF…</button>
        <button className="btn plain small" onClick={() => void exportModel("stl")} title={`Export the ${scope} as one STL file`} data-testid="export-stl">Export STL…</button>
        <button className="btn plain small" onClick={() => void exportModel("obj")} title={`Export the ${scope} as one OBJ file`} data-testid="export-obj">Export OBJ…</button>
        <button className="btn plain small" onClick={() => void exportModel("step")} title={`Export the ${scope} as one STEP file (exact solids for CAD programs)`} data-testid="export-step">Export STEP…</button>
        <button className="btn plain small" onClick={() => void exportEachPart()} title="Export each top-level object as its own STL file" data-testid="export-parts">Export parts…</button>
        <button className="btn plain small" onClick={() => void openScript()} title="Open a Python part script with a PARAMETERS block: change its sizes and build it" data-testid="open-script">Script part…</button>
      </div>
      <p className="muted small">Exports {hasSelection ? "the selected objects" : "all visible objects"}.</p>
    </section>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = { error: "Problem", warning: "Warning", info: "Note" };

function PrintPanel() {
  const hasSelection = useCad((s) => s.selection.length > 0);
  const check = useCad((s) => s.printCheck);
  const showIssues = useCad((s) => s.showPrintIssues);
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const [slicer, setSlicer] = useState<SlicerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    window.makerstudio.slicerStatus().then((status) => alive && setSlicer(status), () => alive && setSlicer({ found: false, name: "Bambu Studio", location: null }));
    return () => { alive = false; };
  }, []);
  const stale = check !== null && check.objects !== objects;
  const scope = hasSelection ? "the selected objects" : "all visible objects";
  const hasAreas = check?.report.parts.some((p) => p.overhangTriangles.length || p.thinTriangles.length) ?? false;
  return (
    <section className="cad-section" data-testid="print-panel">
      <h4>Print <span className="muted">({check?.report.printer.name ?? "printer from Settings"})</span></h4>
      <div className="file-actions">
        <button className="btn plain small" onClick={runPrintCheck} title={`Check ${scope} for printing: size, bed, overhangs, thin walls`} data-testid="print-check">Check for printing</button>
        <button className="btn plain small" onClick={orientForPrinting} title={`Turn ${scope} to the position with the least overhang and the most on the bed (undoable)`} data-testid="print-orient">Orient</button>
        <button
          className="btn plain small"
          onClick={() => void openInBambuStudio()}
          disabled={!slicer?.found}
          title={slicer?.found ? `Export ${scope} (one STL per part) and open them in Bambu Studio (${slicer.location})` : "Bambu Studio was not found on this computer"}
          data-testid="print-slicer"
        >
          Bambu Studio
        </button>
      </div>
      {check && stale && (
        <p className="muted small" data-testid="print-stale">The model changed since the last check. <button className="link-btn" onClick={runPrintCheck}>Check again</button></p>
      )}
      {check && !stale && (
        <div className="print-results" data-testid="print-results">
          {check.report.parts.map((part) => (
            <div key={part.id} className="print-part">
              <button className="link-btn print-part-name" onClick={() => useCad.getState().select([part.id])} title="Select this part">{part.name}</button>
              <span className="muted small"> {part.size.map((n) => Math.round(n * 10) / 10).join(" × ")} mm</span>
              {part.issues.length === 0 ? (
                <div className="print-issue ok">No problems found.</div>
              ) : (
                part.issues.map((issue, i) => (
                  <div key={i} className={`print-issue ${issue.severity}`} data-testid={`print-issue-${issue.code}`}>
                    <b>{SEVERITY_LABEL[issue.severity]}:</b> {issue.message}
                  </div>
                ))
              )}
            </div>
          ))}
          {hasAreas && (
            <label className="print-legend">
              <input type="checkbox" checked={showIssues} onChange={(e) => useCad.getState().setShowPrintIssues(e.target.checked)} />
              Show in the view: <span className="key overhang">overhang</span> <span className="key thin">thin wall</span>
            </label>
          )}
          <p className="muted small">These are estimates from the shape. The slicer has the final say.</p>
        </div>
      )}
    </section>
  );
}

function TreeRow({ object, all, depth }: { object: CadObject; all: CadObject[]; depth: number }) {
  const selected = useCad((s) => s.selection.includes(object.id));
  const children = all.filter((o) => o.parentId === object.id);
  return (
    <>
      <li
        className={`tree-row ${selected ? "selected" : ""} ${object.visible ? "" : "hidden-obj"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => {
          const cad = useCad.getState();
          if (e.shiftKey || e.ctrlKey || e.metaKey) cad.toggle(object.id);
          else cad.select([object.id]);
        }}
        data-testid="tree-row"
      >
        <span className="swatch" style={{ background: object.hole ? "transparent" : object.color, borderColor: object.hole ? "#9aa5ae" : object.color }} />
        <span className="tree-name">{object.name}</span>
        {object.hole && <span className="badge">hole</span>}
        {object.locked && <span className="badge">locked</span>}
        <button
          className="eye"
          title={object.visible ? "Hide" : "Show"}
          aria-label={object.visible ? `Hide ${object.name}` : `Show ${object.name}`}
          onClick={(e) => { e.stopPropagation(); run(setProps({ ids: [object.id], props: { visible: !object.visible } })); }}
        >
          {object.visible ? "●" : "○"}
        </button>
      </li>
      {children.map((c) => <TreeRow key={c.id} object={c} all={all} depth={depth + 1} />)}
    </>
  );
}

function ObjectList() {
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const roots = objects.filter((o) => o.parentId === null);
  return (
    <section className="cad-section grow">
      <h4>Objects <span className="muted">({objects.filter((o) => o.kind !== "group").length})</span></h4>
      {roots.length === 0 ? <p className="muted small">No objects yet.</p> : (
        <ul className="tree" data-testid="object-list">
          {roots.map((o) => <TreeRow key={o.id} object={o} all={objects} depth={0} />)}
        </ul>
      )}
    </section>
  );
}

function Toolbar() {
  const gizmo = useCad((s) => s.gizmo);
  const camera = useCad((s) => s.camera);
  const tool = useCad((s) => s.tool);
  const cad = useCad.getState();
  const modes: [GizmoMode, string, string][] = [["translate", "Move", "T"], ["rotate", "Rotate", "R"], ["scale", "Scale", "S"]];
  const views: [ViewPreset, string][] = [["home", "Home"], ["top", "Top"], ["front", "Front"], ["right", "Right"], ["fit", "Fit"]];
  return (
    <div className="viewport-toolbar">
      <div className="seg">
        {modes.map(([mode, label, key]) => (
          <button key={mode} className={gizmo === mode ? "on" : ""} onClick={() => cad.setGizmo(mode)} title={`${label} (${key})`}>{label}</button>
        ))}
      </div>
      <div className="seg">
        {views.map(([preset, label]) => (
          <button key={preset} onClick={() => cad.requestView(preset)} title={preset === "fit" ? "Fit all objects (F)" : `${label} view`}>{label}</button>
        ))}
      </div>
      <div className="seg">
        <button className={camera === "perspective" ? "on" : ""} onClick={() => cad.setCamera("perspective")} title="Perspective (P)">Persp</button>
        <button className={camera === "orthographic" ? "on" : ""} onClick={() => cad.setCamera("orthographic")} title="Orthographic (P)">Ortho</button>
      </div>
      <div className="seg">
        <button className={`tool-btn ${tool === "measure" ? "on" : ""}`} onClick={() => cad.setTool(tool === "measure" ? "select" : "measure")} title="Measure the distance between two points (M)" data-testid="tool-measure">Measure</button>
        <button className={`tool-btn ${tool === "workplane" ? "on" : ""}`} onClick={() => cad.setTool(tool === "workplane" ? "select" : "workplane")} title="Build on a face of a shape (W)" data-testid="tool-workplane">Workplane</button>
      </div>
    </div>
  );
}

export function CadWorkspace() {
  const scriptOpen = useScript((s) => s.path !== null);
  return (
    <div className="cad-workspace">
      <div className="cad-left">
        <ShapePalette />
        <FilePanel />
        <PrintPanel />
        <ObjectList />
      </div>
      <div className="cad-center">
        <Toolbar />
        <Viewport />
      </div>
      {scriptOpen ? <ScriptPanel /> : <Inspector />}
    </div>
  );
}
