// SPICE netlists checked against hand calculations, run through the real ngspice (WASM).
import { beforeAll, describe, expect, it } from "vitest";
import { Simulation } from "eecircuit-engine";
import { componentDef } from "../../src/core/circuit/catalog";
import { buildSpice, readSpice, type GpioState } from "../../src/core/circuit/spice";
import type { CircuitComponent, Wire } from "../../src/core/circuit/schema";

const part = (id: string, type: string, props: Record<string, number | string | boolean> = {}, x = 0, y = 0): CircuitComponent =>
  ({ id, type, label: id, x, y, rotation: 0, props: { ...Object.fromEntries(componentDef(type)!.props.map((p) => [p.key, p.default])), ...props } });
const w = (i: string, a: string, b: string): Wire => { const [ac, ap] = a.split("."), [bc, bp] = b.split("."); return { id: i, from: { component: ac!, pin: ap! }, to: { component: bc!, pin: bp! }, color: "#ff0000" }; };

let sim: Simulation;
beforeAll(async () => { sim = new Simulation(); await sim.start(); }, 60000);
async function run(parts: CircuitComponent[], wires: Wire[], gpio: Record<string, GpioState> = {}) {
  const b = buildSpice(parts, wires, gpio);
  sim.setNetList(b.netlist);
  const r = await sim.runSim();
  return { b, r: readSpice(b, r.data as { name: string; values: number[] }[]) };
}

describe("SPICE (ngspice) against hand calculations", () => {
  it("voltage divider: 9 V, 1k over 2k → 6 V (less the 0.1 Ω battery drop)", async () => {
    const { r } = await run([part("bat", "battery", { volts: 9 }), part("r1", "resistor", { ohms: 1000 }), part("r2", "resistor", { ohms: 2000 })],
      [w("a", "bat.+", "r1.1"), w("b", "r1.2", "r2.1"), w("c", "r2.2", "bat.-")]);
    // I = 9 / 3000.1 = 2.99990 mA; V(mid) = I × 2000
    expect(r.volts("r1", "2")!).toBeCloseTo((9 / 3000.1) * 2000, 4);
    expect(r.sourceCurrent("bat", "+")!).toBeCloseTo(9 / 3000.1, 7);
  });

  it("red LED + 220 Ω from an Uno pin set HIGH: about (5 − 2) / (220 + 25) ≈ 12 mA", async () => {
    const parts = [part("uno", "arduino-uno-r3"), part("r", "resistor", { ohms: 220 }), part("led", "led", { color: "red" })];
    const wires = [w("a", "uno.D13", "r.1"), w("b", "r.2", "led.A"), w("c", "led.K", "uno.GND1")];
    const on = await run(parts, wires, { "uno:D13": "high" });
    const i = on.r.ledCurrent("led")!;
    // Hand calc with Vf ≈ 2.0 V at this current range: (5 - ~1.95) / 245 = 12.4 mA; allow the model's curve.
    expect(i).toBeGreaterThan(0.0115);
    expect(i).toBeLessThan(0.0130);
    const vf = on.r.volts("led", "A")! - on.r.volts("led", "K")!;
    expect(vf).toBeGreaterThan(1.85);
    expect(vf).toBeLessThan(2.0);
    // Pin LOW or input: the LED is off.
    expect((await run(parts, wires, { "uno:D13": "low" })).r.ledCurrent("led")!).toBeLessThan(1e-6);
    expect((await run(parts, wires)).r.ledCurrent("led")!).toBeLessThan(1e-6);
  });

  it("each LED colour lights at its catalog forward voltage at 20 mA", async () => {
    for (const [color, vf] of [["red", 2.0], ["green", 2.2], ["blue", 3.0]] as const) {
      // A 20 mA test: ideal-ish 10 V source through a resistor chosen for 20 mA at the expected Vf.
      const R = (10 - vf) / 0.02;
      const { r } = await run([part("bat", "battery", { volts: 10 }), part("r", "resistor", { ohms: R - 0.1 }), part("led", "led", { color })],
        [w("a", "bat.+", "r.1"), w("b", "r.2", "led.A"), w("c", "led.K", "bat.-")]);
      expect(r.ledCurrent("led")!, color).toBeCloseTo(0.02, 3);
    }
  });

  it("NPN switch: base 1k from 5 V turns the collector LED on; base open turns it off", async () => {
    const parts = [part("bat", "battery", { volts: 5 }), part("rb", "resistor", { ohms: 1000 }), part("q", "npn"), part("rc", "resistor", { ohms: 220 }), part("led", "led"), part("sw", "switch", { closed: true })];
    const wires = [w("1", "bat.+", "sw.1"), w("2", "sw.2", "rb.1"), w("3", "rb.2", "q.B"), w("4", "bat.+", "rc.1"), w("5", "rc.2", "led.A"), w("6", "led.K", "q.C"), w("7", "q.E", "bat.-")];
    const on = await run(parts, wires);
    expect(on.r.ledCurrent("led")!).toBeGreaterThan(0.01); // saturated: (5 - 2 - ~0.1) / 220 ≈ 13 mA
    const off = await run(parts.map((p) => (p.id === "sw" ? { ...p, props: { closed: false } } : p)), wires);
    expect(off.r.ledCurrent("led")!).toBeLessThan(1e-6);
  });

  it("parts on a breadboard are simulated through the strips", async () => {
    const parts = [part("bb", "breadboard-half"), part("bat", "battery", { volts: 9 }, 40, 30), part("led", "led", {}, 11, 6), part("r", "resistor", { ohms: 1000 }, 13, 2)];
    const { r } = await run(parts, [w("1", "bat.+", "bb.b10"), w("2", "bat.-", "bb.b16")]);
    // (9 - ~1.9) / 1000 ≈ 7 mA
    expect(r.ledCurrent("led")!).toBeGreaterThan(0.0065);
    expect(r.ledCurrent("led")!).toBeLessThan(0.0075);
  });
});
