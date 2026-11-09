// Circuit → SPICE netlist for ngspice (Phase 6a), and reading the results back.
//
// Connections come from the same netlist as the checks (wires, breadboard strips, plugged legs).
// Every model here is GENERIC and marked as such: LEDs are calibrated to the catalog's typical
// forward voltages at 20 mA, transistors are textbook models, not a specific part number.
// Boards are powered over USB; each GPIO pin is driven as the owner sets it (high / low / input)
// until firmware emulation (Phase 6b) drives it instead.

import { componentDef, LED_VF } from "./catalog";
import { buildNetlist, isBreadboard, pinKey } from "./checks";
import type { CircuitComponent, Wire } from "./schema";

export type GpioState = "high" | "low" | "input" | "pullup";

/** Generic models, with where their numbers come from. */
export const MODEL_NOTES: Record<string, string> = {
  led: "Generic LED diode model (N = 1.8, RS = 5 Ω) calibrated so each colour has the catalog's typical forward voltage at 20 mA. Real LEDs differ by part and batch.",
  diode: "Generic silicon diode (IS = 2.5 nA, N = 1.75, RS = 0.6 Ω), roughly a small-signal 1N4148-class part.",
  npn: "Generic NPN (gain about 100), not a specific part number.",
  pnp: "Generic PNP (gain about 100), not a specific part number.",
  mosfet: "Generic N-channel MOSFET (level 1, threshold 2 V), not a specific part number.",
  board: "Board supply pins as voltage sources with 0.5 Ω output resistance (estimate); a GPIO set HIGH or LOW as its logic voltage / ground behind 25 Ω (estimate).",
  battery: "Battery as an ideal source with 0.1 Ω internal resistance (estimate; real batteries sag more under load).",
};

const R_BATTERY = 0.1, R_BOARD = 0.5, R_GPIO = 25, R_CLOSED = 0.05, R_LEAK = 1e9;
/** Internal pull-up resistor (estimate: the ATmega328P datasheet gives 20-50 kΩ). */
const R_PULLUP = 35000;
const N_LED = 1.8, RS_LED = 5, VT = 0.025852;
const ledIs = (vf: number) => 0.02 / Math.exp((vf - 0.02 * RS_LED) / (N_LED * VT));

export interface SpiceBuild {
  netlist: string;
  /** SPICE node name for a part's pin. */
  node(component: string, pin: string): string;
  /** Current probes: an LED channel or a source, measured by a 0 V source named `sense`. */
  probes: { kind: "led" | "source" | "gpio"; component: string; pin?: string; sense: string }[];
  /** Parts that are in the circuit but not modelled (modules, servos, motors...). */
  notModelled: string[];
}

export function buildSpice(components: CircuitComponent[], wires: Wire[], gpio: Record<string, GpioState> = {}): SpiceBuild {
  const nets = buildNetlist(components, wires);
  const names = new Map<string, string>();
  const lines: string[] = ["* MakerStudio circuit"];
  const probes: SpiceBuild["probes"] = [];
  const notModelled: string[] = [];
  const models = new Set<string>();
  let ground: string | null = null;

  // Reference node: a board GND if there is one, else a battery's minus.
  for (const c of components) {
    const def = componentDef(c.type);
    if (def?.electrical.kind === "board") { ground = nets.find(pinKey(c.id, def.electrical.internalGround[0]!)); break; }
  }
  if (!ground) for (const c of components) if (componentDef(c.type)?.electrical.kind === "battery") { ground = nets.find(pinKey(c.id, "-")); break; }

  const node = (component: string, pin: string) => {
    const root = nets.find(pinKey(component, pin));
    if (root === ground) return "0";
    let n = names.get(root);
    if (!n) { n = `n${names.size + 1}`; names.set(root, n); }
    return n;
  };
  const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "x";
  let k = 0;
  const id = (prefix: string, c: CircuitComponent) => `${prefix}${safe(c.id)}_${++k}`;

  for (const c of components) {
    const def = componentDef(c.type);
    if (!def || isBreadboard(c.type)) continue;
    const e = def.electrical;
    switch (e.kind) {
      case "battery": {
        const v = Number(c.props.volts ?? 9), sense = id("VS", c), mid = `${sense}_m`;
        lines.push(`${id("V", c)} ${mid} ${node(c.id, "-")} DC ${v}`, `${id("R", c)} ${mid} ${sense}_p ${R_BATTERY}`, `${sense} ${sense}_p ${node(c.id, "+")} 0`);
        probes.push({ kind: "source", component: c.id, pin: "+", sense });
        break;
      }
      case "resistor":
        lines.push(`${id("R", c)} ${node(c.id, "1")} ${node(c.id, "2")} ${Math.max(0.01, Number(c.props.ohms ?? 220))}`);
        break;
      case "potentiometer": {
        const ohms = Math.max(1, Number(c.props.ohms ?? 10000)), pos = Math.min(1, Math.max(0, Number(c.props.position ?? 0.5)));
        lines.push(`${id("R", c)} ${node(c.id, "1")} ${node(c.id, "W")} ${Math.max(0.5, ohms * pos)}`, `${id("R", c)} ${node(c.id, "W")} ${node(c.id, "2")} ${Math.max(0.5, ohms * (1 - pos))}`);
        break;
      }
      case "capacitor":
        lines.push(`${id("C", c)} ${node(c.id, e.polarized ? "+" : "1")} ${node(c.id, e.polarized ? "-" : "2")} ${Number(c.props.microfarads ?? 1)}u`);
        break;
      case "switch":
        if (c.props.closed) lines.push(`${id("R", c)} ${node(c.id, "1")} ${node(c.id, "2")} ${R_CLOSED}`);
        break;
      case "led":
      case "led-array": {
        const chans = e.kind === "led" ? [{ a: "A", k: "K", color: String(c.props.color ?? "red"), pin: undefined as string | undefined }]
          : e.channels.map((ch) => ({ a: ch.pin, k: e.common, color: ch.color, pin: ch.pin as string | undefined }));
        for (const ch of chans) {
          const vf = (LED_VF[ch.color as keyof typeof LED_VF] ?? LED_VF.red).value;
          const model = `LED_${ch.color.toUpperCase()}`;
          if (!models.has(model)) { models.add(model); lines.push(`.model ${model} D(IS=${ledIs(vf).toExponential(4)} N=${N_LED} RS=${RS_LED} BV=5 IBV=10u)`); }
          const sense = id("VL", c);
          lines.push(`${sense} ${node(c.id, ch.a)} ${sense}_a 0`, `${id("D", c)} ${sense}_a ${node(c.id, ch.k)} ${model}`);
          probes.push({ kind: "led", component: c.id, ...(ch.pin ? { pin: ch.pin } : {}), sense });
        }
        break;
      }
      case "diode":
        if (!models.has("DGEN")) { models.add("DGEN"); lines.push(".model DGEN D(IS=2.52n N=1.752 RS=0.568 BV=100)"); }
        lines.push(`${id("D", c)} ${node(c.id, "A")} ${node(c.id, "K")} DGEN`);
        break;
      case "transistor":
        if (c.type === "mosfet") {
          if (!models.has("NMOSGEN")) { models.add("NMOSGEN"); lines.push(".model NMOSGEN NMOS(LEVEL=1 VTO=2 KP=0.5)"); }
          lines.push(`${id("M", c)} ${node(c.id, "D")} ${node(c.id, "G")} ${node(c.id, "S")} ${node(c.id, "S")} NMOSGEN`);
        } else {
          const pnp = c.type === "pnp", m = pnp ? "PNPGEN" : "NPNGEN";
          if (!models.has(m)) { models.add(m); lines.push(`.model ${m} ${pnp ? "PNP" : "NPN"}(IS=1e-14 BF=100 VAF=100)`); }
          lines.push(`${id("Q", c)} ${node(c.id, "C")} ${node(c.id, "B")} ${node(c.id, "E")} ${m}`);
        }
        break;
      case "board": {
        const gnd = node(c.id, e.internalGround[0]!);
        for (const p of def.pins) {
          if (p.role.kind === "supply") {
            const sense = id("VB", c), mid = `${sense}_m`;
            lines.push(`${id("V", c)} ${mid} ${gnd} DC ${p.role.volts.value}`, `${id("R", c)} ${mid} ${sense}_p ${R_BOARD}`, `${sense} ${sense}_p ${node(c.id, p.id)} 0`);
            probes.push({ kind: "source", component: c.id, pin: p.id, sense });
          }
          if (p.role.kind === "gpio") {
            const state = gpio[pinKey(c.id, p.id)] ?? "input";
            if (state === "input") continue;
            const sense = id("VG", c), mid = `${sense}_m`;
            lines.push(`${id("V", c)} ${mid} ${gnd} DC ${state === "low" ? 0 : p.role.logic.value}`, `${id("R", c)} ${mid} ${sense}_p ${state === "pullup" ? R_PULLUP : R_GPIO}`, `${sense} ${sense}_p ${node(c.id, p.id)} 0`);
            probes.push({ kind: "gpio", component: c.id, pin: p.id, sense });
          }
        }
        break;
      }
      default:
        notModelled.push(c.id);
    }
  }
  // A very weak path to ground from every node keeps floating parts solvable (it changes nothing measurable).
  for (const n of names.values()) lines.push(`RLEAK_${n} ${n} 0 ${R_LEAK}`);
  if (lines.length === 1) lines.push("RNONE 0 0 1");
  lines.push(".options noacct", ".op", ".end");
  return { netlist: lines.join("\n"), node, probes, notModelled };
}

export interface SimResult {
  /** Voltage of every node against the reference (board GND or battery minus). */
  volts(component: string, pin: string): number | null;
  /** Current through an LED (channel) in A, forward positive. */
  ledCurrent(component: string, pin?: string): number | null;
  /** Current a source / GPIO pin delivers, in A. */
  sourceCurrent(component: string, pin: string): number | null;
}

export function readSpice(build: SpiceBuild, data: { name: string; values: number[] }[]): SimResult {
  const value = new Map(data.map((d) => [d.name.toLowerCase(), d.values[0] ?? NaN]));
  const cur = (sense: string) => { const v = value.get(`i(${sense.toLowerCase()})`); return v === undefined || !Number.isFinite(v) ? null : v; };
  return {
    volts: (component, pin) => {
      const n = build.node(component, pin);
      if (n === "0") return 0;
      const v = value.get(`v(${n})`);
      return v === undefined || !Number.isFinite(v) ? null : v;
    },
    ledCurrent: (component, pin) => { const p = build.probes.find((x) => x.kind === "led" && x.component === component && x.pin === pin); return p ? cur(p.sense) : null; },
    // ngspice reports source current flowing into the + terminal; the sense source sits on the output side.
    sourceCurrent: (component, pin) => { const p = build.probes.find((x) => x.kind !== "led" && x.component === component && x.pin === pin); return p ? cur(p.sense) : null; },
  };
}
