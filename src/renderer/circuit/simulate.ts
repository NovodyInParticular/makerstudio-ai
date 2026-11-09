// Talks to the SPICE worker and the Uno emulator worker, and keeps the latest result for the canvas.
//
// With code running, the emulated pins drive the circuit: outputs as HIGH/LOW, PWM outputs as the
// time-average of a HIGH and a LOW solve weighted by duty (the average current a real LED sees),
// inputs as plain inputs or with the chip's pull-up. The solved pin voltages go back to the chip
// (digitalRead, analogRead).

import { create } from "zustand";
import type { CircuitComponent, Wire } from "../../core/circuit/schema";
import { buildSpice, readSpice, type GpioState, type SimResult, type SpiceBuild } from "../../core/circuit/spice";
import { pinKey } from "../../core/circuit/checks";
import { UNO_PINS, type PinReport } from "../../core/circuit/avr";
import { PICO_GPIO } from "../../core/circuit/pico";
import type { SpiceResponse } from "./spice.worker";
import type { AvrIn, AvrOut } from "./avr.worker";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: SpiceResponse) => void>();

function solve(netlist: string): Promise<SpiceResponse> {
  if (!worker) {
    worker = new Worker(new URL("./spice.worker.ts", import.meta.url), { type: "module", name: "spice" });
    worker.onmessage = (e: MessageEvent<SpiceResponse>) => { pending.get(e.data.id)?.(e.data); pending.delete(e.data.id); };
    worker.onerror = (e) => {
      for (const done of pending.values()) done({ id: 0, ok: false, error: `The simulator stopped: ${e.message || "unknown error"}` });
      pending.clear(); worker?.terminate(); worker = null;
    };
  }
  const id = nextId++;
  return new Promise((resolve) => { pending.set(id, resolve); worker!.postMessage({ id, netlist }); });
}

export interface CodeState {
  board: string;          // the board part being emulated
  kind: "uno" | "pico";
  status: "compiling" | "running" | "error";
  errors: string[];
  size: string;
  serial: string;
  speed: number;
  pins: Record<string, PinReport>;
}

interface SimState {
  on: boolean;
  running: boolean;
  gpio: Record<string, GpioState>;
  result: SimResult | null;
  build: SpiceBuild | null;
  error: string | null;
  code: CodeState | null;
}

export const useSim = create<SimState>()(() => ({ on: false, running: false, gpio: {}, result: null, build: null, error: null, code: null }));

/** Weighted average of several solves (same netlist shape, different pin states). */
function average(parts: { r: SimResult; w: number }[]): SimResult {
  const mix = (f: (r: SimResult) => number | null) => {
    let sum = 0, any = false;
    for (const { r, w } of parts) { const v = f(r); if (v !== null) { sum += v * w; any = true; } }
    return any ? sum : null;
  };
  return {
    volts: (c, p) => mix((r) => r.volts(c, p)),
    ledCurrent: (c, p) => mix((r) => r.ledCurrent(c, p)),
    sourceCurrent: (c, p) => mix((r) => r.sourceCurrent(c, p)),
  };
}

let latest = 0;
let lastInputs = "";

/** Re-simulates the circuit (the newest request wins). */
export async function simulate(components: CircuitComponent[], wires: Wire[]) {
  const ticket = ++latest;
  const { gpio, code } = useSim.getState();
  const states: Record<string, GpioState> = { ...gpio };
  const pwm: { key: string; duty: number }[] = [];
  if (code?.status === "running") {
    for (const [pin, rep] of Object.entries(code.pins)) {
      const key = pinKey(code.board, pin);
      if (rep.mode !== "output") { states[key] = rep.mode === "pullup" ? "pullup" : "input"; continue; }
      if (rep.duty <= 0.02) states[key] = "low";
      else if (rep.duty >= 0.98) states[key] = "high";
      else pwm.push({ key, duty: rep.duty });
    }
  }
  // PWM: average of every HIGH/LOW combination (up to 3 PWM pins; more are rounded to their nearer level).
  const exact = pwm.slice(0, 3);
  for (const p of pwm.slice(3)) states[p.key] = p.duty >= 0.5 ? "high" : "low";
  const combos = 1 << exact.length;
  const solves: { build: SpiceBuild; w: number }[] = [];
  for (let m = 0; m < combos; m++) {
    const s = { ...states };
    let w = 1;
    exact.forEach((p, i) => { const hi = (m >> i) & 1; s[p.key] = hi ? "high" : "low"; w *= hi ? p.duty : 1 - p.duty; });
    if (w > 0) solves.push({ build: buildSpice(components, wires, s), w });
  }
  const build = solves[0]!.build;
  if (!/^[A-Z]/m.test(build.netlist.split("\n").filter((l) => !l.startsWith("*") && !l.startsWith(".") && !l.startsWith("RNONE")).join("\n"))) {
    useSim.setState({ running: false, error: null, build, result: readSpice(build, []) });
    return;
  }
  useSim.setState({ running: true });
  const results = await Promise.all(solves.map((x) => solve(x.build.netlist)));
  if (ticket !== latest) return;
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) { useSim.setState({ running: false, error: failed.error, result: null, build }); return; }
  const parts = results.map((r, i) => ({ r: readSpice(solves[i]!.build, (r as { data: { name: string; values: number[] }[] }).data), w: solves[i]!.w }));
  const result = parts.length === 1 ? parts[0]!.r : average(parts);
  useSim.setState({ running: false, error: null, build, result });
  // Feed the solved voltages back to the emulated chip's inputs.
  const c = useSim.getState().code;
  if (c?.status === "running" && avr) {
    const volts: Record<string, number> = {};
    const names = c.kind === "pico" ? PICO_GPIO.map((n) => `GP${n}`) : Object.keys(UNO_PINS);
    for (const pin of names) { const v = result.volts(c.board, pin); if (v !== null) volts[pin] = v; }
    const sig = JSON.stringify(volts, (_k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
    if (sig !== lastInputs) { lastInputs = sig; avr.postMessage({ type: "inputs", volts } satisfies AvrIn); }
  }
}

export function setGpio(key: string, state: GpioState) {
  useSim.setState({ gpio: { ...useSim.getState().gpio, [key]: state } });
}

// --- the emulated Uno ------------------------------------------------------------------------

let avr: Worker | null = null;

/** Compiles the sketch and runs it on the emulated Uno. */
export async function runCode(board: string, code: string, kind: "uno" | "pico" = "uno") {
  stopCode();
  useSim.setState({ code: { board, kind, status: "compiling", errors: [], size: "", serial: "", speed: 1, pins: {} } });
  const r = await window.makerstudio.avrBuild(code, kind);
  if (useSim.getState().code?.board !== board) return; // stopped meanwhile
  if (!r.ok) { useSim.setState({ code: { ...useSim.getState().code!, status: "error", errors: [r.error] } }); return; }
  if (!r.value.ok) { useSim.setState({ code: { ...useSim.getState().code!, status: "error", errors: r.value.errors } }); return; }
  const size = r.value.size;
  avr = new Worker(new URL("./avr.worker.ts", import.meta.url), { type: "module", name: "avr" });
  lastInputs = "";
  avr.onmessage = (e: MessageEvent<AvrOut>) => {
    const cur = useSim.getState().code;
    if (!cur) return;
    if (e.data.type === "error") { useSim.setState({ code: { ...cur, status: "error", errors: [e.data.message] } }); stopWorker(); return; }
    const changed = JSON.stringify(e.data.pins) !== JSON.stringify(cur.pins);
    useSim.setState({ code: { ...cur, status: "running", size, pins: e.data.pins, speed: e.data.speed, serial: (cur.serial + e.data.serial).slice(-20000) } });
    if (changed) useSim.setState({ gpio: { ...useSim.getState().gpio } }); // triggers a re-simulation
  };
  avr.onerror = (e) => { const cur = useSim.getState().code; if (cur) useSim.setState({ code: { ...cur, status: "error", errors: [`The emulator stopped: ${e.message}`] } }); stopWorker(); };
  avr.postMessage((r.value.board === "pico" ? { type: "loadPico", bin: r.value.bin! } : { type: "load", hex: r.value.hex! }) satisfies AvrIn);
  useSim.setState({ code: { ...useSim.getState().code!, status: "running", size } });
}

function stopWorker() { avr?.postMessage({ type: "stop" } satisfies AvrIn); avr?.terminate(); avr = null; }

export function stopCode() {
  stopWorker();
  useSim.setState({ code: null });
}

export const fmtVolts = (v: number) => `${Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(Math.abs(v) < 10 ? 3 : 2)} V`;
export const fmtAmps = (a: number) => { const x = Math.abs(a); return x < 1e-6 ? "0 mA" : x < 1e-3 ? `${(a * 1e6).toFixed(0)} µA` : x < 1 ? `${(a * 1e3).toFixed(1)} mA` : `${a.toFixed(2)} A`; };
