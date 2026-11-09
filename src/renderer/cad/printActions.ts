// Print preparation in the 3D Studio: check the model for printing, turn parts into a good
// printing position, and hand the parts to Bambu Studio.

import { cadObjects, orientObjects } from "../../core/cad/commands";
import { partFileNames, writeStl } from "../../core/cad/exporting";
import { getMesh } from "../../core/cad/meshes";
import { BAMBU_A1, type PrinterSpec } from "../../core/cad/printcheck";
import { projectStore, useUi } from "../state";
import { liveSelection, run, useCad } from "./cadState";
import type { PrintResult } from "./print.worker";
import { printJob } from "./printWorker";

const notify = (kind: "success" | "error" | "info", message: string) => useUi.getState().notify(kind, message);

/** Imported figures can have millions of triangles; above this the user is told the work is running. */
const BUSY_TRIANGLES = 500_000;
let busy = false;

export function printerSpec(): PrinterSpec {
  const p = useUi.getState().settings?.printer;
  return p ? { name: p.name, bedX: p.bedX, bedY: p.bedY, bedZ: p.bedZ, nozzle: p.nozzle } : BAMBU_A1;
}

/** The selected top-level objects, or all visible top-level objects when nothing is selected. */
function scopeIds(): string[] {
  const objects = cadObjects(projectStore.getState().project);
  return liveSelection().filter((id) => objects.find((o) => o.id === id)?.parentId === null);
}

/**
 * Runs print work in the print worker (the window stays usable). Big models get a "working"
 * message first. Returns null, after telling the user why, when there is nothing to do.
 */
async function job(type: "collect" | "check" | "orient", message: string): Promise<(PrintResult & { objects: ReturnType<typeof cadObjects>; version: number }) | null> {
  if (busy) {
    notify("info", "Still working on the last print job…");
    return null;
  }
  const state = projectStore.getState();
  const objects = cadObjects(state.project);
  const ids = scopeIds();
  const triangles = objects.reduce((n, o) => n + (o.kind === "mesh" && o.visible ? (getMesh(o.mesh)?.indices.length ?? 0) / 3 : 0), 0);
  if (triangles >= BUSY_TRIANGLES) notify("info", `${message} (${(triangles / 1e6).toFixed(1)} million triangles, this can take a little while; you can keep working)…`);
  busy = true;
  try {
    const result = await printJob(type, ids, objects, printerSpec());
    if (result.parts.length === 0) {
      notify("error", ["There is nothing to print.", ...result.warnings].join(" "));
      return null;
    }
    return { ...result, objects, version: state.version };
  } catch (error) {
    notify("error", error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    busy = false;
  }
}

/** Runs the print check and keeps the result for the panel and the viewport highlights. */
export async function runPrintCheck() {
  const result = await job("check", "Checking for printing");
  if (!result?.report) return;
  const { report, parts, objects } = result;
  // The check describes the model as it was when it started; the panel says so if it changed since.
  useCad.getState().setPrintCheck({ report, parts, objects });
  useCad.getState().setShowPrintIssues(true);
  const count = report.parts.reduce((n, p) => n + p.issues.length, 0);
  if (count === 0) notify("success", `Print check: no problems found in ${report.parts.length === 1 ? "1 part" : `${report.parts.length} parts`}.`);
}

/** Turns each selected (or every visible) top-level object into its best printing position. */
export async function orientForPrinting() {
  const result = await job("orient", "Finding the best printing position");
  if (!result?.orient) return;
  if (projectStore.getState().version !== result.version) {
    notify("info", "The model changed while the best position was being worked out, so nothing was turned. Press Orient again.");
    return;
  }
  const { updates, kept } = result.orient;
  if (updates.length === 0) {
    notify("info", kept.length === 1 ? `"${kept[0]}" is already in a good printing position.` : "All parts are already in a good printing position.");
    return;
  }
  if (!run(orientObjects({ updates }))) return;
  const turned = updates.length === 1 ? "Turned 1 part" : `Turned ${updates.length} parts`;
  notify("success", `${turned} for printing (less overhang, more on the bed). Ctrl+Z puts ${updates.length === 1 ? "it" : "them"} back.`);
  if (useCad.getState().printCheck) await runPrintCheck();
}

/** Exports one STL per part into a new folder and opens them in Bambu Studio. */
export async function openInBambuStudio() {
  const collected = await job("collect", "Preparing the parts for Bambu Studio");
  if (!collected) return;
  const names = partFileNames(collected.parts, "stl");
  const files = collected.parts.map((part, i) => ({ name: names[i]!, bytes: writeStl([part], `${part.name} (mm)`) }));
  const project = projectStore.getState().project.document.name;
  const result = await window.makerstudio.openInSlicer(project, files);
  if (!result.ok) return notify("error", result.error);
  const head = `Opened ${files.length === 1 ? "1 part" : `${files.length} parts`} in Bambu Studio. The files are in ${result.value}.`;
  notify(collected.warnings.length ? "info" : "success", [head, ...collected.warnings].join(" "));
}
