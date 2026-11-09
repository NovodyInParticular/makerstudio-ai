// Realistic look of a small display panel, drawn over the exact face pixels:
// OLED = separate glowing dots on true black (in the panel's colour), TFT/IPS = red/green/blue
// subpixel stripes with a backlight-grey black and a little bloom. Glass glare on top.
// Built from a few full-canvas compositing steps (no per-pixel loops at screen size), so it
// keeps up with the face animations.

import type { DisplaySpec } from "../../core/display/catalog";

export type OledTint = "white" | "blue" | "yellow-blue";
export const OLED_TINTS: { id: OledTint; label: string }[] = [
  { id: "white", label: "White" },
  { id: "blue", label: "Blue" },
  { id: "yellow-blue", label: "Yellow + blue (top 16 rows yellow)" },
];

const TINT_RGB: Record<"white" | "blue" | "yellow", [number, number, number]> = { white: [232, 244, 255], blue: [92, 196, 255], yellow: [255, 214, 64] };

const masks = new Map<string, HTMLCanvasElement>();
/** One pixel's worth of mask (zoom × zoom): what part of a pixel cell emits light. */
function cellMask(kind: "oled" | "tft", zoom: number): HTMLCanvasElement {
  const key = `${kind}-${zoom}`;
  const hit = masks.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = zoom;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, zoom, zoom);
  if (kind === "oled") {
    // A rounded dot with a dark gap around it.
    const gap = Math.max(1, zoom * 0.14), r = (zoom - 2 * gap) * 0.3;
    g.fillStyle = "#fff";
    g.beginPath();
    g.roundRect(gap, gap, zoom - 2 * gap, zoom - 2 * gap, r);
    g.fill();
  } else if (zoom >= 6) {
    // R, G, B vertical stripes with a thin dark line between rows.
    const sub = zoom / 3, row = Math.max(1, Math.round(zoom * 0.08));
    (["#f00", "#0f0", "#00f"] as const).forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(i * sub + (i ? 0.5 : 0), 0, sub - 0.5, zoom - row);
    });
  } else {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, zoom, zoom - (zoom >= 3 ? 1 : 0));
  }
  masks.set(key, c);
  return c;
}

/** Turns the face pixels into what the panel would emit (mono OLEDs light up in their colour). */
function emitted(px: Uint8ClampedArray, display: DisplaySpec, tint: OledTint): ImageData {
  const out = new Uint8ClampedArray(px);
  if (display.color === "mono") {
    for (let i = 0, y = 0, n = 0; i < out.length; i += 4, n++) {
      if (n % display.width === 0 && n) y++;
      const on = out[i]! * 0.3 + out[i + 1]! * 0.59 + out[i + 2]! * 0.11 > 96;
      const col = tint === "yellow-blue" ? (y < 16 ? TINT_RGB.yellow : TINT_RGB.blue) : TINT_RGB[tint];
      out[i] = on ? col[0] : 0; out[i + 1] = on ? col[1] : 0; out[i + 2] = on ? col[2] : 0; out[i + 3] = 255;
    }
  }
  return new ImageData(out, display.width, display.height);
}

/** Draws the realistic panel onto ctx (size width*zoom × height*zoom). */
export function drawPanel(ctx: CanvasRenderingContext2D, px: Uint8ClampedArray, display: DisplaySpec, zoom: number, tint: OledTint) {
  const W = display.width * zoom, H = display.height * zoom;
  const oled = display.color === "mono";
  const native = new OffscreenCanvas(display.width, display.height);
  native.getContext("2d")!.putImageData(emitted(px, display, tint), 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  // 1. The pixels, sharp.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(native, 0, 0, W, H);
  // 2. Only the lit part of each pixel cell emits light.
  if (zoom >= 3) {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = ctx.createPattern(cellMask(oled ? "oled" : "tft", zoom), "repeat")!;
    ctx.fillRect(0, 0, W, H);
  }
  // 3. Bloom: the same image, smoothly upscaled, added on top.
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = oled ? 0.32 : 0.16;
  ctx.drawImage(native, 0, 0, W, H);
  // 4. TFT/IPS: the backlight makes black a dark grey, brighter towards the middle.
  if (!oled) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(22,26,32,1)");
    g.addColorStop(1, "rgba(10,12,16,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // 5. Glass: a soft diagonal glare and a highlight along the top edge.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  const glare = ctx.createLinearGradient(0, 0, W, H);
  glare.addColorStop(0, "rgba(255,255,255,0.10)");
  glare.addColorStop(0.35, "rgba(255,255,255,0.025)");
  glare.addColorStop(0.36, "rgba(255,255,255,0)");
  glare.addColorStop(1, "rgba(255,255,255,0.03)");
  ctx.fillStyle = glare;
  ctx.fillRect(0, 0, W, H);
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.06);
  top.addColorStop(0, "rgba(255,255,255,0.08)");
  top.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.06);
  ctx.restore();
}
