// Compiles an Arduino sketch for the Uno with PlatformIO, for the in-app emulator (Phase 6b).
// Builds run in a private folder; identical code is reused from the cache.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { findPio } from "./device";

export type EmuBoard = "uno" | "pico";
/** Uno: Intel HEX text. Pico: the raw flash image (firmware.bin). */
export type BuildResult = { ok: true; board: EmuBoard; hex?: string; bin?: Uint8Array; size: string } | { ok: false; errors: string[] };

const INIS: Record<EmuBoard, string> = {
  uno: "[env:uno]\nplatform = atmelavr\nboard = uno\nframework = arduino\n",
  pico: "[env:pico]\nplatform = raspberrypi\nboard = pico\nframework = arduino\n",
};

export async function buildSketch(root: string, code: string, board: EmuBoard = "uno"): Promise<BuildResult> {
  const INI = INIS[board];
  const pio = await findPio();
  if (!pio) return { ok: false, errors: ["PlatformIO is not installed: it compiles your code (install it from platformio.org)."] };
  const hash = createHash("sha256").update(INI).update(code).digest("hex").slice(0, 16);
  const dir = path.join(root, hash);
  const hexFile = path.join(dir, `.pio/build/${board}/firmware.${board === "uno" ? "hex" : "bin"}`);
  const result = async (size: string): Promise<BuildResult> => board === "uno"
    ? { ok: true, board, hex: await fs.readFile(hexFile, "utf8"), size }
    : { ok: true, board, bin: new Uint8Array(await fs.readFile(hexFile)), size };
  if (existsSync(hexFile)) return result("(cached)");
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "platformio.ini"), INI);
  // Like the Arduino IDE: the sketch gets Arduino.h; a .cpp file needs prototypes for functions used before they are defined.
  await fs.writeFile(path.join(dir, "src/main.cpp"), `#include <Arduino.h>\n#line 1 "sketch.ino"\n${code}\n`);
  const out = await new Promise<{ code: number; text: string }>((resolve) =>
    execFile(pio, ["run", "-d", dir], { timeout: 240000, maxBuffer: 16 << 20, env: { ...process.env, PLATFORMIO_NO_ANSI: "1" } }, (e, so, se) =>
      resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, text: `${so}\n${se}` })));
  if (out.code !== 0 || !existsSync(hexFile)) {
    const errors = out.text.split("\n").filter((l) => /sketch\.ino:\d+|error:|Error /.test(l)).map((l) => l.replace(/^.*?sketch\.ino:/, "line ")).slice(0, 20);
    return { ok: false, errors: errors.length ? errors : [out.text.trim().split("\n").slice(-8).join("\n")] };
  }
  const size = out.text.split("\n").filter((l) => /^(RAM|Flash):/.test(l)).join(" · ");
  return result(size);
}
