// The Uno emulator running real compiled firmware (tests/fixtures/uno-test.cpp, built with PlatformIO).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNO_HZ, UnoEmulator } from "../../src/core/circuit/avr";

const hex = readFileSync(new URL("../fixtures/uno-test.hex", import.meta.url), "utf8");
const ms = (n: number) => Math.round((UNO_HZ / 1000) * n);

describe("Uno emulator (avr8js) with real firmware", () => {
  it("prints over Serial, blinks D13 every 100 ms, PWM 25 % on D9", () => {
    const uno = new UnoEmulator(hex);
    let serial = "";
    const d13: number[] = [];
    for (let i = 0; i < 20; i++) { uno.run(ms(50)); const s = uno.sample(); serial += s.serial; d13.push(s.pins.D13!.duty); if (i > 2) expect(s.pins.D9!.duty).toBeCloseTo(64 / 255, 1); }
    expect(serial).toContain("hello from the uno");
    // 1 s at 100 ms per half period: the 50 ms windows alternate in pairs (on, on, off, off ...).
    const changes = d13.slice(1).filter((d, i) => Math.round(d) !== Math.round(d13[i]!)).length;
    expect(changes).toBeGreaterThanOrEqual(8);
    expect(changes).toBeLessThanOrEqual(11);
  });
  it("reads a pull-up button and analogRead from the circuit", () => {
    const uno = new UnoEmulator(hex);
    uno.run(ms(20)); uno.sample();
    expect(uno.sample().pins.D2!.mode).toBe("pullup");
    uno.setInputs({ D2: 5, A0: 2.5 }); uno.run(ms(20)); uno.sample(); uno.run(ms(10));
    expect(uno.sample().pins.D12!.duty).toBe(0);      // not pressed
    uno.setInputs({ D2: 0 }); uno.run(ms(10)); uno.sample(); uno.run(ms(10));
    expect(uno.sample().pins.D12!.duty).toBe(1);      // pressed (to GND)
    let serial = "";
    for (let i = 0; i < 4; i++) { uno.run(ms(60)); serial += uno.sample().serial; }
    const reading = Number(/A0=(\d+)/.exec(serial)![1]);
    expect(reading).toBeGreaterThanOrEqual(509); expect(reading).toBeLessThanOrEqual(513); // 2.5 V of 5 V → 512
  });
  it("runs near real time (bound loose: tests share the CPU; the app shows the live speed)", () => {
    const uno = new UnoEmulator(hex);
    const t = performance.now(); uno.run(ms(500)); const took = performance.now() - t;
    console.log(`0.5 s of Uno time took ${took.toFixed(0)} ms`);
    expect(took).toBeLessThan(1500);
  });
});
