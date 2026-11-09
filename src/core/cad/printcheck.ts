// Print preparation checks for FDM printers (default: Bambu Lab A1).
//
// Works on the same world-space meshes that are exported (see exporting.ts), so what is
// checked is exactly what the slicer will get. All checks are geometric estimates and are
// described to the user as such; the slicer has the final say.
//
//   - fits the build volume, sits inside the bed area, rests on the bed
//   - overhangs: downward faces that lean more than the overhang angle from vertical
//     (45° is the usual rule of thumb), not counting the faces on the bed
//   - thin walls: material thinner than the nozzle (left out by the slicer) or thinner
//     than two lines (fragile), measured by casting rays inward through the solid;
//     sharp tapered edges (wedge tips, chamfers: sides more than 10° apart) are not counted as walls
//   - bed contact: how much flat face touches the bed (adhesion, tipping)
//   - orientation: tries the main flat faces and the six axis directions and picks the
//     one with the least overhang and the most bed contact

import { BufferAttribute, BufferGeometry, DoubleSide, Quaternion, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { ExportPart } from "./exporting";

export interface PrinterSpec {
  name: string;
  bedX: number;
  bedY: number;
  bedZ: number;
  nozzle: number;
}

export const BAMBU_A1: PrinterSpec = { name: "Bambu Lab A1", bedX: 256, bedY: 256, bedZ: 256, nozzle: 0.4 };

export type Severity = "error" | "warning" | "info";

export interface PrintIssue {
  severity: Severity;
  code: "too-big" | "off-bed" | "below-bed" | "floating" | "overhang" | "too-thin" | "thin-wall" | "no-contact" | "small-contact" | "tiny" | "open-mesh";
  message: string;
}

export interface PartReport {
  id: string;
  name: string;
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  triangles: number;
  watertight: boolean;
  surfaceArea: number; // mm²
  overhangArea: number; // mm²
  bedContactArea: number; // mm²
  /** Area where the wall is thinner than the nozzle, mm². */
  tooThinArea: number;
  /** Area where the wall is thinner than two lines (but at least one), mm². */
  thinArea: number;
  /** Thinnest wall found, mm (null when nothing thinner than two lines was found). */
  thinnest: number | null;
  /** Triangle numbers for highlighting in the viewport. */
  overhangTriangles: Uint32Array;
  thinTriangles: Uint32Array;
  issues: PrintIssue[];
}

export interface PrintReport {
  printer: PrinterSpec;
  parts: PartReport[];
  /** Highest severity found, or null when nothing was found. */
  worst: Severity | null;
}

export interface CheckOptions {
  /** Faces leaning more than this from vertical count as overhangs (degrees). */
  overhangAngle?: number;
  /** Upper bound on the number of rays cast per part for the wall check. */
  raySamples?: number;
}

const BED_TOLERANCE = 0.02; // mm: "touching the bed"
const FIRST_LAYER = 0.2; // mm: faces this close to the bottom are printed on the bed
const PARALLEL = Math.cos((10 * Math.PI) / 180); // far side within 10° of parallel = a wall
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const fmtArea = (n: number) => (n >= 100 ? String(Math.round(n)) : fmt(n));

/** Per-triangle area and unit normal of a world-space mesh. */
function triangleData(positions: Float32Array, indices: Uint32Array) {
  const count = indices.length / 3;
  const area = new Float64Array(count);
  const normal = new Float64Array(count * 3);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e = new Vector3();
  for (let t = 0; t < count; t++) {
    const i0 = indices[t * 3]! * 3, i1 = indices[t * 3 + 1]! * 3, i2 = indices[t * 3 + 2]! * 3;
    a.set(positions[i0]!, positions[i0 + 1]!, positions[i0 + 2]!);
    b.set(positions[i1]!, positions[i1 + 1]!, positions[i1 + 2]!);
    c.set(positions[i2]!, positions[i2 + 1]!, positions[i2 + 2]!);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const len = n.length();
    area[t] = len / 2;
    if (len > 0) n.divideScalar(len);
    normal[t * 3] = n.x; normal[t * 3 + 1] = n.y; normal[t * 3 + 2] = n.z;
  }
  return { count, area, normal };
}

function bounds(positions: Float32Array) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

interface SupportStats {
  overhangArea: number;
  contactArea: number;
  overhang: number[];
}

/**
 * Overhang and bed-contact areas for a mesh whose triangles have the given normals and
 * whose lowest point is minZ. zOf returns the z of a vertex index (lets the orientation
 * search evaluate rotations without copying the mesh).
 */
function supportStats(
  indices: Uint32Array, area: Float64Array, nz: (t: number) => number, zOf: (v: number) => number, minZ: number, cosLimit: number, collect: boolean,
): SupportStats {
  let overhangArea = 0, contactArea = 0;
  const overhang: number[] = [];
  for (let t = 0, n = area.length; t < n; t++) {
    const z = nz(t);
    if (z >= -cosLimit) continue; // not facing down steeply enough
    const z0 = zOf(indices[t * 3]!), z1 = zOf(indices[t * 3 + 1]!), z2 = zOf(indices[t * 3 + 2]!);
    const top = Math.max(z0, z1, z2) - minZ;
    if (z < -0.999 && top <= BED_TOLERANCE) { contactArea += area[t]!; continue; }
    if (top <= FIRST_LAYER) continue; // printed directly on the bed
    overhangArea += area[t]!;
    if (collect) overhang.push(t);
  }
  return { overhangArea, contactArea, overhang };
}

/** Small deterministic random numbers, so the same model always gives the same report. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface WallStats {
  tooThinArea: number;
  thinArea: number;
  thinnest: number | null;
  thin: number[];
}

/**
 * Wall thickness by ray casting: from sample points on each triangle, a ray goes straight
 * into the solid (against the outward normal); the distance to the far side is the local
 * wall thickness. Only meaningful for closed meshes.
 */
function wallStats(positions: Float32Array, indices: Uint32Array, tri: ReturnType<typeof triangleData>, limit: number, oneLine: number, budget: number): WallStats {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1)); // the BVH reorders its copy
  const bvh = new MeshBVH(geometry);
  const total = tri.area.reduce((s, a) => s + a, 0);
  const sampleArea = total / budget;
  const random = rng(indices.length);
  const ray = new Ray();
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), p = new Vector3();
  let tooThinArea = 0, thinArea = 0, thinnest: number | null = null;
  const thin: number[] = [];
  // Every triangle gets at least one ray, so a very detailed mesh (millions of triangles from a
  // sculpt or scan) would cast millions. Beyond a few rays per budget sample, probe an even random
  // share of the triangles instead and weight what they find, which keeps the areas unbiased.
  const share = Math.min(1, (budget * 4) / Math.max(1, tri.count));
  const pick = rng(tri.count + 1);
  for (let t = 0; t < tri.count; t++) {
    const area = tri.area[t]!;
    if (area <= 0) continue;
    if (share < 1 && pick() >= share) continue;
    const i0 = indices[t * 3]! * 3, i1 = indices[t * 3 + 1]! * 3, i2 = indices[t * 3 + 2]! * 3;
    a.set(positions[i0]!, positions[i0 + 1]!, positions[i0 + 2]!);
    b.set(positions[i1]!, positions[i1 + 1]!, positions[i1 + 2]!);
    c.set(positions[i2]!, positions[i2 + 1]!, positions[i2 + 2]!);
    ray.direction.set(-tri.normal[t * 3]!, -tri.normal[t * 3 + 1]!, -tri.normal[t * 3 + 2]!);
    const samples = Math.min(16, Math.max(1, Math.ceil(area / sampleArea)));
    let thinHere = 0, tooThinHere = 0;
    for (let s = 0; s < samples; s++) {
      // Centroid first, then random points inside the triangle.
      let u = 1 / 3, v = 1 / 3;
      if (s > 0) {
        u = random(); v = random();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
      }
      p.set(0, 0, 0).addScaledVector(a, 1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
      ray.origin.copy(p).addScaledVector(ray.direction, 1e-4);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, limit);
      if (!hit) continue;
      // A wall has its far side roughly parallel to the near side. Where the far side meets
      // at an angle, this is a tapered edge (a wedge or chamfer tip), not a thin wall.
      if (!hit.face || Math.abs(hit.face.normal.dot(ray.direction)) < PARALLEL) continue;
      const d = hit.distance + 1e-4;
      if (d < 1e-3) continue; // touching itself at a sharp edge: not a wall
      if (thinnest === null || d < thinnest) thinnest = d;
      if (d < oneLine) tooThinHere++;
      else thinHere++;
    }
    if (tooThinHere || thinHere) {
      tooThinArea += (area * tooThinHere) / samples / share;
      thinArea += (area * thinHere) / samples / share;
      thin.push(t);
    }
  }
  geometry.dispose();
  return { tooThinArea, thinArea, thinnest, thin };
}

/** Checks one exported part against the printer. */
export function checkPart(part: ExportPart, printer: PrinterSpec, options: CheckOptions = {}): PartReport {
  const { min, max } = bounds(part.positions);
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const tri = triangleData(part.positions, part.indices);
  const surfaceArea = tri.area.reduce((s, a) => s + a, 0);
  const cosLimit = Math.cos(((90 - (options.overhangAngle ?? 45)) * Math.PI) / 180);
  const z = (v: number) => part.positions[v * 3 + 2]!;
  const support = supportStats(part.indices, tri.area, (t) => tri.normal[t * 3 + 2]!, z, min[2], cosLimit, true);
  const twoLines = printer.nozzle * 2;
  const walls = part.watertight
    ? wallStats(part.positions, part.indices, tri, twoLines, printer.nozzle, options.raySamples ?? 20000)
    : { tooThinArea: 0, thinArea: 0, thinnest: null, thin: [] };

  const issues: PrintIssue[] = [];
  const add = (severity: Severity, code: PrintIssue["code"], message: string) => issues.push({ severity, code, message });
  const volume: [number, number, number] = [printer.bedX, printer.bedY, printer.bedZ];
  const sizeText = size.map(fmt).join(" × ");

  if (!part.watertight) add("warning", "open-mesh", "It is not a closed (watertight) solid, so walls could not be measured and the slicer may need to repair it.");
  if (Math.max(...size) < printer.nozzle * 2) add("error", "tiny", `It is only ${sizeText} mm, too small to print with a ${printer.nozzle} mm nozzle.`);

  const tooBig = size.some((s, k) => s > volume[k]! + 1e-6);
  if (tooBig) {
    const [a, b, c] = [...size].sort((x, y) => x - y) as [number, number, number];
    const fitsRotated = [a, b, c].every((s, k) => s <= [...volume].sort((x, y) => x - y)[k]! + 1e-6);
    // A long part lying at 45° across the bed: its footprint is (length + width) / √2 square.
    const fitsDiagonal = a <= printer.bedZ + 1e-6 && (c + b) / Math.SQRT2 <= Math.min(printer.bedX, printer.bedY) + 1e-6;
    add("error", "too-big", `At ${sizeText} mm it is bigger than the ${printer.name} build volume (${volume.join(" × ")} mm).` +
      (fitsRotated ? " It would fit if turned on its side: try Orient for printing."
        : fitsDiagonal ? " It would fit lying diagonally across the bed: try Orient for printing."
          : " Scale it down or split it into parts."));
  } else {
    const off = min[0] < -printer.bedX / 2 - 1e-6 || max[0] > printer.bedX / 2 + 1e-6 || min[1] < -printer.bedY / 2 - 1e-6 || max[1] > printer.bedY / 2 + 1e-6;
    if (off) add("warning", "off-bed", "Part of it is outside the bed area. Move it onto the bed (the slicer can also arrange it for you).");
  }
  if (min[2] < -BED_TOLERANCE) add("warning", "below-bed", `It goes ${fmt(-min[2])} mm below the bed. The slicer will lift it onto the bed; press D (Drop to bed) to see it the same way.`);
  else if (min[2] > BED_TOLERANCE) add("info", "floating", `It floats ${fmt(min[2])} mm above the bed. The slicer will drop it onto the bed; press D (Drop to bed) to match.`);

  if (walls.tooThinArea > 0.05) {
    add("error", "too-thin", `About ${fmtArea(walls.tooThinArea)} mm² of it is thinner than the ${printer.nozzle} mm nozzle (thinnest ≈ ${fmt(walls.thinnest ?? 0)} mm). The slicer will leave those parts out; make them at least ${fmt(twoLines)} mm thick.`);
  } else if (walls.thinArea > 0.5) {
    add("warning", "thin-wall", `About ${fmtArea(walls.thinArea)} mm² has walls under ${fmt(twoLines)} mm (two nozzle widths), thinnest ≈ ${fmt(walls.thinnest ?? 0)} mm. Those print as a single line and break easily.`);
  }

  if (support.overhangArea > 4) {
    add("warning", "overhang", `About ${fmtArea(support.overhangArea)} mm² faces downward more steeply than ${options.overhangAngle ?? 45}° from vertical. Those overhangs need supports (turn them on in the slicer) or a different orientation.`);
  }
  if (part.watertight && support.contactArea < 1) {
    add("warning", "no-contact", "No flat face rests on the bed (it touches only at a point or an edge). It needs supports or a brim, or turn it so a flat face is down.");
  } else if (support.contactArea >= 1 && size[2] > 4 * Math.sqrt(support.contactArea) && size[2] > 20) {
    add("info", "small-contact", `It is tall (${fmt(size[2])} mm) on a small footprint (${fmtArea(support.contactArea)} mm²) and may wobble or come loose. A brim in the slicer helps.`);
  }

  return {
    id: part.id,
    name: part.name,
    size, min, max,
    triangles: tri.count,
    watertight: part.watertight,
    surfaceArea,
    overhangArea: support.overhangArea,
    bedContactArea: support.contactArea,
    tooThinArea: walls.tooThinArea,
    thinArea: walls.thinArea,
    thinnest: walls.thinnest,
    overhangTriangles: Uint32Array.from(support.overhang),
    thinTriangles: Uint32Array.from(walls.thin),
    issues,
  };
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export function checkPrint(parts: ExportPart[], printer: PrinterSpec, options: CheckOptions = {}): PrintReport {
  const reports = parts.map((p) => checkPart(p, printer, options));
  let worst: Severity | null = null;
  for (const r of reports) for (const i of r.issues) if (worst === null || RANK[i.severity] > RANK[worst]) worst = i.severity;
  return { printer, parts: reports, worst };
}

export interface OrientationChoice {
  /** World rotation to apply (x, y, z, w). Identity means "keep as it is". */
  quaternion: [number, number, number, number];
  overhangArea: number;
  contactArea: number;
  height: number;
  /** The same numbers for the current orientation. */
  current: { overhangArea: number; contactArea: number; height: number };
  /** True when the best choice is not clearly better than the current one. */
  keep: boolean;
}

/**
 * Finds a good print orientation: candidates are the largest flat faces turned down onto
 * the bed and the six axis directions. Each is scored by overhang area (less is better)
 * and bed contact area (more is better); candidates that do not fit the printer are skipped.
 */
export function bestOrientation(part: ExportPart, printer: PrinterSpec, options: CheckOptions = {}): OrientationChoice {
  const tri = triangleData(part.positions, part.indices);
  const cosLimit = Math.cos(((90 - (options.overhangAngle ?? 45)) * Math.PI) / 180);
  const vertexCount = part.positions.length / 3;

  // Group triangle areas by (rounded) normal to find the big flat faces.
  const faces = new Map<string, { n: Vector3; area: number }>();
  for (let t = 0; t < tri.count; t++) {
    const nx = tri.normal[t * 3]!, ny = tri.normal[t * 3 + 1]!, nz = tri.normal[t * 3 + 2]!;
    const key = `${Math.round(nx * 200)},${Math.round(ny * 200)},${Math.round(nz * 200)}`;
    const face = faces.get(key);
    if (face) face.area += tri.area[t]!;
    else faces.set(key, { n: new Vector3(nx, ny, nz), area: tri.area[t]! });
  }
  const down = new Vector3(0, 0, -1);
  const candidates: Quaternion[] = [new Quaternion()];
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new Vector3(x, y, z));
  const flat = [...faces.values()].filter((f) => f.n.lengthSq() > 0.5).sort((a, b) => b.area - a.area).slice(0, 12).map((f) => f.n.clone().normalize());
  const diagonal = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
  for (const n of [...flat, ...axes]) {
    const q = new Quaternion().setFromUnitVectors(n, down);
    candidates.push(q, diagonal.clone().multiply(q)); // also try it turned 45° on the bed
  }

  const zs = new Float64Array(vertexCount);
  const v = new Vector3(), n = new Vector3();
  const score = (q: Quaternion) => {
    let minZ = Infinity, maxZ = -Infinity;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
      v.set(part.positions[i * 3]!, part.positions[i * 3 + 1]!, part.positions[i * 3 + 2]!).applyQuaternion(q);
      zs[i] = v.z;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
      for (let k = 0; k < 3; k++) { const c = v.getComponent(k); if (c < mn[k]!) mn[k] = c; if (c > mx[k]!) mx[k] = c; }
    }
    const fits = mx[0]! - mn[0]! <= printer.bedX + 1e-6 && mx[1]! - mn[1]! <= printer.bedY + 1e-6 && maxZ - minZ <= printer.bedZ + 1e-6;
    const nz = (t: number) => n.set(tri.normal[t * 3]!, tri.normal[t * 3 + 1]!, tri.normal[t * 3 + 2]!).applyQuaternion(q).z;
    const s = supportStats(part.indices, tri.area, nz, (i) => zs[i]!, minZ, cosLimit, false);
    return { fits, overhangArea: s.overhangArea, contactArea: s.contactArea, height: maxZ - minZ, value: s.overhangArea - 0.3 * s.contactArea + 1e-3 * (maxZ - minZ) };
  };

  const current = score(candidates[0]!);
  let best = { q: candidates[0]!, ...current };
  for (const q of candidates.slice(1)) {
    const s = score(q);
    if (!s.fits && best.fits) continue;
    if ((s.fits && !best.fits) || s.value < best.value - 1e-6) best = { q, ...s };
  }
  const total = tri.area.reduce((s, a) => s + a, 0);
  const keep = best.q === candidates[0] || (current.fits && current.value - best.value < Math.max(1, total * 0.01));
  const chosen = keep ? candidates[0]! : best.q;
  const result = keep ? current : best;
  return {
    quaternion: [chosen.x, chosen.y, chosen.z, chosen.w],
    overhangArea: result.overhangArea,
    contactArea: result.contactArea,
    height: result.height,
    current: { overhangArea: current.overhangArea, contactArea: current.contactArea, height: current.height },
    keep,
  };
}
