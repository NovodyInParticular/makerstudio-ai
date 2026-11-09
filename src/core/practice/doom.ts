// The Doom handheld: retro-go (GPL-2.0) on an ESP32-S3-DevKitC-1, wired exactly like retro-go's
// own target `components/retro-go/targets/esp32-s3-devkit/config.h` (read 2026-11-08, release 1.46),
// so its prebuilt firmware image runs without changes.

import { componentDef } from "../circuit/catalog";
import { buildNetlist, pinKey } from "../circuit/checks";
import type { CircuitComponent, Wire } from "../circuit/schema";

export const RETRO_GO = {
  repo: "ducalex/retro-go",
  release: "1.46",
  image: "retro-go_1.46_esp32-s3-devkit.img",
  config: "components/retro-go/targets/esp32-s3-devkit/config.h",
};

/** The pins retro-go's esp32-s3-devkit target uses (from its config.h). */
export const DOOM_PINS = {
  lcd: { MOSI: 12, CLK: 48, DC: 47, BCKL: 39, RST: 3, CS: "not used (tie the screen's CS to GND)" },
  sd: { MISO: 9, MOSI: 11, CLK: 13, CS: 10 },
  i2s: { BCK: 41, WS: 42, DATA: 40 },
  buttons: { A: 15, B: 5, START: 17, SELECT: 16, MENU: 18, OPTION: 8 },
  /** D-pad on two analog pins: ADC1 channel 5 = GPIO6 (up high / down middle), channel 6 = GPIO7 (left high / right middle). */
  dpad: { upDown: 6, leftRight: 7 },
};

const RED = "#ff5d73", GREY = "#8b97a5", SIG = ["#f2b84b", "#22b8c9", "#8f7cf0", "#2fd6a3"];

export function doomCircuit(newId: () => string): { components: CircuitComponent[]; wires: Wire[] } {
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  const part = (type: string, label: string, x: number, y: number, props: CircuitComponent["props"] = {}, rotation: CircuitComponent["rotation"] = 0) => {
    const def = componentDef(type)!;
    const c: CircuitComponent = { id: newId(), type, label, x, y, rotation, props: { ...Object.fromEntries(def.props.map((p) => [p.key, p.default])), ...props } };
    components.push(c);
    return c;
  };
  let n = 0;
  const wire = (a: CircuitComponent, ap: string, b: CircuitComponent, bp: string, color?: string) =>
    wires.push({ id: newId(), from: { component: a.id, pin: ap }, to: { component: b.id, pin: bp }, color: color ?? SIG[n++ % SIG.length]! });
  const g = (n: number) => `GPIO${n}`;

  const s3 = part("esp32-s3-devkitc-1", "ESP32-S3 (N16R8)", 0, 0);
  // Screen
  const tft = part("tft-ili9341", "Screen", 30, -2);
  wire(s3, "3V3", tft, "VCC", RED); wire(s3, "GND", tft, "GND", GREY); wire(s3, "GND", tft, "CS", GREY);
  wire(s3, g(DOOM_PINS.lcd.RST), tft, "RESET"); wire(s3, g(DOOM_PINS.lcd.DC), tft, "DC");
  wire(s3, g(DOOM_PINS.lcd.MOSI), tft, "SDI"); wire(s3, g(DOOM_PINS.lcd.CLK), tft, "SCK"); wire(s3, g(DOOM_PINS.lcd.BCKL), tft, "LED");
  // microSD (own SPI bus)
  const sd = part("sd-module", "microSD", 30, 26);
  wire(s3, "3V3_2", sd, "3V3", RED); wire(s3, "GND_2", sd, "GND", GREY);
  wire(s3, g(DOOM_PINS.sd.CS), sd, "CS"); wire(s3, g(DOOM_PINS.sd.MOSI), sd, "MOSI"); wire(s3, g(DOOM_PINS.sd.CLK), sd, "CLK"); wire(s3, g(DOOM_PINS.sd.MISO), sd, "MISO");
  // Sound
  const amp = part("i2s-amp", "Amplifier", 50, 26);
  const spk = part("speaker", "Speaker", 56, 42);
  wire(s3, "5V", amp, "VIN", RED); wire(s3, "GND_3", amp, "GND", GREY);
  wire(s3, g(DOOM_PINS.i2s.BCK), amp, "BCLK"); wire(s3, g(DOOM_PINS.i2s.WS), amp, "LRC"); wire(s3, g(DOOM_PINS.i2s.DATA), amp, "DIN");
  wire(amp, "SPK+", spk, "+", RED); wire(amp, "SPK-", spk, "-", GREY);
  // Buttons: GPIO with the chip's pull-up; pressing connects the pin to GND (retro-go: .pullup = 1, .level = 0).
  Object.entries(DOOM_PINS.buttons).forEach(([name, pin], i) => {
    const b = part("button", `${name[0]}${name.slice(1).toLowerCase()} button`, -26, 2 + i * 6);
    wire(s3, g(pin), b, "2"); wire(b, "1", s3, "GND_4", GREY);
  });
  // D-pad: one analog pin per axis with a 10 kΩ pull-down. The "high" direction connects the pin
  // straight to 3V3 (reads 3072-4095), the "middle" one through 10 kΩ (about 1.65 V, reads 1024-3071).
  ([["Up", "Down", DOOM_PINS.dpad.upDown], ["Left", "Right", DOOM_PINS.dpad.leftRight]] as const).forEach(([high, mid, pin], i) => {
    const y = 42 + i * 14;
    const pull = part("resistor", `${high}/${mid} pull-down`, -14, y, { ohms: 10000 });
    wire(s3, g(pin), pull, "1"); wire(pull, "2", s3, "GND_4", GREY);
    const bh = part("button", `${high} button`, -26, y + 4);
    wire(s3, "3V3", bh, "1", RED); wire(bh, "2", s3, g(pin));
    const r = part("resistor", `${mid} 10k`, -40, y + 8, { ohms: 10000 });
    const bm = part("button", `${mid} button`, -26, y + 8);
    wire(s3, "3V3", r, "1", RED); wire(r, "2", bm, "1"); wire(bm, "2", s3, g(pin));
  });
  return { components, wires };
}

// --- does a circuit match the handheld? (what works in the preview) -----------------------------

export type DoomButton = "up" | "down" | "left" | "right" | "A" | "B" | "START" | "SELECT" | "MENU" | "OPTION";
export interface DoomWiring {
  board: boolean;
  screen: boolean;
  sd: boolean;
  sound: boolean;
  buttons: Record<DoomButton, boolean>;
  problems: string[];
}

export function doomWiring(components: CircuitComponent[], wires: Wire[]): DoomWiring {
  const nets = buildNetlist(components, wires);
  const empty = { up: false, down: false, left: false, right: false, A: false, B: false, START: false, SELECT: false, MENU: false, OPTION: false };
  const board = components.find((c) => c.type === "esp32-s3-devkitc-1");
  if (!board) return { board: false, screen: false, sd: false, sound: false, buttons: empty, problems: ["No ESP32-S3-DevKitC-1 in the circuit."] };
  const at = (c: CircuitComponent, pin: string) => nets.find(pinKey(c.id, pin));
  const gpio = (n: number) => at(board, `GPIO${n}`);
  const gnd = at(board, "GND");
  const v33 = new Set([at(board, "3V3"), at(board, "3V3_2")]);
  const problems: string[] = [];
  const need = (label: string, ok: boolean) => { if (!ok) problems.push(label); return ok; };

  const tfts = components.filter((c) => c.type === "tft-ili9341");
  const screen = need("Screen: wire SDI→GPIO12, SCK→GPIO48, DC→GPIO47, RESET→GPIO3, LED→GPIO39, CS→GND, VCC→3V3, GND→GND (retro-go's pins).",
    tfts.some((t) => at(t, "SDI") === gpio(12) && at(t, "SCK") === gpio(48) && at(t, "DC") === gpio(47) && at(t, "RESET") === gpio(3) && at(t, "LED") === gpio(39) && at(t, "CS") === gnd && at(t, "GND") === gnd && v33.has(at(t, "VCC"))));
  const sd = need("microSD: wire MISO→GPIO9, MOSI→GPIO11, CLK→GPIO13, CS→GPIO10, 3V3, GND (the game files are on the card).",
    components.some((c) => c.type === "sd-module" && at(c, "MISO") === gpio(9) && at(c, "MOSI") === gpio(11) && at(c, "CLK") === gpio(13) && at(c, "CS") === gpio(10) && v33.has(at(c, "3V3")) && at(c, "GND") === gnd));
  const sound = components.some((c) => c.type === "i2s-amp" && at(c, "BCLK") === gpio(41) && at(c, "LRC") === gpio(42) && at(c, "DIN") === gpio(40));
  const buttonsList = components.filter((c) => c.type === "button");
  const resistors = components.filter((c) => c.type === "resistor");
  const between = (c: CircuitComponent, a: string | undefined, b: string | undefined) => { const x = at(c, "1"), y = at(c, "2"); return (x === a && y === b) || (x === b && y === a); };
  const buttons = { ...empty };
  for (const [name, pin] of Object.entries(DOOM_PINS.buttons)) buttons[name as DoomButton] = buttonsList.some((b) => between(b, gpio(pin), gnd));
  // D-pad axis: pull-down on the pin, the "high" button straight to 3V3, the "middle" one through a resistor to 3V3.
  const axis = (pin: number): [boolean, boolean] => {
    const p = gpio(pin);
    if (!resistors.some((r) => between(r, p, gnd))) return [false, false];
    const high = buttonsList.some((b) => [...v33].some((v) => between(b, p, v)));
    const mid = buttonsList.some((b) => { const other = at(b, "1") === p ? at(b, "2") : at(b, "2") === p ? at(b, "1") : undefined; return other !== undefined && other !== p && resistors.some((r) => [...v33].some((v) => between(r, other, v))); });
    return [high, mid];
  };
  [buttons.up, buttons.down] = axis(DOOM_PINS.dpad.upDown);
  [buttons.left, buttons.right] = axis(DOOM_PINS.dpad.leftRight);
  for (const [k, ok] of Object.entries(buttons)) if (!ok) problems.push(`${k} button is not wired like retro-go's (it will not work).`);
  return { board: true, screen, sd, sound, buttons, problems };
}
