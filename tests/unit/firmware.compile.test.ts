// Acceptance test for Phase 8c: generated projects compile with PlatformIO.
// Slow (downloads toolchains the first time), so it only runs with MAKERSTUDIO_PIO=1.
// Projects are kept in MAKERSTUDIO_PIO_DIR (or a temporary folder) for inspection.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES, type Animation } from "../../src/core/display/animation";
import { DEFAULT_FACE, type Screen } from "../../src/core/display/face";
import { firmwareProject } from "../../src/core/display/firmware";
import { behaviorTemplates } from "../../src/core/robot/behavior";
import { robotFirmwareProject } from "../../src/core/robot/firmware";
import type { Joint, Robot } from "../../src/core/robot/model";

const enabled = process.env.MAKERSTUDIO_PIO === "1";
const root = process.env.MAKERSTUDIO_PIO_DIR ?? (enabled ? mkdtempSync(path.join(tmpdir(), "ms-pio-")) : "");
const animations: Animation[] = TEMPLATES.map((t, i) => ({ id: `a${i}`, ...t.make() }));

const CASES: [string, string, number][] = [
  ["m5stack-cores3", "m5stack-cores3", 0], // Stack-chan style desk robot (ESP32-S3)
  ["ssd1306-128x64", "uno", 2], // classic OLED on an Uno
  ["st7789-240x320", "pico", 1], // colour TFT on a Raspberry Pi Pico
  ["m5stack-core2", "m5stack-core2", -1],
  ["sh1106-128x64", "esp32", 0],
  ["gc9a01-240", "esp32s3", 3],
  ["ili9341-240x320", "esp32", 1],
];

describe.skipIf(!enabled)("generated firmware compiles with PlatformIO", () => {
  for (const [display, board, start] of CASES) {
    it(`${display} on ${board}`, () => {
      const screen: Screen = { id: "s", name: "Desk buddy", display, face: { ...DEFAULT_FACE, cheeks: "#e86fa5", pupil: 0.3 }, animations };
      const project = firmwareProject({ screen, boardId: board, start });
      const dir = path.join(root, `${display}--${board}`);
      for (const f of project.files) {
        mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
        writeFileSync(path.join(dir, f.path), f.text);
      }
      const out = execFileSync("pio", ["run", "-d", dir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 1_500_000 });
      const ram = out.match(/RAM:.*?(\d+\.\d+)%/)?.[1];
      const flash = out.match(/Flash:.*?(\d+\.\d+)%/)?.[1];
      writeFileSync(path.join(dir, "build-summary.txt"), `RAM ${ram}%  Flash ${flash}%\n`);
      console.log(`${display} on ${board}: RAM ${ram}%, Flash ${flash}%`);
      expect(out).toMatch(/SUCCESS/);
    }, 1_600_000);
  }
});

// Whole robots: face + behaviour + servos.
const joint = (id: string, axis: Joint["axis"], pin: number | null): Joint => ({
  id, name: id, child: `${id}-part`, parent: null, pivot: [0, 0, 0], axis, min: -60, max: 60, servo: { pin, center: 90, reversed: false },
});
const ROBOTS: [string | null, string, string][] = [
  ["m5stack-cores3", "m5stack-cores3", "Curious"], // Stack-chan style desk robot
  ["ssd1306-128x64", "uno", "Say hello"],
  [null, "esp32", "Doze off"], // servos only, no screen
  ["st7789-240x320", "pico", "Curious"],
];

function build(name: string, files: { path: string; text: string }[]) {
  const dir = path.join(root, name);
  for (const f of files) {
    mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
    writeFileSync(path.join(dir, f.path), f.text);
  }
  const out = execFileSync("pio", ["run", "-d", dir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 1_500_000 });
  const ram = out.match(/RAM:.*?(\d+\.\d+)%/)?.[1];
  const flash = out.match(/Flash:.*?(\d+\.\d+)%/)?.[1];
  writeFileSync(path.join(dir, "build-summary.txt"), `RAM ${ram}%  Flash ${flash}%\n`);
  console.log(`${name}: RAM ${ram}%, Flash ${flash}%`);
  return out;
}

describe.skipIf(!enabled)("generated robot code compiles with PlatformIO", () => {
  for (const [display, board, behaviour] of ROBOTS) {
    it(`${display ?? "no screen"} on ${board}, ${behaviour}`, () => {
      const base: Robot = { id: "r", name: "Desk buddy", joints: [joint("pan", "z", 5), joint("tilt", "x", 6)], mounts: [] };
      const screen = display ? { id: "s", name: "Face", display, face: { ...DEFAULT_FACE }, animations } : null;
      const robot: Robot = {
        ...base,
        mounts: screen ? [{ id: "m", screenId: "s", objectId: "pan-part", position: [0, 0, 0], normal: [0, -1, 0], width: 40 }] : [],
        behaviors: [{ id: "b", ...behaviorTemplates(base).find((t) => t.name === behaviour)!.make() }],
      };
      const project = robotFirmwareProject({ robot, screens: screen ? [screen] : [], behaviorId: "b", boardId: board });
      expect(build(`robot--${display ?? "none"}--${board}`, project.files)).toMatch(/SUCCESS/);
    }, 1_600_000);
  }
});

// Drones: the Drone Studio flight code on both ESP32-S3 boards (warnings from our code fail it).
describe.skipIf(!enabled)("drone code compiles with PlatformIO", async () => {
  const { initCsg } = await import("../../src/core/cad/csg");
  const { DEFAULT_PARAMS, IDENTITY } = await import("../../src/core/cad/model");
  const { droneCodeProject } = await import("../../src/core/drone/firmware");
  const { defaultDrone, quadX } = await import("../../src/core/drone/model");
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
  const box = (id: string, w: number, d: number) => ({ id, name: id, kind: "box" as const, params: { ...DEFAULT_PARAMS.box, width: w, depth: d, height: 3 }, transform: { ...IDENTITY }, hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false });
  const frame = [box("plate", 40, 40), box("a", 120, 6), box("b", 6, 120)];
  for (const [boardId, pins, battery, motorType] of [["esp32s3", [4, 5, 6, 7], 1, "brushed"], ["xiao-esp32s3", [1, 2, 3, 4], null, "brushed"], ["esp32s3", [4, 5, 6, 7], 1, "esc"], ["xiao-esp32s3", [1, 2, 3, 4], null, "brushed+height"]] as const) {
    it(`drone on ${boardId} (${motorType})`, () => {
      const project = droneCodeProject({ ...defaultDrone(quadX(120)), motorType: motorType === "esc" ? "esc" : "brushed" }, frame, { boardId, motorPins: [...pins], imuX: "front", imuUp: true, batteryPin: battery, batteryDivider: 2, heightSensor: motorType.endsWith("+height"), wifiName: "MakerStudio-Drone", wifiPassword: "testpass123" });
      const dir = path.join(root, `drone--${boardId}--${motorType.replace("+", "-")}`);
      for (const f of project.files) {
        mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
        writeFileSync(path.join(dir, f.path), f.text);
      }
      const run = spawnSync("pio", ["run", "-d", dir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 1_500_000 });
      const out = `${run.stdout}\n${run.stderr}`; // compiler warnings come on stderr
      expect(out).toMatch(/SUCCESS/);
      expect(out).not.toMatch(/src\/main\.cpp:\d+:\d+: warning|flight_core\.h:\d+:\d+: warning/);
    }, 1_600_000);
  }
});
