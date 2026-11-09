import { describe, expect, it } from "vitest";
import { TEMPLATES, type Animation } from "../../src/core/display/animation";
import { createProjectStore } from "../../src/core/document/store";
import { BehaviorRunner, behaviorTemplates, nestingDepth, type Behavior, type Step } from "../../src/core/robot/behavior";
import { addBehavior, robotOf, setBehavior } from "../../src/core/robot/commands";
import type { Joint, Robot } from "../../src/core/robot/model";
import { packProject, unpackProject } from "../../src/shared/format";

const joint = (id: string, axis: Joint["axis"], min = -90, max = 90): Joint => ({
  id, name: id, child: `${id}-part`, parent: null, pivot: [0, 0, 0], axis, min, max, servo: { pin: null, center: 90, reversed: false },
});
const robot: Robot = { id: "r", name: "Desk", mounts: [], joints: [joint("pan", "z"), joint("tilt", "x", -20, 30)] };
const wake: Animation = { id: "wake", ...TEMPLATES[0]!.make() };
const find = (_s: string, id: string) => (id === "wake" ? wake : undefined);

function run(steps: Step[], _until: number, idle = false) {
  const r = new BehaviorRunner({ id: "b", name: "Test", idle, steps }, robot, find);
  const at = (t: number) => { r.advanceTo(t); return r.output(); };
  return { r, at };
}

describe("behaviour runner", () => {
  it("moves a joint smoothly over the given time, then the next step runs", () => {
    const { at } = run([{ kind: "move", joint: "pan", angle: 40, ms: 1000, wait: true }, { kind: "mood", mood: "happy" }], 2000);
    expect(at(0).angles.pan).toBe(0);
    expect(at(500).angles.pan).toBeCloseTo(20, 6); // eased midpoint
    expect(at(500).face.mood).toBe("neutral");
    expect(at(1000).angles.pan).toBe(40);
    expect(at(1010).face.mood).toBe("happy");
  });

  it("runs steps marked 'and continue' at the same time as the next ones", () => {
    const { at } = run([
      { kind: "look", x: 1, y: 0, ms: 400, wait: false },
      { kind: "move", joint: "pan", angle: -30, ms: 400, wait: true },
    ], 1000);
    const o = at(400);
    expect(o.face.lookX).toBe(1);
    expect(o.angles.pan).toBe(-30);
  });

  it("keeps joints inside their range", () => {
    const { at } = run([{ kind: "move", joint: "tilt", angle: 80, ms: 0, wait: true }], 100);
    expect(at(10).angles.tilt).toBe(30);
  });

  it("repeats a number of times, then finishes", () => {
    const { at } = run([{ kind: "repeat", times: 3, steps: [{ kind: "move", joint: "pan", angle: 10, ms: 100, wait: true }, { kind: "move", joint: "pan", angle: 0, ms: 100, wait: true }] }], 1000);
    expect(at(150).angles.pan).toBeCloseTo(5, 6);
    expect(at(590).done).toBe(false);
    expect(at(610).done).toBe(true);
  });

  it("repeats forever when times is 0", () => {
    const { at } = run([{ kind: "repeat", times: 0, steps: [{ kind: "wait", ms: 100 }] }], 0);
    expect(at(60000).done).toBe(false);
  });

  it("plays face animations and keeps their last mood", () => {
    const { at } = run([{ kind: "animation", screen: "s", animation: "wake", wait: true }, { kind: "wait", ms: 100 }], 0);
    expect(at(0).face.mood).toBe("sleepy");
    expect(at(0).face.blink).toBe(1);
    expect(at(wake.duration + 50).face.mood).toBe("happy");
  });

  it("talks and blinks", () => {
    const { at } = run([{ kind: "talk", ms: 500, wait: true }, { kind: "blink" }, { kind: "wait", ms: 500 }], 0);
    expect([100, 200, 300].some((t) => at(t).face.talk > 0.1)).toBe(true);
    expect(at(600).face.talk).toBe(0);
    expect(at(590).face.blink).toBeGreaterThan(0.5);
  });

  it("skips steps for joints or animations that no longer exist", () => {
    const { at } = run([{ kind: "move", joint: "gone", angle: 10, ms: 100, wait: true }, { kind: "animation", screen: "s", animation: "gone", wait: true }, { kind: "mood", mood: "sad" }], 0);
    expect(at(10).face.mood).toBe("sad");
  });

  it("is the same every time, including idle blinking", () => {
    const steps: Step[] = [{ kind: "wait", ms: 20000 }];
    const a = run(steps, 0, true), b = run(steps, 0, true);
    for (let t = 0; t <= 20000; t += 250) expect(a.at(t)).toEqual(b.at(t));
    // and idle life actually blinks and glances
    const r = run(steps, 0, true);
    let blinked = false, glanced = false;
    for (let t = 0; t <= 20000; t += 10) { const o = r.at(t); if (o.face.blink > 0.5) blinked = true; if (Math.abs(o.face.lookX) > 0.2) glanced = true; }
    expect(blinked && glanced).toBe(true);
  });

  it("templates use the robot's own joints", () => {
    const [hello, curious, doze] = behaviorTemplates(robot).map((t) => t.make());
    const joints = (steps: Step[]): string[] => steps.flatMap((s) => (s.kind === "move" ? [s.joint] : s.kind === "repeat" ? joints(s.steps) : []));
    expect(new Set(joints(hello!.steps))).toEqual(new Set(["tilt"]));
    expect(new Set(joints(curious!.steps))).toEqual(new Set(["pan", "tilt"]));
    expect(nestingDepth(doze!.steps)).toBe(1);
    // A robot without joints gets face-only versions.
    expect(behaviorTemplates(null).every((t) => joints(t.make().steps).length === 0)).toBe(true);
  });
});

describe("behaviour commands", () => {
  it("adds, edits, refuses deep nesting, and saves", () => {
    const s = createProjectStore(undefined, "test");
    const b: Behavior = { id: "b", name: "Hello", idle: true, steps: [{ kind: "mood", mood: "happy" }] };
    s.getState().execute(addBehavior({ behavior: b }));
    s.getState().execute(setBehavior({ id: "b", changes: { steps: [{ kind: "wait", ms: 100 }] } }));
    expect(robotOf(s.getState().project)!.behaviors![0]!.steps).toEqual([{ kind: "wait", ms: 100 }]);
    const deep: Step = { kind: "repeat", times: 2, steps: [{ kind: "repeat", times: 2, steps: [{ kind: "repeat", times: 2, steps: [{ kind: "repeat", times: 2, steps: [] }] }] }] };
    expect(() => s.getState().execute(setBehavior({ id: "b", changes: { steps: [deep] } }))).toThrow(/nested at most/);
    expect(() => s.getState().execute(setBehavior({ id: "b", changes: { steps: [{ kind: "look", x: 5, y: 0, ms: 1, wait: true }] } }))).toThrow(/Invalid behaviour/);
    const back = unpackProject(packProject(s.getState().project));
    expect(back.document.workspaces.robotics.assemblies[0]).toEqual(robotOf(s.getState().project));
  });
});
