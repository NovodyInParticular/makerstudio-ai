// Electrical checks for circuits (see SAFETY_REQUIREMENTS.md).
//
// 1. Netlist: which pins are joined (wires, plus the pins a board connects inside itself).
// 2. DC solver: node voltages from batteries and board supply pins (each with a small internal
//    resistance), resistors, LEDs and diodes (switched on/off until consistent), closed
//    switches. Capacitors, motors, servos and modules draw no current in this estimate.
// 3. Two scenarios: GPIO pins as inputs (nothing driven), and GPIO pins driven HIGH (as outputs).
// 4. Rules produce findings. The checks cannot certify a design: the best result says
//    "no problems detected", never "safe".

import { placedPins } from "./layout";
import { componentDef, LED_MAX_CURRENT, LED_VF, LOAD_PEAK, type ComponentDef, type PinDef, type Spec } from "./catalog";
import type { CircuitComponent, Wire } from "./schema";

export type Severity = "danger" | "warning" | "info";

export interface Finding {
  severity: Severity;
  rule: string;
  /** What is wrong, in plain words, naming the parts. */
  message: string;
  /** What to do about it. */
  fix: string;
  components: string[];
}

export interface CheckReport {
  findings: Finding[];
  checksRun: number;
  summary: string;
}

// --- netlist ---------------------------------------------------------------------------------

export const pinKey = (component: string, pin: string) => `${component}:${pin}`;

export class Netlist {
  private parent = new Map<string, string>();
  find(k: string): string {
    let p = this.parent.get(k) ?? k;
    if (p !== k) { p = this.find(p); this.parent.set(k, p); }
    return p;
  }
  join(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export const isBreadboard = (type: string) => componentDef(type)?.electrical.kind === "breadboard";

/** Pins of other parts that sit exactly in a breadboard hole: [part pin, breadboard pin]. */
export function pluggedPins(components: CircuitComponent[]): { component: string; pin: string; board: string; hole: string }[] {
  const out: { component: string; pin: string; board: string; hole: string }[] = [];
  const boards = components.filter((c) => isBreadboard(c.type));
  if (!boards.length) return out;
  const holes = new Map<string, { board: string; hole: string }>();
  for (const b of boards) for (const p of placedPins(b)) holes.set(`${Math.round(p.cx * 2)},${Math.round(p.cy * 2)}`, { board: b.id, hole: p.id });
  for (const c of components) {
    if (isBreadboard(c.type)) continue;
    for (const p of placedPins(c)) {
      const h = holes.get(`${Math.round(p.cx * 2)},${Math.round(p.cy * 2)}`);
      if (h && Math.abs(p.cx * 2 - Math.round(p.cx * 2)) < 1e-6 && Math.abs(p.cy * 2 - Math.round(p.cy * 2)) < 1e-6) out.push({ component: c.id, pin: p.id, board: h.board, hole: h.hole });
    }
  }
  return out;
}

export function buildNetlist(components: CircuitComponent[], wires: Wire[]): Netlist {
  const n = new Netlist();
  for (const c of components) {
    const def = componentDef(c.type);
    if (def?.electrical.kind === "board") {
      const [first, ...rest] = def.electrical.internalGround;
      for (const g of rest) n.join(pinKey(c.id, first!), pinKey(c.id, g));
    }
    if (def?.electrical.kind === "breadboard") {
      for (const strip of def.electrical.strips) for (const h of strip.slice(1)) n.join(pinKey(c.id, strip[0]!), pinKey(c.id, h));
    }
  }
  for (const p of pluggedPins(components)) n.join(pinKey(p.component, p.pin), pinKey(p.board, p.hole));
  for (const w of wires) n.join(pinKey(w.from.component, w.from.pin), pinKey(w.to.component, w.to.pin));
  return n;
}

// --- solver ----------------------------------------------------------------------------------

const R_BATTERY = 0.1;  // Ω, internal resistance used to find shorts (estimate)
const R_BOARD = 0.5;    // Ω, board supply pins
const R_GPIO = 25;      // Ω, a GPIO driven HIGH (estimate)
const R_LED = 10;       // Ω, LED/diode resistance once conducting
const G_LEAK = 1e-9;    // S, keeps floating parts solvable
const G_CLOSED = 1e4;   // S, a closed switch

interface Element { a: string; b: string; g: number; /** current source pushing from b to a, A */ i: number }

interface Diode { id: string; a: string; k: string; vf: number; on: boolean }

interface Source { component: string; pin: string; plus: string; minus: string; volts: number; r: number; label: string }

interface Solution { v: Map<string, number>; diodeCurrent: Map<string, number>; sourceCurrent: (s: Source) => number }

function solve(nodes: string[], elements: Element[], sources: Source[], diodes: Diode[]): Solution {
  const index = new Map(nodes.map((n, i) => [n, i]));
  const size = nodes.length;
  const run = () => {
    const G = Array.from({ length: size }, () => new Float64Array(size));
    const I = new Float64Array(size);
    const stamp = (a: string, b: string, g: number, i: number) => {
      const ia = index.get(a)!, ib = index.get(b)!;
      G[ia]![ia]! += g; G[ib]![ib]! += g; G[ia]![ib]! -= g; G[ib]![ia]! -= g;
      I[ia]! += i; I[ib]! -= i;
    };
    for (let k = 0; k < size; k++) G[k]![k]! += G_LEAK;
    for (const e of elements) stamp(e.a, e.b, e.g, e.i);
    for (const s of sources) stamp(s.plus, s.minus, 1 / s.r, s.volts / s.r);
    for (const d of diodes) {
      if (d.on) stamp(d.a, d.k, 1 / R_LED, d.vf / R_LED);
      else stamp(d.a, d.k, G_LEAK, 0);
    }
    // Gaussian elimination with partial pivoting
    for (let c = 0; c < size; c++) {
      let p = c;
      for (let r = c + 1; r < size; r++) if (Math.abs(G[r]![c]!) > Math.abs(G[p]![c]!)) p = r;
      [G[c], G[p]] = [G[p]!, G[c]!];
      [I[c], I[p]] = [I[p]!, I[c]!];
      const d = G[c]![c]!;
      if (Math.abs(d) < 1e-30) continue;
      for (let r = c + 1; r < size; r++) {
        const f = G[r]![c]! / d;
        if (f === 0) continue;
        for (let k = c; k < size; k++) G[r]![k]! -= f * G[c]![k]!;
        I[r]! -= f * I[c]!;
      }
    }
    const x = new Float64Array(size);
    for (let r = size - 1; r >= 0; r--) {
      let s = I[r]!;
      for (let k = r + 1; k < size; k++) s -= G[r]![k]! * x[k]!;
      x[r] = Math.abs(G[r]![r]!) < 1e-30 ? 0 : s / G[r]![r]!;
    }
    return new Map(nodes.map((n, i) => [n, x[i]!]));
  };
  let v = run();
  for (let iter = 0; iter < 30; iter++) {
    let changed = false;
    for (const d of diodes) {
      const vd = v.get(d.a)! - v.get(d.k)!;
      const current = d.on ? (vd - d.vf) / R_LED : 0;
      if (d.on && current < 0) { d.on = false; changed = true; }
      else if (!d.on && vd > d.vf) { d.on = true; changed = true; }
    }
    if (!changed) break;
    v = run();
  }
  const diodeCurrent = new Map(diodes.map((d) => [d.id, d.on ? Math.max(0, (v.get(d.a)! - v.get(d.k)! - d.vf) / R_LED) : 0]));
  return { v, diodeCurrent, sourceCurrent: (s) => (s.volts - (v.get(s.plus)! - v.get(s.minus)!)) / s.r };
}

// --- the checks ------------------------------------------------------------------------------

const fmtV = (v: number) => `${Math.round(v * 100) / 100} V`;
const fmtI = (a: number) => (Math.abs(a) >= 1 ? `${Math.round(a * 10) / 10} A` : `${Math.round(a * 1000)} mA`);
const label = (c: CircuitComponent) => `"${c.label}"`;
const pinName = (def: ComponentDef, pin: string) => def.pins.find((p) => p.id === pin)?.name ?? pin;

/** Standard E12 resistor values (10-82 per decade). */
const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export function nextStandardResistor(ohms: number): number {
  for (let decade = 1; decade <= 1e6; decade *= 10) for (const v of E12) if (v * decade >= ohms) return v * decade;
  return ohms;
}

/**
 * @param knownInputs pins ("partId:pinId") that running code has set as inputs: the
 *   "if it is used as an output" rules do not apply to them.
 */
export function checkCircuit(components: CircuitComponent[], wires: Wire[], knownInputs: ReadonlySet<string> = new Set()): CheckReport {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const netlist = buildNetlist(components, wires);
  const net = (c: string, p: string) => netlist.find(pinKey(c, p));
  const defs = new Map(components.map((c) => [c.id, componentDef(c.type)]));
  let checksRun = 0;

  // Everything the solver needs.
  const nodeSet = new Set<string>();
  // Breadboard holes are only connections: they count through the parts plugged or wired into them.
  const counted = components.filter((c) => !isBreadboard(c.type));
  for (const c of counted) for (const p of defs.get(c.id)?.pins ?? []) nodeSet.add(net(c.id, p.id));
  const nodes = [...nodeSet];
  if (nodes.length === 0) return { findings, checksRun: 0, summary: "Nothing to check yet." };
  // How many pins share each net: a net with one pin has nothing attached (its voltage means nothing).
  const pinsOnNet = new Map<string, number>();
  for (const c of counted) for (const p of defs.get(c.id)?.pins ?? []) { const k = net(c.id, p.id); pinsOnNet.set(k, (pinsOnNet.get(k) ?? 0) + 1); }
  // A wire from a pin to an otherwise empty breadboard strip does not attach it to anything.
  const attached = (node: string) => (pinsOnNet.get(node) ?? 0) > 1;

  const elements: Element[] = [];
  const baseSources: Source[] = [];
  const gpios: { c: CircuitComponent; def: ComponentDef; pin: PinDef; logic: Spec; maxCurrent: Spec; gnd: string }[] = [];
  const diodesFor = (): Diode[] => components.flatMap((c) => {
    const def = defs.get(c.id);
    if (def?.electrical.kind === "led") return [{ id: c.id, a: net(c.id, "A"), k: net(c.id, "K"), vf: (LED_VF[c.props.color as keyof typeof LED_VF] ?? LED_VF.red).value, on: false }];
    if (def?.electrical.kind === "diode") return [{ id: c.id, a: net(c.id, "A"), k: net(c.id, "K"), vf: 0.7, on: false }];
    if (def?.electrical.kind === "led-array") {
      const e = def.electrical;
      return e.channels.map((ch) => ({ id: `${c.id}:${ch.pin}`, a: net(c.id, ch.pin), k: net(c.id, e.common), vf: (LED_VF[ch.color as keyof typeof LED_VF] ?? LED_VF.red).value, on: false }));
    }
    return [];
  });

  for (const c of components) {
    const def = defs.get(c.id);
    if (!def) {
      add({ severity: "info", rule: "unknown-part", message: `${label(c)} is a part MakerStudio does not know, so it is not checked.`, fix: "Replace it with a part from the library.", components: [c.id] });
      continue;
    }
    switch (def.electrical.kind) {
      case "battery": {
        const volts = Number(c.props.volts ?? 9);
        baseSources.push({ component: c.id, pin: "+", plus: net(c.id, "+"), minus: net(c.id, "-"), volts, r: R_BATTERY, label: label(c) });
        break;
      }
      case "resistor": {
        const ohms = Math.max(0.01, Number(c.props.ohms ?? 220));
        elements.push({ a: net(c.id, "1"), b: net(c.id, "2"), g: 1 / ohms, i: 0 });
        break;
      }
      case "potentiometer": {
        const ohms = Math.max(1, Number(c.props.ohms ?? 10000));
        const pos = Math.min(1, Math.max(0, Number(c.props.position ?? 0.5)));
        elements.push({ a: net(c.id, "1"), b: net(c.id, "W"), g: 1 / Math.max(0.5, ohms * pos), i: 0 });
        elements.push({ a: net(c.id, "W"), b: net(c.id, "2"), g: 1 / Math.max(0.5, ohms * (1 - pos)), i: 0 });
        break;
      }
      case "switch":
        if (c.props.closed) elements.push({ a: net(c.id, "1"), b: net(c.id, "2"), g: G_CLOSED, i: 0 });
        break;
      case "board": {
        const gnd = net(c.id, def.electrical.internalGround[0]!);
        for (const p of def.pins) {
          if (p.role.kind === "supply") baseSources.push({ component: c.id, pin: p.id, plus: net(c.id, p.id), minus: gnd, volts: p.role.volts.value, r: R_BOARD, label: `${label(c)} ${p.name}` });
          if (p.role.kind === "gpio") gpios.push({ c, def, pin: p, logic: p.role.logic, maxCurrent: p.role.maxCurrent, gnd });
        }
        break;
      }
      default:
        break;
    }
  }

  // Nets whose voltage is set by a supply (through resistors, closed switches, diodes). Others float:
  // their computed voltage means nothing and they are treated as "not connected".
  const driven = new Netlist();
  for (const e of elements) driven.join(e.a, e.b);
  for (const s of baseSources) driven.join(s.plus, s.minus);
  for (const d of diodesFor()) driven.join(d.a, d.k);
  const suppliedGroups = new Set(baseSources.map((s) => driven.find(s.plus)));
  const determined = (node: string) => suppliedGroups.has(driven.find(node));

  const inputs = solve(nodes, elements, baseSources, diodesFor());
  // GPIOs driven HIGH: each as a source with its own output resistance.
  const gpioSources: Source[] = gpios.map((g) => ({ component: g.c.id, pin: g.pin.id, plus: net(g.c.id, g.pin.id), minus: g.gnd, volts: g.logic.value, r: R_GPIO, label: `${label(g.c)} ${g.pin.name}` }));
  const outputs = solve(nodes, elements, [...baseSources, ...gpioSources], diodesFor());

  // 1. Short circuits: a supply delivering a huge current means a path with almost no resistance.
  checksRun++;
  for (const s of baseSources) {
    const i = inputs.sourceCurrent(s);
    if (i > 3) {
      add({
        severity: "danger", rule: "short-circuit",
        message: `Short circuit: ${s.label} is connected to its own ground (or to another supply) through almost no resistance, so it would try to deliver about ${fmtI(i)}. That can melt wires, damage the board or the battery, or start a fire.`,
        fix: "Find the wire that joins + (or 5V / 3V3) to GND or to a different supply, and remove it.",
        components: [s.component],
      });
    }
  }
  const shorted = findings.some((f) => f.rule === "short-circuit");

  // 2. LEDs, diodes: direction and current.
  checksRun++;
  const ledChannels = components.flatMap((c) => {
    const def = defs.get(c.id);
    if (def?.electrical.kind === "led") return [{ c, id: c.id, a: "A", k: "K", color: String(c.props.color ?? "red"), name: "" }];
    if (def?.electrical.kind === "led-array") {
      const e = def.electrical;
      return e.channels.map((ch) => ({ c, id: `${c.id}:${ch.pin}`, a: ch.pin, k: e.common, color: ch.color, name: ` (${pinName(def, ch.pin)})` }));
    }
    return [];
  });
  for (const ch of ledChannels) {
    const c = ch.c;
    const a = net(c.id, ch.a), k = net(c.id, ch.k);
    if (!determined(a) || !determined(k)) continue;
    const reverse = Math.max(inputs.v.get(k)! - inputs.v.get(a)!, outputs.v.get(k)! - outputs.v.get(a)!);
    if (reverse > 1) {
      add({
        severity: reverse > 5 ? "danger" : "warning", rule: "led-reversed",
        message: `${label(c)}${ch.name} is the wrong way round: its cathode (short leg) is about ${fmtV(reverse)} higher than its anode, so it will not light${reverse > 5 ? ", and more than about 5 V backwards can damage a typical LED" : ""}.`,
        fix: "Turn the LED around: the long leg (anode, +) goes towards the positive side, the short leg (cathode, flat edge) towards GND.",
        components: [c.id],
      });
      continue;
    }
    if (shorted) continue;
    const current = Math.max(inputs.diodeCurrent.get(ch.id)!, outputs.diodeCurrent.get(ch.id)!);
    const vf = (LED_VF[ch.color as keyof typeof LED_VF] ?? LED_VF.red).value;
    if (current > LED_MAX_CURRENT.value) {
      // Resistor for about 10 mA from the highest supply in the circuit.
      const supply = Math.max(...baseSources.map((s) => s.volts), ...gpios.map((g) => g.logic.value));
      const suggest = nextStandardResistor(Math.max(10, (supply - vf) / 0.01));
      add({
        severity: current > 0.1 ? "danger" : "warning", rule: "led-current",
        message: `${label(c)}${ch.name} would carry about ${fmtI(current)}${current > 0.1 ? " (no current-limiting resistor?)" : ""}. A typical indicator LED is rated about 20 mA (typical value; check your LED), so it ${current > 0.1 ? "will burn out quickly and can damage the pin or supply driving it" : "will run hot and wear out"}.`,
        fix: `Add (or increase) a resistor in series with the LED: about ${suggest} Ω gives roughly 10 mA from ${fmtV(supply)}.`,
        components: [c.id],
      });
    }
  }

  // 3. Polarized capacitors.
  checksRun++;
  for (const c of components) {
    const def = defs.get(c.id);
    if (def?.electrical.kind !== "capacitor") continue;
    const p = net(c.id, def.electrical.polarized ? "+" : "1"), m = net(c.id, def.electrical.polarized ? "-" : "2");
    if (!determined(p) || !determined(m)) continue;
    const vMax = Math.max(Math.abs(inputs.v.get(p)! - inputs.v.get(m)!), Math.abs(outputs.v.get(p)! - outputs.v.get(m)!));
    if (def.electrical.polarized && Math.max(inputs.v.get(m)! - inputs.v.get(p)!, outputs.v.get(m)! - outputs.v.get(p)!) > 0.5) {
      add({ severity: "danger", rule: "capacitor-reversed", message: `${label(c)} (electrolytic) is the wrong way round. Reversed electrolytic capacitors can heat up, leak or burst.`, fix: "Turn it around: the leg by the stripe (−) goes to the lower voltage / GND.", components: [c.id] });
    }
    const rated = Number(c.props.ratedVolts ?? 50);
    if (vMax > rated) add({ severity: "danger", rule: "capacitor-voltage", message: `${label(c)} gets about ${fmtV(vMax)} but is rated ${fmtV(rated)}.`, fix: "Use a capacitor rated for at least 1.5 times the voltage it sees.", components: [c.id] });
  }

  // 4. GPIO voltage and current.
  checksRun += 2;
  for (const g of gpios) {
    const node = net(g.c.id, g.pin.id);
    if (!attached(node)) continue;
    const v = determined(node) ? inputs.v.get(node)! - inputs.v.get(g.gnd)! : 0;
    const limit = g.logic.value + 0.3;
    if (v > limit) {
      const clear = v > g.logic.value * 1.2;
      add({
        severity: clear ? "danger" : "info", rule: "gpio-overvoltage",
        message: clear
          ? `${label(g.c)} ${g.pin.name} gets about ${fmtV(v)}, but it is a ${fmtV(g.logic.value)} logic pin. That can permanently damage the pin or the whole chip.`
          : `${label(g.c)} ${g.pin.name} gets about ${fmtV(v)}, a little above its ${fmtV(g.logic.value)} logic level. Whether that is within the chip's limit depends on its datasheet (not checked here).`,
        fix: g.logic.value < 4 ? "Use a level shifter or a voltage divider (for example 1 kΩ / 2 kΩ) to bring 5 V signals down to 3.3 V, or power the part from 3.3 V." : "Keep signals into this pin between 0 V and its logic voltage.",
        components: [g.c.id],
      });
    } else if (v < -0.3) {
      add({ severity: "danger", rule: "gpio-negative", message: `${label(g.c)} ${g.pin.name} would be pulled about ${fmtV(-v)} below its GND. Pins must not go below 0 V.`, fix: "Check the battery polarity and which ground the signal uses.", components: [g.c.id] });
    }
    if (shorted) continue;
    if (knownInputs.has(pinKey(g.c.id, g.pin.id))) continue; // an input: nothing drives it
    // A pin joined directly (no resistor) to a supply or ground pin.
    const tiedTo = components.flatMap((c) => (defs.get(c.id)?.pins ?? [])
      .filter((p) => (p.role.kind === "supply" || p.role.kind === "ground" || (defs.get(c.id)?.electrical.kind === "battery")) && net(c.id, p.id) === node)
      .map((p) => `${label(c)} ${p.name}`))[0];
    if (tiedTo) {
      add({
        severity: "danger", rule: "gpio-tied",
        message: `${label(g.c)} ${g.pin.name} is wired directly to ${tiedTo}. If the program sets this pin as an output at the other level, it is a short circuit through the pin, which can destroy it.`,
        fix: "Do not wire a GPIO pin straight to a supply or GND; put a resistor in between (for a button, use the pin's pull-up or a 10 kΩ resistor).",
        components: [g.c.id],
      });
      continue;
    }
    const src = gpioSources.find((s) => s.component === g.c.id && s.pin === g.pin.id)!;
    const i = Math.abs(outputs.sourceCurrent(src));
    if (i > g.maxCurrent.value) {
      const status = g.maxCurrent.status === "estimated" ? " (typical value)" : "";
      add({
        severity: i > 2 * g.maxCurrent.value ? "warning" : g.maxCurrent.status === "estimated" ? "info" : "warning", rule: "gpio-current",
        message: `If ${label(g.c)} ${g.pin.name} is used as an output, about ${fmtI(i)} would flow through it, more than about ${fmtI(g.maxCurrent.value)}${status} per pin.`,
        fix: "Use a larger series resistor, or switch the load with a transistor.",
        components: [g.c.id],
      });
    }
  }

  // 5. Modules: supply range, power from GPIO, common ground with the signal source.
  checksRun += 3;
  for (const c of components) {
    const def = defs.get(c.id);
    if (!def || def.electrical.kind === "battery") continue;
    const isBoard = def.electrical.kind === "board";
    const gndPin = def.pins.find((p) => p.role.kind === "ground");
    for (const p of def.pins) {
      const node = net(c.id, p.id);
      const gpioHere = gpios.find((g) => net(g.c.id, g.pin.id) === node);
      if (gpioHere && (p.role.kind === "power-in" || def.electrical.kind === "motor")) {
        {
          add({ severity: "warning", rule: "power-from-gpio", message: `${label(c)} ${pinName(def, p.id)} is powered from ${label(gpioHere.c)} ${gpioHere.pin.name}. A GPIO pin can only supply a few milliamps, far too little for a ${def.electrical.kind === "motor" ? "motor" : def.electrical.kind === "servo" ? "servo" : "module"}, and the load can damage the pin.`, fix: def.electrical.kind === "motor" ? "Use a motor driver board between the GPIO pin and the motor, with its own supply." : "Power it from a 5V / 3V3 supply pin or a battery; use the GPIO pin only for the signal.", components: [c.id, gpioHere.c.id] });
          continue;
        }
      }
      if (p.role.kind === "power-in" && gndPin) {
        const v = inputs.v.get(node)! - inputs.v.get(net(c.id, gndPin.id))!;
        if (!attached(node) || !determined(node) || Math.abs(v) < 0.2) {
          if (isBoard) continue; // boards are powered over USB in these checks
          add({ severity: "info", rule: "not-powered", message: `${label(c)} ${pinName(def, p.id)} has no supply voltage (not connected yet, or switched off).`, fix: "Connect it to a supply pin (through a switch if you like) and its GND to ground.", components: [c.id] });
          continue;
        }
        const { min, max } = p.role;
        const est = min.status === "estimated" || max.status === "estimated";
        if (v > max.value + 0.05 || v < min.value - 0.05) {
          const far = v > max.value * 1.2 || v < min.value * 0.8;
          add({
            severity: far ? (est ? "warning" : "danger") : est ? "info" : "warning", rule: "supply-range",
            message: `${label(c)} ${pinName(def, p.id)} gets about ${fmtV(v)}; it expects ${fmtV(min.value)}-${fmtV(max.value)}${est ? " (typical range; check your part)" : ""}.`,
            fix: v > max.value ? "Use a lower supply or a regulator." : "Use a higher supply; at too low a voltage it may not work or reset.",
            components: [c.id],
          });
        }
      }
      if (p.role.kind === "signal-in" && gndPin) {
        const driver = gpios.find((g) => net(g.c.id, g.pin.id) === node);
        if (driver && net(c.id, gndPin.id) !== driver.gnd) {
          add({ severity: "warning", rule: "missing-ground", message: `${label(c)} gets its ${pinName(def, p.id)} signal from ${label(driver.c)} ${driver.pin.name}, but their grounds are not connected. Without a common ground the signal has no reference: it will not work reliably, and the two sides can sit at unsafe voltages to each other.`, fix: `Connect ${label(c)} GND to a GND pin of ${label(driver.c)} (and to the ground of any separate battery).`, components: [c.id, driver.c.id] });
        }
      }
    }
  }

  // 5b. Module outputs into board inputs with lower logic voltage (e.g. a 5 V Echo into a 3.3 V pin).
  checksRun++;
  for (const c of components) {
    const def = defs.get(c.id);
    for (const p of def?.pins ?? []) {
      if (p.role.kind !== "signal-out") continue;
      const node = net(c.id, p.id);
      for (const g of gpios.filter((x) => net(x.c.id, x.pin.id) === node)) {
        if (p.role.volts.value <= g.logic.value + 0.3) continue;
        add({
          severity: "warning", rule: "signal-too-high",
          message: `${label(c)} ${pinName(def!, p.id)} outputs about ${fmtV(p.role.volts.value)} (typical; ${p.role.volts.source}) into ${label(g.c)} ${g.pin.name}, a ${fmtV(g.logic.value)} logic pin. Signals above the pin's logic voltage can damage it.`,
          fix: `Add a voltage divider (for example 1 kΩ from the output, 2 kΩ to GND) or a level shifter, so the pin sees at most about ${fmtV(g.logic.value)}.`,
          components: [c.id, g.c.id],
        });
      }
    }
  }

  // 6. Current budget: peak loads on each supply pin vs what the pin can give.
  checksRun++;
  if (!shorted) {
    for (const s of baseSources) {
      const def = defs.get(s.component);
      const pin = def?.pins.find((p) => p.id === s.pin);
      const max = pin?.role.kind === "supply" ? pin.role.maxCurrent : undefined;
      if (!max) continue;
      const loads = components.filter((c) => {
        const d = defs.get(c.id);
        return d && LOAD_PEAK[c.type] && d.pins.some((p) => (p.role.kind === "power-in" || d.electrical.kind === "motor") && net(c.id, p.id) === s.plus);
      });
      if (!loads.length) continue;
      const total = loads.reduce((sum, c) => sum + LOAD_PEAK[c.type]!.value, 0);
      if (total <= max.value) continue;
      const far = total > 2 * max.value;
      add({
        severity: far ? "warning" : "info", rule: "current-budget",
        message: `${s.label} feeds ${loads.map(label).join(", ")}: together they can draw about ${fmtI(total)} at peak, more than about ${fmtI(max.value)} this pin can give (${max.status === "estimated" ? "typical values" : max.source}). The board may reset or brown out when ${loads.some((c) => c.type === "servo" || c.type === "motor") ? "the motors start or stall" : "they all draw at once"}.`,
        fix: "Power servos and motors from their own supply (for example a 5 V pack or regulator), and join its GND to the board's GND.",
        components: [s.component, ...loads.map((c) => c.id)],
      });
    }
  }

  // 7. LiPo cells.
  checksRun++;
  for (const c of components) {
    if (defs.get(c.id)?.electrical.kind === "battery" && c.props.chemistry === "lipo") {
      add({ severity: "warning", rule: "lipo", message: `${label(c)} is a LiPo battery. Unprotected LiPo cells can catch fire if shorted, over-discharged or charged wrongly.`, fix: "Use a protected cell or a protection (BMS) board, a proper LiPo charger, and never charge it unattended.", components: [c.id] });
    }
  }

  // 8. What is not checked.
  checksRun++;
  for (const c of components) {
    if (defs.get(c.id)?.electrical.kind === "transistor") add({ severity: "info", rule: "not-checked", message: `${label(c)}: transistor circuits are not analysed by the checks yet.`, fix: "Check base resistor and load current by hand (or wait for the simulator, Phase 6).", components: [c.id] });
  }

  const order: Record<Severity, number> = { danger: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const problems = findings.filter((f) => f.severity !== "info").length;
  const summary = problems === 0
    ? `No problems detected by MakerStudio's checks (${checksRun} checks run). This is not a guarantee.`
    : `${problems} problem${problems === 1 ? "" : "s"} found (${checksRun} checks run).`;
  return { findings, checksRun, summary };
}
