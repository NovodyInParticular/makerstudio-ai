import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  addObject, alignObjects, deleteObjects, dropToBed, duplicateObjects, groupObjects, planDuplicate, setParams, setProps, setTransforms, ungroup,
} from "../../src/core/cad/commands";
import { buildGeometry, worldBounds } from "../../src/core/cad/geometry";
import { DEFAULT_PARAMS, IDENTITY, PRIMITIVE_KINDS, type CadObject, type PrimitiveKind } from "../../src/core/cad/model";
import { createProjectStore } from "../../src/core/document/store";
import { createEmptyProject, packProject, unpackProject } from "../../src/shared/format";

function shape(id: string, kind: PrimitiveKind = "box", position: [number, number, number] = [0, 0, 0]): CadObject {
  return {
    id, name: id, kind, params: { ...DEFAULT_PARAMS[kind] }, transform: { ...IDENTITY, position },
    ...(kind === "text" ? { text: "Hi" } : {}),
    hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false,
  };
}

const setup = () => createProjectStore(undefined, "test");
const objects = (s: ReturnType<typeof setup>) => s.getState().project.document.workspaces.cad.objects as CadObject[];
const get = (s: ReturnType<typeof setup>, id: string) => objects(s).find((o) => o.id === id)!;
const size = (s: ReturnType<typeof setup>, ids: string[]) => worldBounds(ids, objects(s)).getSize(new Vector3());

describe("primitive geometry", () => {
  it.each(PRIMITIVE_KINDS)("%s sits on the bed with its default size", (kind) => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", kind) }));
    const box = worldBounds(["a"], objects(s));
    expect(box.min.z).toBeCloseTo(0, 6);
    const expectedHeight = { box: 20, sphere: 20, cylinder: 20, cone: 20, torus: 6, wedge: 20, text: 3 }[kind];
    expect(box.max.z).toBeCloseTo(expectedHeight, 4);
  });

  it("wedge faces all point outward", () => {
    const g = buildGeometry(shape("w", "wedge"))!;
    const pos = g.getAttribute("position");
    const centre = new Vector3(-20 / 6, 0, 20 / 3);
    for (let i = 0; i < pos.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k));
      const n = new Vector3().subVectors(b!, a!).cross(new Vector3().subVectors(c!, a!));
      const mid = new Vector3().add(a!).add(b!).add(c!).divideScalar(3).sub(centre);
      expect(n.dot(mid)).toBeGreaterThan(0);
    }
  });
});

describe("3D commands", () => {
  it("adds, resizes with validation, and undoes", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(setParams({ id: "a", params: { width: 50 } }));
    expect(size(s, ["a"]).x).toBeCloseTo(50);
    expect(() => s.getState().execute(setParams({ id: "a", params: { width: 0 } }))).toThrow(/at least/);
    expect(() => s.getState().execute(setParams({ id: "a", params: { width: 99999 } }))).toThrow(/at most/);
    s.getState().undo();
    expect(size(s, ["a"]).x).toBeCloseTo(20);
  });

  it("rejects a torus whose tube is too thick", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("t", "torus") }));
    expect(() => s.getState().execute(setParams({ id: "t", params: { tube: 12 } }))).toThrow(/tube radius/);
  });

  it("refuses to move a locked object", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(setProps({ ids: ["a"], props: { locked: true } }));
    expect(() => s.getState().execute(setTransforms({ updates: [{ id: "a", transform: { position: [5, 0, 0] } }] }))).toThrow(/locked/);
  });

  it("rotation changes the world size (90° about Z swaps X and Y)", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(setParams({ id: "a", params: { width: 40, depth: 10 } }));
    s.getState().execute(setTransforms({ updates: [{ id: "a", transform: { rotation: [0, 0, 90] } }] }));
    const v = size(s, ["a"]);
    expect(v.x).toBeCloseTo(10);
    expect(v.y).toBeCloseTo(40);
  });

  it("duplicates with an offset and new ids", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "box", [1, 2, 0]) }));
    let n = 0;
    const idMap = planDuplicate(["a"], objects(s), () => `copy${++n}`);
    s.getState().execute(duplicateObjects({ ids: ["a"], idMap, offset: [10, 0, 0] }));
    expect(get(s, "copy1").transform.position).toEqual([11, 2, 0]);
    expect(get(s, "copy1").name).toBe("a copy");
  });

  it("groups and ungroups without moving anything in the world", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "box", [-30, 0, 0]) }));
    s.getState().execute(addObject({ object: shape("b", "cylinder", [30, 10, 5]) }));
    s.getState().execute(setTransforms({ updates: [{ id: "b", transform: { rotation: [0, 0, 30] } }] }));
    const before = worldBounds(["a", "b"], objects(s));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    expect(get(s, "a").parentId).toBe("g");
    // Bounds are exact: box spans x -40..-20, the 30°-turned 48-sided cylinder x 20..40 and y 0..20.
    const [gx, gy, gz] = get(s, "g").transform.position;
    expect(gx).toBeCloseTo(0, 4);
    expect(gy).toBeCloseTo(5, 4);
    expect(gz).toBeCloseTo(0, 4);
    const grouped = worldBounds(["g"], objects(s));
    expect(grouped.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(grouped.max.distanceTo(before.max)).toBeLessThan(1e-4);
    // Move and rotate the group, then ungroup: children keep their new world place.
    s.getState().execute(setTransforms({ updates: [{ id: "g", transform: { position: [100, 0, 0], rotation: [0, 0, 90] } }] }));
    const moved = worldBounds(["g"], objects(s));
    s.getState().execute(ungroup({ groupId: "g" }));
    const after = worldBounds(["a", "b"], objects(s));
    expect(after.min.distanceTo(moved.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(moved.max)).toBeLessThan(1e-4);
    expect(objects(s).some((o) => o.id === "g")).toBe(false);
  });

  it("deleting a group deletes its contents", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a") }));
    s.getState().execute(addObject({ object: shape("b", "box", [40, 0, 0]) }));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    s.getState().execute(deleteObjects({ ids: ["g"] }));
    expect(objects(s)).toHaveLength(0);
    s.getState().undo();
    expect(objects(s)).toHaveLength(3);
  });

  it("aligns minimum X and centres on Y", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "box", [0, 0, 0]) }));
    s.getState().execute(addObject({ object: shape("b", "sphere", [50, 30, 0]) }));
    s.getState().execute(alignObjects({ ids: ["a", "b"], axis: 0, mode: "min" }));
    expect(worldBounds(["a"], objects(s)).min.x).toBeCloseTo(-10);
    expect(worldBounds(["b"], objects(s)).min.x).toBeCloseTo(-10);
    s.getState().execute(alignObjects({ ids: ["a", "b"], axis: 1, mode: "center" }));
    expect(get(s, "a").transform.position[1]).toBeCloseTo(15);
    expect(get(s, "b").transform.position[1]).toBeCloseTo(15);
  });

  it("drops floating and sunken objects onto the bed", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "box", [0, 0, 12]) }));
    s.getState().execute(addObject({ object: shape("b", "box", [0, 0, -5]) }));
    s.getState().execute(dropToBed({ ids: ["a", "b"] }));
    expect(worldBounds(["a"], objects(s)).min.z).toBeCloseTo(0);
    expect(worldBounds(["b"], objects(s)).min.z).toBeCloseTo(0);
  });

  it("3D objects survive save and load", () => {
    const s = setup();
    s.getState().execute(addObject({ object: shape("a", "cone", [3, 4, 0]) }));
    const back = unpackProject(packProject(s.getState().project));
    expect(back.document.workspaces.cad.objects).toEqual(objects(s));
  });

  it("damaged object data in a file is rejected with a clear message", () => {
    const p = createEmptyProject("x", "test");
    (p.document.workspaces.cad.objects as unknown[]).push({ id: "bad", kind: "box" });
    expect(() => unpackProject(packProject(p))).toThrow(/document\.json.*workspaces\.cad\.objects/);
  });
});
