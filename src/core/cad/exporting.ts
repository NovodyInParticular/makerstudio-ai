// Exporting the model for printing: STL (binary) and OBJ.
//
// Every exported object goes through the solid engine first, so what is written is the same
// closed (watertight) mesh a slicer needs: holes are cut, groups are combined. Imported meshes
// that are not closed are written as they are, with a warning.

import { Matrix4, Vector3 } from "three";
import { checkMesh, meshIsWatertight, solidMesh } from "./csg";
import { byId, worldMatrix } from "./geometry";
import { getMesh, type MeshData } from "./meshes";
import type { CadObject } from "./model";

export interface ExportPart {
  /** The top-level object this part was made from. */
  id: string;
  name: string;
  /** World coordinates, mm. */
  positions: Float32Array;
  indices: Uint32Array;
  watertight: boolean;
}

export interface ExportResult {
  parts: ExportPart[];
  warnings: string[];
}

function transformed(mesh: MeshData, m: Matrix4): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  const v = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!).applyMatrix4(m);
    positions[i] = v.x; positions[i + 1] = v.y; positions[i + 2] = v.z;
  }
  let indices = mesh.indices;
  // A mirroring scale (negative) turns the triangles inside out; flip them back.
  if (m.determinant() < 0) {
    indices = new Uint32Array(mesh.indices);
    for (let t = 0; t < indices.length; t += 3) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!];
  }
  return { positions, indices };
}

/**
 * Collects the printable parts for the given top-level objects (or all visible top-level
 * objects when ids is empty). Each top-level object becomes one part.
 */
export function collectParts(ids: string[], objects: CadObject[]): ExportResult {
  const index = byId(objects);
  const roots = ids.length ? ids.map((id) => index.get(id)).filter((o): o is CadObject => !!o) : objects.filter((o) => o.parentId === null && o.visible);
  const parts: ExportPart[] = [];
  const warnings: string[] = [];
  for (const object of roots) {
    if (!object.visible) {
      warnings.push(`"${object.name}" is hidden and was not exported.`);
      continue;
    }
    if (object.hole) {
      warnings.push(`"${object.name}" is a hole that is not grouped with anything, so it was not exported.`);
      continue;
    }
    const m = worldMatrix(object, index);
    if (object.kind === "mesh") {
      const data = getMesh(object.mesh);
      if (!data) { warnings.push(`The mesh data for "${object.name}" is missing.`); continue; }
      const watertight = object.mesh ? meshIsWatertight(object.mesh) === true : checkMesh(data).watertight;
      if (!watertight) warnings.push(`"${object.name}" is not a closed (watertight) solid. It was exported as it is; the slicer may need to repair it.`);
      // A mesh on its own has nothing to combine or cut: its own triangles are the part
      // (running a big closed mesh through the solid engine again only costs time).
      parts.push({ id: object.id, name: object.name, ...transformed(data, m), watertight });
      continue;
    }
    const solid = solidMesh(object, objects);
    if (solid.empty) {
      warnings.push(`"${object.name}" has no solid volume (for example only holes, or nothing left after cutting), so it was not exported.`);
      continue;
    }
    parts.push({ id: object.id, name: object.name, ...transformed(solid, m), watertight: true });
  }
  return { parts, warnings };
}

/** Binary STL with all parts in one file. */
export function writeStl(parts: ExportPart[], title = "MakerStudio AI export"): Uint8Array {
  const triangles = parts.reduce((n, p) => n + p.indices.length / 3, 0);
  const bytes = new Uint8Array(84 + triangles * 50);
  const view = new DataView(bytes.buffer);
  const header = `${title}`.slice(0, 79);
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  view.setUint32(80, triangles, true);
  let o = 84;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e = new Vector3();
  for (const part of parts) {
    const p = part.positions;
    for (let t = 0; t < part.indices.length; t += 3) {
      const i0 = part.indices[t]! * 3, i1 = part.indices[t + 1]! * 3, i2 = part.indices[t + 2]! * 3;
      a.set(p[i0]!, p[i0 + 1]!, p[i0 + 2]!);
      b.set(p[i1]!, p[i1 + 1]!, p[i1 + 2]!);
      c.set(p[i2]!, p[i2 + 1]!, p[i2 + 2]!);
      n.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
      for (const v of [n, a, b, c]) {
        view.setFloat32(o, v.x, true); view.setFloat32(o + 4, v.y, true); view.setFloat32(o + 8, v.z, true);
        o += 12;
      }
      o += 2; // attribute byte count, unused
    }
  }
  return bytes;
}

/** Wavefront OBJ, one named object per part. Units: mm. */
export function writeObj(parts: ExportPart[]): Uint8Array {
  const lines: string[] = ["# MakerStudio AI export (units: mm)"];
  let base = 1;
  const f = (v: number) => String(Math.round(v * 1e5) / 1e5);
  for (const part of parts) {
    lines.push(`o ${part.name.replace(/\s+/g, "_") || "part"}`);
    for (let i = 0; i < part.positions.length; i += 3) lines.push(`v ${f(part.positions[i]!)} ${f(part.positions[i + 1]!)} ${f(part.positions[i + 2]!)}`);
    for (let t = 0; t < part.indices.length; t += 3) lines.push(`f ${part.indices[t]! + base} ${part.indices[t + 1]! + base} ${part.indices[t + 2]! + base}`);
    base += part.positions.length / 3;
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

/** A file name that is safe on Windows and Linux. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  return cleaned.slice(0, 100) || "part";
}

/** One file name per part, made unique ("Box", "Box (2)", ...). */
export function partFileNames(parts: ExportPart[], extension: string): string[] {
  const used = new Map<string, number>();
  return parts.map((part) => {
    const base = safeFileName(part.name);
    const key = base.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    return `${n === 1 ? base : `${base} (${n})`}.${extension}`;
  });
}
