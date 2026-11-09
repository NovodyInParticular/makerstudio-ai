// Robot faces for small screens.
//
// A face design (FaceSpec) plus a moment in time (FaceState: mood, blink, where it looks,
// talking) becomes a list of simple drawing operations: rectangles, rounded rectangles,
// circles, ellipses and triangles. Those are exactly the shapes the display libraries on the
// robot can draw (M5GFX, TFT_eSPI, Adafruit GFX, U8g2), so the preview here and the code
// exported for the robot (Phase 8c) draw the same shapes at the same pixel positions and
// sizes, without anti-aliasing like on the device. Each library rounds curved edges in its
// own way, so the outline of a circle or ellipse can differ by about one pixel.
//
// Sizes are fractions of the screen, so a face keeps its look on another display.

import { z } from "zod";
import { AnimationSchema } from "./animation";
import { NEUTRAL, type FaceState } from "./mood";
export { MOODS, NEUTRAL, type FaceState, type Mood } from "./mood";
import type { DisplaySpec } from "./catalog";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const frac = (min: number, max: number) => z.number().min(min).max(max);

export const FaceSpecSchema = z.object({
  eyeShape: z.enum(["round", "rounded", "rect"]),
  /** Eye size as a fraction of the screen width / height. */
  eyeWidth: frac(0.03, 0.45),
  eyeHeight: frac(0.03, 0.9),
  /** Corner rounding of "rounded" eyes, 0 (square) to 1 (fully round ends). */
  eyeRound: frac(0, 1),
  /** Distance between the eye centres, fraction of the width. */
  eyeSpacing: frac(0.05, 0.9),
  /** Height of the eye centres, fraction of the height from the top. */
  eyeY: frac(0.1, 0.9),
  /** Pupil diameter as a fraction of the eye's smaller side (0 = solid eyes). */
  pupil: frac(0, 0.9),
  mouth: z.enum(["none", "line", "smile", "open"]),
  mouthWidth: frac(0.03, 0.8),
  mouthY: frac(0.1, 0.98),
  /** Line thickness of the mouth, fraction of the height. */
  mouthThickness: frac(0.005, 0.15),
  background: hex,
  foreground: hex,
  /** Cheeks (colour screens only); empty string = none. */
  cheeks: z.union([hex, z.literal("")]),
});
export type FaceSpec = z.infer<typeof FaceSpecSchema>;

export const DEFAULT_FACE: FaceSpec = {
  eyeShape: "round",
  eyeWidth: 0.09,
  eyeHeight: 0.12,
  eyeRound: 1,
  eyeSpacing: 0.42,
  eyeY: 0.4,
  pupil: 0,
  mouth: "line",
  mouthWidth: 0.2,
  mouthY: 0.7,
  mouthThickness: 0.02,
  background: "#000000",
  foreground: "#ffffff",
  cheeks: "",
};

/** One drawing step. Coordinates are whole pixels; colours are "#rrggbb". */
export type DrawOp =
  | { op: "fill"; color: string }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { op: "roundRect"; x: number; y: number; w: number; h: number; r: number; color: string }
  | { op: "circle"; cx: number; cy: number; r: number; color: string }
  | { op: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: string }
  | { op: "triangle"; x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; color: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = Math.round;

/** The drawing steps for a face at one moment. */
export function faceOps(spec: FaceSpec, display: Pick<DisplaySpec, "width" | "height" | "color">, state: FaceState = NEUTRAL): DrawOp[] {
  const W = display.width, H = display.height;
  const mono = display.color === "mono";
  const bg = mono ? "#000000" : spec.background;
  const fg = mono ? "#ffffff" : spec.foreground;
  const ops: DrawOp[] = [{ op: "fill", color: bg }];

  const blink = clamp(state.blink, 0, 1);
  const lookX = clamp(state.lookX, -1, 1), lookY = clamp(state.lookY, -1, 1);
  const grow = state.mood === "surprised" ? 1.18 : 1;
  const ew = Math.max(2, round(spec.eyeWidth * W * grow));
  const fullH = Math.max(2, round(spec.eyeHeight * H * grow));
  const eh = Math.max(1, round(fullH * (1 - 0.9 * blink)));
  const shiftX = round(lookX * W * 0.06), shiftY = round(lookY * H * 0.06);
  const cy = round(spec.eyeY * H) + shiftY;

  for (const side of [-1, 1] as const) {
    const cx = round(W / 2 + (side * spec.eyeSpacing * W) / 2) + shiftX;
    const x = cx - round(ew / 2), y = cy - round(eh / 2);
    // The eye
    if (spec.eyeShape === "round") ops.push({ op: "ellipse", cx, cy, rx: Math.max(1, round(ew / 2)), ry: Math.max(1, round(eh / 2)), color: fg });
    else if (spec.eyeShape === "rect") ops.push({ op: "rect", x, y, w: ew, h: eh, color: fg });
    else ops.push({ op: "roundRect", x, y, w: ew, h: eh, r: round((Math.min(ew, eh) / 2) * spec.eyeRound), color: fg });

    // Pupil, following the gaze a little more than the eye does
    if (spec.pupil > 0 && blink < 0.6) {
      const pr = Math.max(1, round((Math.min(ew, eh) * spec.pupil) / 2));
      const px = cx + round(lookX * (ew / 2 - pr) * 0.8), py = cy + round(lookY * (eh / 2 - pr) * 0.8);
      ops.push({ op: "circle", cx: px, cy: py, r: pr, color: bg });
    }

    // Eyelids for moods, drawn in the background colour over the eye
    const top = cy - round(eh / 2) - 1, bottom = cy + round(eh / 2) + 1;
    const left = cx - round(ew / 2) - 1, right = cx + round(ew / 2) + 1;
    const inner = side < 0 ? right : left, outer = side < 0 ? left : right;
    if (state.mood === "sleepy") {
      ops.push({ op: "rect", x: left, y: top, w: right - left + 1, h: round(eh * 0.5) + 1, color: bg });
    } else if (state.mood === "angry") {
      // lid slopes down towards the nose
      ops.push({ op: "triangle", x0: outer, y0: top, x1: inner, y1: top, x2: inner, y2: top + round(eh * 0.55), color: bg });
    } else if (state.mood === "sad") {
      // lid slopes down towards the outside
      ops.push({ op: "triangle", x0: inner, y0: top, x1: outer, y1: top, x2: outer, y2: top + round(eh * 0.5), color: bg });
    } else if (state.mood === "happy") {
      // a curve from below turns the eye into a smiling arc
      ops.push({ op: "ellipse", cx, cy: bottom + round(eh * 0.15), rx: round(ew * 0.62), ry: round(eh * 0.6), color: bg });
    }
  }

  // Cheeks
  if (!mono && spec.cheeks && state.mood !== "angry") {
    const r = Math.max(2, round(H * 0.04));
    for (const side of [-1, 1]) {
      const cx = round(W / 2 + (side * spec.eyeSpacing * W) / 2 + side * spec.eyeWidth * W * 0.5) + shiftX;
      ops.push({ op: "ellipse", cx, cy: cy + round(spec.eyeHeight * H * 0.85), rx: round(r * 1.6), ry: r, color: spec.cheeks });
    }
  }

  // Mouth
  if (spec.mouth !== "none") {
    const mw = Math.max(2, round(spec.mouthWidth * W));
    const t = Math.max(1, round(spec.mouthThickness * H));
    const mx = round(W / 2) + round(shiftX / 2), my = round(spec.mouthY * H);
    let kind: FaceSpec["mouth"] | "frown" = spec.mouth;
    if (state.mood === "happy") kind = "smile";
    else if (state.mood === "sad") kind = "frown";
    else if (state.mood === "surprised") kind = "open";
    const talk = clamp(state.talk, 0, 1);
    if (talk > 0.05 && kind !== "open") kind = "open";

    if (kind === "line") {
      ops.push({ op: "roundRect", x: mx - round(mw / 2), y: my - round(t / 2), w: mw, h: t, r: round(t / 2), color: fg });
    } else if (kind === "open") {
      const open = state.mood === "surprised" ? Math.max(talk, 0.6) : talk;
      const rx = state.mood === "surprised" ? Math.max(2, round(mw * 0.22)) : Math.max(2, round(mw / 2));
      const ry = Math.max(1, round(t / 2 + open * H * 0.07));
      ops.push({ op: "ellipse", cx: mx, cy: my, rx, ry, color: fg });
    } else {
      // smile / frown: a thick arc = big ellipse minus a shifted ellipse, top (or bottom) half hidden
      const rx = round(mw / 2), ry = Math.max(t + 1, round(H * 0.06));
      const down = kind === "smile" ? 1 : -1;
      ops.push({ op: "ellipse", cx: mx, cy: my, rx, ry, color: fg });
      ops.push({ op: "ellipse", cx: mx, cy: my - down * t, rx: Math.max(1, rx - t), ry, color: bg });
      if (down > 0) ops.push({ op: "rect", x: mx - rx - 1, y: my - ry - t - 1, w: 2 * rx + 3, h: ry + t + 1, color: bg });
      else ops.push({ op: "rect", x: mx - rx - 1, y: my + 1, w: 2 * rx + 3, h: ry + t + 2, color: bg });
    }
  }
  return ops;
}

// --- rasterizer ----------------------------------------------------------------------

function rgb(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Draws the operations into an RGBA image of the display's size. Monochrome displays come
 * out pure black and white; round displays are masked to their circle.
 */
export function rasterize(ops: DrawOp[], display: Pick<DisplaySpec, "width" | "height" | "color" | "round">): Uint8ClampedArray<ArrayBuffer> {
  const W = display.width, H = display.height;
  const px = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  };
  const span = (y: number, x0: number, x1: number, c: [number, number, number]) => {
    if (y < 0 || y >= H) return;
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) put(x, y, c);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, c: [number, number, number]) => {
    // Pixel centres inside the ellipse with radii grown by half a pixel: smooth outlines
    // without single-pixel spikes at the top and bottom.
    const ax = rx + 0.5, ay = ry + 0.5;
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.floor(ax * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ay * ay))) + 1e-9);
      span(cy + dy, cx - Math.min(half, rx), cx + Math.min(half, rx), c);
    }
  };
  for (const o of ops) {
    const c = rgb(o.color);
    switch (o.op) {
      case "fill":
        for (let y = 0; y < H; y++) span(y, 0, W - 1, c);
        break;
      case "rect":
        for (let y = o.y; y < o.y + o.h; y++) span(y, o.x, o.x + o.w - 1, c);
        break;
      case "roundRect": {
        const r = Math.max(0, Math.min(o.r, Math.floor(Math.min(o.w, o.h) / 2)));
        for (let y = o.y; y < o.y + o.h; y++) {
          const dy = y < o.y + r ? o.y + r - y - 0.5 : y > o.y + o.h - 1 - r ? y - (o.y + o.h - 1 - r) - 0.5 : 0;
          const inset = dy > 0 ? Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy)) - 0.5) : 0;
          span(y, o.x + Math.max(0, inset), o.x + o.w - 1 - Math.max(0, inset), c);
        }
        break;
      }
      case "circle":
        ellipse(o.cx, o.cy, o.r, o.r, c);
        break;
      case "ellipse":
        ellipse(o.cx, o.cy, o.rx, o.ry, c);
        break;
      case "triangle": {
        const ys = [o.y0, o.y1, o.y2];
        const pts: [number, number][] = [[o.x0, o.y0], [o.x1, o.y1], [o.x2, o.y2]];
        for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
          const xs: number[] = [];
          for (let i = 0; i < 3; i++) {
            const [ax, ay] = pts[i]!, [bx, by] = pts[(i + 1) % 3]!;
            if (ay === by) { if (y === ay) xs.push(ax, bx); continue; }
            if (y < Math.min(ay, by) || y > Math.max(ay, by)) continue;
            xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
          }
          if (xs.length) span(y, Math.round(Math.min(...xs)), Math.round(Math.max(...xs)), c);
        }
        break;
      }
    }
  }
  if (display.color === "mono") {
    for (let i = 0; i < px.length; i += 4) {
      const on = px[i]! * 0.3 + px[i + 1]! * 0.59 + px[i + 2]! * 0.11 > 127 ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = on;
    }
  }
  if (display.round) {
    const r = Math.min(W, H) / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if ((x + 0.5 - W / 2) ** 2 + (y + 0.5 - H / 2) ** 2 > r * r) {
        const i = (y * W + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
  }
  return px;
}

/** A face design saved in the project. */
export const ScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  display: z.string().min(1).max(60),
  face: FaceSpecSchema,
  /** Timeline animations (Phase 8b). Missing in files made before 8b. */
  animations: z.array(AnimationSchema).max(50).optional(),
});
export type Screen = z.infer<typeof ScreenSchema>;
