import { describe, expect, it } from "vitest";
import { designReport } from "../../src/core/ai/design";
import { createEmptyProject } from "../../src/shared/format";
import { DEFAULT_PARAMS, IDENTITY, type CadObject } from "../../src/core/cad/model";
import { componentDef } from "../../src/core/circuit/catalog";
import { DEFAULT_FACE } from "../../src/core/display/face";

const box = (id: string, w = 40, d = 40, h = 40): CadObject => ({ id, name: id, kind: "box", params: { ...DEFAULT_PARAMS.box, width: w, depth: d, height: h }, transform: { ...IDENTITY }, hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false });
const part = (id: string, type: string) => ({ id, type, label: id, x: 0, y: 0, rotation: 0 as const, props: Object.fromEntries(componentDef(type)!.props.map((p) => [p.key, p.default])) });
const joint = (id: string, pin: number | null) => ({ id, name: id, child: "head", parent: "body", pivot: [0, 0, 40] as [number, number, number], axis: "z" as const, min: -45, max: 45, servo: { pin, center: 90, reversed: false } });

function project() {
  const p = createEmptyProject("t", "test");
  p.document.workspaces.cad.objects = [box("body"), box("head")];
  return p;
}
const A1 = { bedX: 256, bedY: 256, bedZ: 256 };

describe("design report across studios", () => {
  it("flags an unwired servo, a shared pin and a screen missing from the circuit", () => {
    const p = project();
    p.document.workspaces.robotics.assemblies = [{ id: "robot", name: "R", joints: [joint("Nod", 9), joint("Turn", 9)], mounts: [{ id: "m", screenId: "s", objectId: "head", position: [0, 0, 60], normal: [0, -1, 0], width: 25 }] }];
    p.document.workspaces.displays.screens = [{ id: "s", name: "Face", display: "ssd1306-128x64", face: { ...DEFAULT_FACE } }];
    p.document.workspaces.circuit.components = [part("uno", "arduino-uno-r3")];
    const r = designReport(p as never, A1);
    expect(r.some((f) => f.area === "Wiring" && /"Nod" expects a servo on Arduino UNO R3 D9/.test(f.message))).toBe(true);
    expect(r.some((f) => /share pin 9/.test(f.message))).toBe(true);
    expect(r.some((f) => f.area === "Screens" && /not in Circuit Studio/.test(f.message))).toBe(true);
  });
  it("is clean when the servo and screen are wired", () => {
    const p = project();
    p.document.workspaces.robotics.assemblies = [{ id: "robot", name: "R", joints: [joint("Nod", 9)], mounts: [{ id: "m", screenId: "s", objectId: "head", position: [0, 0, 60], normal: [0, -1, 0], width: 25 }] }];
    p.document.workspaces.displays.screens = [{ id: "s", name: "Face", display: "ssd1306-128x64", face: { ...DEFAULT_FACE } }];
    p.document.workspaces.circuit.components = [part("uno", "arduino-uno-r3"), part("sv", "servo"), part("oled", "oled-i2c")];
    p.document.workspaces.circuit.wires = [{ id: "w", from: { component: "uno", pin: "D9" }, to: { component: "sv", pin: "SIG" }, color: "#f2b84b" }];
    const r = designReport(p as never, A1);
    expect(r.filter((f) => f.severity === "danger" || (f.severity === "warning" && f.area !== "Wiring"))).toEqual([]);
    expect(r.some((f) => /expects a servo/.test(f.message))).toBe(false);
  });
  it("flags a part bigger than the printer", () => {
    const p = project();
    p.document.workspaces.cad.objects = [box("Hull", 300, 40, 40)];
    expect(designReport(p as never, A1).some((f) => f.area === "Printing" && /bigger than the 256/.test(f.message))).toBe(true);
  });
});
