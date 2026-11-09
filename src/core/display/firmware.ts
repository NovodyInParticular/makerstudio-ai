// Turns a face (and its animations) into a PlatformIO project for a real board.
//
// The project contains the MakerStudio face engine (face_engine.h, the same drawing code
// as the preview, built from horizontal lines), the player (face_player.h: animations,
// idle life, serial commands), the face itself (face_data.h) and a small main.cpp that
// connects them to the display library of the chosen board.

import engineSource from "./firmware/face_engine.h?raw";
import playerSource from "./firmware/face_player.h?raw";
import type { Animation } from "./animation";
import { displayById, type DisplaySpec } from "./catalog";
import { MOODS, type Screen } from "./face";

export interface BoardSpec {
  id: string;
  name: string;
  /** PlatformIO platform and board. */
  platform: string;
  board: string;
  /** 8-bit boards get only the starting animation (very little RAM). */
  tiny?: boolean;
  /** Example SPI pins for colour TFTs on this board (the user changes them to their wiring). */
  tftPins?: { cs: number; dc: number; rst: number; note: string };
  /** Displays with their own board (M5Stack) list only that board. */
  builtIn?: string;
}

export const BOARDS: BoardSpec[] = [
  { id: "m5stack-cores3", name: "M5Stack CoreS3", platform: "espressif32", board: "m5stack-cores3", builtIn: "m5stack-cores3" },
  { id: "m5stack-core2", name: "M5Stack Core2", platform: "espressif32", board: "m5stack-core2", builtIn: "m5stack-core2" },
  { id: "uno", name: "Arduino Uno", platform: "atmelavr", board: "uno", tiny: true },
  { id: "nano", name: "Arduino Nano (ATmega328P)", platform: "atmelavr", board: "nanoatmega328", tiny: true },
  { id: "esp32", name: "ESP32 DevKit", platform: "espressif32", board: "esp32dev", tftPins: { cs: 5, dc: 16, rst: 17, note: "SPI: SCK 18, MOSI 23" } },
  { id: "esp32s3", name: "ESP32-S3 DevKitC-1", platform: "espressif32", board: "esp32-s3-devkitc-1", tftPins: { cs: 10, dc: 9, rst: 8, note: "SPI: SCK 12, MOSI 11" } },
  { id: "xiao-esp32s3", name: "Seeed XIAO ESP32-S3 (Sense)", platform: "espressif32", board: "seeed_xiao_esp32s3", tftPins: { cs: 1, dc: 2, rst: 3, note: "SPI: SCK D8 (GPIO7), MOSI D10 (GPIO9); CS D0 (GPIO1), DC D1 (GPIO2), RST D2 (GPIO3). I²C screens: SDA D4, SCL D5" } },
  { id: "pico", name: "Raspberry Pi Pico", platform: "raspberrypi", board: "pico", tftPins: { cs: 17, dc: 20, rst: 21, note: "SPI0: SCK 18, MOSI 19" } },
];

export type Driver = "m5" | "ssd1306" | "sh1106" | "st7789" | "ili9341" | "gc9a01";

export function driverOf(display: DisplaySpec): Driver {
  if (display.id.startsWith("m5stack")) return "m5";
  return ({ SSD1306: "ssd1306", SH1106: "sh1106", ST7789: "st7789", ILI9341: "ili9341", GC9A01: "gc9a01" } as Record<string, Driver>)[display.controller]!;
}

/** Boards that can drive this display. */
export function boardsFor(displayId: string): BoardSpec[] {
  const display = displayById(displayId);
  if (!display) return [];
  const driver = driverOf(display);
  if (driver === "m5") return BOARDS.filter((b) => b.builtIn === display.id);
  // Colour TFTs need a 25 KB band buffer and fast SPI, which 8-bit boards do not have.
  if (driver === "st7789" || driver === "ili9341" || driver === "gc9a01") return BOARDS.filter((b) => b.tftPins);
  return BOARDS.filter((b) => !b.builtIn);
}

// --- face_data.h -----------------------------------------------------------------------------

const num = (n: number) => {
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
const hex = (c: string) => `0x${c.slice(1).toUpperCase()}`;
const cString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[^\x20-\x7e]/g, "?")}"`;
const MOOD_ENUM = ["FE_NEUTRAL", "FE_HAPPY", "FE_SAD", "FE_ANGRY", "FE_SLEEPY", "FE_SURPRISED"];

function keyLine(k: Animation["keyframes"][number]): string {
  const has = [k.mood !== undefined && "FE_K_MOOD", k.lookX !== undefined && "FE_K_LOOKX", k.lookY !== undefined && "FE_K_LOOKY", k.blink !== undefined && "FE_K_BLINK", k.talk !== undefined && "FE_K_TALK"].filter(Boolean);
  const mood = k.mood !== undefined ? MOOD_ENUM[MOODS.indexOf(k.mood)] : "FE_NEUTRAL";
  return `  {${k.t}, ${has.length ? has.join(" | ") : "0"}, ${mood}, ${num(k.lookX ?? 0)}, ${num(k.lookY ?? 0)}, ${num(k.blink ?? 0)}, ${num(k.talk ?? 0)}},`;
}

export function faceDataHeader(screen: Screen, display: DisplaySpec, animations: Animation[], start: number): string {
  const f = screen.face;
  const shape = { round: "FE_EYE_ROUND", rounded: "FE_EYE_ROUNDED", rect: "FE_EYE_RECT" }[f.eyeShape];
  const mouth = { none: "FE_MOUTH_NONE", line: "FE_MOUTH_LINE", smile: "FE_MOUTH_SMILE", open: "FE_MOUTH_OPEN" }[f.mouth];
  const lines = [
    `// Face "${screen.name.replace(/[^\x20-\x7e]/g, "?")}" for ${display.name}, made with MakerStudio AI.`,
    "// Generated file: change the face in MakerStudio and export again.",
    "#pragma once",
    '#include "face_engine.h"',
    "",
    `#define FACE_WIDTH ${display.width}`,
    `#define FACE_HEIGHT ${display.height}`,
    `#define FACE_MONO ${display.color === "mono" ? 1 : 0}`,
    "",
    "static const FeFace FACE = {",
    `  ${shape}, ${num(f.eyeWidth)}, ${num(f.eyeHeight)}, ${num(f.eyeRound)}, ${num(f.eyeSpacing)}, ${num(f.eyeY)}, ${num(f.pupil)},`,
    `  ${mouth}, ${num(f.mouthWidth)}, ${num(f.mouthY)}, ${num(f.mouthThickness)},`,
    `  ${hex(f.background)}, ${hex(f.foreground)}, ${f.cheeks ? "true" : "false"}, ${f.cheeks ? hex(f.cheeks) : "0x000000"}`,
    "};",
    "",
  ];
  animations.forEach((a, i) => {
    const keys = [...a.keyframes].sort((x, y) => x.t - y.t);
    lines.push(`// ${i}: ${a.name.replace(/[^\x20-\x7e]/g, "?")}`);
    if (keys.length) lines.push(`static const FeKey ANIM_${i}_KEYS[] FE_PROGMEM = {`, ...keys.map(keyLine), "};");
  });
  lines.push(
    "",
    `#define ANIMATION_COUNT ${animations.length}`,
    animations.length
      ? `static const FeAnimation ANIMATIONS[] = {\n${animations.map((a, i) => `  {${a.duration}, ${a.loop}, ${a.keyframes.length ? `ANIM_${i}_KEYS` : "nullptr"}, ${a.keyframes.length}},`).join("\n")}\n};`
      : "static const FeAnimation ANIMATIONS[1] = {{1000, true, nullptr, 0}};",
    animations.length
      ? `static const char* const ANIMATION_NAMES[] = {${animations.map((a) => cString(a.name)).join(", ")}};`
      : 'static const char* const ANIMATION_NAMES[1] = {""};',
    `#define START_ANIMATION ${start} // -1 = idle life`,
    "",
  );
  return lines.join("\n");
}

// --- main.cpp per display driver -------------------------------------------------------------

const LOOP = `
void drawFrame() {
  FeState s = frameState(millis());
  feDrawFace(FACE, FACE_WIDTH, FACE_HEIGHT, FACE_MONO, s, hline);
  present();
}
`;

export function mainCpp(driver: Driver, board: BoardSpec, display: DisplaySpec, runtime = "face_player.h"): string {
  const head = `// Robot face made with MakerStudio AI. Upload with PlatformIO ("pio run -t upload").
// Serial monitor at 115200 baud (see README for the commands).
#include <Arduino.h>
`;
  const setupSerial = `  Serial.begin(115200);
  randomSeed(micros());
  frameSetup();`;
  const pins = board.tftPins;
  const tftPins = pins ? `// Example wiring for ${board.name} (${pins.note}). CHANGE these to match how you wired your display.
#define TFT_CS ${pins.cs}
#define TFT_DC ${pins.dc}
#define TFT_RST ${pins.rst}
` : "";
  const rgb565 = "((uint16_t)(((c >> 8) & 0xF800) | ((c >> 5) & 0x07E0) | ((c >> 3) & 0x001F)))";
  const mono = "(((c >> 16) & 255) * 30 + ((c >> 8) & 255) * 59 + (c & 255) * 11 > 12700)";

  switch (driver) {
    case "m5":
      return `${head}#include <M5Unified.h>
#include "${runtime}"

// Draw into an off-screen canvas, then show it in one go (no flicker).
M5Canvas canvas(&M5.Display);

static void hline(int x0, int x1, int y, uint32_t c) { canvas.drawFastHLine(x0, y, x1 - x0 + 1, ${rgb565}); }
static void present() { canvas.pushSprite(0, 0); }
${LOOP}
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
${setupSerial}
  canvas.setColorDepth(16);
  canvas.setPsram(true); // the CoreS3 and Core2 have 8 MB PSRAM; the 150 KB canvas goes there
  if (!canvas.createSprite(FACE_WIDTH, FACE_HEIGHT)) Serial.println(F("Not enough memory for the face canvas."));
}

void loop() {
  M5.update();
  drawFrame();
  delay(16);
}
`;
    case "ssd1306":
    case "sh1106": {
      const isSh = driver === "sh1106";
      return `${head}#include <Wire.h>
#include <Adafruit_GFX.h>
#include <${isSh ? "Adafruit_SH110X.h" : "Adafruit_SSD1306.h"}>
#include "${runtime}"

// I2C address of the display: most modules use 0x3C, some 0x3D (see the back of the board).
#define OLED_ADDRESS 0x3C

${isSh ? "Adafruit_SH1106G display(FACE_WIDTH, FACE_HEIGHT, &Wire, -1);" : "Adafruit_SSD1306 display(FACE_WIDTH, FACE_HEIGHT, &Wire, -1);"}

// Monochrome: a pixel is lit when its colour is light (same rule as the preview).
static void hline(int x0, int x1, int y, uint32_t c) { display.drawFastHLine(x0, y, x1 - x0 + 1, ${mono} ? ${isSh ? "SH110X_WHITE" : "SSD1306_WHITE"} : ${isSh ? "SH110X_BLACK" : "SSD1306_BLACK"}); }
static void present() { display.display(); }
${LOOP}
void setup() {
${setupSerial}
  if (!${isSh ? "display.begin(OLED_ADDRESS, true)" : "display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)"}) {
    Serial.println(F("Display not found (or not enough memory): check the wiring (SDA, SCL, power) and OLED_ADDRESS."));
    for (;;) delay(1000);
  }
}

void loop() {
  drawFrame();
  delay(10);
}
`;
    }
    default: {
      const lib = { st7789: "Adafruit_ST7789", ili9341: "Adafruit_ILI9341", gc9a01: "Adafruit_GC9A01A" }[driver];
      // ST7789 panels are 240 wide; a 240 x 320 panel is turned to landscape to show 320 x 240.
      const init = driver === "st7789"
        ? (display.width === display.height ? "  tft.init(240, 240);" : "  tft.init(240, 320);\n  tft.setRotation(1); // landscape")
        : driver === "ili9341" ? "  tft.begin();\n  tft.setRotation(1); // landscape" : "  tft.begin();";
      return `${head}#include <SPI.h>
#include <Adafruit_GFX.h>
#include <${lib}.h>
#include "${runtime}"

${tftPins}
${lib} tft(TFT_CS, TFT_DC, TFT_RST);

// The picture is drawn in bands of rows: a full-screen buffer (up to 150 KB) does not fit in
// the RAM of many boards, a band does. Each band is drawn in memory and sent in one go.
#define BAND_ROWS 40
GFXcanvas16 band(FACE_WIDTH, BAND_ROWS);
static int bandTop = 0;

static void hline(int x0, int x1, int y, uint32_t c) {
  if (y < bandTop || y >= bandTop + BAND_ROWS) return;
  band.drawFastHLine(x0, y - bandTop, x1 - x0 + 1, ${rgb565});
}

void drawFrame() {
  FeState s = frameState(millis());
  for (bandTop = 0; bandTop < FACE_HEIGHT; bandTop += BAND_ROWS) {
    int rows = FACE_HEIGHT - bandTop < BAND_ROWS ? FACE_HEIGHT - bandTop : BAND_ROWS;
    feDrawFace(FACE, FACE_WIDTH, FACE_HEIGHT, FACE_MONO, s, hline);
    tft.drawRGBBitmap(0, bandTop, band.getBuffer(), FACE_WIDTH, rows);
  }
}

void setup() {
${setupSerial}
${init}
  if (!band.getBuffer()) Serial.println(F("Not enough memory for the face buffer."));
}

void loop() {
  drawFrame();
  delay(5);
}
`;
    }
  }
}

// --- the project -------------------------------------------------------------------------------

export interface FirmwareOptions {
  screen: Screen;
  boardId: string;
  /** Index into the screen's animations to start with, or -1 for idle life. */
  start: number;
}

export interface FirmwareProject {
  /** Folder name suggestion. */
  name: string;
  files: { path: string; text: string }[];
  notes: string[];
}

export const LIBS: Record<Driver, string[]> = {
  m5: ["m5stack/M5Unified"],
  ssd1306: ["adafruit/Adafruit GFX Library", "adafruit/Adafruit SSD1306"],
  sh1106: ["adafruit/Adafruit GFX Library", "adafruit/Adafruit SH110X"],
  st7789: ["adafruit/Adafruit GFX Library", "adafruit/Adafruit ST7735 and ST7789 Library"],
  ili9341: ["adafruit/Adafruit GFX Library", "adafruit/Adafruit ILI9341"],
  gc9a01: ["adafruit/Adafruit GFX Library", "adafruit/Adafruit GC9A01A"],
};

export function firmwareProject({ screen, boardId, start }: FirmwareOptions): FirmwareProject {
  const display = displayById(screen.display);
  if (!display) throw new Error("Unknown display type.");
  const board = boardsFor(display.id).find((b) => b.id === boardId);
  if (!board) throw new Error(`${BOARDS.find((b) => b.id === boardId)?.name ?? "That board"} cannot drive the ${display.name} in an exported project.`);
  const driver = driverOf(display);
  const all = screen.animations ?? [];
  if (start >= all.length) throw new Error("That animation does not exist.");
  const notes: string[] = [];
  // 8-bit boards have 2 KB of RAM: only the starting animation goes along.
  let animations = all;
  let first = start;
  if (board.tiny && all.length > 1) {
    animations = start >= 0 ? [all[start]!] : [];
    first = start >= 0 ? 0 : -1;
    notes.push(`${board.name} has very little memory, so only ${start >= 0 ? `"${all[start]!.name}"` : "idle life"} was included.`);
  }
  if (animations.length > 10) notes.push("Serial commands 0-9 reach the first 10 animations.");
  const ini = [
    "; PlatformIO project made by MakerStudio AI.",
    "; Build and upload:  pio run -t upload     Serial monitor:  pio device monitor",
    `[env:${board.id}]`,
    `platform = ${board.platform}`,
    `board = ${board.board}`,
    "framework = arduino",
    "monitor_speed = 115200",
    "lib_deps =",
    ...LIBS[driver].map((l) => `  ${l}`),
    ...(board.tiny ? [] : ["build_flags = -O2"]),
    "",
  ].join("\n");
  const readme = [
    `# ${screen.name} on ${board.name}`,
    "",
    `Robot face for the ${display.name} (${display.width} × ${display.height}), made with MakerStudio AI.`,
    "",
    "## Upload",
    "1. Install PlatformIO (VS Code extension or `pip install platformio`).",
    "2. Connect the board with USB, then in this folder run `pio run -t upload`.",
    "3. Optional: `pio device monitor` opens the serial monitor (115200 baud). Type `0`-`9` to play an animation, `i` for idle life.",
    "",
    ...(board.tftPins && driver !== "m5" ? ["## Wiring", `The pins in \`src/main.cpp\` are an example for ${board.name} (${board.tftPins.note}, CS ${board.tftPins.cs}, DC ${board.tftPins.dc}, RST ${board.tftPins.rst}). Change them to match your wiring before uploading.`, ""] : []),
    ...(driver === "ssd1306" || driver === "sh1106" ? ["## Wiring", "I²C: connect SDA and SCL to the board's I²C pins, plus power and ground. If nothing shows, try `OLED_ADDRESS 0x3D` in `src/main.cpp`.", ""] : []),
    "## Files",
    "- `include/face_data.h`: your face and animations (generated; export again after changes).",
    "- `include/face_engine.h`: draws the face, the same code as MakerStudio's preview.",
    "- `include/face_player.h`: plays animations, idle life, serial commands.",
    "- `src/main.cpp`: connects the face to the display.",
    ...(notes.length ? ["", "## Notes", ...notes.map((n) => `- ${n}`)] : []),
    "",
  ].join("\n");
  return {
    name: `${screen.name} - ${board.name}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80),
    files: [
      { path: "platformio.ini", text: ini },
      { path: "README.md", text: readme },
      { path: "include/face_engine.h", text: engineSource },
      { path: "include/face_player.h", text: playerSource },
      { path: "include/face_data.h", text: faceDataHeader(screen, display, animations, first) },
      { path: "src/main.cpp", text: mainCpp(driver, board, display) },
    ],
    notes,
  };
}

/** Circuit Studio board part → the code-export board for it. */
const CIRCUIT_TO_FIRMWARE: Record<string, string> = {
  "arduino-uno-r3": "uno",
  "raspberry-pi-pico": "pico",
  "esp32-s3-devkitc-1": "esp32s3",
  "xiao-esp32s3-sense": "xiao-esp32s3",
  "m5stack-cores3": "m5stack-cores3",
};

/**
 * The export board to start with: the board wired in Circuit Studio when it is one of the
 * offered boards, else the first offered one (so an ESP32 robot is not exported for an Uno).
 */
export function preferredBoard(offered: { id: string }[], circuitParts: { type: string }[]): string {
  for (const part of circuitParts) {
    const id = CIRCUIT_TO_FIRMWARE[part.type];
    if (id && offered.some((b) => b.id === id)) return id;
  }
  return offered[0]?.id ?? "";
}
