// Import and export of 3D model files (STL, OBJ, STEP) from the 3D Studio.

import { addObject, cadObjects } from "../../core/cad/commands";
import { collectParts, partFileNames, safeFileName, writeObj, writeStl } from "../../core/cad/exporting";
import { centreOnOrigin, encodeMesh, meshBounds, meshFormatOf, newMeshKey, parseMeshFile, registerMesh, type MeshData } from "../../core/cad/meshes";
import { IDENTITY, PALETTE, type CadObject } from "../../core/cad/model";
import { newId } from "../../shared/format";
import { projectStore, useUi } from "../state";
import { liveSelection, run, useCad } from "./cadState";
import { meshInfo } from "./printWorker";
import { readStepFile, writeStepFile } from "./stepLoader";
import { read3mf } from "../../core/cad/threemf";

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const notify = (kind: "success" | "error" | "info", message: string) => useUi.getState().notify(kind, message);

const MESH_NOTE = "It is not a closed (watertight) solid, so it cannot be cut or combined; slicers may need to repair it.";

/** Adds a mesh as a new object. `position` is where the centre of its bottom goes. */
function addMeshObject(name: string, mesh: MeshData, position: [number, number, number]): CadObject | null {
  const key = newMeshKey();
  registerMesh(key, mesh);
  projectStore.getState().addAsset(key, encodeMesh(mesh));
  const objects = cadObjects(projectStore.getState().project);
  const object: CadObject = {
    id: newId(),
    name: name.slice(0, 120) || "Imported mesh",
    kind: "mesh",
    mesh: key,
    params: {},
    transform: { ...IDENTITY, position },
    hole: false,
    color: PALETTE[objects.length % PALETTE.length]!,
    parentId: null,
    visible: true,
    locked: false,
  };
  return run(addObject({ object })) ? object : null;
}

const baseName = (file: string) => file.replace(/\.[^.]+$/, "");
const isStep = (file: string) => /\.(step|stp)$/i.test(file);

/** Adds one STL / OBJ file to the project as an imported mesh object. Returns its id, or null on failure. */
export function importModelBytes(name: string, bytes: Uint8Array): string | null {
  let mesh;
  try {
    mesh = centreOnOrigin(parseMeshFile(name, bytes)).mesh;
  } catch (error) {
    notify("error", `"${name}": ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const object = addMeshObject(baseName(name), mesh, useCad.getState().workplane?.origin ?? [0, 0, 0]);
  if (!object) return null;

  const { min, max } = meshBounds(mesh);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const parts = [`Imported "${object.name}": ${size.map(fmt).join(" × ")} mm, ${(mesh.indices.length / 3).toLocaleString("en")} triangles.`];
  // Checked in the background (big meshes take seconds); a note follows if it is open.
  void meshInfo(object).then((info) => { if (info && !info.watertight) notify("info", `"${object.name}": ${MESH_NOTE}`); });
  const largest = Math.max(...size);
  // STL and OBJ files carry no units. Point out sizes that suggest inches or metres.
  if (largest < 3) parts.push("It is very small: if the file was made in inches, set Scale to 25.4; in centimetres, to 10.");
  else if (largest > 1000) parts.push("It is very large: if the file was made in micrometres or another unit, change its Scale.");
  notify("success", parts.join(" "));
  return object.id;
}

/**
 * Adds several meshes as objects that keep their places relative to each other; the whole set
 * lands centred on the bed (or the workplane) and standing on it.
 */
function addMeshSet(items: { name: string; mesh: MeshData }[]) {
  const all = items.map((s) => meshBounds(s.mesh));
  const min = [0, 1, 2].map((a) => Math.min(...all.map((b) => b.min[a]!)));
  const max = [0, 1, 2].map((a) => Math.max(...all.map((b) => b.max[a]!)));
  const origin = useCad.getState().workplane?.origin ?? [0, 0, 0];
  const shift = [origin[0] - (min[0]! + max[0]!) / 2, origin[1] - (min[1]! + max[1]!) / 2, origin[2] - min[2]!];
  const ids: string[] = [];
  let triangles = 0;
  const checks: Promise<{ watertight: boolean } | null>[] = [];
  for (const item of items) {
    const { mesh, offset } = centreOnOrigin(item.mesh);
    const object = addMeshObject(item.name, mesh, [offset[0] + shift[0]!, offset[1] + shift[1]!, offset[2] + shift[2]!]);
    if (!object) continue;
    ids.push(object.id);
    triangles += mesh.indices.length / 3;
    checks.push(meshInfo(object));
  }
  return { ids, triangles, checks, min, max };
}

/** Adds a 3MF file (Bambu Studio / PrusaSlicer projects, MakerWorld downloads): every object, in place. */
export function importThreeMfBytes(name: string, bytes: Uint8Array): string[] {
  let objects;
  try {
    objects = read3mf(bytes);
  } catch (error) {
    notify("error", `"${name}": ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  if (objects.length === 0) { notify("error", `"${name}" has no 3D objects in it.`); return []; }
  const base = baseName(name);
  const { ids, triangles, checks, min, max } = addMeshSet(objects.map((o) => ({ name: objects.length === 1 ? base : `${base} · ${o.name}`.slice(0, 120), mesh: o.mesh })));
  if (ids.length === 0) return ids;
  const size = [0, 1, 2].map((a) => max[a]! - min[a]!);
  notify("success", `Imported "${base}" from 3MF: ${ids.length === 1 ? "1 object" : `${ids.length} objects`}, ${size.map(fmt).join(" × ")} mm, ${triangles.toLocaleString("en")} triangles (3MF files are in millimetres).`);
  void Promise.all(checks).then((infos) => {
    const open = infos.filter((i) => i && !i.watertight).length;
    if (open) notify("info", `"${base}": ${open} of the objects are not closed (watertight); those cannot be cut or combined.`);
  });
  return ids;
}

/**
 * Adds a STEP file: every solid in it becomes one mesh object, keeping their places relative
 * to each other (the whole set lands on the bed centre or the workplane). STEP files carry
 * their units, which the engine converts to millimetres.
 */
export async function importStepBytes(name: string, bytes: Uint8Array): Promise<string[]> {
  let result;
  try {
    result = await readStepFile(bytes);
  } catch (error) {
    notify("error", `"${name}": ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const base = baseName(name);
  const { ids, triangles, checks, min, max } = addMeshSet(result.solids.map((solid, i) => ({ name: result.solids.length === 1 ? base : `${base} ${i + 1}`, mesh: solid.mesh })));
  if (ids.length === 0) return ids;
  const size = [0, 1, 2].map((a) => max[a]! - min[a]!);
  const parts = [
    `Imported "${base}" from STEP: ${ids.length === 1 ? "1 solid" : `${ids.length} solids`}, ${size.map(fmt).join(" × ")} mm, ${triangles.toLocaleString("en")} triangles.`,
    "Curved faces were turned into fine triangles; it can be moved, scaled, cut and combined like any imported mesh.",
  ];
  if (result.surfacesOnly) parts.push("The file has surfaces but no closed solids, so it was imported as an open mesh.");
  notify(result.surfacesOnly ? "info" : "success", parts.join(" "));
  if (!result.surfacesOnly) {
    void Promise.all(checks).then((infos) => {
      const open = infos.filter((i) => i && !i.watertight).length;
      if (open) notify("info", `"${base}": ${open} of the solids did not close up into watertight meshes; those cannot be cut or combined.`);
    });
  }
  return ids;
}

/** Imports any supported model file (STL, OBJ, STEP). Returns the new object ids. */
export async function importModelFile(name: string, bytes: Uint8Array): Promise<string[]> {
  if (isStep(name)) return importStepBytes(name, bytes);
  if (/\.3mf$/i.test(name)) return importThreeMfBytes(name, bytes);
  const id = importModelBytes(name, bytes);
  return id ? [id] : [];
}

export function isModelFile(name: string): boolean {
  return meshFormatOf(name) !== null || isStep(name) || /\.3mf$/i.test(name);
}

export async function importModels() {
  const result = await window.makerstudio.importModelFiles();
  if (!result.ok) return notify("error", result.error);
  if (!result.value) return;
  const ids: string[] = [];
  for (const f of result.value) ids.push(...(await importModelFile(f.name, f.bytes)));
  if (ids.length) useCad.getState().select(ids);
}

export type ExportFormat = "stl" | "obj" | "step";

/** What gets exported: the selected top-level objects, or everything visible. */
function exportScope(): { ids: string[]; label: string } {
  const objects = cadObjects(projectStore.getState().project);
  const ids = liveSelection().filter((id) => objects.find((o) => o.id === id)?.parentId === null);
  return { ids, label: ids.length ? "selection" : "all visible objects" };
}

function prepare() {
  if (!useCad.getState().csgReady) {
    notify("error", "The solid geometry engine is still loading. Try again in a moment.");
    return null;
  }
  const { ids } = exportScope();
  try {
    const result = collectParts(ids, cadObjects(projectStore.getState().project));
    if (result.parts.length === 0) {
      notify("error", ["There is nothing to export.", ...result.warnings].join(" "));
      return null;
    }
    return result;
  } catch (error) {
    notify("error", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function report(where: string, count: number, warnings: string[]) {
  const head = `Exported ${count === 1 ? "1 part" : `${count} parts`} to ${where}.`;
  notify(warnings.length ? "info" : "success", [head, ...warnings].join(" "));
}

const FORMAT_FILTER: Record<ExportFormat, { name: string; extensions: string[] }> = {
  stl: { name: "STL model", extensions: ["stl"] },
  obj: { name: "OBJ model", extensions: ["obj"] },
  step: { name: "STEP model", extensions: ["step"] },
};

/** Exports everything (or the selection) into one file. */
export async function exportModel(format: ExportFormat) {
  const prepared = prepare();
  if (!prepared) return;
  const name = projectStore.getState().project.document.name;
  const base = prepared.parts.length === 1 ? prepared.parts[0]!.name : name;
  let bytes: Uint8Array;
  const warnings = [...prepared.warnings];
  if (format === "step") {
    try {
      const out = await writeStepFile(prepared.parts, cadObjects(projectStore.getState().project));
      bytes = out.bytes;
      warnings.push(...out.warnings);
      if (out.faceted.length) {
        const list = out.faceted.slice(0, 5).map((n) => `"${n}"`).join(", ") + (out.faceted.length > 5 ? "…" : "");
        warnings.push(`${list} ${out.faceted.length === 1 ? "is" : "are"} made of flat faces in the STEP file (imported meshes, or round shapes squashed unevenly); the rest are exact.`);
      }
    } catch (error) {
      return notify("error", `Could not make the STEP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    bytes = format === "stl" ? writeStl(prepared.parts, `${name} (mm)`) : writeObj(prepared.parts);
  }
  const result = await window.makerstudio.saveExportFile(`${safeFileName(base)}.${format}`, bytes, FORMAT_FILTER[format]);
  if (!result.ok) return notify("error", result.error);
  if (result.value) report(result.value, prepared.parts.length, warnings);
}

/** Exports each top-level object as its own STL file (for printing parts separately). */
export async function exportEachPart() {
  const prepared = prepare();
  if (!prepared) return;
  const names = partFileNames(prepared.parts, "stl");
  const files = prepared.parts.map((part, i) => ({ name: names[i]!, bytes: writeStl([part], `${part.name} (mm)`) }));
  const result = await window.makerstudio.saveExportFiles(files);
  if (!result.ok) return notify("error", result.error);
  if (result.value) report(result.value, files.length, prepared.warnings);
}
