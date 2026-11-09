import { describe, expect, it } from "vitest";
import { DISPLAYS, displayById } from "../../src/core/display/catalog";
import { addScreen, deleteScreen, setFace, setScreen } from "../../src/core/display/commands";
import { DEFAULT_FACE, faceOps, MOODS, NEUTRAL, rasterize, type DrawOp, type Screen } from "../../src/core/display/face";
import { createProjectStore } from "../../src/core/document/store";
import { createEmptyProject, packProject, unpackProject } from "../../src/shared/format";

const core = displayById("m5stack-cores3")!;
const oled = displayById("ssd1306-128x64")!;
const round = displayById("gc9a01-240")!;

/** Number of pixels of a colour in an RGBA image. */
function count(px: Uint8ClampedArray, [r, g, b]: [number, number, number]) {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] === r && px[i + 1] === g && px[i + 2] === b) n++;
  return n;
}
const pixel = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
const white: [number, number, number] = [255, 255, 255];

describe("display catalog", () => {
  it("has unique ids, positive sizes and a source for every display", () => {
    expect(new Set(DISPLAYS.map((d) => d.id)).size).toBe(DISPLAYS.length);
    for (const d of DISPLAYS) {
      expect(d.width).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
      expect(d.source.length).toBeGreaterThan(5);
    }
    expect(core.width * core.height).toBe(320 * 240);
  });
});

describe("rasterizer", () => {
  const disp = { width: 100, height: 100, color: "rgb565" as const };
  const draw = (op: DrawOp) => count(rasterize([{ op: "fill", color: "#000000" }, op], disp), white);
  it("draws exact rectangles", () => {
    expect(draw({ op: "rect", x: 10, y: 20, w: 30, h: 15, color: "#ffffff" })).toBe(450);
  });
  it("draws circles, ellipses and triangles with about the right area", () => {
    expect(Math.abs(draw({ op: "circle", cx: 50, cy: 50, r: 20, color: "#ffffff" }) - Math.PI * 400) / (Math.PI * 400)).toBeLessThan(0.06);
    expect(Math.abs(draw({ op: "ellipse", cx: 50, cy: 50, rx: 30, ry: 10, color: "#ffffff" }) - Math.PI * 300) / (Math.PI * 300)).toBeLessThan(0.08);
    expect(Math.abs(draw({ op: "triangle", x0: 10, y0: 10, x1: 70, y1: 10, x2: 10, y2: 70, color: "#ffffff" }) - 1800) / 1800).toBeLessThan(0.08);
    const rr = draw({ op: "roundRect", x: 10, y: 10, w: 40, h: 20, r: 10, color: "#ffffff" });
    expect(rr).toBeLessThan(800);
    expect(rr).toBeGreaterThan(800 - (4 - Math.PI) * 100 - 30);
  });
  it("clips shapes at the screen edge", () => {
    expect(draw({ op: "rect", x: 90, y: 90, w: 50, h: 50, color: "#ffffff" })).toBe(100);
  });
});

describe("faces", () => {
  it("only uses whole pixels and real colours", () => {
    for (const mood of MOODS) {
      for (const op of faceOps(DEFAULT_FACE, core, { ...NEUTRAL, mood, talk: 0.5, lookX: 0.7, blink: 0.3 })) {
        for (const [k, v] of Object.entries(op)) {
          if (k === "op") continue;
          if (k === "color") expect(v).toMatch(/^#[0-9a-f]{6}$/i);
          else expect(Number.isInteger(v)).toBe(true);
        }
      }
    }
  });

  it("draws two eyes where the design puts them", () => {
    const px = rasterize(faceOps(DEFAULT_FACE, core), core);
    const y = Math.round(DEFAULT_FACE.eyeY * 240);
    const left = Math.round(160 - (DEFAULT_FACE.eyeSpacing * 320) / 2), right = Math.round(160 + (DEFAULT_FACE.eyeSpacing * 320) / 2);
    expect(pixel(px, 320, left, y)).toEqual(white);
    expect(pixel(px, 320, right, y)).toEqual(white);
    expect(pixel(px, 320, 160, y)).toEqual([0, 0, 0]); // between the eyes
    expect(pixel(px, 320, 2, 2)).toEqual([0, 0, 0]);
  });

  it("closes the eyes when blinking and moves them when looking", () => {
    const open = count(rasterize(faceOps(DEFAULT_FACE, core, NEUTRAL), core), white);
    const closed = count(rasterize(faceOps(DEFAULT_FACE, core, { ...NEUTRAL, blink: 1 }), core), white);
    expect(closed).toBeLessThan(open * 0.6);
    const right = faceOps({ ...DEFAULT_FACE, mouth: "none" }, core, { ...NEUTRAL, lookX: 1 });
    const centre = faceOps({ ...DEFAULT_FACE, mouth: "none" }, core, NEUTRAL);
    const eyeX = (ops: DrawOp[]) => ops.filter((o) => o.op === "ellipse").map((o) => (o as { cx: number }).cx);
    expect(eyeX(right)[0]!).toBeGreaterThan(eyeX(centre)[0]!);
  });

  it("looks different for every mood", () => {
    const images = MOODS.map((mood) => rasterize(faceOps(DEFAULT_FACE, core, { ...NEUTRAL, mood }), core).join(","));
    expect(new Set(images).size).toBe(MOODS.length);
  });

  it("opens the mouth when talking", () => {
    const quiet = count(rasterize(faceOps(DEFAULT_FACE, core, NEUTRAL), core), white);
    const talking = count(rasterize(faceOps(DEFAULT_FACE, core, { ...NEUTRAL, talk: 1 }), core), white);
    expect(talking).toBeGreaterThan(quiet);
  });

  it("is pure black and white on a monochrome OLED, whatever the colours", () => {
    const px = rasterize(faceOps({ ...DEFAULT_FACE, background: "#203040", foreground: "#ff8800", cheeks: "#ff0000" }, oled), oled);
    for (let i = 0; i < px.length; i += 4) expect([0, 255]).toContain(px[i]);
    expect(count(px, white)).toBeGreaterThan(50);
  });

  it("masks round displays to their circle", () => {
    const px = rasterize(faceOps({ ...DEFAULT_FACE, background: "#123456" }, round), round);
    expect(pixel(px, 240, 0, 0)).toEqual([0, 0, 0]);
    expect(pixel(px, 240, 120, 5)).toEqual([0x12, 0x34, 0x56]);
  });
});

describe("screen commands", () => {
  const screen: Screen = { id: "s1", name: "Face", display: "m5stack-cores3", face: DEFAULT_FACE };
  it("add, change (merged slider drags), undo and delete", () => {
    const s = createProjectStore(undefined, "test");
    const list = () => s.getState().project.document.workspaces.displays.screens as Screen[];
    s.getState().execute(addScreen({ screen }));
    s.getState().execute(setFace({ id: "s1", face: { eyeWidth: 0.1 }, merge: "drag-eyeWidth" }));
    s.getState().execute(setFace({ id: "s1", face: { eyeWidth: 0.12 }, merge: "drag-eyeWidth" }));
    expect(list()[0]!.face.eyeWidth).toBe(0.12);
    s.getState().undo();
    expect(list()[0]!.face.eyeWidth).toBe(DEFAULT_FACE.eyeWidth); // one undo step for the drag
    s.getState().execute(setScreen({ id: "s1", name: "Happy face", display: "ssd1306-128x64" }));
    expect(list()[0]!.display).toBe("ssd1306-128x64");
    s.getState().execute(deleteScreen({ id: "s1" }));
    expect(list()).toEqual([]);
    s.getState().undo();
    expect(list()[0]!.name).toBe("Happy face");
  });

  it("refuses bad values and unknown displays", () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addScreen({ screen }));
    expect(() => s.getState().execute(setFace({ id: "s1", face: { eyeWidth: 2 } }))).toThrow(/Invalid face setting/);
    expect(() => s.getState().execute(setFace({ id: "s1", face: { foreground: "red" } }))).toThrow(/Invalid face setting/);
    expect(() => s.getState().execute(setScreen({ id: "s1", display: "nope" }))).toThrow(/Unknown display/);
    expect(() => s.getState().execute(addScreen({ screen: { ...screen, id: "s2", display: "nope" } }))).toThrow(/Unknown display/);
  });

  it("saves screens in the project file and rejects damaged ones", () => {
    const p = createEmptyProject("Faces", "test");
    p.document.workspaces.displays.screens = [screen];
    expect(unpackProject(packProject(p)).document.workspaces.displays.screens).toEqual([screen]);
    const bad = createEmptyProject("Faces", "test");
    bad.document.workspaces.displays.screens = [{ ...screen, face: { ...DEFAULT_FACE, eyeWidth: 5 } }];
    expect(() => unpackProject(packProject(bad))).toThrow();
  });
});

describe("ellipse outline", () => {
  it("has no single-pixel spike at the top", () => {
    const disp = { width: 60, height: 60, color: "rgb565" as const };
    const px = rasterize([{ op: "fill", color: "#000000" }, { op: "ellipse", cx: 30, cy: 30, rx: 14, ry: 14, color: "#ffffff" }], disp);
    let top = 0;
    for (let x = 0; x < 60; x++) if (px[(16 * 60 + x) * 4] === 255) top++;
    expect(top).toBeGreaterThan(3); // a flat top row, not one pixel
  });
});
