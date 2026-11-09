// The Pico emulator running real compiled firmware (tests/fixtures/pico-test.cpp, Arduino-mbed core).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PicoEmulator } from "../../src/core/circuit/pico";

const bin = new Uint8Array(readFileSync(new URL("../fixtures/pico-test.bin", import.meta.url)));
const ms = (n: number) => n * 1e6;

describe("Pico emulator (rp2040js) with real firmware", () => {
  it("boots, prints over USB serial, blinks GP15, PWM on GP16, reads a button and the ADC", () => {
    const pico = new PicoEmulator(bin);
    const t = performance.now();
    let serial = "";
    // Boot (the mbed core takes a moment to start USB).
    for (let i = 0; i < 40 && !serial.includes("hello pico"); i++) { pico.run(ms(50)); serial += pico.sample().serial; }
    console.log("boot + first print took", (performance.now() - t).toFixed(0), "ms real time; serial:", JSON.stringify(serial.slice(0, 80)));
    expect(serial).toContain("hello pico");
    const gp15: number[] = [];
    let pwm = 0;
    for (let i = 0; i < 12; i++) { pico.run(ms(50)); const s = pico.sample(); gp15.push(s.pins.GP15!.duty); pwm = s.pins.GP16!.duty; }
    const changes = gp15.slice(1).filter((d, i) => Math.round(d) !== Math.round(gp15[i]!)).length;
    expect(changes).toBeGreaterThanOrEqual(4);
    expect(pwm).toBeCloseTo(64 / 255, 1);
    expect(pico.sample().pins.GP14!.mode).toBe("pullup");
    pico.setInputs({ GP14: 3.3, GP26: 1.65 }); pico.run(ms(20)); pico.sample(); pico.run(ms(20));
    expect(pico.sample().pins.GP13!.duty).toBe(0);
    pico.setInputs({ GP14: 0 }); pico.run(ms(20)); pico.sample(); pico.run(ms(20));
    expect(pico.sample().pins.GP13!.duty).toBe(1);
    serial = "";
    for (let i = 0; i < 6; i++) { pico.run(ms(50)); serial += pico.sample().serial; }
    const reading = Number(/A0=(\d+)/.exec(serial.split("\n").slice(-3).join("\n"))?.[1]);
    console.log("A0 reading at 1.65 V:", reading);
    expect(reading).toBeGreaterThan(490); expect(reading).toBeLessThan(535); // 10-bit default: 1.65/3.3 → 512
  }, 120000);
});
