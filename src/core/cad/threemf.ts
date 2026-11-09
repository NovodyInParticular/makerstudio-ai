// 3MF reader (3MF Core spec): every build item becomes one mesh, with component and item
// transforms applied, in millimetres. Handles Bambu Studio / PrusaSlicer project files, whose
// parts live in separate 3D/Objects/*.model files referenced by components.

import { strFromU8, unzipSync } from "fflate";
import { MAX_TRIANGLES, type MeshData } from "./meshCodec";

const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
type M = number[]; // 12 numbers, 3MF row order: x' = x*m0 + y*m3 + z*m6 + m9 ...
const IDENT: M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const mul = (a: M, b: M): M => { // apply a, then b
  const r: M = new Array(12).fill(0);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
    let v = row === 3 ? b[9 + col]! : 0;
    for (let k = 0; k < 3; k++) v += a[row * 3 + k]! * b[k * 3 + col]!;
    r[row * 3 + col] = v;
  }
  return r;
};
const parseM = (s: string | undefined): M => { const n = s?.trim().split(/\s+/).map(Number); return n && n.length === 12 && n.every(Number.isFinite) ? n : IDENT; };
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

interface Obj { name?: string; positions?: Float32Array; indices?: Uint32Array; components: { ref: string; m: M }[] }

export function read3mf(bytes: Uint8Array): { name: string; mesh: MeshData }[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /\.model$/i.test(f.name) }); } catch { throw new Error("This 3MF file could not be opened (not a valid zip)."); }
  const paths = Object.keys(files);
  const main = paths.find((p) => /^3D\/3dmodel\.model$/i.test(p)) ?? paths[0];
  if (!main) throw new Error("This 3MF file has no 3D model inside.");
  const objects = new Map<string, Obj>();
  let scale = 1;
  const items: { ref: string; m: M }[] = [];
  for (const path of paths) {
    const xml = strFromU8(files[path]!);
    const unit = /<model[^>]*\sunit="([^"]+)"/.exec(xml)?.[1];
    if (path === main) scale = UNIT_MM[unit ?? "millimeter"] ?? 1;
    const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    for (let m; (m = objRe.exec(xml)); ) {
      const id = attr(m[1]!, "id");
      if (!id) continue;
      const body = m[2]!;
      const o: Obj = { name: attr(m[1]!, "name"), components: [] };
      const vs = body.match(/<vertex\b[^>]*\/>/g);
      if (vs) {
        const pos = new Float32Array(vs.length * 3);
        vs.forEach((v, i) => { pos[i * 3] = Number(attr(v, "x")); pos[i * 3 + 1] = Number(attr(v, "y")); pos[i * 3 + 2] = Number(attr(v, "z")); });
        const ts = body.match(/<triangle\b[^>]*\/>/g) ?? [];
        if (ts.length > MAX_TRIANGLES) throw new Error(`An object has more than ${MAX_TRIANGLES.toLocaleString("en")} triangles.`);
        const idx = new Uint32Array(ts.length * 3);
        ts.forEach((t, i) => { idx[i * 3] = Number(attr(t, "v1")); idx[i * 3 + 1] = Number(attr(t, "v2")); idx[i * 3 + 2] = Number(attr(t, "v3")); });
        for (const i of idx) if (i >= vs.length) throw new Error("This 3MF file has a triangle pointing at a missing vertex.");
        o.positions = pos; o.indices = idx;
      }
      for (const c of body.match(/<component\b[^>]*\/>/g) ?? []) {
        const cp = (attr(c, "p:path") ?? attr(c, "path") ?? `/${path}`).replace(/^\//, "");
        o.components.push({ ref: `${cp}#${attr(c, "objectid")}`, m: parseM(attr(c, "transform")) });
      }
      objects.set(`${path}#${id}`, o);
    }
    if (path === main) for (const it of xml.match(/<item\b[^>]*\/?>/g) ?? []) items.push({ ref: `${(attr(it, "p:path") ?? `/${path}`).replace(/^\//, "")}#${attr(it, "objectid")}`, m: parseM(attr(it, "transform")) });
  }
  const out: { name: string; mesh: MeshData }[] = [];
  items.forEach((item, n) => {
    const pos: number[] = [], idx: number[] = [];
    const walk = (ref: string, m: M, depth: number) => {
      const o = objects.get(ref);
      if (!o || depth > 16) return;
      if (o.positions && o.indices) {
        const base = pos.length / 3;
        for (let i = 0; i < o.positions.length; i += 3) {
          const x = o.positions[i]!, y = o.positions[i + 1]!, z = o.positions[i + 2]!;
          pos.push((x * m[0]! + y * m[3]! + z * m[6]! + m[9]!) * scale, (x * m[1]! + y * m[4]! + z * m[7]! + m[10]!) * scale, (x * m[2]! + y * m[5]! + z * m[8]! + m[11]!) * scale);
        }
        for (const i of o.indices) idx.push(base + i);
      }
      for (const c of o.components) walk(c.ref, mul(c.m, m), depth + 1);
    };
    walk(item.ref, item.m, 0);
    if (idx.length) out.push({ name: objects.get(item.ref)?.name ?? `Object ${n + 1}`, mesh: { positions: new Float32Array(pos), indices: new Uint32Array(idx) } });
  });
  if (!out.length) throw new Error("This 3MF file has no printable objects.");
  return out;
}
