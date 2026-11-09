// Display geometry for imported meshes, shared between 3D Studio and Robotics Studio.
//
// Imported figures can have millions of triangles. Building their display geometry takes
// seconds, so it is built once per mesh (mesh data never changes for a key) and kept while
// it is likely to be shown again, instead of on every visit to a studio.

import type { BufferGeometry } from "three";
import { buildGeometry } from "../../core/cad/geometry";
import type { CadObject } from "../../core/cad/model";

/** Above this many triangles, outline edges are not drawn (too slow to build, and only noise on a detailed model). */
export const EDGE_LINE_TRIANGLE_LIMIT = 200_000;

/** Total triangles kept in the cache; the least recently used meshes are dropped beyond it. */
const CACHE_TRIANGLE_LIMIT = 30_000_000;

const cache = new Map<string, { geometry: BufferGeometry | null; triangles: number }>();
let total = 0;

export function triangleCount(geometry: BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
}

/** Geometry for an imported mesh object. It is shared: callers must not dispose it. */
export function sharedMeshGeometry(object: CadObject): BufferGeometry | null {
  const key = object.mesh;
  if (object.kind !== "mesh" || !key) return null;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit.geometry;
  }
  const geometry = buildGeometry(object);
  const triangles = geometry ? triangleCount(geometry) : 0;
  if (!geometry) return null; // mesh data not loaded yet: try again next time
  cache.set(key, { geometry, triangles });
  total += triangles;
  while (total > CACHE_TRIANGLE_LIMIT && cache.size > 1) {
    const [oldKey, old] = cache.entries().next().value!;
    cache.delete(oldKey);
    total -= old.triangles;
    old.geometry?.dispose(); // still-mounted users get it re-uploaded by three.js on the next frame
  }
  return geometry;
}
