// Solid (Boolean) geometry using the manifold-3d engine.
//
// Rules (what a group means):
//   result = combine(solid children) − union(hole children)
//   where combine is union (default) or intersection (group.boolean === "intersect").
// A hole that is not inside a group is only a marker; it cuts nothing.
//
// Results are always closed, watertight ("manifold") meshes, which is what 3D printing needs.

import type { CrossSection as CrossSectionT, Manifold as ManifoldT, ManifoldToplevel } from "manifold-3d/manifold";
import { localMatrix } from "./geometry";
import type { CadObject } from "./model";
import { textPolygons } from "./text";
import { getMesh, type MeshData } from "./meshes";

let wasm: ManifoldToplevel | null = null;

/** Must be called once (it loads the WebAssembly engine). Safe to call again. */
export async function initCsg(load: () => Promise<ManifoldToplevel>): Promise<void> {
  if (wasm) return;
  const module = await load();
  module.setup();
  wasm = module;
}

export function csgReady(): boolean {
  return wasm !== null;
}

function engine(): ManifoldToplevel {
  if (!wasm) throw new Error("The solid geometry engine is still loading. Try again in a moment.");
  return wasm;
}

export interface SolidMesh {
  /** x, y, z per vertex */
  positions: Float32Array;
  /** three vertex indices per triangle, counter-clockwise from outside */
  indices: Uint32Array;
  volume: number; // mm³
  /** Number of through-holes (topological genus); useful for tests and diagnostics. */
  genus: number;
  empty: boolean;
}

/**
 * Builds objects with automatic clean-up: every WASM object created through `keep`
 * is deleted at the end, so memory is not leaked.
 */
class Arena {
  private items: { delete(): void }[] = [];
  keep<T extends { delete(): void }>(item: T): T {
    this.items.push(item);
    return item;
  }
  free() {
    for (const item of this.items) item.delete();
    this.items = [];
  }
}

function primitive(object: CadObject, a: Arena): ManifoldT | null {
  const { Manifold, CrossSection } = engine();
  const p = object.params;
  switch (object.kind) {
    case "box":
      return a.keep(a.keep(Manifold.cube([p.width!, p.depth!, p.height!], true)).translate([0, 0, p.height! / 2]));
    case "sphere":
      return a.keep(a.keep(Manifold.sphere(p.radius!, p.segments)).translate([0, 0, p.radius!]));
    case "cylinder":
      return a.keep(Manifold.cylinder(p.height!, p.radius!, p.radius!, p.segments, false));
    case "cone":
      return a.keep(Manifold.cylinder(p.height!, p.bottomRadius!, p.topRadius!, p.segments, false));
    case "torus": {
      const circle = a.keep(a.keep(CrossSection.circle(p.tube!, Math.max(8, Math.round(p.segments! / 2)))).translate([p.radius!, 0]));
      return a.keep(a.keep(circle.revolve(p.segments)).translate([0, 0, p.tube!]));
    }
    case "wedge": {
      const w = p.width!, d = p.depth!, h = p.height!;
      // Triangle in the XZ profile, drawn in 2D as (x, y) then stood up and centred on Y.
      const profile: CrossSectionT = a.keep(new CrossSection([[[-w / 2, 0], [w / 2, 0], [-w / 2, h]]], "Positive"));
      return a.keep(a.keep(a.keep(profile.extrude(d)).rotate([90, 0, 0])).translate([0, d / 2, 0]));
    }
    case "text": {
      const polygons = textPolygons(object.text ?? "", p.size!);
      if (polygons.length === 0) return null;
      const section = a.keep(new CrossSection(polygons, "NonZero"));
      return a.keep(section.extrude(p.depth!));
    }
    case "mesh": {
      const data = getMesh(object.mesh);
      if (!data) throw new Error(`The mesh data for "${object.name}" is missing.`);
      return a.keep(manifoldFromMesh(data, object.name));
    }
    case "group":
      return null;
  }
}

/** Builds a solid from triangles; fails with a clear message when the mesh is not closed. */
function manifoldFromMesh(data: MeshData, name: string): ManifoldT {
  const { Manifold, Mesh } = engine();
  const mesh = new Mesh({ numProp: 3, vertProperties: data.positions, triVerts: data.indices });
  mesh.merge();
  let solid: ManifoldT;
  try {
    solid = new Manifold(mesh);
  } catch {
    throw new Error(`"${name}" is not a closed (watertight) solid, so it cannot be combined or cut. It can still be moved, scaled and exported.`);
  }
  if (solid.status() !== "NoError") {
    solid.delete();
    throw new Error(`"${name}" is not a closed (watertight) solid (${solid.status()}), so it cannot be combined or cut.`);
  }
  return solid;
}

export interface MeshCheck {
  watertight: boolean;
  volume: number; // mm³, 0 when not watertight
  triangles: number;
}

/** Checks whether a mesh is a closed solid that a slicer will accept. */
export function checkMesh(data: MeshData): MeshCheck {
  const triangles = data.indices.length / 3;
  try {
    const solid = manifoldFromMesh(data, "mesh");
    const volume = solid.volume();
    solid.delete();
    return { watertight: true, volume, triangles };
  } catch {
    return { watertight: false, volume: 0, triangles };
  }
}

// Mesh data never changes for a key, so the (slow, for big meshes) check runs once per mesh.
const watertightByKey = new Map<string, boolean>();

/** Records a watertight result worked out elsewhere (the print worker), so it is not repeated. */
export function rememberWatertight(key: string, watertight: boolean) {
  watertightByKey.set(key, watertight);
}

/** Whether an imported mesh is a closed solid (checked once per mesh); null when its data is not loaded. */
export function meshIsWatertight(key: string): boolean | null {
  let ok = watertightByKey.get(key);
  if (ok === undefined) {
    const data = getMesh(key);
    if (!data) return null;
    ok = checkMesh(data).watertight;
    watertightByKey.set(key, ok);
  }
  return ok;
}

/**
 * Names the first imported mesh in these objects (and everything inside them) that is not a
 * closed solid, or null. Such a mesh cannot be combined, so it must not go into a group.
 * Returns null while the engine is loading (nothing can be combined then anyway).
 */
export function openMeshIn(ids: string[], objects: CadObject[]): string | null {
  if (!wasm) return null;
  const seen = new Set<string>();
  const visit = (id: string, depth: number): string | null => {
    if (depth > 50 || seen.has(id)) return null;
    seen.add(id);
    const object = objects.find((o) => o.id === id);
    if (!object) return null;
    if (object.kind === "mesh" && object.mesh) {
      const ok = meshIsWatertight(object.mesh);
      return ok === false ? object.name : null;
    }
    if (object.kind === "group") {
      for (const child of objects) if (child.parentId === id) { const hit = visit(child.id, depth + 1); if (hit) return hit; }
    }
    return null;
  };
  for (const id of ids) { const hit = visit(id, 0); if (hit) return hit; }
  return null;
}

/** The solid for an object in its own local space (its own transform not applied). */
function solidLocal(object: CadObject, objects: CadObject[], a: Arena, depth = 0): ManifoldT | null {
  if (depth > 50) throw new Error("Groups are nested too deeply.");
  if (object.kind !== "group") return primitive(object, a);
  const { Manifold } = engine();
  const solids: ManifoldT[] = [];
  const holes: ManifoldT[] = [];
  for (const child of objects) {
    if (child.parentId !== object.id || !child.visible) continue;
    const local = solidLocal(child, objects, a, depth + 1);
    if (!local) continue;
    const placed = a.keep(local.transform(localMatrix(child.transform).toArray() as never));
    (child.hole ? holes : solids).push(placed);
  }
  if (solids.length === 0) return null;
  let result = solids.length === 1 ? solids[0]! : a.keep(object.boolean === "intersect" ? Manifold.intersection(solids) : Manifold.union(solids));
  if (holes.length) result = a.keep(result.subtract(a.keep(Manifold.union(holes))));
  return result;
}

function toMesh(m: ManifoldT | null): SolidMesh {
  if (!m || m.isEmpty()) return { positions: new Float32Array(), indices: new Uint32Array(), volume: 0, genus: 0, empty: true };
  const status = m.status();
  if (status !== "NoError") throw new Error(`The solid geometry engine reported a problem: ${status}`);
  const mesh = m.getMesh();
  const positions = new Float32Array((mesh.vertProperties.length / mesh.numProp) * 3);
  for (let v = 0, n = positions.length / 3; v < n; v++) {
    positions[v * 3] = mesh.vertProperties[v * mesh.numProp]!;
    positions[v * 3 + 1] = mesh.vertProperties[v * mesh.numProp + 1]!;
    positions[v * 3 + 2] = mesh.vertProperties[v * mesh.numProp + 2]!;
  }
  return { positions, indices: new Uint32Array(mesh.triVerts), volume: m.volume(), genus: m.genus(), empty: false };
}

// --- caching: a result is reused until something inside the object changes ---

const cache = new Map<string, SolidMesh>();
const CACHE_LIMIT = 300;

function signature(object: CadObject, objects: CadObject[], depth = 0): string {
  if (depth > 50) return "";
  const own = JSON.stringify([object.kind, object.params, object.text ?? "", object.mesh ?? "", object.boolean ?? "", object.hole, object.visible]);
  if (object.kind !== "group") return own;
  const children = objects
    .filter((o) => o.parentId === object.id)
    .map((c) => `${JSON.stringify(c.transform)}${signature(c, objects, depth + 1)}`);
  return `${own}[${children.join(",")}]`;
}

/** Watertight mesh of an object (a group is combined with its holes cut out), in its local space. */
export function solidMesh(object: CadObject, objects: CadObject[]): SolidMesh {
  const key = signature(object, objects);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const arena = new Arena();
  try {
    const mesh = toMesh(solidLocal(object, objects, arena));
    cache.set(key, mesh);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return mesh;
  } finally {
    arena.free();
  }
}

/** Signed area of a closed 2D polygon (positive = counter-clockwise). */
function signedArea(polygon: [number, number][]): number {
  let a = 0;
  for (let i = 0, n = polygon.length; i < n; i++) {
    const [x0, y0] = polygon[i]!, [x1, y1] = polygon[(i + 1) % n]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/**
 * Text outline as separate filled regions, each an outer contour followed by its holes
 * (overlaps between letters already merged). Used to build exact text for STEP export.
 */
export function textRegions(text: string, size: number): [number, number][][][] {
  const polygons = textPolygons(text, size);
  if (polygons.length === 0) return [];
  const { CrossSection } = engine();
  const a = new Arena();
  try {
    const section = a.keep(new CrossSection(polygons, "NonZero"));
    const regions: [number, number][][][] = [];
    for (const part of section.decompose()) {
      a.keep(part);
      const contours = part.toPolygons().map((p) => p.map(([x, y]) => [x, y] as [number, number]));
      // The outer contour is the counter-clockwise one with the largest area.
      contours.sort((p, q) => signedArea(q) - signedArea(p));
      if (contours.length && signedArea(contours[0]!) > 0) regions.push(contours);
    }
    return regions;
  } finally {
    a.free();
  }
}
