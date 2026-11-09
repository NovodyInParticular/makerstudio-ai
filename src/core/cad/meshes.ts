// Imported triangle meshes (STL, OBJ, and STEP after it is converted to triangles).
//
// Mesh data never changes after import, so it is stored once as a binary asset in the
// project ("meshes/<id>.bin") and objects refer to it by that key. Undo only has to
// track the object, not the (possibly large) mesh. Unused meshes are dropped on save.
//
// Binary layout (little endian):
//   8 bytes  "MSMESH01"
//   u32      vertex count
//   u32      triangle count
//   f32[3n]  vertex positions (mm)
//   u32[3t]  triangle vertex indices, counter-clockwise seen from outside

import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Mesh as ThreeMesh } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { decodeMesh, MAX_TRIANGLES, type MeshData } from "./meshCodec";
import { MESH_KEY } from "./model";

export { decodeMesh, encodeMesh, MAX_TRIANGLES, type MeshData } from "./meshCodec";

export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
/** Vertices closer than this (mm) are treated as the same point when welding. */
const WELD_TOLERANCE = 1e-4;

// --- registry of loaded meshes ---------------------------------------------

const registry = new Map<string, MeshData>();

export function newMeshKey(): string {
  return `meshes/${globalThis.crypto.randomUUID()}.bin`;
}

export function registerMesh(key: string, mesh: MeshData) {
  if (!MESH_KEY.test(key)) throw new Error(`Invalid mesh name "${key}".`);
  registry.set(key, mesh);
}

export function getMesh(key: string | undefined): MeshData | undefined {
  return key ? registry.get(key) : undefined;
}

/** Decodes and registers every mesh asset of a project. Throws on damaged data. */
export function registerMeshAssets(assets: Record<string, Uint8Array>) {
  for (const [name, bytes] of Object.entries(assets)) {
    if (!name.startsWith("meshes/")) continue;
    if (registry.has(name)) continue; // meshes never change, so a known key is already correct
    registerMesh(name, decodeMesh(bytes));
  }
}

// --- building meshes from triangles -------------------------------------------

/**
 * Turns a list of separate triangles (9 numbers each) into an indexed mesh, joining
 * corners that are at the same place and dropping triangles that collapsed to a line.
 */
export function weldTriangles(soup: ArrayLike<number>): MeshData {
  const map = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const q = (v: number) => Math.round(v / WELD_TOLERANCE);
  const corner = [0, 0, 0];
  for (let t = 0; t + 8 < soup.length; t += 9) {
    for (let c = 0; c < 3; c++) {
      const x = soup[t + c * 3]!, y = soup[t + c * 3 + 1]!, z = soup[t + c * 3 + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error("The file contains an invalid coordinate.");
      const key = `${q(x)},${q(y)},${q(z)}`;
      let index = map.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        map.set(key, index);
        positions.push(x, y, z);
      }
      corner[c] = index;
    }
    if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) continue;
    indices.push(corner[0]!, corner[1]!, corner[2]!);
  }
  if (indices.length === 0) throw new Error("The file contains no usable triangles.");
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

export function meshBounds(mesh: MeshData): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.positions[i + a]!;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Moves the mesh so the centre of its bottom face is at the origin (the same convention as
 * the built-in shapes). Returns where that point was in the file, so placement can be kept.
 */
export function centreOnOrigin(mesh: MeshData): { mesh: MeshData; offset: [number, number, number] } {
  const { min, max } = meshBounds(mesh);
  const offset: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = mesh.positions[i]! - offset[0];
    positions[i + 1] = mesh.positions[i + 1]! - offset[1];
    positions[i + 2] = mesh.positions[i + 2]! - offset[2];
  }
  return { mesh: { positions, indices: mesh.indices }, offset };
}

// --- file parsing ---------------------------------------------------------------

export type MeshFormat = "stl" | "obj";

export function meshFormatOf(fileName: string): MeshFormat | null {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "stl" || ext === "obj" ? ext : null;
}

function soupOf(geometry: BufferGeometry): Float32Array {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const attr = flat.getAttribute("position");
  if (!attr) return new Float32Array();
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

/** Reads an STL (binary or text) or OBJ file into a welded mesh. Units are taken as millimetres. */
export function parseMeshFile(fileName: string, bytes: Uint8Array): MeshData {
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  const format = meshFormatOf(fileName);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let soup: Float32Array;
  if (format === "stl") {
    let geometry: BufferGeometry;
    try {
      geometry = new STLLoader().parse(buffer);
    } catch (error) {
      throw new Error(`This STL file could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    soup = soupOf(geometry);
  } else if (format === "obj") {
    const text = new TextDecoder().decode(bytes);
    const group = new OBJLoader().parse(text);
    const parts: Float32Array[] = [];
    group.updateMatrixWorld(true);
    group.traverse((child) => {
      if (!(child instanceof ThreeMesh)) return;
      const geometry = (child.geometry as BufferGeometry).clone();
      geometry.applyMatrix4(child.matrixWorld);
      parts.push(soupOf(geometry));
    });
    soup = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) { soup.set(p, offset); offset += p.length; }
  } else {
    throw new Error("Only STL and OBJ files can be imported as meshes.");
  }
  if (soup.length / 9 > MAX_TRIANGLES) throw new Error(`The file has more than ${MAX_TRIANGLES.toLocaleString("en")} triangles.`);
  return weldTriangles(soup);
}

/** three.js geometry for a mesh, positions only. */
export function meshGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(mesh.positions, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  return g;
}
