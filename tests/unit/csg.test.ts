import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { addObject, booleanOp, groupObjects, setBooleanMode, setParams, setText, setTransforms } from "../../src/core/cad/commands";
import { initCsg, solidMesh } from "../../src/core/cad/csg";
import { buildGeometry, worldBounds } from "../../src/core/cad/geometry";
import { DEFAULT_PARAMS, IDENTITY, PRIMITIVE_KINDS, type CadObject, type PrimitiveKind } from "../../src/core/cad/model";
import { createProjectStore } from "../../src/core/document/store";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

function shape(id: string, kind: PrimitiveKind = "box", position: [number, number, number] = [0, 0, 0], extra: Partial<CadObject> = {}): CadObject {
  return {
    id, name: id, kind, params: { ...DEFAULT_PARAMS[kind] }, transform: { ...IDENTITY, position },
    ...(kind === "text" ? { text: "Hi" } : {}),
    hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra,
  };
}

const setup = () => createProjectStore(undefined, "test");
const objects = (s: ReturnType<typeof setup>) => s.getState().project.document.workspaces.cad.objects as CadObject[];
const get = (s: ReturnType<typeof setup>, id: string) => objects(s).find((o) => o.id === id)!;

describe("solid primitives", () => {
  it.each(PRIMITIVE_KINDS)("%s is watertight and matches the displayed shape's size", (kind) => {
    const o = shape("a", kind);
    const solid = solidMesh(o, [o]);
    expect(solid.empty).toBe(false);
    expect(solid.volume).toBeGreaterThan(0);
    const g = buildGeometry(o)!;
    g.computeBoundingBox();
    const shown = g.boundingBox!;
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < solid.positions.length; i += 3) {
      const v = new Vector3(solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]);
      min.min(v); max.max(v);
    }
    // Same placement and size within 1% (round shapes are made of slightly different facets).
    for (const k of ["x", "y", "z"] as const) {
      expect(Math.abs(min[k] - shown.min[k])).toBeLessThan(0.01 * 20 + 1e-6);
      expect(Math.abs(max[k] - shown.max[k])).toBeLessThan(0.01 * 20 + 1e-6);
    }
  });

  it("volumes match the formulas", () => {
    const vol = (kind: PrimitiveKind, params: Record<string, number>) => {
      const o = { ...shape("a", kind), params: { ...DEFAULT_PARAMS[kind], ...params } };
      return solidMesh(o, [o]).volume;
    };
    expect(vol("box", { width: 10, depth: 20, height: 30 })).toBeCloseTo(6000, 3);
    expect(vol("wedge", { width: 10, depth: 20, height: 30 })).toBeCloseTo(3000, 3);
    // Round shapes are polygons, so they are slightly smaller than the perfect formula (within 1%).
    expect(vol("cylinder", { radius: 10, height: 10, segments: 128 }) / (Math.PI * 1000)).toBeCloseTo(1, 2);
    expect(vol("sphere", { radius: 10, segments: 128 }) / ((4 / 3) * Math.PI * 1000)).toBeCloseTo(1, 2);
    expect(vol("torus", { radius: 10, tube: 3, segments: 128 }) / (2 * Math.PI ** 2 * 10 * 9)).toBeCloseTo(1, 2);
  });
});

describe("Boolean operations", () => {
  it("subtract drills a through-hole", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("plate") }));
    s.getState().execute(setParams({ id: "plate", params: { width: 40, depth: 40, height: 5 } }));
    s.getState().execute(addObject({ object: shape("pin", "cylinder", [0, 0, -1]) }));
    s.getState().execute(setParams({ id: "pin", params: { radius: 3, height: 10, segments: 128 } }));
    s.getState().execute(booleanOp({ ids: ["plate", "pin"], groupId: "g", op: "subtract" }));
    expect(get(s, "pin").hole).toBe(true);
    const solid = solidMesh(get(s, "g"), objects(s));
    expect(solid.genus).toBe(1);
    expect(solid.volume).toBeCloseTo(40 * 40 * 5 - Math.PI * 9 * 5, -1);
    // The group's size is the plate only: the hole sticks out but is not material.
    const size = worldBounds(["g"], objects(s)).getSize(new Vector3());
    expect(size.z).toBeCloseTo(5, 4);
    s.getState().undo();
    expect(get(s, "pin").hole).toBe(false);
    expect(objects(s).some((o) => o.id === "g")).toBe(false);
  });

  it("a hole outside the solid cuts nothing", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("b", "box", [100, 0, 0], { hole: true }) }));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    expect(solidMesh(get(s, "g"), objects(s)).volume).toBeCloseTo(8000, 3);
  });

  it("union merges overlapping solids without counting the overlap twice", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("b", "box", [10, 0, 0]) }));
    s.getState().execute(booleanOp({ ids: ["a", "b"], groupId: "g", op: "union" }));
    expect(solidMesh(get(s, "g"), objects(s)).volume).toBeCloseTo(30 * 20 * 20, 3);
  });

  it("intersect keeps only the shared part, and the mode can be switched back", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("b", "box", [10, 0, 0]) }));
    s.getState().execute(booleanOp({ ids: ["a", "b"], groupId: "g", op: "intersect" }));
    expect(solidMesh(get(s, "g"), objects(s)).volume).toBeCloseTo(10 * 20 * 20, 3);
    s.getState().execute(setBooleanMode({ id: "g", mode: "union" }));
    expect(solidMesh(get(s, "g"), objects(s)).volume).toBeCloseTo(30 * 20 * 20, 3);
  });

  it("moving a hole inside a group updates the result", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("h", "box", [0, 0, 0]) }));
    s.getState().execute(setParams({ id: "h", params: { width: 10, depth: 10, height: 40 } }));
    s.getState().execute(booleanOp({ ids: ["a", "h"], groupId: "g", op: "subtract" }));
    const before = solidMesh(get(s, "g"), objects(s)).volume;
    // Move the hole half off the block: less material removed.
    s.getState().execute(setTransforms({ updates: [{ id: "h", transform: { position: [get(s, "h").transform.position[0] + 10, get(s, "h").transform.position[1], get(s, "h").transform.position[2]] } }] }));
    const after = solidMesh(get(s, "g"), objects(s)).volume;
    expect(before).toBeCloseTo(8000 - 10 * 10 * 20, 3);
    expect(after).toBeCloseTo(8000 - 5 * 10 * 20, 3);
  });

  it("nested groups combine correctly", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("h1", "cylinder", [0, 0, -5]) }));
    s.getState().execute(setParams({ id: "h1", params: { radius: 2, height: 30 } }));
    s.getState().execute(booleanOp({ ids: ["a", "h1"], groupId: "g1", op: "subtract" }));
    // b overlaps the block (x 5..25) but not the hole at x = 0, so the result is one body with one hole.
    s.getState().execute(addObject({ object: shape("b", "box", [15, 0, 0]) }));
    s.getState().execute(booleanOp({ ids: ["g1", "b"], groupId: "g2", op: "union" }));
    const solid = solidMesh(get(s, "g2"), objects(s));
    expect(solid.genus).toBe(1);
    // 20 x 20 x 35 mm of material minus the 2 mm hole (a polygon, so a little less than pi r^2 h).
    expect(solid.volume).toBeCloseTo(35 * 20 * 20 - Math.PI * 4 * 20, -1);
  });

  it("subtract refuses a hole as the kept object", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "box", [0, 0, 0], { hole: true }) }));
    s.getState().execute(addObject({ object: shape("b") }));
    expect(() => s.getState().execute(booleanOp({ ids: ["a", "b"], groupId: "g", op: "subtract" }))).toThrow(/first selected/);
  });
});

describe("text", () => {
  it("letter height is the capital height in mm, and text can be edited", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("t", "text") }));
    s.getState().execute(setText({ id: "t", text: "H" }));
    s.getState().execute(setParams({ id: "t", params: { size: 12, depth: 2 } }));
    const size = worldBounds(["t"], objects(s)).getSize(new Vector3());
    expect(size.y).toBeCloseTo(12, 1);
    expect(size.z).toBeCloseTo(2, 4);
    expect(solidMesh(get(s, "t"), objects(s)).volume).toBeGreaterThan(0);
  });

  it("the size updates when only the text changes", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("t", "text") }));
    const short = worldBounds(["t"], objects(s)).getSize(new Vector3()).x;
    s.getState().execute(setText({ id: "t", text: "Hi there" }));
    const long = worldBounds(["t"], objects(s)).getSize(new Vector3()).x;
    expect(long).toBeGreaterThan(short * 2);
  });

  it("letters with holes (O, A, 8) really have holes", () => {
    const o = { ...shape("t", "text"), text: "O" };
    expect(solidMesh(o, [o]).genus).toBe(1);
  });

  it("rejects empty text", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("t", "text") }));
    expect(() => s.getState().execute(setText({ id: "t", text: "   " }))).toThrow(/empty/);
  });
});
