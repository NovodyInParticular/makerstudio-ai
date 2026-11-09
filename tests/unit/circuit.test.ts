// Acceptance tests for Phase 5: known-bad circuits must be caught, good ones must not
// be flagged, and the checks must never call a circuit "safe".
import { describe, expect, it } from "vitest";
import { COMPONENTS, componentDef } from "../../src/core/circuit/catalog";
import { checkCircuit, nextStandardResistor, type Finding } from "../../src/core/circuit/checks";
import type { CircuitComponent, Wire } from "../../src/core/circuit/schema";

let n = 0;
function part(type: string, props: CircuitComponent["props"] = {}, label?: string): CircuitComponent {
  const def = componentDef(type)!;
  const defaults = Object.fromEntries(def.props.map((p) => [p.key, p.default]));
  return { id: `${type}-${++n}`, type, label: label ?? def.name, x: 0, y: 0, rotation: 0, props: { ...defaults, ...props } };
}
const w = (a: CircuitComponent, ap: string, b: CircuitComponent, bp: string): Wire => ({ id: `w${++n}`, from: { component: a.id, pin: ap }, to: { component: b.id, pin: bp }, color: "#ff0000" });
const rules = (fs: Finding[]) => fs.map((f) => `${f.severity}:${f.rule}`);

describe("catalog", () => {
  it("has unique pins per part and a source on every board", () => {
    for (const c of COMPONENTS) {
      expect(new Set(c.pins.map((p) => p.id)).size, c.id).toBe(c.pins.length);
      if (c.electrical.kind === "board") expect(c.source, c.id).toBeTruthy();
    }
    expect(componentDef("raspberry-pi-pico")!.pins).toHaveLength(40);
    expect(componentDef("esp32-s3-devkitc-1")!.pins).toHaveLength(44);
  });
  it("picks standard resistor values", () => {
    expect(nextStandardResistor(700)).toBe(820);
    expect(nextStandardResistor(330)).toBe(330);
    expect(nextStandardResistor(130)).toBe(150);
  });
});

describe("known-bad circuits are caught", () => {
  it("short circuit across a battery", () => {
    const b = part("battery", { volts: 9 });
    const r = checkCircuit([b], [w(b, "+", b, "-")]);
    expect(rules(r.findings)).toContain("danger:short-circuit");
    expect(r.summary).toMatch(/problem/);
  });

  it("short circuit from a board's 5V to GND", () => {
    const u = part("arduino-uno-r3");
    expect(rules(checkCircuit([u], [w(u, "5V", u, "GND2")]).findings)).toContain("danger:short-circuit");
  });

  it("reversed LED", () => {
    const b = part("battery", { volts: 3 }), r = part("resistor", { ohms: 220 }), led = part("led");
    const found = checkCircuit([b, r, led], [w(b, "+", r, "1"), w(r, "2", led, "K"), w(led, "A", b, "-")]).findings;
    expect(rules(found)).toContain("warning:led-reversed");
    // 9 V backwards is beyond what a typical LED survives.
    const b9 = part("battery", { volts: 9 });
    expect(rules(checkCircuit([b9, r, led], [w(b9, "+", r, "1"), w(r, "2", led, "K"), w(led, "A", b9, "-")]).findings)).toContain("danger:led-reversed");
  });

  it("LED without a resistor, with a helpful resistor suggestion", () => {
    const b = part("battery", { volts: 9 }), led = part("led", { color: "red" });
    const f = checkCircuit([b, led], [w(b, "+", led, "A"), w(led, "K", b, "-")]).findings.find((x) => x.rule === "led-current")!;
    expect(f.severity).toBe("danger");
    expect(f.fix).toMatch(/820 Ω/); // (9 - 2) / 10 mA = 700 Ω → next standard value
  });

  it("missing common ground between a board and a separately powered servo", () => {
    const u = part("arduino-uno-r3"), s = part("servo"), bat = part("battery", { volts: 6, chemistry: "nimh" });
    const wires = [w(u, "D9", s, "SIG"), w(bat, "+", s, "V"), w(bat, "-", s, "GND")];
    expect(rules(checkCircuit([u, s, bat], wires).findings)).toContain("warning:missing-ground");
    // Joining the grounds fixes it.
    expect(rules(checkCircuit([u, s, bat], [...wires, w(bat, "-", u, "GND1")]).findings)).not.toContain("warning:missing-ground");
  });

  it("5 V into a 3.3 V GPIO pin (Pico and ESP32-S3)", () => {
    const u = part("arduino-uno-r3"), pico = part("raspberry-pi-pico");
    const f = checkCircuit([u, pico], [w(u, "5V", pico, "GP2"), w(u, "GND1", pico, "GND1")]).findings;
    expect(rules(f)).toContain("danger:gpio-overvoltage");
    expect(f.find((x) => x.rule === "gpio-overvoltage")!.fix).toMatch(/level shifter|divider/);
    const s3 = part("esp32-s3-devkitc-1");
    expect(rules(checkCircuit([s3], [w(s3, "5V", s3, "GPIO4")]).findings)).toContain("danger:gpio-overvoltage");
  });

  it("a GPIO wired straight to GND or a supply", () => {
    const u = part("arduino-uno-r3");
    expect(rules(checkCircuit([u], [w(u, "D7", u, "GND1")]).findings)).toContain("danger:gpio-tied");
    const pico = part("raspberry-pi-pico");
    const f = checkCircuit([u, pico], [w(u, "5V", pico, "GP2"), w(u, "GND1", pico, "GND1")]).findings;
    expect(f.find((x) => x.rule === "gpio-tied")!.message).toMatch(/wired directly to "Arduino UNO R3" 5V/);
  });

  it("a servo or motor powered from a GPIO pin", () => {
    const u = part("arduino-uno-r3"), s = part("servo"), m = part("motor");
    expect(rules(checkCircuit([u, s], [w(u, "D3", s, "V"), w(u, "GND1", s, "GND"), w(u, "D9", s, "SIG")]).findings)).toContain("warning:power-from-gpio");
    expect(rules(checkCircuit([u, m], [w(u, "D5", m, "1"), w(m, "2", u, "GND1")]).findings)).toContain("warning:power-from-gpio");
  });

  it("9 V into a Pico's VSYS (rated 1.8-5.5 V, from the datasheet)", () => {
    const pico = part("raspberry-pi-pico"), b = part("battery", { volts: 9 });
    expect(rules(checkCircuit([pico, b], [w(b, "+", pico, "VSYS"), w(b, "-", pico, "GND1")]).findings)).toContain("danger:supply-range");
  });

  it("reversed or over-voltage electrolytic capacitor", () => {
    const b = part("battery", { volts: 9 }), c = part("electrolytic", { ratedVolts: 16 });
    expect(rules(checkCircuit([b, c], [w(b, "+", c, "-"), w(c, "+", b, "-")]).findings)).toContain("danger:capacitor-reversed");
    const small = part("electrolytic", { ratedVolts: 6.3 });
    expect(rules(checkCircuit([b, small], [w(b, "+", small, "+"), w(small, "-", b, "-")]).findings)).toContain("danger:capacitor-voltage");
  });

  it("a servo behind an open switch is 'not powered', not 'wrong voltage'", () => {
    const b = part("battery", { volts: 6, chemistry: "nimh" }), sw = part("switch", { closed: false }), s = part("servo");
    const wires = [w(b, "+", sw, "1"), w(sw, "2", s, "V"), w(b, "-", s, "GND")];
    expect(rules(checkCircuit([b, sw, s], wires).findings)).toEqual(["info:not-powered"]);
    const on = part("switch", { closed: true });
    expect(checkCircuit([b, on, s], [w(b, "+", on, "1"), w(on, "2", s, "V"), w(b, "-", s, "GND")]).findings).toEqual([]);
  });

  it("LiPo batteries get a safety warning", () => {
    const b = part("battery", { volts: 3.7, chemistry: "lipo" });
    expect(rules(checkCircuit([b], []).findings)).toContain("warning:lipo");
  });
});

describe("good circuits are not flagged", () => {
  const clean = (components: CircuitComponent[], wires: Wire[]) => {
    const r = checkCircuit(components, wires);
    expect(r.findings.filter((f) => f.severity !== "info").map((f) => f.message)).toEqual([]);
    expect(r.summary).toMatch(/^No problems detected by MakerStudio's checks \(\d+ checks run\)\. This is not a guarantee\.$/);
    expect(r.summary.toLowerCase()).not.toContain("safe");
    return r;
  };

  it("LED with a 220 Ω resistor on an Uno pin", () => {
    const u = part("arduino-uno-r3"), r = part("resistor", { ohms: 220 }), led = part("led");
    clean([u, r, led], [w(u, "D13", r, "1"), w(r, "2", led, "A"), w(led, "K", u, "GND1")]);
  });

  it("LED with a resistor on a 9 V battery", () => {
    const b = part("battery", { volts: 9 }), r = part("resistor", { ohms: 820 }), led = part("led", { color: "blue" });
    clean([b, r, led], [w(b, "+", r, "1"), w(r, "2", led, "A"), w(led, "K", b, "-")]);
  });

  it("servo on an Uno: 5V, GND and a signal pin", () => {
    const u = part("arduino-uno-r3"), s = part("servo");
    clean([u, s], [w(u, "5V", s, "V"), w(u, "GND1", s, "GND"), w(u, "D9", s, "SIG")]);
  });

  it("OLED on a Pico (3.3 V) and a 1k/2k divider bringing 5 V down for a Pico pin", () => {
    const pico = part("raspberry-pi-pico"), o = part("oled-i2c"), u = part("arduino-uno-r3"), r1 = part("resistor", { ohms: 1000 }), r2 = part("resistor", { ohms: 2000 });
    clean([pico, o, u, r1, r2], [
      w(pico, "3V3", o, "VCC"), w(pico, "GND2", o, "GND"), w(pico, "GP4", o, "SDA"), w(pico, "GP5", o, "SCL"),
      w(u, "D2", r1, "1"), w(r1, "2", pico, "GP10"), w(r1, "2", r2, "1"), w(r2, "2", pico, "GND3"), w(u, "GND1", pico, "GND4"),
    ]);
  });

  it("a button between a GPIO pin and GND (open)", () => {
    const u = part("arduino-uno-r3"), b = part("button");
    clean([u, b], [w(u, "D2", b, "1"), w(b, "2", u, "GND1")]);
  });

  it("an empty canvas", () => {
    expect(checkCircuit([], []).summary).toBe("Nothing to check yet.");
  });
});

describe("circuit commands", () => {
  it("add parts and wires, change settings, delete with wires, undo, save", async () => {
    const { createProjectStore } = await import("../../src/core/document/store");
    const { addPart, addWire, deleteParts, updatePart, circuitOf } = await import("../../src/core/circuit/commands");
    const { packProject, unpackProject } = await import("../../src/shared/format");
    const s = createProjectStore(undefined, "test");
    const b = part("battery"), r = part("resistor");
    s.getState().execute(addPart({ component: b }));
    s.getState().execute(addPart({ component: r }));
    s.getState().execute(addWire({ wire: w(b, "+", r, "1") }));
    expect(() => s.getState().execute(addWire({ wire: w(r, "1", b, "+") }))).toThrow(/already connected/);
    expect(() => s.getState().execute(addWire({ wire: w(r, "9", b, "+") }))).toThrow(/no pin/);
    s.getState().execute(updatePart({ id: r.id, changes: { props: { ohms: 1000 } } }));
    expect(() => s.getState().execute(updatePart({ id: r.id, changes: { props: { ohms: -5 } } }))).toThrow(/Resistance must be/);
    expect(() => s.getState().execute(updatePart({ id: b.id, changes: { props: { chemistry: "plutonium" } } }))).toThrow(/Type must be one of/);
    const c = () => circuitOf(s.getState().project);
    expect(unpackProject(packProject(s.getState().project)).document.workspaces.circuit).toEqual(c());
    s.getState().execute(deleteParts({ ids: [r.id] }));
    expect(c().wires).toEqual([]);
    s.getState().undo();
    expect(c().wires).toHaveLength(1);
    expect(c().components.find((x) => x.id === r.id)!.props.ohms).toBe(1000);
  });
});

describe("wiring layout", () => {
  it("routes a wire that doubles back below its parts instead of through them", async () => {
    const { wireRoute } = await import("../../src/core/circuit/layout");
    const route = wireRoute({ cx: 117, cy: 62, side: "right" }, { cx: 76, cy: 55, side: "left" });
    // the long horizontal run is below the starting pin's row
    const runs = route.slice(1).map((p, i) => [route[i]!, p] as const).filter(([a, b]) => a[1] === b[1] && Math.abs(a[0] - b[0]) > 5);
    expect(runs.every(([a]) => a[1] > 62)).toBe(true);
    // a normal left-to-right wire stays direct
    expect(wireRoute({ cx: 10, cy: 5, side: "right" }, { cx: 30, cy: 5, side: "left" }).every(([, y]) => y === 5)).toBe(true);
  });
});

describe("wiring a robot", () => {
  const joint = (id: string, pin: number | null) => ({ id, name: id, child: `${id}-part`, parent: null, pivot: [0, 0, 0] as [number, number, number], axis: "z" as const, min: -90, max: 90, servo: { pin, center: 90, reversed: false } });
  const screen = (display: string) => ({ id: "s", name: "Face", display, face: {} as never });
  const robot = (pins: (number | null)[], display: string | null) => ({
    id: "r", name: "Desk buddy",
    joints: pins.map((p, i) => joint(`J${i}`, p)),
    mounts: display ? [{ id: "m", screenId: "s", objectId: "head", position: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], width: 30 }] : [],
  });
  let k = 0;
  const id = () => `id${++k}`;
  const problems = (c: { components: CircuitComponent[]; wires: Wire[] }) => checkCircuit(c.components, c.wires).findings.filter((f) => f.severity !== "info");

  it("Pico with two servos and an OLED: grounds joined, OLED on 3.3 V and GP4/GP5, no problems", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    const c = robotCircuit(robot([2, 3], "ssd1306-128x64"), [screen("ssd1306-128x64")], "raspberry-pi-pico", id);
    expect(c.components.map((x) => x.type).sort()).toEqual(["battery", "oled-i2c", "raspberry-pi-pico", "servo", "servo"]);
    const pico = c.components.find((x) => x.type === "raspberry-pi-pico")!;
    const oled = c.components.find((x) => x.type === "oled-i2c")!;
    const joined = (a: string, ap: string, b: string, bp: string) => c.wires.some((w) => (w.from.component === a && w.from.pin === ap && w.to.component === b && w.to.pin === bp));
    expect(joined(pico.id, "3V3", oled.id, "VCC") && joined(pico.id, "GP4", oled.id, "SDA") && joined(pico.id, "GP5", oled.id, "SCL")).toBe(true);
    expect(problems(c)).toEqual([]);
  });

  it("places the whole wiring at the origin, nothing above or left of it (regression: OLED off-screen)", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    for (const origin of [[0, 0], [4, 4], [80, 30]] as [number, number][]) {
      const c = robotCircuit(robot([4, 5], "ssd1306-128x64"), [screen("ssd1306-128x64")], "esp32-s3-devkitc-1", id, origin);
      expect(Math.min(...c.components.map((x) => x.x))).toBe(origin[0]);
      expect(Math.min(...c.components.map((x) => x.y))).toBe(origin[1]);
      expect(problems(c)).toEqual([]);
    }
  });

  it("lays the parts out without overlaps (names included)", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    const { partLayout } = await import("../../src/core/circuit/layout");
    for (const board of ["esp32-s3-devkitc-1", "arduino-uno-r3", "raspberry-pi-pico", "xiao-esp32s3-sense"]) {
      const c = robotCircuit(robot([4, 5, 6, 7], "ssd1306-128x64"), [screen("ssd1306-128x64")], board, id);
      // Each part's box, plus room above it for its name and drawings that reach over the box.
      const boxes = c.components.map((p) => { const L = partLayout(p.type); return { label: p.label, x0: p.x, x1: p.x + L.w, y0: p.y - 7, y1: p.y + L.h }; });
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a]!, B = boxes[b]!;
        const overlap = A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
        expect(overlap, `${board}: "${A.label}" overlaps "${B.label}"`).toBe(false);
      }
    }
  });

  it("Uno: OLED on 5V, servos on D9/D10", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    const c = robotCircuit(robot([9, 10], "ssd1306-128x64"), [screen("ssd1306-128x64")], "arduino-uno-r3", id);
    expect(c.wires.some((w) => w.from.pin === "5V" && c.components.find((x) => x.id === w.to.component)?.type === "oled-i2c")).toBe(true);
    expect(c.wires.filter((w) => w.from.pin === "D9" || w.from.pin === "D10")).toHaveLength(2);
    expect(problems(c)).toEqual([]);
  });

  it("CoreS3 on Port C; pins the board does not have are reported, not invented", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    const c = robotCircuit(robot([17, 18, 5, null], "m5stack-cores3"), [screen("m5stack-cores3")], "m5stack-cores3", id);
    expect(c.wires.filter((w) => w.from.pin === "G17" || w.from.pin === "G18")).toHaveLength(2);
    expect(c.notes.join(" ")).toMatch(/pin 5, which M5Stack CoreS3 \(ports\) does not have/);
    expect(c.notes.join(" ")).toMatch(/"J3" has no servo pin/);
    expect(c.notes.join(" ")).toMatch(/built into the M5Stack/);
    expect(problems(c)).toEqual([]);
  });

  it("adds everything as one undo step", async () => {
    const { robotCircuit } = await import("../../src/core/circuit/fromRobot");
    const { addMany, circuitOf } = await import("../../src/core/circuit/commands");
    const { createProjectStore } = await import("../../src/core/document/store");
    const s = createProjectStore(undefined, "test");
    const c = robotCircuit(robot([2], null), [], "esp32-s3-devkitc-1", id);
    s.getState().execute(addMany({ components: c.components, wires: c.wires, label: "Wire my robot" }));
    expect(circuitOf(s.getState().project).components).toHaveLength(3);
    s.getState().undo();
    expect(circuitOf(s.getState().project).components).toHaveLength(0);
  });

  it("current budget: two servos on a USB-powered Uno's 5V pin", () => {
    const u = part("arduino-uno-r3"), s1 = part("servo"), s2 = part("servo");
    const wires = [w(u, "5V", s1, "V"), w(u, "GND1", s1, "GND"), w(u, "D9", s1, "SIG"), w(u, "5V", s2, "V"), w(u, "GND2", s2, "GND"), w(u, "D10", s2, "SIG")];
    const f = checkCircuit([u, s1, s2], wires).findings.find((x) => x.rule === "current-budget")!;
    expect(f.severity).toBe("warning");
    expect(f.fix).toMatch(/own supply/);
  });
});

describe("drone parts (coreless motor, 1S LiPo, MPU-6050)", () => {
  const p = (id: string, type: string, props: Record<string, number | string | boolean> = {}): CircuitComponent =>
    ({ id, type, label: id, x: 0, y: 0, rotation: 0, props: { ...Object.fromEntries(componentDef(type)!.props.map((q) => [q.key, q.default])), ...props } });
  const wire = (i: string, a: string, b: string): Wire => { const [ac, ap] = a.split("."), [bc, bp] = b.split("."); return { id: i, from: { component: ac!, pin: ap! }, to: { component: bc!, pin: bp! }, color: "#ff0000" }; };
  const found = (parts: CircuitComponent[], wires: Wire[]) => checkCircuit(parts, wires).findings.filter((f) => f.severity !== "info");
  const S3 = "esp32-s3-devkitc-1";

  it("an MPU-6050 on 3V3 and the default I²C pins is clean", () => {
    expect(found([p("b", S3), p("i", "imu-mpu6050")], [wire("1", "b.3V3", "i.VCC"), wire("2", "b.GND", "i.GND"), wire("3", "b.GPIO8", "i.SDA"), wire("4", "b.GPIO9", "i.SCL"), wire("5", "i.INT", "b.GPIO12")])).toEqual([]);
  });
  it("a coreless motor straight on a GPIO pin is flagged", () => {
    expect(found([p("b", S3), p("m", "coreless-motor")], [wire("1", "b.GPIO4", "m.+"), wire("2", "m.-", "b.GND")]).some((f) => /GPIO pin can only supply a few milliamps/.test(f.message))).toBe(true);
  });
  it("a 1S LiPo always carries its safety warning, and a short is danger", () => {
    const short = found([p("bat", "lipo-1s")], [wire("1", "bat.+", "bat.-")]);
    expect(short.some((f) => f.severity === "danger" && /Short circuit/.test(f.message))).toBe(true);
    expect(short.some((f) => /LiPo/.test(f.message))).toBe(true);
  });
});

describe("wiring a drone", () => {
  it("wires every motor through a MOSFET with pull-down and diode, IMU on I²C; clean checks; no overlaps", async () => {
    const { droneCircuit } = await import("../../src/core/circuit/fromDrone");
    const { defaultDrone, quadX } = await import("../../src/core/drone/model");
    const { partLayout } = await import("../../src/core/circuit/layout");
    let k = 0;
    for (const [board, pins] of [["esp32s3", [4, 5, 6, 7]], ["xiao-esp32s3", [1, 2, 3, 4]]] as const) {
      const c = droneCircuit(defaultDrone(quadX(120)), board, [...pins], () => `d${++k}`);
      const types = c.components.map((x) => x.type);
      expect(types.filter((t) => t === "coreless-motor")).toHaveLength(4);
      expect(types.filter((t) => t === "mosfet")).toHaveLength(4);
      expect(types.filter((t) => t === "diode")).toHaveLength(4);
      expect(c.components.filter((x) => x.type === "resistor").every((r) => r.props.ohms === 10000)).toBe(true);
      const findings = checkCircuit(c.components, c.wires).findings.filter((f) => f.severity === "danger");
      expect(findings).toEqual([]);
      expect(c.wires.filter((w) => w.to.pin === "G" && c.components.find((x) => x.id === w.from.component)?.type !== "resistor")).toHaveLength(4);
      const boxes = c.components.map((p) => { const L = partLayout(p.type); return { label: p.label, x0: p.x, x1: p.x + L.w, y0: p.y - 7, y1: p.y + L.h }; });
      for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a]!, B = boxes[b]!;
        expect(A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1, `${board}: "${A.label}" overlaps "${B.label}"`).toBe(false);
      }
    }
  });
});
