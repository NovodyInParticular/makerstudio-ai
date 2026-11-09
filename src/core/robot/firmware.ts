// Turns a robot (joints, mounted face, behaviour) into a PlatformIO project for a real board.

import coreSource from "./firmware/robot_core.h?raw";
import runnerSource from "./firmware/robot_runner.h?raw";
import engineSource from "../display/firmware/face_engine.h?raw";
import type { Animation } from "../display/animation";
import { displayById, type DisplaySpec } from "../display/catalog";
import { DEFAULT_FACE, MOODS, type Screen } from "../display/face";
import { BOARDS, boardsFor, driverOf, faceDataHeader, LIBS, mainCpp, type BoardSpec } from "../display/firmware";
import type { Behavior, Step } from "./behavior";
import type { Robot } from "./model";

export const MAX_FIRMWARE_JOINTS = 16;
const OP = { mood: 0, look: 1, move: 2, animation: 3, talk: 4, blink: 5, wait: 6, repeat: 7, end: 8 } as const;
const MOOD_ENUM = ["FE_NEUTRAL", "FE_HAPPY", "FE_SAD", "FE_ANGRY", "FE_SLEEPY", "FE_SURPRISED"];

export interface CompiledStep { op: number; a: number; wait: boolean; n: number; x: number; y: number; jump: number }

/**
 * Flattens a behaviour into the robot's instruction list. Steps for joints or animations
 * that no longer exist, and empty repeats, are left out (the app skips them too).
 */
export function compileBehavior(steps: Step[], robot: Robot, animationIndex: (screen: string, id: string) => number): CompiledStep[] {
  const out: CompiledStep[] = [];
  const emit = (list: Step[]) => {
    for (const s of list) {
      switch (s.kind) {
        case "mood": out.push({ op: OP.mood, a: MOODS.indexOf(s.mood), wait: false, n: 0, x: 0, y: 0, jump: 0 }); break;
        case "look": out.push({ op: OP.look, a: 0, wait: s.wait, n: s.ms, x: s.x, y: s.y, jump: 0 }); break;
        case "move": {
          const j = robot.joints.findIndex((x) => x.id === s.joint);
          if (j >= 0) out.push({ op: OP.move, a: j, wait: s.wait, n: s.ms, x: s.angle, y: 0, jump: 0 });
          break;
        }
        case "animation": {
          const a = animationIndex(s.screen, s.animation);
          if (a >= 0) out.push({ op: OP.animation, a, wait: s.wait, n: 0, x: 0, y: 0, jump: 0 });
          break;
        }
        case "talk": out.push({ op: OP.talk, a: 0, wait: s.wait, n: s.ms, x: 0, y: 0, jump: 0 }); break;
        case "blink": out.push({ op: OP.blink, a: 0, wait: false, n: 0, x: 0, y: 0, jump: 0 }); break;
        case "wait": out.push({ op: OP.wait, a: 0, wait: true, n: s.ms, x: 0, y: 0, jump: 0 }); break;
        case "repeat": {
          if (s.steps.length === 0) break;
          const begin = out.length;
          out.push({ op: OP.repeat, a: 0, wait: false, n: s.times, x: 0, y: 0, jump: 0 });
          emit(s.steps);
          out.push({ op: OP.end, a: 0, wait: false, n: 0, x: 0, y: 0, jump: begin });
          out[begin]!.jump = out.length - 1;
          break;
        }
      }
    }
  };
  emit(steps);
  return out;
}

const num = (n: number) => {
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};

export function robotDataHeader(robot: Robot, behavior: Behavior | null, program: CompiledStep[]): string {
  const joints = robot.joints;
  const arr = (values: string[]) => `{${values.length ? values.join(", ") : "0"}}`;
  return [
    `// Robot "${robot.name.replace(/[^\x20-\x7e]/g, "?")}"${behavior ? `, behaviour "${behavior.name.replace(/[^\x20-\x7e]/g, "?")}"` : ""}, made with MakerStudio AI.`,
    "// Generated file: change the robot in MakerStudio and export again.",
    "#pragma once",
    `#define RB_JOINT_COUNT ${joints.length}`,
    `#define RB_MAX_JOINTS ${Math.max(1, joints.length)} // room for exactly this robot's joints`,
    '#include "face_engine.h"',
    '#include "robot_core.h"',
    "",
    ...joints.map((j, i) => `// joint ${i}: ${j.name.replace(/[^\x20-\x7e]/g, "?")}${j.servo.pin === null ? " (no pin: not driven)" : ` on pin ${j.servo.pin}`}`),
    `static const fe_real RB_JOINT_MIN[] = ${arr(joints.map((j) => num(j.min)))};`,
    `static const fe_real RB_JOINT_MAX[] = ${arr(joints.map((j) => num(j.max)))};`,
    `static const int RB_SERVO_PIN[] = ${arr(joints.map((j) => String(j.servo.pin ?? -1)))};`,
    `static const fe_real RB_SERVO_CENTER[] = ${arr(joints.map((j) => num(j.servo.center)))};`,
    `static const bool RB_SERVO_REVERSED[] = ${arr(joints.map((j) => String(j.servo.reversed)))};`,
    "",
    `#define RB_IDLE_LIFE ${behavior?.idle ?? true}`,
    `#define RB_PROGRAM_LENGTH ${program.length}`,
    "static const RbStep RB_PROGRAM[] FE_PROGMEM = {",
    ...(program.length ? program.map((s) => `  {${s.op}, ${s.op === OP.mood ? MOOD_ENUM[s.a] : s.a}, ${s.wait ? 1 : 0}, ${s.n}, ${num(s.x)}, ${num(s.y)}, ${s.jump}},`) : ["  {0, 0, 0, 0, 0.0, 0.0, 0},"]),
    "};",
    "",
  ].join("\n");
}

export interface RobotFirmwareOptions {
  robot: Robot;
  screens: Screen[];
  behaviorId: string | null;
  boardId: string;
}

/** Boards for this robot: those that can drive its mounted screen, or any board without one. */
export function robotBoards(robot: Robot, screens: Screen[]): BoardSpec[] {
  const screen = robot.mounts.map((m) => screens.find((s) => s.id === m.screenId)).find(Boolean);
  return screen ? boardsFor(screen.display) : BOARDS;
}

export function robotFirmwareProject({ robot, screens, behaviorId, boardId }: RobotFirmwareOptions) {
  if (robot.joints.length > MAX_FIRMWARE_JOINTS) throw new Error(`The robot code supports up to ${MAX_FIRMWARE_JOINTS} joints.`);
  const mount = robot.mounts.find((m) => screens.some((s) => s.id === m.screenId));
  const screen = mount ? screens.find((s) => s.id === mount.screenId)! : null;
  const display: DisplaySpec | null = screen ? displayById(screen.display) ?? null : null;
  const board = robotBoards(robot, screens).find((b) => b.id === boardId);
  if (!board) throw new Error(`${BOARDS.find((b) => b.id === boardId)?.name ?? "That board"} cannot run this robot${display ? ` with the ${display.name}` : ""}.`);
  const behavior = robot.behaviors?.find((b) => b.id === behaviorId) ?? null;
  if (behaviorId && !behavior) throw new Error("That behaviour no longer exists.");
  const notes: string[] = [];
  if (robot.mounts.length > 1) notes.push("Only the first mounted screen is driven; the others are in the 3D preview only.");

  // Animations on the robot: the face's own, plus any the behaviour uses from other screens.
  // 8-bit boards have 2 KB of RAM, so they get only the ones the behaviour uses.
  const animations: Animation[] = board.tiny ? [] : [...(screen?.animations ?? [])];
  const key = (s: string, a: string) => `${s}/${a}`;
  const index = new Map(animations.map((a, i) => [key(screen!.id, a.id), i]));
  if (board.tiny && display) notes.push(`The ${board.name} has only 2 KB of RAM; a screen plus servos fits, but only just. For bigger robots use an ESP32 or an M5Stack.`);
  const collect = (steps: Step[]) => {
    for (const s of steps) {
      if (s.kind === "repeat") collect(s.steps);
      if (s.kind !== "animation" || index.has(key(s.screen, s.animation))) continue;
      const a = screens.find((x) => x.id === s.screen)?.animations?.find((x) => x.id === s.animation);
      if (a) { index.set(key(s.screen, s.animation), animations.length); animations.push(a); }
    }
  };
  collect(behavior?.steps ?? []);
  const program = compileBehavior(behavior?.steps ?? [], robot, (s, a) => index.get(key(s, a)) ?? -1);
  const unpinned = robot.joints.filter((j) => j.servo.pin === null);
  if (unpinned.length) notes.push(`${unpinned.map((j) => `"${j.name}"`).join(", ")} ${unpinned.length === 1 ? "has" : "have"} no servo pin yet, so ${unpinned.length === 1 ? "it moves" : "they move"} only in the preview. Set the pin in Robotics Studio and export again.`);
  if (board.tiny && program.length * 24 > 900) notes.push(`The behaviour is long for the ${board.name}'s memory; if the build fails, shorten it or use an ESP32.`);

  const faceScreen: Screen = screen ?? { id: "none", name: "No screen", display: "ssd1306-128x64", face: DEFAULT_FACE };
  const faceDisplay = display ?? displayById("ssd1306-128x64")!;
  const servoLib = board.platform === "espressif32" ? "madhephaestus/ESP32Servo" : "arduino-libraries/Servo";
  const libs = [...(display ? LIBS[driverOf(display)] : []), servoLib];

  const noScreenMain = `// Robot made with MakerStudio AI (no screen). Upload with PlatformIO ("pio run -t upload").
// Serial monitor at 115200 baud: r restarts the behaviour.
#include <Arduino.h>
#include "robot_runner.h"

void setup() {
  Serial.begin(115200);
  frameSetup();
}

void loop() {
  frameState(millis());
  delay(10);
}
`;
  const pins = robot.joints.filter((j) => j.servo.pin !== null).map((j) => `- ${j.name}: pin ${j.servo.pin}, home ${j.servo.center}°${j.servo.reversed ? ", reversed" : ""}`);
  const readme = [
    `# ${robot.name}${behavior ? `: ${behavior.name}` : ""} on ${board.name}`,
    "",
    `Made with MakerStudio AI. ${display ? `Face on the ${display.name}. ` : ""}${robot.joints.length} joint${robot.joints.length === 1 ? "" : "s"}.`,
    "",
    "## Upload",
    "1. Install PlatformIO (VS Code extension or `pip install platformio`).",
    "2. Connect the board with USB and run `pio run -t upload` in this folder.",
    "3. Optional: `pio device monitor` (115200 baud). Type `r` to restart the behaviour.",
    "",
    "## Servos",
    ...(pins.length ? pins : ["- No servo pins set yet."]),
    "",
    "Hobby servos need their own 5 V supply for anything more than a tiny servo; connect its ground to the board's ground. Do not power several servos from the board's 5 V pin.",
    "Before fitting the horns, power the servos once: each moves to its home angle (usually 90°), then fit the part in its home position.",
    ...(notes.length ? ["", "## Notes", ...notes.map((n) => `- ${n}`)] : []),
    "",
  ].join("\n");
  const ini = [
    "; PlatformIO project made by MakerStudio AI.",
    `[env:${board.id}]`,
    `platform = ${board.platform}`,
    `board = ${board.board}`,
    "framework = arduino",
    "monitor_speed = 115200",
    "lib_deps =",
    ...libs.map((l) => `  ${l}`),
    ...(board.tiny ? [] : ["build_flags = -O2"]),
    "",
  ].join("\n");
  return {
    name: `${robot.name}${behavior ? ` - ${behavior.name}` : ""} - ${board.name}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80),
    files: [
      { path: "platformio.ini", text: ini },
      { path: "README.md", text: readme },
      { path: "include/face_engine.h", text: engineSource },
      { path: "include/robot_core.h", text: coreSource },
      { path: "include/robot_runner.h", text: runnerSource },
      { path: "include/face_data.h", text: faceDataHeader(faceScreen, faceDisplay, animations, -1) },
      { path: "include/robot_data.h", text: robotDataHeader(robot, behavior, program) },
      { path: "src/main.cpp", text: display ? mainCpp(driverOf(display), board, display, "robot_runner.h") : noScreenMain },
    ],
    notes,
  };
}
