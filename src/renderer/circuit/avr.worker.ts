// Runs the Uno emulator in real time, off the main thread.
// Runs the Uno (avr8js) or Pico (rp2040js) emulator in real time.
import { UNO_HZ, UnoEmulator, type PinReport } from "../../core/circuit/avr";
import { PicoEmulator } from "../../core/circuit/pico";

export type AvrIn = { type: "load"; hex: string } | { type: "loadPico"; bin: Uint8Array } | { type: "inputs"; volts: Record<string, number> } | { type: "stop" };
export type AvrOut = { type: "pins"; pins: Record<string, PinReport>; serial: string; speed: number } | { type: "error"; message: string };

interface Emu { run(ms: number): void; sample(): { pins: Record<string, PinReport>; serial: string }; setInputs(v: Record<string, number>): void }
let uno: Emu | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = 0;
let lastSig = "";
let lastPost = 0;
const post = (m: AvrOut) => (self as unknown as Worker).postMessage(m);

function tick() {
  if (!uno) return;
  const now = performance.now();
  const wall = Math.min(50, now - last); // never try to catch up more than 50 ms at once
  last = now;
  const t0 = performance.now();
  try {
    uno.run(wall);
  } catch (error) {
    post({ type: "error", message: `The emulator stopped: ${error instanceof Error ? error.message : String(error)}` });
    uno = null;
    return;
  }
  const busy = performance.now() - t0;
  const s = uno.sample();
  // Duty in 2 % steps; only send when pins change, there is serial output, or twice a second.
  for (const p of Object.values(s.pins)) p.duty = Math.round(p.duty * 50) / 50;
  const sig = JSON.stringify(s.pins);
  if (sig !== lastSig || s.serial || now - lastPost > 500) {
    lastSig = sig; lastPost = now;
    post({ type: "pins", pins: s.pins, serial: s.serial, speed: busy > 0 ? Math.min(1, wall / Math.max(wall, busy)) : 1 });
  }
  timer = setTimeout(tick, 16);
}

self.onmessage = (e: MessageEvent<AvrIn>) => {
  const m = e.data;
  if (m.type === "load" || m.type === "loadPico") {
    if (timer) clearTimeout(timer);
    try {
      if (m.type === "load") { const u = new UnoEmulator(m.hex); uno = { run: (ms) => u.run(Math.round((UNO_HZ / 1000) * ms)), sample: () => u.sample(), setInputs: (v) => u.setInputs(v) }; }
      else { const p = new PicoEmulator(m.bin); uno = { run: (ms) => p.run(ms * 1e6), sample: () => p.sample(), setInputs: (v) => p.setInputs(v) }; }
    } catch (error) { post({ type: "error", message: String(error) }); return; }
    last = performance.now();
    tick();
  } else if (m.type === "inputs") uno?.setInputs(m.volts);
  else { if (timer) clearTimeout(timer); uno = null; }
};
