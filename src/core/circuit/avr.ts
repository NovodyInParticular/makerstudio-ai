// Arduino Uno (ATmega328P at 16 MHz) emulator built on avr8js (MIT). Runs the real compiled
// firmware: timers (millis, delay, PWM), GPIO, USART (Serial) and ADC (analogRead).
// Pins are reported with their mode and the fraction of time they were HIGH (PWM duty).

import {
  AVRADC, AVRIOPort, AVRTimer, AVRUSART, CPU, PinState, adcConfig, avrInstruction,
  portBConfig, portCConfig, portDConfig, timer0Config, timer1Config, timer2Config, usart0Config,
} from "avr8js";

export const UNO_HZ = 16_000_000;

/** Intel HEX → flash bytes. */
export function loadHex(hex: string, target: Uint8Array) {
  let base = 0;
  for (const raw of hex.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(":")) continue;
    const len = parseInt(line.slice(1, 3), 16), addr = parseInt(line.slice(3, 7), 16), type = parseInt(line.slice(7, 9), 16);
    if (type === 0) for (let i = 0; i < len; i++) target[base + addr + i] = parseInt(line.slice(9 + i * 2, 11 + i * 2), 16);
    else if (type === 2) base = parseInt(line.slice(9, 13), 16) << 4;
    else if (type === 4) base = parseInt(line.slice(9, 13), 16) << 16;
  }
}

export type PinMode = "output" | "input" | "pullup";
export interface PinReport { mode: PinMode; duty: number }

/** Uno pin name → [port, bit]. */
export const UNO_PINS: Record<string, ["B" | "C" | "D", number]> = {
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D${i}`, ["D", i]])),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`D${i + 8}`, ["B", i]])),
  ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`A${i}`, ["C", i]])),
} as Record<string, ["B" | "C" | "D", number]>;

export class UnoEmulator {
  readonly cpu: CPU;
  readonly ports: Record<"B" | "C" | "D", AVRIOPort>;
  readonly adc: AVRADC;
  private serial = "";
  private high = new Map<string, number>();      // cycles spent HIGH in this window
  private since = new Map<string, number>();     // cycle the pin last went HIGH (or -1)
  private windowStart = 0;

  constructor(hex: string) {
    const program = new Uint16Array(0x4000); // 32 KB flash
    loadHex(hex, new Uint8Array(program.buffer));
    this.cpu = new CPU(program);
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    const usart = new AVRUSART(this.cpu, usart0Config, UNO_HZ);
    usart.onByteTransmit = (b) => { this.serial += String.fromCharCode(b); };
    this.adc = new AVRADC(this.cpu, adcConfig);
    for (const [name, [port, bit]] of Object.entries(UNO_PINS)) {
      this.since.set(name, -1);
      this.ports[port].addListener((value, old) => {
        const now = (value >> bit) & 1, was = (old >> bit) & 1;
        if (now === was) return;
        if (now) this.since.set(name, this.cpu.cycles);
        else { const s = this.since.get(name)!; if (s >= 0) this.high.set(name, (this.high.get(name) ?? 0) + this.cpu.cycles - Math.max(s, this.windowStart)); this.since.set(name, -1); }
      });
    }
  }

  /** Runs the CPU for a number of clock cycles. */
  run(cycles: number) {
    const end = this.cpu.cycles + cycles;
    const cpu = this.cpu;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }

  /** Pin modes and HIGH-time fractions since the last call; also returns new serial output. */
  sample(): { pins: Record<string, PinReport>; serial: string } {
    const now = this.cpu.cycles, span = Math.max(1, now - this.windowStart);
    const pins: Record<string, PinReport> = {};
    for (const [name, [port, bit]] of Object.entries(UNO_PINS)) {
      const st = this.ports[port].pinState(bit);
      let hi = this.high.get(name) ?? 0;
      const s = this.since.get(name)!;
      if (s >= 0) { hi += now - Math.max(s, this.windowStart); this.since.set(name, now); }
      const mode: PinMode = st === PinState.Input ? "input" : st === PinState.InputPullUp ? "pullup" : "output";
      // An output that did not change in the window: use its level.
      const duty = mode === "output" ? (hi === 0 && st === PinState.High ? 1 : Math.min(1, hi / span)) : 0;
      pins[name] = { mode, duty: Math.round(duty * 1000) / 1000 };
    }
    this.high.clear();
    this.windowStart = now;
    const serial = this.serial;
    this.serial = "";
    return { pins, serial };
  }

  /** Voltages the circuit puts on input pins (digital level at about half the supply) and analog inputs. */
  setInputs(volts: Record<string, number>) {
    for (const [name, v] of Object.entries(volts)) {
      const map = UNO_PINS[name];
      if (!map) continue;
      const [port, bit] = map;
      const st = this.ports[port].pinState(bit);
      if (st === PinState.Input || st === PinState.InputPullUp) this.ports[port].setPin(bit, v > 2.5);
      if (port === "C") this.adc.channelValues[bit] = Math.max(0, Math.min(5, v));
    }
  }
}
