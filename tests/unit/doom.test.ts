import { beforeAll, describe, expect, it } from "vitest";
import { Simulation } from "eecircuit-engine";
import { checkCircuit } from "../../src/core/circuit/checks";
import { buildSpice, readSpice } from "../../src/core/circuit/spice";
import { DOOM_PINS, doomCircuit } from "../../src/core/practice/doom";
import { PRACTICE_PROJECTS, createPracticeProject } from "../../src/core/practice/catalog";

let n = 0;
const id = () => `d${++n}`;

describe("Doom handheld circuit (retro-go esp32-s3-devkit wiring)", () => {
  const { components, wires } = doomCircuit(id);
  const board = components.find((c) => c.type === "esp32-s3-devkitc-1")!;
  const to = (gpio: number) => wires.filter((w) => (w.from.component === board.id && w.from.pin === `GPIO${gpio}`) || (w.to.component === board.id && w.to.pin === `GPIO${gpio}`)).map((w) => {
    const other = w.from.component === board.id ? w.to : w.from;
    return `${components.find((c) => c.id === other.component)!.label}.${other.pin}`;
  });
  it("uses exactly retro-go's pins", () => {
    expect(to(12)).toEqual(["Screen.SDI"]); expect(to(48)).toEqual(["Screen.SCK"]); expect(to(47)).toEqual(["Screen.DC"]);
    expect(to(3)).toEqual(["Screen.RESET"]); expect(to(39)).toEqual(["Screen.LED"]);
    expect(to(10)).toEqual(["microSD.CS"]); expect(to(11)).toEqual(["microSD.MOSI"]); expect(to(13)).toEqual(["microSD.CLK"]); expect(to(9)).toEqual(["microSD.MISO"]);
    expect(to(41)).toEqual(["Amplifier.BCLK"]); expect(to(42)).toEqual(["Amplifier.LRC"]); expect(to(40)).toEqual(["Amplifier.DIN"]);
    for (const [name, pin] of Object.entries(DOOM_PINS.buttons)) expect(to(pin)).toEqual([`${name[0]}${name.slice(1).toLowerCase()} button.2`]);
  });
  it("has no Danger or Warning findings", () => {
    const r = checkCircuit(components, wires);
    expect(r.findings.filter((f) => f.severity === "danger")).toEqual([]);
    // The amplifier at full volume can exceed a USB port's 500 mA: reported as a note, which is honest.
    expect(r.findings.filter((f) => f.severity === "warning").map((f) => f.rule)).toEqual([]);
  });
  it("D-pad voltages land in retro-go's ADC ranges (simulated)", async () => {
    const sim = new Simulation(); await sim.start();
    const press = async (label: string | null) => {
      const comps = components.map((c) => (c.label === label ? { ...c, props: { ...c.props, closed: true } } : c));
      const b = buildSpice(comps, wires); sim.setNetList(b.netlist);
      const r = readSpice(b, (await sim.runSim()).data as { name: string; values: number[] }[]);
      return r.volts(board.id, "GPIO6")!;
    };
    expect(await press(null)).toBeLessThan(0.05);              // nothing pressed: 0 V
    const up = await press("Up button"), down = await press("Down button");
    // ESP32-S3 ADC at 11 dB reads roughly 0-3.1 V as 0-4095: Up ≥ 3072 counts, Down 1024-3071.
    expect(up).toBeGreaterThan(3.0);
    expect(down).toBeGreaterThan(1.4); expect(down).toBeLessThan(1.9);
  }, 60000);
  it("the practice project opens with the wired circuit", () => {
    const p = PRACTICE_PROJECTS.find((x) => x.id === "doom-handheld")!;
    const proj = createPracticeProject(p, "test", id);
    expect(proj.document.workspaces.circuit.components.length).toBe(components.length);
    expect(proj.notes).toMatch(/retro-go_1\.46_esp32-s3-devkit\.img/);
    expect(proj.notes).toMatch(/roms\/doom/);
  });
});

describe("doomWiring: the preview only works the way the real handheld would", () => {
  it("the project's circuit is fully wired", async () => {
    const { doomWiring } = await import("../../src/core/practice/doom");
    const { components, wires } = doomCircuit(id);
    const w = doomWiring(components, wires);
    expect(w.problems).toEqual([]);
    expect(w.screen && w.sd && w.sound).toBe(true);
    expect(Object.values(w.buttons).every(Boolean)).toBe(true);
  });
  it("a missing wire breaks exactly that part", async () => {
    const { doomWiring } = await import("../../src/core/practice/doom");
    const { components, wires } = doomCircuit(id);
    const label = (cid: string) => components.find((c) => c.id === cid)!.label;
    const noA = wires.filter((w) => !(label(w.to.component) === "A button" || label(w.from.component) === "A button"));
    const r = doomWiring(components, noA);
    expect(r.buttons.A).toBe(false);
    expect(r.buttons.B).toBe(true);
    const noClk = wires.filter((w) => !(w.to.pin === "SCK" && label(w.to.component) === "Screen"));
    expect(doomWiring(components, noClk).screen).toBe(false);
    const noDown = wires.filter((w) => !(label(w.from.component) === "Down 10k" || label(w.to.component) === "Down 10k"));
    const d = doomWiring(components, noDown);
    expect(d.buttons.down).toBe(false); expect(d.buttons.up).toBe(true);
  });
});
