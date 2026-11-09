// Writes XIAO firmware exports for a compile check: XIAO_OUT=dir npx vitest run tests/live/xiao-export --config vitest.live.config.ts
import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { firmwareProject } from "../../src/core/display/firmware";
import { DEFAULT_FACE } from "../../src/core/display/face";
it.runIf(!!process.env.XIAO_OUT)("export", () => {
  for (const display of ["ssd1306-128x64", "gc9a01-240"]) {
    const screen = { id: "s1", name: "Face", display, face: { ...DEFAULT_FACE }, animations: [] } as never;
    const p = firmwareProject({ screen, boardId: "xiao-esp32s3", start: -1 });
    for (const f of p.files) { const path = join(process.env.XIAO_OUT!, display, f.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.text); }
  }
});
