import { exportSTEP, makeBox } from "replicad";
import { beforeAll, describe, expect, it } from "vitest";
import { checkMesh, initCsg } from "../../src/core/cad/csg";
import { collectParts } from "../../src/core/cad/exporting";
import { meshBounds, registerMesh, weldTriangles } from "../../src/core/cad/meshes";
import { DEFAULT_PARAMS, IDENTITY, type CadObject, type PrimitiveKind, type Transform } from "../../src/core/cad/model";
import { initStep, readStep, writeStep } from "../../src/core/cad/step";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
  const quiet = () => {};
  await initStep(async () => (await import("replicad-opencascadejs")).default({ print: quiet, printErr: quiet } as never));
}, 60000);

function shape(id: string, kind: PrimitiveKind, params: Record<string, number> = {}, transform: Partial<Transform> = {}, extra: Partial<CadObject> = {}): CadObject {
  return {
    id, name: id, kind, params: { ...DEFAULT_PARAMS[kind], ...params }, transform: { ...IDENTITY, ...transform },
    ...(kind === "text" ? { text: "MAKER" } : {}),
    hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra,
  };
}

/** Exports the objects to STEP, reads the file back and returns the solids with their volumes. */
async function roundTrip(objects: CadObject[]) {
  const { parts } = collectParts([], objects);
  const out = await writeStep(parts, objects);
  const text = new TextDecoder().decode(out.bytes);
  const back = readStep(out.bytes);
  const solids = back.solids.map((s) => ({ ...meshBounds(s.mesh), check: checkMesh(s.mesh) }));
  return { out, text, solids, parts };
}

describe("STEP export and import", () => {
  it("round-trips an exact box with its size, place, name and units", async () => {
    const { out, text, solids } = await roundTrip([shape("Base plate", "box", { width: 10, depth: 20, height: 30 }, { position: [5, -7, 2] })]);
    expect(out.exact).toEqual(["Base plate"]);
    expect(out.faceted).toEqual([]);
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    expect(text).toContain("Base plate");
    expect(text).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    expect(solids).toHaveLength(1);
    expect(solids[0]!.check.watertight).toBe(true);
    expect(solids[0]!.check.volume).toBeCloseTo(6000, 1);
    expect(solids[0]!.min.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([0, -17, 2]);
    expect(solids[0]!.max.map((v) => Math.round(v * 1e4) / 1e4)).toEqual([10, 3, 32]);
  });

  it("writes true circles: a cylinder's volume is closer to π r² h than the faceted STL", async () => {
    const cylinder = shape("c", "cylinder", { radius: 10, height: 20 });
    const { out, solids, parts } = await roundTrip([cylinder]);
    expect(out.exact).toEqual(["c"]);
    const ideal = Math.PI * 100 * 20;
    const stl = checkMesh(parts[0]!).volume;
    expect(Math.abs(solids[0]!.check.volume - ideal) / ideal).toBeLessThan(0.002);
    expect(Math.abs(solids[0]!.check.volume - ideal)).toBeLessThan(Math.abs(stl - ideal));
  });

  it.each([
    ["sphere", {}, {}],
    ["sphere (ellipsoid)", {}, { scale: [2, 1, 0.5] }],
    ["cone", {}, {}],
    ["cone (to a point)", { topRadius: 0 }, {}],
    ["torus", {}, { rotation: [30, 0, 45] }],
    ["wedge", {}, { rotation: [0, 0, 90], scale: [1.5, 1, 2] }],
    ["wedge (mirrored)", {}, { scale: [-1, 1, 1] }],
    ["text", {}, { rotation: [90, 0, 0] }],
    ["box (rotated, stretched)", {}, { rotation: [10, 20, 30], scale: [3, 1, 0.5] }],
  ] as [string, Record<string, number>, Partial<Transform>][])("%s is exported exactly with the same size and volume", async (label, params, transform) => {
    const kind = label.split(" ")[0] as PrimitiveKind;
    const o = shape(label, kind, params, { position: [3, 4, 0], ...transform });
    const { out, solids, parts } = await roundTrip([o]);
    expect(out.exact).toEqual([label]);
    // Separate letters come back as separate solids; measure them together.
    expect(solids.every((s) => s.check.watertight)).toBe(true);
    const solid = {
      volume: solids.reduce((v, s) => v + s.check.volume, 0),
      min: [0, 1, 2].map((a) => Math.min(...solids.map((s) => s.min[a]!))),
      max: [0, 1, 2].map((a) => Math.max(...solids.map((s) => s.max[a]!))),
    };
    if (kind === "text") expect(solids).toHaveLength(5);
    // Same volume and place as the solid engine (which uses flat facets, so allow a few %).
    const reference = checkMesh(parts[0]!).volume;
    expect(Math.abs(solid.volume - reference) / reference).toBeLessThan(0.04);
    const ref = meshBounds(parts[0]!);
    for (let a = 0; a < 3; a++) {
      expect(Math.abs(solid.min[a]! - ref.min[a]!)).toBeLessThan(0.6);
      expect(Math.abs(solid.max[a]! - ref.max[a]!)).toBeLessThan(0.6);
    }
  });

  it("cuts holes and combines groups exactly", async () => {
    const objects = [
      shape("Bracket", "box", {}, {}, { kind: "group", params: {} }),
      shape("block", "box", { width: 40, depth: 20, height: 10 }, {}, { parentId: "Bracket" }),
      shape("post", "cylinder", { radius: 5, height: 30 }, { position: [-12, 0, 0] }, { parentId: "Bracket" }),
      shape("hole", "cylinder", { radius: 3, height: 12 }, { position: [12, 0, -1] }, { parentId: "Bracket", hole: true }),
    ];
    const { out, solids } = await roundTrip(objects);
    expect(out.exact).toEqual(["Bracket"]);
    const ideal = 40 * 20 * 10 + Math.PI * 25 * 20 - Math.PI * 9 * 10;
    expect(solids).toHaveLength(1);
    expect(Math.abs(solids[0]!.check.volume - ideal) / ideal).toBeLessThan(0.002);
  });

  it("falls back to flat faces when a round shape is squashed, and says so", async () => {
    const o = shape("oval", "cylinder", { radius: 10, height: 10 }, { scale: [2, 1, 1] });
    const { out, solids, parts } = await roundTrip([o]);
    expect(out.exact).toEqual([]);
    expect(out.faceted).toEqual(["oval"]);
    expect(solids[0]!.check.watertight).toBe(true);
    expect(solids[0]!.check.volume).toBeCloseTo(checkMesh(parts[0]!).volume, 1);
  });

  it("exports imported meshes as faceted solids with merged flat faces", async () => {
    const tris: number[] = [];
    const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
    for (const f of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) {
      for (const i of f) tris.push(...v[i]!);
    }
    registerMesh("meshes/0123456789ab.bin", weldTriangles(tris));
    const o = shape("cube", "box", {}, {}, { kind: "mesh", mesh: "meshes/0123456789ab.bin", params: {} });
    const { out, text, solids } = await roundTrip([o]);
    expect(out.faceted).toEqual(["cube"]);
    expect(solids[0]!.check.volume).toBeCloseTo(1000, 2);
    expect(text.match(/ADVANCED_FACE\(/g)?.length).toBe(6);
  });

  it("puts each top-level object in the file as its own solid", async () => {
    const { solids } = await roundTrip([shape("a", "box"), shape("b", "sphere", {}, { position: [40, 0, 0] })]);
    expect(solids).toHaveLength(2);
  });

  it("converts a file made in inches to millimetres", async () => {
    const blob = exportSTEP([{ shape: makeBox([0, 0, 0], [1, 2, 3]), name: "inch box" }], { unit: "INCH", modelUnit: "INCH" });
    const back = readStep(new Uint8Array(await blob.arrayBuffer()));
    const b = meshBounds(back.solids[0]!.mesh);
    expect(b.max[0] - b.min[0]).toBeCloseTo(25.4, 3);
    expect(b.max[2] - b.min[2]).toBeCloseTo(76.2, 3);
  });

  it("refuses files that are not STEP", () => {
    expect(() => readStep(new TextEncoder().encode("solid nope\nendsolid nope"))).toThrow(/not a readable STEP/);
  });
});
