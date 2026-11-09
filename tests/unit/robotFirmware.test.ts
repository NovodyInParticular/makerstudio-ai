// The robot's C++ behaviour runner must move exactly like the app's preview.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES, type Animation } from "../../src/core/display/animation";
import { displayById } from "../../src/core/display/catalog";
import { DEFAULT_FACE, MOODS, type Screen } from "../../src/core/display/face";
import { faceDataHeader } from "../../src/core/display/firmware";
import { BehaviorRunner, behaviorTemplates, type Behavior, type Step } from "../../src/core/robot/behavior";
import { compileBehavior, robotDataHeader, robotFirmwareProject } from "../../src/core/robot/firmware";
import type { Joint, Robot } from "../../src/core/robot/model";

const cxx = ["g++", "clang++"].find((c) => spawnSync(c, ["--version"]).status === 0);
const joint = (id: string, axis: Joint["axis"], min: number, max: number, pin: number | null = null): Joint => ({
  id, name: id, child: `${id}-part`, parent: null, pivot: [0, 0, 0], axis, min, max, servo: { pin, center: 90, reversed: false },
});
const robot: Robot = { id: "r", name: "Desk", mounts: [{ id: "m", screenId: "s", objectId: "head", position: [0, 0, 0], normal: [0, -1, 0], width: 40 }], joints: [joint("pan", "z", -60, 60, 5), joint("tilt", "x", -20, 30, 6)] };
const animations: Animation[] = TEMPLATES.map((t, i) => ({ id: `a${i}`, ...t.make() }));
const screen: Screen = { id: "s", name: "Face", display: "m5stack-cores3", face: DEFAULT_FACE, animations };

function native(behavior: Behavior, times: number[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "ms-robot-"));
  const program = compileBehavior(behavior.steps, robot, (s, a) => (s === "s" ? animations.findIndex((x) => x.id === a) : -1));
  writeFileSync(path.join(dir, "face_engine.h"), readFileSync("src/core/display/firmware/face_engine.h", "utf8"));
  writeFileSync(path.join(dir, "robot_core.h"), readFileSync("src/core/robot/firmware/robot_core.h", "utf8"));
  writeFileSync(path.join(dir, "face_data.h"), faceDataHeader(screen, displayById("m5stack-cores3")!, animations, -1));
  writeFileSync(path.join(dir, "robot_data.h"), robotDataHeader(robot, behavior, program));
  writeFileSync(path.join(dir, "main.cpp"), `
#include <cstdio>
#include "face_engine.h"
#include "face_data.h"
#include "robot_data.h"
int main() {
  RbRunner r;
  r.program = RB_PROGRAM; r.length = RB_PROGRAM_LENGTH; r.idleLife = RB_IDLE_LIFE; r.jointCount = RB_JOINT_COUNT;
  r.jointMin = RB_JOINT_MIN; r.jointMax = RB_JOINT_MAX; r.animations = ANIMATIONS; r.begin();
  unsigned times[] = { ${times.join(", ")} };
  for (unsigned t : times) {
    r.advanceTo(t);
    RbOutput o = r.output();
    printf("%d %.12f %.12f %.12f %.12f %.12f %.12f %d\\n", o.face.mood, o.face.blink, o.face.lookX, o.face.lookY, o.face.talk, o.angles[0], o.angles[1], o.done ? 1 : 0);
  }
}
`);
  execFileSync(cxx!, ["-std=c++17", "-O1", "-Wall", "-Werror", "-Wno-unused-function", "-Wno-unused-variable", "-o", "robot", "main.cpp"], { cwd: dir });
  return execFileSync(path.join(dir, "robot"), { encoding: "utf8" }).trim().split("\n");
}

function compare(behavior: Behavior, until: number) {
  const times: number[] = [];
  for (let t = 0; t <= until; t += 37) times.push(t);
  const lines = native(behavior, times);
  const r = new BehaviorRunner(behavior, robot, (s, a) => (s === "s" ? animations.find((x) => x.id === a) : undefined));
  times.forEach((t, i) => {
    r.advanceTo(t);
    const o = r.output();
    const [mood, blink, lx, ly, talk, pan, tilt, done] = lines[i]!.split(" ").map(Number);
    const where = `${behavior.name} at ${t} ms`;
    expect(MOODS[mood!], where).toBe(o.face.mood);
    expect(blink, where).toBeCloseTo(o.face.blink, 9);
    expect(lx, where).toBeCloseTo(o.face.lookX, 9);
    expect(ly, where).toBeCloseTo(o.face.lookY, 9);
    expect(talk, where).toBeCloseTo(o.face.talk, 9);
    expect(pan, where).toBeCloseTo(o.angles.pan!, 9);
    expect(tilt, where).toBeCloseTo(o.angles.tilt!, 9);
    expect(done === 1, where).toBe(o.done);
  });
}

const custom: Step[] = [
  { kind: "animation", screen: "s", animation: "a0", wait: false },
  { kind: "move", joint: "pan", angle: 200, ms: 700, wait: false },
  { kind: "look", x: -0.7, y: 0.4, ms: 300, wait: true },
  { kind: "repeat", times: 3, steps: [
    { kind: "move", joint: "tilt", angle: 25, ms: 120, wait: true },
    { kind: "repeat", times: 2, steps: [{ kind: "blink" }, { kind: "wait", ms: 90 }] },
    { kind: "move", joint: "tilt", angle: -40, ms: 150, wait: true },
  ] },
  { kind: "move", joint: "gone", angle: 10, ms: 500, wait: true },
  { kind: "repeat", times: 2, steps: [] },
  { kind: "talk", ms: 800, wait: false },
  { kind: "mood", mood: "angry" },
  { kind: "animation", screen: "s", animation: "a2", wait: true },
  { kind: "wait", ms: 4000 },
];

describe.skipIf(!cxx)("robot code moves exactly like the preview", () => {
  for (const t of behaviorTemplates(robot)) {
    it(t.name, () => compare({ id: "b", ...t.make() }, 12000), 60000);
  }
  it("nested repeats, 'and go on', limits, animations, skipped steps, idle life", () => compare({ id: "c", name: "Custom", idle: true, steps: custom }, 16000), 60000);
  it("no steps at all, idle life only", () => compare({ id: "e", name: "Empty", idle: true, steps: [] }, 20000), 60000);
});

describe("robot firmware project", () => {
  it("drops steps for missing joints and empty repeats, and links repeats", () => {
    const p = compileBehavior(custom, robot, (s, a) => (s === "s" ? animations.findIndex((x) => x.id === a) : -1));
    expect(p.some((s) => s.op === 2 && s.a > 1)).toBe(false);
    const begins = p.map((s, i) => [s, i] as const).filter(([s]) => s.op === 7);
    expect(begins).toHaveLength(2);
    for (const [s, i] of begins) expect(p[s.jump]!.op === 8 && p[s.jump]!.jump === i).toBe(true);
  });
  it("writes a project with the face, the behaviour and the servos", () => {
    const r: Robot = { ...robot, behaviors: [{ id: "b", ...behaviorTemplates(robot)[0]!.make() }] };
    const p = robotFirmwareProject({ robot: { ...r, joints: [...r.joints, joint("arm", "y", -10, 10)] }, screens: [screen], behaviorId: "b", boardId: "m5stack-cores3" });
    expect(p.files.map((f) => f.path).sort()).toEqual(["README.md", "include/face_data.h", "include/face_engine.h", "include/robot_core.h", "include/robot_data.h", "include/robot_runner.h", "platformio.ini", "src/main.cpp"]);
    expect(p.files.find((f) => f.path === "platformio.ini")!.text).toContain("madhephaestus/ESP32Servo");
    expect(p.files.find((f) => f.path === "src/main.cpp")!.text).toContain('#include "robot_runner.h"');
    expect(p.files.find((f) => f.path === "include/robot_data.h")!.text).toContain("static const int RB_SERVO_PIN[] = {5, 6, -1};");
    expect(p.notes.join(" ")).toMatch(/"arm" has no servo pin/);
    expect(() => robotFirmwareProject({ robot: r, screens: [screen], behaviorId: "b", boardId: "uno" })).toThrow(/cannot run this robot/);
  });
});
