import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { addObject } from "../../src/core/cad/commands";
import { DEFAULT_PARAMS, IDENTITY, type CadObject } from "../../src/core/cad/model";
import { addScreen } from "../../src/core/display/commands";
import { DEFAULT_FACE } from "../../src/core/display/face";
import { createProjectStore } from "../../src/core/document/store";
import { addJoint, addMount, deleteJoint, robotOf, setJoint } from "../../src/core/robot/commands";
import { poseMatrices, type Joint, type Robot } from "../../src/core/robot/model";
import { packProject, unpackProject } from "../../src/shared/format";

const box = (id: string, z = 0): CadObject => ({
  id, name: id, kind: "box", params: { ...DEFAULT_PARAMS.box }, transform: { ...IDENTITY, position: [0, 0, z] },
  hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false,
});
const joint = (id: string, child: string, parent: string | null, pivot: [number, number, number], axis: Joint["axis"]): Joint => ({
  id, name: id, child, parent, pivot, axis, min: -90, max: 90, servo: { pin: null, center: 90, reversed: false },
});

describe("robot pose", () => {
  // Desk robot: base (fixed) → body turns around Z (pan) → head tilts around X.
  const robot: Robot = {
    id: "r", name: "Desk", mounts: [],
    joints: [joint("pan", "body", null, [0, 0, 20], "z"), joint("tilt", "head", "body", [0, 0, 60], "x")],
  };
  it("leaves the home pose unchanged", () => {
    const m = poseMatrices(robot, {});
    const p = new Vector3(10, 0, 70).applyMatrix4(m.get("head")!);
    expect(p.toArray().map((v) => Math.round(v * 1e9) / 1e9)).toEqual([10, 0, 70]);
  });
  it("turns a part around its pivot", () => {
    const m = poseMatrices(robot, { pan: 90 });
    const p = new Vector3(10, 0, 30).applyMatrix4(m.get("body")!);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
    expect(p.z).toBeCloseTo(30, 9);
  });
  it("carries child parts along the chain", () => {
    // Tilt the head 90° forward, then pan the body 90°.
    const m = poseMatrices(robot, { pan: 90, tilt: 90 });
    // A point 10 mm above the tilt pivot: tilt (around +X) sends it to -Y, then pan sends -Y to +X.
    const p = new Vector3(0, 0, 70).applyMatrix4(m.get("head")!);
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(60, 9);
  });
  it("keeps angles inside the joint limits", () => {
    const m = poseMatrices(robot, { pan: 500 });
    const p = new Vector3(10, 0, 30).applyMatrix4(m.get("body")!);
    expect(p.y).toBeCloseTo(10, 9); // clamped to +90°
  });
});

describe("robot commands", () => {
  const setup = () => {
    const s = createProjectStore(undefined, "test");
    for (const o of [box("base"), box("body", 20), box("head", 40)]) s.getState().execute(addObject({ object: o }));
    return s;
  };
  it("adds, edits, undoes and saves joints", () => {
    const s = setup();
    s.getState().execute(addJoint({ joint: joint("pan", "body", "base", [0, 0, 20], "z") }));
    s.getState().execute(setJoint({ id: "pan", changes: { max: 45, servo: { pin: 5 } as Joint["servo"] } }));
    const r = () => robotOf(s.getState().project)!;
    expect(r().joints[0]).toMatchObject({ max: 45, servo: { pin: 5, center: 90, reversed: false } });
    s.getState().undo();
    expect(r().joints[0]!.max).toBe(90);
    const back = unpackProject(packProject(s.getState().project));
    expect(back.document.workspaces.robotics.assemblies).toEqual(s.getState().project.document.workspaces.robotics.assemblies);
    s.getState().execute(deleteJoint({ id: "pan" }));
    expect(r().joints).toEqual([]);
  });
  it("refuses impossible joints", () => {
    const s = setup();
    s.getState().execute(addJoint({ joint: joint("pan", "body", "base", [0, 0, 0], "z") }));
    s.getState().execute(addJoint({ joint: joint("tilt", "head", "body", [0, 0, 0], "x") }));
    expect(() => s.getState().execute(addJoint({ joint: joint("again", "body", null, [0, 0, 0], "z") }))).toThrow(/already has a joint/);
    expect(() => s.getState().execute(addJoint({ joint: joint("loop", "base", "head", [0, 0, 0], "z") }))).toThrow(/loop/);
    expect(() => s.getState().execute(addJoint({ joint: joint("self", "base", "base", [0, 0, 0], "z") }))).toThrow(/itself/);
    expect(() => s.getState().execute(addJoint({ joint: joint("ghost", "nope", null, [0, 0, 0], "z") }))).toThrow(/no longer exists/);
    expect(() => s.getState().execute(setJoint({ id: "pan", changes: { min: 10 } }))).toThrow(/Invalid joint/);
  });
  it("mounts a screen on a part", () => {
    const s = setup();
    s.getState().execute(addScreen({ screen: { id: "face", name: "Face", display: "m5stack-cores3", face: DEFAULT_FACE } }));
    s.getState().execute(addMount({ mount: { id: "m", screenId: "face", objectId: "head", position: [0, -10, 50], normal: [0, -1, 0], width: 40.8 } }));
    expect(robotOf(s.getState().project)!.mounts).toHaveLength(1);
    expect(() => s.getState().execute(addMount({ mount: { id: "m2", screenId: "nope", objectId: "head", position: [0, 0, 0], normal: [0, 0, 1], width: 40 } }))).toThrow(/screen no longer exists/);
  });
});
