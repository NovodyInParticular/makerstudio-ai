// Turns model objects into three.js geometry and computes positions and bounding boxes.
// Pure functions (no React, no rendering), shared by the viewport, the commands and tests.

import { Box3, BoxGeometry, BufferGeometry, CylinderGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from "three";
import type { CadObject, Transform } from "./model";
import { csgReady, solidMesh } from "./csg";
import { CURVE_SEGMENTS, textOutline } from "./text";
import { getMesh, meshGeometry } from "./meshes";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const DEG = Math.PI / 180;

/** Geometry in the object's local space (origin at bottom centre, Z up). */
export function buildGeometry(object: CadObject): BufferGeometry | null {
  const p = object.params;
  let g: BufferGeometry;
  switch (object.kind) {
    case "box":
      g = new BoxGeometry(p.width, p.depth, p.height);
      g.translate(0, 0, p.height! / 2);
      break;
    case "sphere":
      g = new SphereGeometry(p.radius, p.segments, Math.max(2, Math.round(p.segments! / 2)));
      g.translate(0, 0, p.radius!);
      break;
    case "cylinder":
      g = new CylinderGeometry(p.radius, p.radius, p.height, p.segments);
      g.rotateX(Math.PI / 2); // three.js cylinders stand along Y; ours stand along Z
      g.translate(0, 0, p.height! / 2);
      break;
    case "cone":
      g = new CylinderGeometry(p.topRadius, p.bottomRadius, p.height, p.segments);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, p.height! / 2);
      break;
    case "torus":
      g = new TorusGeometry(p.radius, p.tube, Math.max(8, Math.round(p.segments! / 2)), p.segments);
      g.translate(0, 0, p.tube!); // lies flat on the bed
      break;
    case "wedge":
      g = wedgeGeometry(p.width!, p.depth!, p.height!);
      break;
    case "text": {
      const outline = textOutline(object.text ?? "", p.size!);
      if (outline.shapes.length === 0) return null;
      g = new ExtrudeGeometry(outline.shapes, { depth: p.depth, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
      g.translate(outline.offset.x, outline.offset.y, 0);
      break;
    }
    case "mesh": {
      const data = getMesh(object.mesh);
      if (!data) return null;
      const indexed = meshGeometry(data);
      // Sharp edges stay sharp, curved surfaces look smooth.
      g = toCreasedNormals(indexed, Math.PI / 6);
      indexed.dispose();
      return g;
    }
    case "group":
      return null;
  }
  g.computeVertexNormals();
  return g;
}

/** A right-angle ramp: full height at -X, sloping down to zero at +X, extruded along Y. */
function wedgeGeometry(w: number, d: number, h: number): BufferGeometry {
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const A = new Vector3(x0, y0, 0), B = new Vector3(x1, y0, 0), C = new Vector3(x0, y0, h);
  const D = new Vector3(x0, y1, 0), E = new Vector3(x1, y1, 0), F = new Vector3(x0, y1, h);
  const triangles = [[A, B, C], [D, E, F], [A, B, E], [A, E, D], [A, D, F], [A, F, C], [B, C, F], [B, F, E]];
  // The wedge is convex, so a triangle faces outward when its normal points away from the centre.
  const centre = new Vector3(-w / 6, 0, h / 3);
  const positions: number[] = [];
  for (const [p, q, r] of triangles as [Vector3, Vector3, Vector3][]) {
    const normal = new Vector3().subVectors(q, p).cross(new Vector3().subVectors(r, p));
    const middle = new Vector3().add(p).add(q).add(r).divideScalar(3);
    const ordered = normal.dot(middle.sub(centre)) >= 0 ? [p, q, r] : [p, r, q];
    for (const v of ordered) positions.push(v.x, v.y, v.z);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return g;
}

export function localMatrix(t: Transform): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, "XYZ"));
  return new Matrix4().compose(new Vector3(...t.position), q, new Vector3(...t.scale));
}

export function byId(objects: CadObject[]): Map<string, CadObject> {
  return new Map(objects.map((o) => [o.id, o]));
}

/** Matrix from the object's local space to world space, including all parent groups. */
export function worldMatrix(object: CadObject, index: Map<string, CadObject>): Matrix4 {
  const m = localMatrix(object.transform);
  let parent = object.parentId ? index.get(object.parentId) : undefined;
  let guard = 0;
  while (parent && guard++ < 100) {
    m.premultiply(localMatrix(parent.transform));
    parent = parent.parentId ? index.get(parent.parentId) : undefined;
  }
  return m;
}

/** Splits a matrix back into position / rotation (degrees) / scale. Shear, if any, is lost. */
export function decompose(m: Matrix4): Transform {
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  m.decompose(position, quaternion, scale);
  const e = new Euler().setFromQuaternion(quaternion, "XYZ");
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    position: [round(position.x), round(position.y), round(position.z)],
    rotation: [round(e.x / DEG), round(e.y / DEG), round(e.z / DEG)],
    scale: [round(scale.x), round(scale.y), round(scale.z)],
  };
}

export function childrenOf(id: string | null, objects: CadObject[]): CadObject[] {
  return objects.filter((o) => o.parentId === id);
}

/** The object and everything inside it (for groups). */
export function subtreeIds(id: string, objects: CadObject[]): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const o of objects) if (o.parentId === out[i]) out.push(o.id);
  }
  return out;
}

// Keyed by the params object (replaced on every size change). The entry also
// remembers the text / mesh it was built for, because changing only those keeps
// the same params object.
const geometryCache = new WeakMap<object, { key: string; geometry: BufferGeometry | null }>();
const cacheKey = (o: CadObject) => `${o.text ?? ""}|${o.mesh ?? ""}`;

function cachedGeometry(object: CadObject): BufferGeometry | null {
  const hit = geometryCache.get(object.params);
  if (hit && hit.key === cacheKey(object)) return hit.geometry;
  const g = buildGeometry(object);
  try {
    geometryCache.set(object.params, { key: cacheKey(object), geometry: g });
  } catch {
    // params is a temporary draft proxy inside a command; just don't cache it
  }
  return g;
}

/**
 * Exact world-space bounding box of objects, computed from transformed vertices.
 * Groups use their combined solid (holes cut away) when the solid engine is loaded,
 * otherwise the box around everything inside them.
 */
export function worldBounds(ids: string[], objects: CadObject[]): Box3 {
  const index = byId(objects);
  const result = new Box3();
  const point = new Vector3();
  const done = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    const object = index.get(id);
    if (!object) return;
    if (object.kind === "group") {
      let mesh = null;
      try {
        mesh = csgReady() ? solidMesh(object, objects) : null;
      } catch {
        mesh = null; // cannot be combined (for example an open mesh inside): use the parts instead
      }
      if (mesh) {
        const m = worldMatrix(object, index);
        for (let i = 0; i < mesh.positions.length; i += 3) {
          result.expandByPoint(point.set(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!).applyMatrix4(m));
        }
      } else {
        for (const child of objects) if (child.parentId === id) visit(child.id);
      }
      return;
    }
    const m = worldMatrix(object, index);
    if (object.kind === "mesh") {
      // The raw vertices are the same points; building display geometry for a big mesh takes seconds.
      const data = getMesh(object.mesh);
      if (!data) return;
      const v = data.positions;
      for (let i = 0; i < v.length; i += 3) result.expandByPoint(point.set(v[i]!, v[i + 1]!, v[i + 2]!).applyMatrix4(m));
      return;
    }
    const g = cachedGeometry(object);
    if (!g) return;
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) result.expandByPoint(point.fromBufferAttribute(pos, i).applyMatrix4(m));
  };
  for (const id of ids) visit(id);
  return result;
}

/** Top-level ancestor (what a click in the viewport selects). */
export function rootOf(id: string, index: Map<string, CadObject>): string {
  let current = index.get(id);
  let guard = 0;
  while (current?.parentId && guard++ < 100) {
    const parent = index.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? id;
}
