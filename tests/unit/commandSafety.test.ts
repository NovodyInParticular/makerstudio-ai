// Regression tests from a fuzz run over the commands (2026-11-09): each case once left the
// project in a state whose saved file could not be opened again.

import { beforeAll, describe, expect, it } from "vitest";
import { addObject, alignObjects, booleanOp, dropToBed, duplicateObjects, groupObjects } from "../../src/core/cad/commands";
import { initCsg } from "../../src/core/cad/csg";
import { DEFAULT_PARAMS, IDENTITY, type CadObject, type PrimitiveKind } from "../../src/core/cad/model";
import { addWire } from "../../src/core/circuit/commands";
import { callTool, previewState } from "../../src/core/ai/proposals";
import { createProjectStore } from "../../src/core/document/store";
import { packProject, unpackProject } from "../../src/shared/format";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

function shape(id: string, kind: PrimitiveKind = "box", position: [number, number, number] = [0, 0, 0], extra: Partial<CadObject> = {}): CadObject {
  return { id, name: id, kind, params: { ...DEFAULT_PARAMS[kind] }, transform: { ...IDENTITY, position }, hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra };
}

function store(...objects: CadObject[]) {
  const s = createProjectStore(undefined, "test");
  for (const o of objects) s.getState().execute(addObject({ object: o }));
  return s;
}
const objects = (s: ReturnType<typeof store>) => s.getState().project.document.workspaces.cad.objects as CadObject[];
const reopens = (s: ReturnType<typeof store>) => unpackProject(packProject(s.getState().snapshotForSave()));

describe("commands never leave a project that cannot be reopened", () => {
  it("duplicate refuses a non-number offset", () => {
    const s = store(shape("a"));
    expect(() => s.getState().execute(duplicateObjects({ ids: ["a"], idMap: { a: "b" }, offset: [NaN, 0, 0] }))).toThrow(/offset/);
    expect(objects(s)).toHaveLength(1);
  });

  it("duplicate of a repeated id makes one copy, never two objects with the same id", () => {
    const s = store(shape("a"));
    s.getState().execute(duplicateObjects({ ids: ["a", "a"], idMap: { a: "b" }, offset: [5, 5, 0] }));
    expect(objects(s).map((o) => o.id)).toEqual(["a", "b"]);
    expect(() => s.getState().execute(duplicateObjects({ ids: ["a"], idMap: { a: "b" }, offset: [5, 5, 0] }))).toThrow(/already exists/);
  });

  it("duplicating a part inside a group keeps the copy in that group (no missing parent)", () => {
    const s = store(shape("a"), shape("b", "box", [30, 0, 0]));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    // The id map also names the group (as the AI might), but only the part is copied.
    s.getState().execute(duplicateObjects({ ids: ["a"], idMap: { a: "a2", g: "g2" }, offset: [0, 40, 0] }));
    expect(objects(s).find((o) => o.id === "a2")!.parentId).toBe("g");
    expect(objects(s).some((o) => o.id === "g2")).toBe(false);
    reopens(s);
  });

  it("duplicating a group and one of its parts copies the group once", () => {
    const s = store(shape("a"), shape("b", "box", [30, 0, 0]));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    s.getState().execute(duplicateObjects({ ids: ["g", "a"], idMap: { g: "g2", a: "a2", b: "b2" }, offset: [0, 40, 0] }));
    expect(objects(s).map((o) => o.id).sort()).toEqual(["a", "a2", "b", "b2", "g", "g2"]);
    expect(objects(s).find((o) => o.id === "a2")!.parentId).toBe("g2");
  });

  it("group, combine and align work next to an empty result (only holes, or an Intersect with no overlap)", () => {
    const s = store(shape("far1"), shape("far2", "box", [100, 0, 0]), shape("c", "box", [0, 60, 0]));
    s.getState().execute(booleanOp({ ids: ["far1", "far2"], groupId: "empty", op: "intersect" }));
    // Nothing to measure in the empty result, so only one object is left to align: refused, nothing moves.
    expect(() => s.getState().execute(alignObjects({ ids: ["empty", "c"], axis: 0, mode: "max" }))).toThrow(/at least two objects/);
    s.getState().execute(groupObjects({ ids: ["empty", "c"], groupId: "g" }));
    s.getState().execute(dropToBed({ ids: ["g", "c"] }));
    reopens(s);
    for (const o of objects(s)) for (const v of o.transform.position) expect(Number.isFinite(v)).toBe(true);
  });

  it("align with a group and its own part does not move the part twice", () => {
    const s = store(shape("a"), shape("b", "box", [30, 0, 0]), shape("c", "box", [0, 50, 0]));
    s.getState().execute(groupObjects({ ids: ["a", "b"], groupId: "g" }));
    const before = objects(s).find((o) => o.id === "a")!.transform.position;
    s.getState().execute(alignObjects({ ids: ["g", "a", "c"], axis: 1, mode: "max" }));
    expect(objects(s).find((o) => o.id === "a")!.transform.position).toEqual(before); // moved with its group only
  });

  it("repeated ids in Combine do not turn the kept object into a hole", () => {
    const s = store(shape("a"), shape("b", "box", [5, 0, 0]));
    s.getState().execute(booleanOp({ ids: ["a", "b", "a"], groupId: "g", op: "subtract" }));
    expect(objects(s).find((o) => o.id === "a")!.hole).toBe(false);
    expect(objects(s).find((o) => o.id === "b")!.hole).toBe(true);
  });

  it("an object can only be put inside a group", () => {
    const s = store(shape("a"));
    expect(() => s.getState().execute(addObject({ object: shape("b", "box", [0, 0, 0], { parentId: "a" }) }))).toThrow(/inside a group/);
  });

  it("validation errors read as a sentence, not a JSON list", () => {
    const s = store();
    expect(() => s.getState().execute(addObject({ object: shape("a", "box", [NaN, 0, 0]) }))).toThrow(/^Invalid value \(transform\.position\.0: /);
    expect(() => s.getState().execute(addWire({ wire: { id: "w", from: { component: "", pin: "" }, to: { component: "x", pin: "1" }, color: "red" } }))).toThrow(/^Invalid value \(/);
  });

  it("the AI is told at once when a change would damage the project", () => {
    const s = store(shape("a"));
    const bad = { ...s.getState().project, document: s.getState().project.document };
    expect(() => previewState(bad, [{ type: "project.rename", params: { name: "x".repeat(300) } }])).toThrow();
    const out = callTool({ name: "circuit_connect", params: { from: { part: "nope", pin: "1" }, to: { part: "nope", pin: "1" } }, mode: "create", source: "test", state: s.getState().project, proposal: null, env: { extras: {}, newId: () => "p1" } });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error).not.toMatch(/^\[/);
  });
});
