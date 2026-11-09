// STEP import and export with the OpenCascade (OCCT) engine, through replicad.
//
// Export: each top-level object becomes one named, coloured solid in the STEP file.
//   - "Exact": built from real geometry (true circles and curved faces, OCCT Booleans for
//     groups and holes). Possible when every shape inside keeps its axes at right angles
//     (no skew from scaling a rotated shape) and round shapes are scaled evenly where it
//     matters (cylinders and cones in X/Y, tori in all directions; spheres become ellipsoids).
//   - "Faceted": otherwise, and for imported meshes, the same closed triangle mesh as the
//     STL export, turned into a solid made of flat faces (coplanar triangles merged).
// Import: every solid in the file becomes a mesh object. OCCT converts the file's units
//   to millimetres.
//
// The engine is about 22 MB of WebAssembly, so it is loaded only when STEP is first used.

import type { OpenCascadeInstance } from "replicad-opencascadejs";
import {
  addHolesInFace, basicFaceExtrusion, cast, exportSTEP, getOC, iterTopo, makeBox, makeCylinder, makeEllipsoid, makePolygon, makeSolid,
  makeSphere, measureVolume, revolution, setOC, Vector, type AnyShape, type Face, type Shape3D,
} from "replicad";
import { Matrix4, Vector3 } from "three";
import { textRegions } from "./csg";
import type { ExportPart } from "./exporting";
import { byId, worldMatrix } from "./geometry";
import { weldTriangles, type MeshData } from "./meshes";
import type { CadObject } from "./model";

let ready = false;

export async function initStep(load: () => Promise<OpenCascadeInstance>): Promise<void> {
  if (ready) return;
  setOC(await load());
  ready = true;
}

export function stepReady(): boolean {
  return ready;
}

function oc(): OpenCascadeInstance {
  if (!ready) throw new Error("The STEP engine is still loading. Try again in a moment.");
  return getOC();
}

/** Most triangles a faceted STEP solid may have (sewing gets slow and files huge beyond this). */
export const MAX_FACETED_TRIANGLES = 20000;

// --- export ------------------------------------------------------------------

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

interface Frame {
  /** Scale along the shape's own X, Y, Z (always positive). */
  s: [number, number, number];
  /** True when the transform mirrors the shape (handled by mirroring its X). */
  mirror: boolean;
  /** Rotation + translation, row-major 3 x 4, for gp_Trsf. */
  rows: number[];
}

/** Splits a world matrix into rotation, translation and per-axis scale, or null if it skews. */
function frameOf(m: Matrix4): Frame | null {
  const e = m.elements;
  const cols = [new Vector3(e[0], e[1], e[2]), new Vector3(e[4], e[5], e[6]), new Vector3(e[8], e[9], e[10])];
  const s = cols.map((c) => c.length()) as [number, number, number];
  if (s.some((v) => v < 1e-9)) return null;
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
    if (Math.abs(cols[i]!.dot(cols[j]!)) > 1e-6 * s[i] * s[j]) return null; // skewed
  }
  const r = cols.map((c, k) => c.clone().divideScalar(s[k]!));
  const mirror = new Matrix4().makeBasis(r[0]!, r[1]!, r[2]!).determinant() < 0;
  if (mirror) r[0]!.negate();
  return {
    s, mirror,
    rows: [r[0]!.x, r[1]!.x, r[2]!.x, e[12]!, r[0]!.y, r[1]!.y, r[2]!.y, e[13]!, r[0]!.z, r[1]!.z, r[2]!.z, e[14]!],
  };
}

/** Keeps every OCCT-backed object made during one export, so all are freed at the end. */
class Keep {
  private items: { delete(): void }[] = [];
  add<T extends { delete(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }
  free() {
    for (const item of this.items.reverse()) {
      try { item.delete(); } catch { /* already freed */ }
    }
    this.items = [];
  }
}

function moved(shape: Shape3D, x: number, y: number, z: number, k: Keep): Shape3D {
  return k.add(shape.translate([x, y, z]));
}

/** A primitive in its own frame, with the frame's scale (and mirror) built in. Null when not exact. */
function primitive(object: CadObject, f: Frame, k: Keep): Shape3D | null {
  const p = object.params;
  const [sx, sy, sz] = f.s;
  const mx = f.mirror ? -1 : 1;
  switch (object.kind) {
    case "box": {
      const w = p.width! * sx, d = p.depth! * sy, h = p.height! * sz;
      return k.add(makeBox([-w / 2, -d / 2, 0], [w / 2, d / 2, h]));
    }
    case "sphere": {
      const r = p.radius!;
      const solid = near(sx, sy) && near(sy, sz) ? k.add(makeSphere(r * sx)) : k.add(makeEllipsoid(r * sx, r * sy, r * sz));
      return moved(solid, 0, 0, r * sz, k);
    }
    case "cylinder":
      if (!near(sx, sy)) return null;
      return k.add(makeCylinder(p.radius! * sx, p.height! * sz));
    case "cone": {
      if (!near(sx, sy)) return null;
      // A profile in XZ (axis, bottom radius, top radius) spun around Z.
      const r1 = p.bottomRadius! * sx, r2 = p.topRadius! * sx, h = p.height! * sz;
      const outline: [number, number, number][] = [[0, 0, 0], [r1, 0, 0]];
      if (r2 > 1e-9) outline.push([r2, 0, h]);
      outline.push([0, 0, h]);
      return k.add(revolution(k.add(makePolygon(outline)), [0, 0, 0], [0, 0, 1], 360));
    }
    case "torus": {
      if (!near(sx, sy) || !near(sy, sz)) return null;
      const maker = new (oc().BRepPrimAPI_MakeTorus)(p.radius! * sx, p.tube! * sx);
      try {
        return moved(k.add(cast(maker.Shape()) as Shape3D), 0, 0, p.tube! * sz, k);
      } finally {
        maker.delete();
      }
    }
    case "wedge": {
      // Same shape as the solid engine: a right triangle in XZ, extruded across Y.
      const w = p.width! * sx, d = p.depth! * sy, h = p.height! * sz;
      const face = k.add(makePolygon([[-w / 2 * mx, -d / 2, 0], [w / 2 * mx, -d / 2, 0], [-w / 2 * mx, -d / 2, h]]));
      return k.add(basicFaceExtrusion(face, k.add(new Vector([0, d, 0]))));
    }
    case "text": {
      const regions = textRegions(object.text ?? "", p.size!);
      if (regions.length === 0) return null;
      const depth = p.depth! * sz;
      let result: Shape3D | null = null;
      for (const contours of regions) {
        const flat = contours.map((c) => c.map(([x, y]) => [x * sx * mx, y * sy, 0] as [number, number, number]));
        let face: Face = k.add(makePolygon(flat[0]!));
        if (flat.length > 1) face = k.add(addHolesInFace(face, flat.slice(1).map((h) => k.add(k.add(makePolygon(h)).outerWire()))));
        const solid = k.add(basicFaceExtrusion(face, k.add(new Vector([0, 0, depth]))));
        result = result ? k.add(result.fuse(solid)) : solid;
      }
      return result;
    }
    case "mesh":
    case "group":
      return null;
  }
}

function placed(shape: Shape3D, f: Frame, k: Keep): Shape3D {
  const o = oc();
  const trsf = k.add(new o.gp_Trsf());
  const r = f.rows;
  trsf.SetValues(r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!, r[6]!, r[7]!, r[8]!, r[9]!, r[10]!, r[11]!);
  const builder = k.add(new o.BRepBuilderAPI_Transform(shape.wrapped, trsf, true, false));
  return k.add(cast(builder.Shape()) as Shape3D);
}

/**
 * Exact solid of an object in world space, with groups combined and holes cut,
 * or null when some part of it cannot be made exactly (then the caller facets it).
 * "empty" means the object has no solid volume at all.
 */
function exactWorld(object: CadObject, objects: CadObject[], index: Map<string, CadObject>, k: Keep, depth = 0): Shape3D | null | "empty" {
  if (depth > 50) throw new Error("Groups are nested too deeply.");
  if (object.kind !== "group") {
    const f = frameOf(worldMatrix(object, index));
    if (!f) return null;
    const local = primitive(object, f, k);
    return local ? placed(local, f, k) : null;
  }
  const solids: Shape3D[] = [];
  const holes: Shape3D[] = [];
  for (const child of objects) {
    if (child.parentId !== object.id || !child.visible) continue;
    const shape = exactWorld(child, objects, index, k, depth + 1);
    if (shape === null) return null;
    if (shape === "empty") continue;
    (child.hole ? holes : solids).push(shape);
  }
  if (solids.length === 0) return "empty";
  let result = solids[0]!;
  for (const s of solids.slice(1)) result = k.add(object.boolean === "intersect" ? result.intersect(s) as Shape3D : result.fuse(s));
  for (const h of holes) result = k.add(result.cut(h));
  return result;
}

/** A solid made of flat faces from a closed triangle mesh (world coordinates). */
function facetedSolid(part: ExportPart, k: Keep): Shape3D {
  const triangles = part.indices.length / 3;
  if (triangles > MAX_FACETED_TRIANGLES) {
    throw new Error(`"${part.name}" has ${triangles.toLocaleString("en")} triangles, too many for a STEP file made of flat faces (limit ${MAX_FACETED_TRIANGLES.toLocaleString("en")}). Export it as STL instead.`);
  }
  const p = part.positions;
  const faces: Face[] = [];
  const pt = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!] as [number, number, number];
  for (let t = 0; t < part.indices.length; t += 3) {
    try {
      faces.push(k.add(makePolygon([pt(part.indices[t]!), pt(part.indices[t + 1]!), pt(part.indices[t + 2]!)])));
    } catch {
      // a triangle too thin to be a face; the sewing closes the gap
    }
  }
  const solid = k.add(makeSolid(faces));
  // Merge coplanar triangles into single faces (a box becomes 6 faces again).
  const o = oc();
  const unify = k.add(new o.ShapeUpgrade_UnifySameDomain(solid.wrapped, true, true, false));
  unify.Build();
  return k.add(cast(unify.Shape()) as Shape3D);
}

export interface StepExport {
  bytes: Uint8Array;
  exact: string[];
  faceted: string[];
  warnings: string[];
}

/**
 * Writes a STEP file (AP214, millimetres). `parts` are the closed meshes from collectParts
 * (used for faceted solids and to know which objects are exported).
 */
export async function writeStep(parts: ExportPart[], objects: CadObject[]): Promise<StepExport> {
  oc();
  const index = byId(objects);
  const k = new Keep();
  const exact: string[] = [], faceted: string[] = [], warnings: string[] = [];
  let blob: Blob;
  try {
    const shapes: { shape: AnyShape; name: string; color: string }[] = [];
    for (const part of parts) {
      const object = index.get(part.id);
      if (!object) continue;
      let shape: Shape3D | null = null;
      if (part.watertight) {
        try {
          const result = exactWorld(object, objects, index, k);
          if (result !== "empty") shape = result;
        } catch {
          shape = null; // an OCCT operation failed: fall back to the mesh
        }
        if (shape && !(measureVolume(shape) > 0)) shape = null;
      }
      if (shape) exact.push(part.name);
      else {
        if (!part.watertight) warnings.push(`"${part.name}" is not a closed solid; its STEP shape may be open.`);
        shape = facetedSolid(part, k);
        faceted.push(part.name);
      }
      shapes.push({ shape, name: part.name, color: colorOf(object, objects) });
    }
    blob = exportSTEP(shapes, { unit: "MM" });
  } finally {
    k.free();
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), exact, faceted, warnings };
}

function colorOf(object: CadObject, objects: CadObject[]): string {
  if (object.kind !== "group") return object.color;
  const child = objects.find((o) => o.parentId === object.id && !o.hole && o.kind !== "group");
  return child?.color ?? object.color;
}

// --- import ------------------------------------------------------------------

export interface StepSolid {
  /** Welded triangle mesh in millimetres, in the file's coordinates. */
  mesh: MeshData;
}

export interface StepImport {
  solids: StepSolid[];
  /** True when the file had no closed solids and the surfaces were imported instead. */
  surfacesOnly: boolean;
}

const MAX_STEP_SOLIDS = 500;

function tessellate(shape: AnyShape, tolerance: number): MeshData {
  const m = shape.mesh({ tolerance, angularTolerance: 0.1 });
  const soup = new Float32Array(m.triangles.length * 3);
  for (let i = 0; i < m.triangles.length; i++) {
    const v = m.triangles[i]! * 3;
    soup[i * 3] = m.vertices[v]!; soup[i * 3 + 1] = m.vertices[v + 1]!; soup[i * 3 + 2] = m.vertices[v + 2]!;
  }
  return weldTriangles(soup);
}

/** Reads a STEP file. Every solid becomes one mesh; curved faces are tessellated finely. */
export function readStep(bytes: Uint8Array): StepImport {
  const o = oc();
  const file = `/import-${Date.now().toString(36)}.step`;
  const k = new Keep();
  const fs = (o as unknown as { FS: { writeFile(p: string, d: Uint8Array): void; unlink(p: string): void } }).FS;
  fs.writeFile(file, bytes);
  try {
    // Convert whatever units the file uses into millimetres (this setting is global in OCCT).
    o.Interface_Static.SetCVal("xstep.cascade.unit", "MM");
    const reader = k.add(new o.STEPControl_Reader());
    const status = reader.ReadFile(file);
    if (status !== o.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error("This is not a readable STEP file.");
    reader.TransferRoots(k.add(new o.Message_ProgressRange()));
    const root = k.add(cast(reader.OneShape()));
    const box = root.boundingBox;
    const diagonal = Math.hypot(box.width, box.height, box.depth);
    if (!Number.isFinite(diagonal) || diagonal <= 0) throw new Error("The STEP file contains no 3D shapes.");
    // About 1/2000 of the model's size, between 0.005 and 0.1 mm.
    const tolerance = Math.min(0.1, Math.max(0.005, diagonal / 2000));
    const solids: StepSolid[] = [];
    for (const solid of iterTopo(root.wrapped, "solid")) {
      if (solids.length >= MAX_STEP_SOLIDS) throw new Error(`The STEP file has more than ${MAX_STEP_SOLIDS} solids.`);
      solids.push({ mesh: tessellate(k.add(cast(solid)), tolerance) });
    }
    if (solids.length) return { solids, surfacesOnly: false };
    return { solids: [{ mesh: tessellate(root, tolerance) }], surfacesOnly: true };
  } finally {
    try { fs.unlink(file); } catch { /* already gone */ }
    k.free();
  }
}
