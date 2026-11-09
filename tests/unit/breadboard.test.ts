import { describe, expect, it } from "vitest";
import { componentDef, COMPONENTS } from "../../src/core/circuit/catalog";
import { checkCircuit, pluggedPins } from "../../src/core/circuit/checks";
import { partLayout } from "../../src/core/circuit/layout";
import type { CircuitComponent, Wire } from "../../src/core/circuit/schema";

const part = (id: string, type: string, x: number, y: number, props: Record<string, number | string | boolean> = {}, rotation: 0 | 90 | 180 | 270 = 0): CircuitComponent =>
  ({ id, type, label: id, x, y, rotation, props: { ...Object.fromEntries(componentDef(type)!.props.map((p) => [p.key, p.default])), ...props } });
const wire = (id: string, a: [string, string], b: [string, string]): Wire => ({ id, from: { component: a[0], pin: a[1] }, to: { component: b[0], pin: b[1] }, color: "#ff0000" });
// Column N of a breadboard placed at (0,0) is at x = 2 + N - 1; row a = y 4 ... e = y 8, f = 11 ... j = 15.
const colX = (n: number) => 1 + n;

describe("breadboards", () => {
  it("have the real hole counts and strips", () => {
    const half = componentDef("breadboard-half")!, full = componentDef("breadboard-full")!;
    expect(half.pins.length).toBe(400);
    expect(full.pins.length).toBe(830);
    if (half.electrical.kind !== "breadboard") throw new Error();
    expect(half.electrical.strips.filter((s) => s.length === 5).length).toBe(60);
    expect(half.electrical.strips.filter((s) => s.length === 25).length).toBe(4);
    // every hole sits on the 0.1 inch grid
    expect(partLayout("breadboard-half").pins.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))).toBe(true);
  });

  it("a part whose legs sit in holes is plugged in; one between holes is not", () => {
    const bb = part("bb", "breadboard-half", 0, 0);
    const led = part("led", "led", colX(10), 6); // legs in e10 and e12
    expect(pluggedPins([bb, led]).map((p) => p.hole).sort()).toEqual(["e10", "e12"]);
    expect(pluggedPins([bb, part("led", "led", colX(10), 5.5)])).toEqual([]);
    // rotated 90°: still lands on holes (vertical in one column = both legs in one strip)
    expect(pluggedPins([bb, part("led", "led", colX(10) - 1, 5, {}, 90)]).length).toBe(2);
  });

  it("an LED on the breadboard with no resistor is caught; adding one plugged in fixes it", () => {
    const bb = part("bb", "breadboard-half", 0, 0);
    const bat = part("bat", "battery", 40, 30, { volts: 9 });
    const led = part("led", "led", colX(10), 6); // A = e10, K = e12
    const wires = [wire("w1", ["bat", "+"], ["bb", "a10"]), wire("w2", ["bat", "-"], ["bb", "a12"])];
    const bad = checkCircuit([bb, bat, led], wires);
    expect(bad.findings.some((f) => f.rule === "led-current" && f.severity === "danger")).toBe(true);
    // Now: LED K in e12, resistor from c12... no: put the resistor between column 12 and 16, battery − to 16.
    const res = part("r", "resistor", colX(12), 2, { ohms: 1000 }); // legs at c12? y = 2+2 = 4 -> row a
    const wires2 = [wire("w1", ["bat", "+"], ["bb", "b10"]), wire("w2", ["bat", "-"], ["bb", "b16"])];
    const good = checkCircuit([bb, bat, led, res], wires2);
    expect(good.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("empty breadboard strips do not count as connections", () => {
    const bb = part("bb", "breadboard-half", 0, 0);
    const uno = part("uno", "arduino-uno-r3", 60, 0);
    const r = checkCircuit([bb, uno], [wire("w", ["uno", "D13"], ["bb", "a5"])]);
    expect(r.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });
});

describe("new parts", () => {
  it("every part has a layout whose pins are all on the grid, and unique pin ids", () => {
    for (const def of COMPONENTS) {
      const L = partLayout(def.id);
      expect(L.pins.length, def.id).toBe(def.pins.length);
      expect(new Set(def.pins.map((p) => p.id)).size, def.id).toBe(def.pins.length);
      expect(L.pins.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)), def.id).toBe(true);
      expect(L.w % 2 + L.h % 2, `${def.id} size must be even to rotate on the grid`).toBe(0);
    }
  });

  it("RGB LED: each colour is checked for current", () => {
    const uno = part("uno", "arduino-uno-r3", 0, 0);
    const rgb = part("rgb", "rgb-led", 40, 0);
    const r = checkCircuit([uno, rgb], [wire("a", ["uno", "D9"], ["rgb", "G"]), wire("b", ["rgb", "K"], ["uno", "GND1"])]);
    const f = r.findings.find((x) => x.rule === "led-current");
    expect(f?.message).toMatch(/\(Green\)/);
  });

  it("potentiometer divides the voltage (the wiper sits between the ends)", () => {
    const uno = part("uno", "arduino-uno-r3", 0, 0);
    const pot = part("pot", "potentiometer", 40, 0);
    const r = checkCircuit([uno, pot], [wire("a", ["uno", "5V"], ["pot", "1"]), wire("b", ["pot", "2"], ["uno", "GND1"])]);
    expect(r.findings.filter((x) => x.severity === "danger")).toEqual([]);
    // 5V straight across with the knob at an end is still 10 kΩ: no short.
    const end = checkCircuit([uno, { ...pot, props: { ...pot.props, position: 0 } }], [wire("a", ["uno", "5V"], ["pot", "1"]), wire("b", ["pot", "2"], ["uno", "GND1"])]);
    expect(end.findings.some((x) => x.rule === "short-circuit")).toBe(false);
  });

  it("a 5 V Echo into a 3.3 V Pico pin is flagged; into a 5 V Uno pin it is not", () => {
    const pico = part("pico", "raspberry-pi-pico", 0, 0), uno = part("uno", "arduino-uno-r3", 0, 0);
    const us = part("us", "ultrasonic", 40, 0);
    const p = checkCircuit([pico, us], [wire("a", ["us", "ECHO"], ["pico", "GP2"])]);
    expect(p.findings.some((f) => f.rule === "signal-too-high")).toBe(true);
    const u = checkCircuit([uno, us], [wire("a", ["us", "ECHO"], ["uno", "D2"])]);
    expect(u.findings.some((f) => f.rule === "signal-too-high")).toBe(false);
  });
});

describe("checks with running code", () => {
  it("a pressed button on a pin the code reads as an input is not a warning; driven as an output it is", () => {
    const uno = part("uno", "arduino-uno-r3", 0, 0), b = part("b", "button", 40, 0, { closed: true });
    const wires = [wire("1", ["b", "1"], ["uno", "D2"]), wire("2", ["b", "2"], ["uno", "GND2"])];
    expect(checkCircuit([uno, b], wires).findings.some((f) => f.rule === "gpio-current")).toBe(true);
    expect(checkCircuit([uno, b], wires, new Set(["uno:D2"])).findings.filter((f) => f.severity !== "info")).toEqual([]);
  });
});
