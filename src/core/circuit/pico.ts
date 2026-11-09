// Raspberry Pi Pico (RP2040) emulator on rp2040js (MIT), running the real compiled firmware.
// Same interface as the Uno emulator: run, sample (pin modes + HIGH-time fractions + serial),
// setInputs (voltages from the circuit). Serial is the Pico's USB serial (USB CDC).

import { GPIOPinState, Simulator, USBCDC } from "rp2040js";
import { bootromB1 } from "./rp2040/bootrom";
import type { PinMode, PinReport } from "./avr";

export const PICO_GPIO = [...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28];

export class PicoEmulator {
  readonly sim = new Simulator();
  private serial = "";
  private high = new Map<number, number>();
  private since = new Map<number, number>();
  private windowStart = 0;

  constructor(bin: Uint8Array) {
    const mcu = this.sim.rp2040;
    mcu.loadBootrom(bootromB1);
    mcu.flash.set(bin.subarray(0, mcu.flash.length));
    const cdc = new USBCDC(mcu.usbCtrl);
    cdc.onSerialData = (data) => { this.serial += new TextDecoder().decode(data); };
    mcu.uart[0]!.onByte = (b) => { this.serial += String.fromCharCode(b); };
    for (const n of PICO_GPIO) {
      this.since.set(n, -1);
      mcu.gpio[n]!.addListener((state) => {
        const hi = state === GPIOPinState.High;
        const s = this.since.get(n)!;
        if (hi && s < 0) this.since.set(n, this.now());
        if (!hi && s >= 0) { this.high.set(n, (this.high.get(n) ?? 0) + this.now() - Math.max(s, this.windowStart)); this.since.set(n, -1); }
      });
    }
    mcu.core.PC = 0x10000000;
  }

  private now() { return this.sim.clock.nanos; }

  /** Runs for a span of simulated time (nanoseconds). */
  run(nanos: number) {
    const { rp2040: mcu, clock } = this.sim;
    const end = clock.nanos + nanos;
    const cycleNanos = 1e9 / 125_000_000;
    while (clock.nanos < end) {
      if (mcu.core.waiting) {
        const next = Math.min(clock.nanosToNextAlarm, end - clock.nanos);
        clock.tick(Math.max(next, cycleNanos));
      } else clock.tick(mcu.core.executeInstruction() * cycleNanos);
    }
  }

  sample(): { pins: Record<string, PinReport>; serial: string } {
    const now = this.now(), span = Math.max(1, now - this.windowStart);
    const pins: Record<string, PinReport> = {};
    for (const n of PICO_GPIO) {
      const g = this.sim.rp2040.gpio[n]!;
      let hi = this.high.get(n) ?? 0;
      const s = this.since.get(n)!;
      if (s >= 0) { hi += now - Math.max(s, this.windowStart); this.since.set(n, now); }
      const mode: PinMode = g.outputEnable ? "output" : g.pullupEnabled ? "pullup" : "input";
      const duty = mode === "output" ? (hi === 0 && g.outputValue ? 1 : Math.min(1, hi / span)) : 0;
      pins[`GP${n}`] = { mode, duty: Math.round(duty * 1000) / 1000 };
    }
    this.high.clear();
    this.windowStart = now;
    const serial = this.serial;
    this.serial = "";
    return { pins, serial };
  }

  /** Circuit voltages on the pins: digital level at half of 3.3 V; GP26-28 also feed the ADC. */
  setInputs(volts: Record<string, number>) {
    const mcu = this.sim.rp2040;
    for (const [name, v] of Object.entries(volts)) {
      const n = Number(/^GP(\d+)$/.exec(name)?.[1] ?? -1);
      if (!PICO_GPIO.includes(n)) continue;
      const g = mcu.gpio[n]!;
      if (!g.outputEnable) g.setInputValue(v > 1.65);
      if (n >= 26) mcu.adc.channelValues[n - 26] = Math.round((Math.max(0, Math.min(3.3, v)) / 3.3) * 4095);
    }
  }
}
