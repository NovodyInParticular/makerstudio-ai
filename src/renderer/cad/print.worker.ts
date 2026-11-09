// Print preparation off the interface thread: collecting the parts (solid engine), the print
// check (walls, overhangs) and finding the best printing position. On imported figures with
// millions of triangles these take several seconds, and the window stays usable meanwhile.
//
// The worker keeps the meshes it has been sent (mesh data never changes for a key), so each
// mesh crosses over only once.

import Manifold from "manifold-3d/manifold";
import manifoldWasm from "manifold-3d/manifold.wasm?url";
import { checkMesh, initCsg, meshIsWatertight } from "../../core/cad/csg";
import { collectParts, type ExportPart } from "../../core/cad/exporting";
import { getMesh, registerMesh, type MeshData } from "../../core/cad/meshes";
import type { CadObject } from "../../core/cad/model";
import { bestOrientation, checkPrint, type PrinterSpec, type PrintReport } from "../../core/cad/printcheck";

export type PrintRequest = {
  id: number;
  type: "collect" | "check" | "orient" | "meshInfo";
  ids: string[];
  objects: CadObject[];
  meshes: Record<string, MeshData>;
  printer: PrinterSpec;
};

export interface PrintResult {
  parts: ExportPart[];
  warnings: string[];
  /** check only */
  report?: PrintReport;
  /** orient only */
  orient?: { updates: { id: string; quaternion: [number, number, number, number] }[]; kept: string[] };
  /** meshInfo only: closed or not, and volume (mm³, unscaled), per mesh key. */
  meshInfo?: Record<string, { watertight: boolean; volume: number }>;
  /** Watertight results worked out here, so the window does not have to repeat them. */
  watertight: Record<string, boolean>;
}

export type PrintResponse = { id: number; ok: true; value: PrintResult } | { id: number; ok: false; error: string };

const ready = initCsg(() => Manifold({ locateFile: () => manifoldWasm }));
const post = (message: PrintResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<PrintRequest>) => {
  const { id, type, ids, objects, meshes, printer } = event.data;
  try {
    await ready;
    for (const [key, mesh] of Object.entries(meshes)) registerMesh(key, mesh);
    if (type === "meshInfo") {
      // The inspector's "watertight / volume" line: slow for big meshes, so it is worked out here.
      const meshInfo: NonNullable<PrintResult["meshInfo"]> = {};
      const watertight: Record<string, boolean> = {};
      for (const o of objects) {
        const data = o.kind === "mesh" ? getMesh(o.mesh) : undefined;
        if (!data || !o.mesh) continue;
        const check = checkMesh(data);
        meshInfo[o.mesh] = { watertight: check.watertight, volume: check.volume };
        watertight[o.mesh] = check.watertight;
      }
      post({ id, ok: true, value: { parts: [], warnings: [], meshInfo, watertight } });
      return;
    }
    const { parts, warnings } = collectParts(ids, objects);
    const watertight: Record<string, boolean> = {};
    // Only meshes collectParts just checked (cached by now), never the rest of the project.
    for (const part of parts) {
      const o = objects.find((x) => x.id === part.id);
      if (o?.kind === "mesh" && o.mesh) { const ok = meshIsWatertight(o.mesh); if (ok !== null) watertight[o.mesh] = ok; }
    }
    const value: PrintResult = { parts, warnings, watertight };
    if (parts.length && type === "check") value.report = checkPrint(parts, printer);
    if (parts.length && type === "orient") {
      const updates: NonNullable<PrintResult["orient"]>["updates"] = [];
      const kept: string[] = [];
      for (const part of parts) {
        const choice = bestOrientation(part, printer);
        if (choice.keep) kept.push(part.name);
        else updates.push({ id: part.id, quaternion: choice.quaternion });
      }
      value.orient = { updates, kept };
    }
    // Positions are new arrays made for each part: hand them over instead of copying. Indices
    // can be the stored mesh's own array (shared with the registry here), so they are copied.
    post({ id, ok: true, value }, parts.map((p) => p.positions.buffer as ArrayBuffer));
  } catch (error) {
    post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
