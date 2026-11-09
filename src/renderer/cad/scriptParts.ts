// Script parts in the 3D Studio: open a Python part script, change its sizes, build it (in a
// temporary copy, by the desktop process) and bring the STL files it writes in as parts that
// remember their script, so they can be rebuilt in place later.

import { create } from "zustand";
import { applyScriptBuild, cadObjects } from "../../core/cad/commands";
import { encodeMesh, meshBounds, newMeshKey, parseMeshFile, registerMesh } from "../../core/cad/meshes";
import { IDENTITY, PALETTE, type CadObject } from "../../core/cad/model";
import { newId } from "../../shared/format";
import type { ScriptParameter, ScriptValue, ScriptValues } from "../../shared/ipc";
import { projectStore, useUi } from "../state";
import { run, useCad } from "./cadState";

const notify = (kind: "success" | "error" | "info", message: string) => useUi.getState().notify(kind, message);

interface ScriptState {
  /** Script being edited, or null when the panel is closed. */
  path: string | null;
  parameters: ScriptParameter[] | null;
  /** Values changed from the script's own. */
  values: ScriptValues;
  building: boolean;
  log: string;
  open(path: string, parameters: ScriptParameter[] | null, values?: ScriptValues): void;
  close(): void;
  set(name: string, value: ScriptValue | undefined): void;
}

export const useScript = create<ScriptState>()((set, get) => ({
  path: null,
  parameters: null,
  values: {},
  building: false,
  log: "",
  open: (path, parameters, values = {}) => {
    // Keep only changes that still match a size in the script (it may have been edited since).
    const known = new Map((parameters ?? []).filter((p) => p.editable).map((p) => [p.name, p]));
    const kept = Object.fromEntries(Object.entries(values).filter(([k]) => known.has(k)));
    set({ path, parameters, values: kept, log: "" });
  },
  close: () => set({ path: null, parameters: null, values: {}, log: "" }),
  set: (name, value) => {
    const values = { ...get().values };
    const original = get().parameters?.find((p) => p.name === name)?.value;
    if (value === undefined || JSON.stringify(value) === JSON.stringify(original)) delete values[name];
    else values[name] = value;
    set({ values });
  },
}));

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const stem = (name: string) => name.replace(/\.[^.]+$/, "");

/** Parts in the project made by this script. */
export function partsFromScript(path: string): CadObject[] {
  return cadObjects(projectStore.getState().project).filter((o) => o.kind === "mesh" && o.script?.path === path);
}

/** Files panel: choose a script and show its sizes. */
export async function openScript() {
  const result = await window.makerstudio.pickScript();
  if (!result.ok) return notify("error", result.error);
  if (!result.value) return;
  const { path, parameters } = result.value;
  const existing = partsFromScript(path);
  useScript.getState().open(path, parameters, existing[0]?.script?.values ?? {});
  if (parameters === null) notify("info", `"${fileName(path)}" has no "# === PARAMETERS ===" block, so there are no sizes to change. It can still be built as it is.`);
}

/** Inspector: edit the sizes of the script a part came from (read fresh from the script). */
export async function editScriptOf(object: CadObject) {
  if (!object.script) return;
  const result = await window.makerstudio.inspectScript(object.script.path);
  if (!result.ok) return notify("error", result.error);
  useScript.getState().open(object.script.path, result.value, object.script.values);
}

/** Builds the open script and adds its parts, or swaps the meshes of parts it made before. */
export async function buildOpenScript() {
  const { path, values, building } = useScript.getState();
  if (!path || building) return;
  useScript.setState({ building: true, log: "" });
  try {
    const result = await window.makerstudio.buildScript(path, values);
    if (!result.ok) { notify("error", result.error); return; }
    if (!result.value) return; // the owner said no
    const { files, log, seconds, skipped } = result.value;
    useScript.setState({ log });
    const existing = partsFromScript(path);
    // Every part made from an output file, copies included, is rebuilt.
    const byOutput = new Map<string, CadObject[]>();
    for (const o of existing) byOutput.set(o.script!.output, [...(byOutput.get(o.script!.output) ?? []), o]);
    const meshes = files.map((f) => {
      const mesh = parseMeshFile(f.name, f.bytes); // script coordinates kept, so parts stay lined up
      const key = newMeshKey();
      registerMesh(key, mesh);
      projectStore.getState().addAsset(key, encodeMesh(mesh));
      return { name: f.name, key, mesh };
    });
    const updates: { id: string; mesh: string }[] = [];
    const adds: CadObject[] = [];
    const fresh = meshes.filter((m) => !byOutput.has(m.name));
    // New parts land together: centred on the bed (or workplane) and standing on it, as one set.
    let shift: [number, number, number] = [0, 0, 0];
    if (fresh.length) {
      const all = fresh.map((m) => meshBounds(m.mesh));
      const min = [0, 1, 2].map((a) => Math.min(...all.map((b) => b.min[a]!)));
      const max = [0, 1, 2].map((a) => Math.max(...all.map((b) => b.max[a]!)));
      const origin = useCad.getState().workplane?.origin ?? [0, 0, 0];
      shift = [origin[0] - (min[0]! + max[0]!) / 2, origin[1] - (min[1]! + max[1]!) / 2, origin[2] - min[2]!];
    }
    const count = cadObjects(projectStore.getState().project).length;
    for (const m of meshes) {
      const olds = byOutput.get(m.name);
      if (olds) { for (const old of olds) updates.push({ id: old.id, mesh: m.key }); continue; }
      adds.push({
        id: newId(), name: `${stem(fileName(path))}: ${stem(m.name)}`.slice(0, 120), kind: "mesh", mesh: m.key, params: {},
        transform: { ...IDENTITY, position: shift }, hole: false, color: PALETTE[(count + adds.length) % PALETTE.length]!,
        parentId: null, visible: true, locked: false, script: { path, output: m.name, values },
      });
    }
    if (!run(applyScriptBuild({ path, values, updates, adds }))) return;
    if (adds.length) useCad.getState().select(adds.map((a) => a.id));
    const gone = [...byOutput.keys()].filter((name) => !meshes.some((m) => m.name === name));
    const changed = Object.keys(values).length;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const done = [updates.length ? `${plural(updates.length, "part")} rebuilt in place` : "", adds.length ? `${plural(adds.length, "part")} added` : ""].filter(Boolean).join(", ");
    let message = `Built "${fileName(path)}" in ${seconds} s${changed ? ` with ${plural(changed, "changed size")}` : ""}: ${done}.`;
    if (gone.length) message += ` The script no longer writes ${gone.join(", ")}; ${gone.length === 1 ? "that part was" : "those parts were"} left as they were.`;
    if (skipped.length) message += ` Helper files (${skipped.join(", ")}) were not imported.`;
    message += " Ctrl+Z undoes it. Your script and its out folder were not changed.";
    notify("success", message);
  } catch (error) {
    notify("error", error instanceof Error ? error.message : String(error));
  } finally {
    useScript.setState({ building: false });
  }
}
