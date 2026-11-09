// 3D Studio interface state (not saved in the project) and the actions used by
// buttons, the keyboard and the viewport.

import { Euler, Quaternion, Vector3 } from "three";
import { create } from "zustand";
import {
  addObject, alignObjects, booleanOp, cadObjects, deleteObjects, dropToBed, duplicateObjects, groupObjects, planDuplicate, setProps, setTransforms, ungroup,
  type AlignMode, type BooleanOp,
} from "../../core/cad/commands";
import { byId, rootOf } from "../../core/cad/geometry";
import { DEFAULT_PARAMS, IDENTITY, KIND_LABELS, PALETTE, type CadObject, type PrimitiveKind } from "../../core/cad/model";
import type { Command } from "../../core/document/commands";
import type { ExportPart } from "../../core/cad/exporting";
import type { PrintReport } from "../../core/cad/printcheck";
import { newId } from "../../shared/format";
import { projectStore, useUi } from "../state";

export type GizmoMode = "translate" | "rotate" | "scale";
export type CameraMode = "perspective" | "orthographic";
export type ViewPreset = "home" | "top" | "front" | "right" | "fit";
export type Tool = "select" | "measure" | "workplane";

export interface Workplane {
  origin: [number, number, number];
  normal: [number, number, number];
}

export interface PrintCheckState {
  report: PrintReport;
  /** The world-space meshes that were checked (for highlighting problem areas). */
  parts: ExportPart[];
  objects: CadObject[];
}

interface CadUiState {
  selection: string[];
  gizmo: GizmoMode;
  camera: CameraMode;
  /** Changing this object asks the viewport to move the camera. */
  viewRequest: { preset: ViewPreset; n: number } | null;
  csgReady: boolean;
  tool: Tool;
  /** Points picked with the measuring tool (world mm). */
  measure: [number, number, number][];
  /** Where new shapes are placed; null means the bed. */
  workplane: Workplane | null;
  /** The last print check, with the object list it was made from (it is out of date once that changes). */
  printCheck: PrintCheckState | null;
  /** Whether problem areas from the print check are highlighted in the viewport. */
  showPrintIssues: boolean;
  setPrintCheck(check: PrintCheckState | null): void;
  setShowPrintIssues(show: boolean): void;
  setCsgReady(ready: boolean): void;
  setTool(tool: Tool): void;
  addMeasurePoint(p: [number, number, number]): void;
  setWorkplane(w: Workplane | null): void;
  select(ids: string[]): void;
  toggle(id: string): void;
  setGizmo(mode: GizmoMode): void;
  setCamera(mode: CameraMode): void;
  requestView(preset: ViewPreset): void;
}

let viewCounter = 0;

export const useCad = create<CadUiState>()((set, get) => ({
  selection: [],
  gizmo: "translate",
  camera: "perspective",
  viewRequest: null,
  csgReady: false,
  tool: "select",
  measure: [],
  workplane: null,
  printCheck: null,
  showPrintIssues: true,
  setPrintCheck: (printCheck) => set({ printCheck }),
  setShowPrintIssues: (showPrintIssues) => set({ showPrintIssues }),
  setCsgReady: (csgReady) => set({ csgReady }),
  setTool: (tool) => set({ tool, measure: [] }),
  addMeasurePoint: (p) => set({ measure: get().measure.length >= 2 ? [p] : [...get().measure, p] }),
  setWorkplane: (workplane) => set({ workplane }),
  select: (selection) => set({ selection }),
  toggle: (id) => {
    const s = get().selection;
    set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
  },
  setGizmo: (gizmo) => set({ gizmo }),
  setCamera: (camera) => set({ camera }),
  requestView: (preset) => set({ viewRequest: { preset, n: ++viewCounter } }),
}));

export function currentObjects(): CadObject[] {
  return cadObjects(projectStore.getState().project);
}

/** Selected ids that still exist (undo can remove objects that were selected). */
export function liveSelection(): string[] {
  const ids = new Set(currentObjects().map((o) => o.id));
  return useCad.getState().selection.filter((id) => ids.has(id));
}

/** Runs a command and reports a problem as a notification. Returns true on success. */
export function run(command: Command): boolean {
  try {
    projectStore.getState().execute(command);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function nextName(kind: PrimitiveKind): string {
  const base = KIND_LABELS[kind];
  const used = new Set(currentObjects().map((o) => o.name));
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Rotation (degrees) that stands a new shape up on the current workplane. */
function workplaneRotation(w: Workplane | null): [number, number, number] {
  if (!w) return [0, 0, 0];
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...w.normal).normalize());
  const e = new Euler().setFromQuaternion(q, "XYZ");
  const deg = (r: number) => Math.round((r * 180) / Math.PI * 1e4) / 1e4;
  return [deg(e.x), deg(e.y), deg(e.z)];
}

/** Adds a shape. Without a position it goes to the workplane origin (or the bed centre). */
export function addPrimitive(kind: PrimitiveKind, position?: [number, number, number]) {
  const count = currentObjects().filter((o) => o.kind !== "group").length;
  const workplane = useCad.getState().workplane;
  const object: CadObject = {
    id: newId(),
    name: nextName(kind),
    kind,
    params: { ...DEFAULT_PARAMS[kind] },
    ...(kind === "text" ? { text: "Text" } : {}),
    transform: { ...IDENTITY, position: position ?? workplane?.origin ?? [0, 0, 0], rotation: workplaneRotation(workplane) },
    hole: false,
    color: PALETTE[count % PALETTE.length]!,
    parentId: null,
    visible: true,
    locked: false,
  };
  if (run(addObject({ object }))) useCad.getState().select([object.id]);
}

export function deleteSelected() {
  const ids = liveSelection();
  if (!ids.length) return;
  if (run(deleteObjects({ ids }))) {
    useCad.getState().select([]);
    useUi.getState().notify("info", `Deleted ${ids.length === 1 ? "1 object" : `${ids.length} objects`}. Press Ctrl+Z to undo.`);
  }
}

export function duplicateSelected() {
  const ids = liveSelection();
  if (!ids.length) return;
  const idMap = planDuplicate(ids, currentObjects(), newId);
  const grid = useUi.getState().settings?.gridSize ?? 1;
  const step = Math.max(5, grid * 5);
  if (run(duplicateObjects({ ids, idMap, offset: [step, step, 0] }))) {
    const now = new Set(currentObjects().map((o) => o.id));
    useCad.getState().select(ids.map((id) => idMap[id]!).filter((id) => now.has(id)));
  }
}

export function groupSelected() {
  const ids = liveSelection();
  if (ids.length < 2) return useUi.getState().notify("info", "Select at least two objects to group (Shift+click).");
  const groupId = newId();
  if (run(groupObjects({ ids, groupId }))) useCad.getState().select([groupId]);
}

export function booleanSelected(op: BooleanOp) {
  const ids = liveSelection();
  if (ids.length < 2) {
    useUi.getState().notify("info", op === "subtract"
      ? "Select the object to keep first, then Shift+click the objects to cut away."
      : "Select at least two objects (Shift+click).");
    return;
  }
  if (!useCad.getState().csgReady) return useUi.getState().notify("error", "The solid geometry engine is still loading.");
  const groupId = newId();
  if (run(booleanOp({ ids, groupId, op }))) useCad.getState().select([groupId]);
}

export function ungroupSelected() {
  const objects = currentObjects();
  const groups = liveSelection().filter((id) => objects.find((o) => o.id === id)?.kind === "group");
  if (!groups.length) return useUi.getState().notify("info", "Select a group to ungroup.");
  const children: string[] = [];
  for (const groupId of groups) {
    children.push(...objects.filter((o) => o.parentId === groupId).map((o) => o.id));
    if (!run(ungroup({ groupId }))) return;
  }
  useCad.getState().select(children);
}

export function alignSelected(axis: 0 | 1 | 2, mode: AlignMode) {
  run(alignObjects({ ids: liveSelection(), axis, mode }));
}

export function dropSelected() {
  const ids = liveSelection();
  if (ids.length) run(dropToBed({ ids }));
}

export function toggleHoleSelected() {
  const ids = liveSelection();
  if (!ids.length) return;
  const objects = byId(currentObjects());
  const makeHole = !ids.every((id) => objects.get(id)?.hole);
  run(setProps({ ids, props: { hole: makeHole } }));
}

export function nudgeSelected(dx: number, dy: number, dz: number) {
  const objects = byId(currentObjects());
  const ids = liveSelection().filter((id) => !objects.get(id)?.locked);
  if (!ids.length) return;
  run(setTransforms({
    updates: ids.map((id) => {
      const p = objects.get(id)!.transform.position;
      return { id, transform: { position: [round(p[0] + dx), round(p[1] + dy), round(p[2] + dz)] as [number, number, number] } };
    }),
    label: "Nudge",
    merge: `nudge:${ids.join(",")}`,
  }));
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** What a click in the viewport selects: the outermost group containing the shape. */
export function clickTarget(id: string): string {
  return rootOf(id, byId(currentObjects()));
}

export function selectAll() {
  useCad.getState().select(currentObjects().filter((o) => o.parentId === null).map((o) => o.id));
}

function inTextField(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/** Keyboard shortcuts that only apply in the 3D Studio. */
export function handleCadKey(e: KeyboardEvent): boolean {
  if (inTextField(e.target)) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const grid = useUi.getState().settings?.gridSize ?? 1;
  const step = e.shiftKey ? grid * 10 : grid;
  const cad = useCad.getState();
  if (ctrl && key.toLowerCase() === "d") return duplicateSelected(), true;
  if (ctrl && key.toLowerCase() === "g") return (e.shiftKey ? ungroupSelected() : groupSelected()), true;
  if (ctrl && key.toLowerCase() === "a") return selectAll(), true;
  if (ctrl && key === "ArrowUp") return nudgeSelected(0, 0, step), true;
  if (ctrl && key === "ArrowDown") return nudgeSelected(0, 0, -step), true;
  if (ctrl || e.altKey) return false;
  switch (key) {
    case "Delete":
    case "Backspace": deleteSelected(); return true;
    case "Escape":
      if (cad.tool !== "select") cad.setTool("select");
      else cad.select([]);
      return true;
    case "ArrowLeft": nudgeSelected(-step, 0, 0); return true;
    case "ArrowRight": nudgeSelected(step, 0, 0); return true;
    case "ArrowUp": nudgeSelected(0, step, 0); return true;
    case "ArrowDown": nudgeSelected(0, -step, 0); return true;
    case "PageUp": nudgeSelected(0, 0, step); return true;
    case "PageDown": nudgeSelected(0, 0, -step); return true;
  }
  switch (key.toLowerCase()) {
    case "t": cad.setGizmo("translate"); return true;
    case "r": cad.setGizmo("rotate"); return true;
    case "s": cad.setGizmo("scale"); return true;
    case "h": toggleHoleSelected(); return true;
    case "d": dropSelected(); return true;
    case "f": cad.requestView("fit"); return true;
    case "p": cad.setCamera(cad.camera === "perspective" ? "orthographic" : "perspective"); return true;
    case "m": cad.setTool(cad.tool === "measure" ? "select" : "measure"); return true;
    case "w": cad.setTool(cad.tool === "workplane" ? "select" : "workplane"); return true;
  }
  return false;
}
