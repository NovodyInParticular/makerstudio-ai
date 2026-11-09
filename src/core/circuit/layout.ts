// Where each part's pins are on the wiring canvas (grid units = 0.1 inch, drawn at 10 px).
// Small parts use real lead spacing so they plug into breadboard holes (1 unit = 0.1 inch).

import { componentDef, railColumns, type ComponentDef } from "./catalog";
import type { CircuitComponent } from "./schema";

export interface PinSpot { id: string; x: number; y: number; side: "left" | "right" | "top" | "bottom" }
export interface PartLayout { w: number; h: number; pins: PinSpot[] }

const PITCH = 2; // grid units between neighbouring pins

function boardLayout(def: ComponentDef): PartLayout {
  const ids = def.pins.map((p) => p.id);
  let left: string[], right: string[];
  if (def.id === "raspberry-pi-pico") {
    // Physical order: pins 1-20 down the left, 21-40 up the right.
    left = ids.slice(0, 20);
    right = ids.slice(20).reverse();
  } else if (def.id === "m5stack-cores3") {
    left = ids;
    right = [];
  } else if (def.id === "xiao-esp32s3-sense") {
    left = ids.slice(0, 7);
    right = ids.slice(7);
  } else if (def.id === "esp32-s3-devkitc-1") {
    left = ids.slice(0, 22); // J1
    right = ids.slice(22); // J3
  } else {
    // UNO: power + analog header on the left, digital header on the right.
    const split = ids.indexOf("D0");
    left = ids.slice(0, split);
    right = ids.slice(split);
  }
  const rows = Math.max(left.length, right.length);
  const w = 16, h = rows * PITCH + 2;
  return {
    w, h,
    pins: [
      ...left.map((id, i) => ({ id, x: 0, y: 2 + i * PITCH, side: "left" as const })),
      ...right.map((id, i) => ({ id, x: w, y: 2 + i * PITCH, side: "right" as const })),
    ],
  };
}

/** Breadboard hole rows (y) and the x of column 1. Widths/heights are even so rotation keeps holes on the grid. */
export const BB = { x0: 2, rails: { "T+": 1, "T-": 2, "B-": 17, "B+": 18 } as Record<string, number>, rows: "abcdefghij", rowY: (r: string) => ("abcdefghij".indexOf(r) < 5 ? 4 + "abcdefghij".indexOf(r) : 6 + "abcdefghij".indexOf(r)) };

function breadboardLayout(columns: number): PartLayout {
  const w = 2 * Math.ceil((columns + BB.x0 + 1) / 2), h = 20;
  const pins: PinSpot[] = [];
  const rails = railColumns(columns);
  for (const key of Object.keys(BB.rails)) rails.forEach((col, i) => pins.push({ id: `${key}${i + 1}`, x: BB.x0 + col - 1, y: BB.rails[key]!, side: "top" }));
  for (let col = 1; col <= columns; col++) for (const r of BB.rows) pins.push({ id: `${r}${col}`, x: BB.x0 + col - 1, y: BB.rowY(r), side: "top" });
  return { w, h, pins };
}

/** Lead spacing (0.1 inch steps) of two-legged parts. */
const SPAN: Record<string, number> = { "coreless-motor": 6, "lipo-1s": 8, resistor: 4, photoresistor: 2, led: 2, diode: 4, capacitor: 2, electrolytic: 2, button: 4, switch: 2, "tilt-switch": 2, buzzer: 4, battery: 8, "battery-aa": 8, "coin-cell": 6, speaker: 6, motor: 8, "vibration-motor": 6 };
/** Body size of modules whose pins sit along the bottom edge. */
const MODULE: Record<string, { w: number; h: number; pitch?: number }> = {
  "imu-mpu6050": { w: 16, h: 10 }, "tof-vl53l1x": { w: 12, h: 10 }, esc: { w: 16, h: 10 }, "brushless-motor": { w: 8, h: 10 }, npn: { w: 6, h: 4 }, pnp: { w: 6, h: 4 }, mosfet: { w: 6, h: 6 }, potentiometer: { w: 6, h: 6 }, tmp36: { w: 6, h: 4 },
  "rgb-led": { w: 8, h: 6 }, servo: { w: 14, h: 8 }, "oled-i2c": { w: 10, h: 10 }, "seven-segment": { w: 18, h: 12 },
  "neopixel-ring": { w: 12, h: 12 }, "lcd-i2c": { w: 26, h: 12 }, ultrasonic: { w: 18, h: 10 }, pir: { w: 12, h: 12 },
  dht11: { w: 8, h: 10 }, "soil-moisture": { w: 8, h: 16 }, "ir-receiver": { w: 6, h: 6 }, "gas-sensor": { w: 10, h: 10 },
  joystick: { w: 12, h: 12 }, "tft-ili9341": { w: 30, h: 22 }, "sd-module": { w: 14, h: 12 }, "i2s-amp": { w: 18, h: 10 }, keypad: { w: 18, h: 20 }, relay: { w: 14, h: 10 }, "motor-driver": { w: 28, h: 14 },
};

export function partLayout(type: string): PartLayout {
  const def = componentDef(type);
  if (!def) return { w: 6, h: 4, pins: [] };
  if (def.electrical.kind === "board") return boardLayout(def);
  if (def.electrical.kind === "breadboard") return breadboardLayout(def.electrical.columns);
  const n = def.pins.length;
  if (n === 2) {
    const span = SPAN[type] ?? 8;
    return { w: span, h: 4, pins: [{ id: def.pins[0]!.id, x: 0, y: 2, side: "left" }, { id: def.pins[1]!.id, x: span, y: 2, side: "right" }] };
  }
  // Several pins: a row along the bottom edge, 0.2 inch apart (fits every other breadboard hole).
  const m = MODULE[type] ?? { w: 10, h: 8 };
  const w = Math.max(m.w, 2 * n), h = m.h;
  const start = (w - 2 * n) / 2 + 1;
  return { w, h, pins: def.pins.map((p, i) => ({ id: p.id, x: start + i * PITCH, y: h, side: "bottom" as const })) };
}

const turn = (side: PinSpot["side"], quarter: number): PinSpot["side"] => {
  const order: PinSpot["side"][] = ["top", "right", "bottom", "left"];
  return order[(order.indexOf(side) + quarter) % 4]!;
};

/** Pin positions on the canvas for a placed part (rotation about the part's top-left corner area). */
export function placedPins(c: CircuitComponent): (PinSpot & { cx: number; cy: number })[] {
  const L = partLayout(c.type);
  const q = c.rotation / 90;
  return L.pins.map((p) => {
    // rotate around the part centre, then place
    const dx = p.x - L.w / 2, dy = p.y - L.h / 2;
    const [rx, ry] = q === 0 ? [dx, dy] : q === 1 ? [-dy, dx] : q === 2 ? [-dx, -dy] : [dy, -dx];
    return { ...p, side: turn(p.side, q), cx: c.x + L.w / 2 + rx, cy: c.y + L.h / 2 + ry };
  });
}

/** An orthogonal route between two pin positions: out from the pins, then across. */
export function wireRoute(a: { cx: number; cy: number; side: PinSpot["side"] }, b: { cx: number; cy: number; side: PinSpot["side"] }): [number, number][] {
  const out = (p: typeof a, d = 1.5): [number, number] => [p.cx + (p.side === "left" ? -d : p.side === "right" ? d : 0), p.cy + (p.side === "top" ? -d : p.side === "bottom" ? d : 0)];
  const a1 = out(a), b1 = out(b);
  // Heading back past the pin it leaves from (e.g. a right-side pin going to something on the
  // left) would run through its own part: drop below both pins first, then go across.
  const backwards = (a.side === "right" && b1[0] < a1[0]) || (a.side === "left" && b1[0] > a1[0]);
  if (backwards) {
    const lane = Math.round(Math.max(a.cy, b.cy)) + 2.5; // half a grid step: never on a pin row
    return [[a.cx, a.cy], a1, [a1[0], lane], [b1[0], lane], b1, [b.cx, b.cy]];
  }
  const mid: [number, number] = [Math.floor((a1[0] + b1[0]) / 2) + 0.5, a1[1]]; // between pin columns
  return [[a.cx, a.cy], a1, mid, [mid[0], b1[1]], b1, [b.cx, b.cy]];
}
