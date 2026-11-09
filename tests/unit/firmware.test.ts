// The exported face engine (C++) must draw exactly what the preview (TypeScript) draws.
// These tests compile it with the computer's C++ compiler and compare every pixel.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sampleAnimation, TEMPLATES, type Animation } from "../../src/core/display/animation";
import { displayById } from "../../src/core/display/catalog";
import { DEFAULT_FACE, faceOps, MOODS, rasterize, type FaceSpec, type FaceState, type Screen } from "../../src/core/display/face";
import { boardsFor, faceDataHeader, firmwareProject } from "../../src/core/display/firmware";

const cxx = ["g++", "clang++"].find((c) => spawnSync(c, ["--version"]).status === 0);
const engine = readFileSync("src/core/display/firmware/face_engine.h", "utf8");
const MOOD_ENUM = ["FE_NEUTRAL", "FE_HAPPY", "FE_SAD", "FE_ANGRY", "FE_SLEEPY", "FE_SURPRISED"];

const animations: Animation[] = TEMPLATES.map((t, i) => ({ id: `a${i}`, ...t.make() }));

/** Builds and runs a C++ program that draws the states and samples the animations. */
function runNative(screen: Screen, states: FaceState[], samples: [number, number][]) {
  const display = displayById(screen.display)!;
  const dir = mkdtempSync(path.join(tmpdir(), "ms-face-"));
  writeFileSync(path.join(dir, "face_engine.h"), engine);
  writeFileSync(path.join(dir, "face_data.h"), faceDataHeader(screen, display, animations, -1));
  const st = states.map((s) => `{${MOOD_ENUM[MOODS.indexOf(s.mood)]}, ${s.blink}, ${s.lookX}, ${s.lookY}, ${s.talk}}`).join(",\n");
  writeFileSync(path.join(dir, "main.cpp"), `
#include <cstdio>
#include <vector>
#include "face_engine.h"
#include "face_data.h"
int main() {
  std::vector<unsigned char> img(FACE_WIDTH * FACE_HEIGHT * 3);
  auto hl = [&](int x0, int x1, int y, uint32_t c) {
    for (int x = x0; x <= x1; x++) { unsigned char* p = &img[(y * FACE_WIDTH + x) * 3]; p[0] = c >> 16; p[1] = (c >> 8) & 255; p[2] = c & 255; }
  };
  FeState states[] = { ${st} };
  for (const FeState& s : states) { feDrawFace(FACE, FACE_WIDTH, FACE_HEIGHT, FACE_MONO, s, hl); fwrite(img.data(), 1, img.size(), stdout); }
  int samples[][2] = { ${samples.map(([a, t]) => `{${a}, ${t}}`).join(", ") || "{0, 0}"} };
  int n = ${samples.length};
  for (int i = 0; i < n; i++) {
    FeState base = {FE_NEUTRAL, 0, 0, 0, 0};
    FeState s = feSample(ANIMATIONS[samples[i][0]], samples[i][1], base);
    printf("%d %.12f %.12f %.12f %.12f\\n", s.mood, s.blink, s.lookX, s.lookY, s.talk);
  }
}
`);
  execFileSync(cxx!, ["-std=c++17", "-O1", "-Wall", "-Werror", "-Wno-unused-function", "-o", "face", "main.cpp"], { cwd: dir });
  const out = execFileSync(path.join(dir, "face"), { maxBuffer: 256 * 1024 * 1024 });
  const frame = display.width * display.height * 3;
  const images = states.map((_, i) => out.subarray(i * frame, (i + 1) * frame));
  const text = out.subarray(states.length * frame).toString("utf8").trim();
  return { images, lines: text ? text.split("\n") : [] };
}

function previewRgb(face: FaceSpec, displayId: string, state: FaceState): Uint8Array {
  const d = displayById(displayId)!;
  const px = rasterize(faceOps(face, d, state), { ...d, round: false });
  const rgb = new Uint8Array(d.width * d.height * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]!; rgb[j + 1] = px[i + 1]!; rgb[j + 2] = px[i + 2]!; }
  return rgb;
}

function states(): FaceState[] {
  const out: FaceState[] = [];
  for (const mood of MOODS) {
    for (const [blink, lookX, lookY, talk] of [[0, 0, 0, 0], [0.37, 0.61, -0.45, 0], [1, -1, 1, 0], [0.1, -0.33, 0.2, 0.83], [0.55, 0.999, -0.999, 0.07]]) {
      out.push({ mood, blink: blink!, lookX: lookX!, lookY: lookY!, talk: talk! });
    }
  }
  return out;
}

const FACES: [string, FaceSpec][] = [
  ["default", DEFAULT_FACE],
  ["robot", { ...DEFAULT_FACE, eyeShape: "rounded", eyeWidth: 0.16, eyeHeight: 0.3, eyeRound: 0.35, eyeSpacing: 0.4, eyeY: 0.45, mouth: "none", foreground: "#2fd6a3" }],
  ["big eyes", { ...DEFAULT_FACE, eyeWidth: 0.2, eyeHeight: 0.34, eyeSpacing: 0.46, eyeY: 0.42, pupil: 0.45, mouth: "smile", mouthWidth: 0.14, mouthY: 0.78, cheeks: "#e86fa5" }],
  ["pixel", { ...DEFAULT_FACE, eyeShape: "rect", eyeWidth: 0.08, eyeHeight: 0.2, eyeSpacing: 0.36, mouth: "open", mouthWidth: 0.22, mouthThickness: 0.035, foreground: "#f2b84b", background: "#101820" }],
];

describe.skipIf(!cxx)("exported face engine matches the preview pixel for pixel", () => {
  for (const displayId of ["m5stack-cores3", "ssd1306-128x64", "gc9a01-240", "ssd1306-128x32"]) {
    for (const [label, face] of FACES) {
      it(`${label} face on ${displayId}, all moods, blinking, looking, talking`, () => {
        const screen: Screen = { id: "s", name: "Test", display: displayId, face, animations };
        const list = states();
        const { images } = runNative(screen, list, []);
        list.forEach((s, i) => {
          const expected = previewRgb(face, displayId, s);
          let diff = 0;
          for (let k = 0; k < expected.length; k++) if (expected[k] !== images[i]![k]) diff++;
          expect(diff, `${s.mood} blink ${s.blink} look ${s.lookX},${s.lookY} talk ${s.talk}`).toBe(0);
        });
      }, 60000);
    }
  }

  it("samples animations exactly like the preview", () => {
    const screen: Screen = { id: "s", name: "Test", display: "m5stack-cores3", face: DEFAULT_FACE, animations };
    const samples: [number, number][] = [];
    animations.forEach((a, i) => { for (let t = 0; t <= a.duration + 1500; t += 37) samples.push([i, t]); });
    const { lines } = runNative(screen, [], samples);
    expect(lines).toHaveLength(samples.length);
    samples.forEach(([a, t], i) => {
      const [mood, blink, lookX, lookY, talk] = lines[i]!.split(" ").map(Number);
      const s = sampleAnimation(animations[a]!, t);
      expect(MOODS[mood!]).toBe(s.mood);
      expect(blink).toBeCloseTo(s.blink, 9);
      expect(lookX).toBeCloseTo(s.lookX, 9);
      expect(lookY).toBeCloseTo(s.lookY, 9);
      expect(talk).toBeCloseTo(s.talk, 9);
    });
  }, 60000);
});

describe("firmware projects", () => {
  const screen: Screen = { id: "s", name: "Desk buddy", display: "m5stack-cores3", face: DEFAULT_FACE, animations };
  it("offers the right boards for each display", () => {
    expect(boardsFor("m5stack-cores3").map((b) => b.id)).toEqual(["m5stack-cores3"]);
    expect(boardsFor("ssd1306-128x64").map((b) => b.id)).toEqual(["uno", "nano", "esp32", "esp32s3", "xiao-esp32s3", "pico"]);
    expect(boardsFor("ili9341-240x320").map((b) => b.id)).toEqual(["esp32", "esp32s3", "xiao-esp32s3", "pico"]);
  });
  it("writes a complete PlatformIO project", () => {
    const p = firmwareProject({ screen, boardId: "m5stack-cores3", start: 0 });
    expect(p.files.map((f) => f.path).sort()).toEqual(["README.md", "include/face_data.h", "include/face_engine.h", "include/face_player.h", "platformio.ini", "src/main.cpp"]);
    const ini = p.files.find((f) => f.path === "platformio.ini")!.text;
    expect(ini).toContain("board = m5stack-cores3");
    expect(ini).toContain("m5stack/M5Unified");
    expect(p.files.find((f) => f.path === "include/face_data.h")!.text).toContain("#define START_ANIMATION 0");
  });
  it("keeps only the starting animation on 8-bit boards, and refuses impossible combinations", () => {
    const uno = firmwareProject({ screen: { ...screen, display: "ssd1306-128x64" }, boardId: "uno", start: 2 });
    const data = uno.files.find((f) => f.path === "include/face_data.h")!.text;
    expect(data).toContain("#define ANIMATION_COUNT 1");
    expect(data).toContain("Happy hello");
    expect(uno.notes[0]).toMatch(/very little memory/);
    expect(() => firmwareProject({ screen, boardId: "uno", start: 0 })).toThrow(/cannot drive/);
    expect(() => firmwareProject({ screen, boardId: "m5stack-cores3", start: 9 })).toThrow(/does not exist/);
  });
});

describe("export board follows Circuit Studio", async () => {
  const { preferredBoard, BOARDS } = await import("../../src/core/display/firmware");
  it("starts on the board wired in the circuit when it is offered (regression: ESP32-S3 robot exported for an Uno)", () => {
    expect(preferredBoard(BOARDS, [{ type: "servo" }, { type: "esp32-s3-devkitc-1" }])).toBe("esp32s3");
    expect(preferredBoard(BOARDS, [{ type: "xiao-esp32s3-sense" }])).toBe("xiao-esp32s3");
    expect(preferredBoard(BOARDS, [{ type: "raspberry-pi-pico" }])).toBe("pico");
  });
  it("falls back to the first offered board", () => {
    expect(preferredBoard(BOARDS, [])).toBe(BOARDS[0]!.id);
    const onlyUno = BOARDS.filter((b) => b.id === "uno");
    expect(preferredBoard(onlyUno, [{ type: "esp32-s3-devkitc-1" }])).toBe("uno");
  });
});
