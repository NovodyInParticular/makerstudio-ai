// Design check across the studios (Phase 10): does the robot, its wiring, its screens and its
// printed parts fit together? Each studio checks itself; this checks them against each other.

import { worldBounds } from "../cad/geometry";
import { cadObjects } from "../cad/commands";
import { componentDef } from "../circuit/catalog";
import { buildNetlist, checkCircuit, pinKey } from "../circuit/checks";
import { circuitOf } from "../circuit/commands";
import type { EditableState } from "../document/commands";
import type { Screen } from "../display/face";
import { robotOf } from "../robot/commands";

export interface DesignFinding { area: "Robot" | "Wiring" | "Screens" | "Printing"; severity: "danger" | "warning" | "info" | "ok"; message: string; fix?: string }

/** Circuit part types that carry each display (null: not in the circuit library yet). */
const DISPLAY_PART: Record<string, string | null> = {
  "ssd1306-128x64": "oled-i2c", "ssd1306-128x32": "oled-i2c", "sh1106-128x64": "oled-i2c",
  "ili9341-240x320": "tft-ili9341", "gc9a01-240": null, "st7789-240x240": null, "st7789-240x320": null,
  "m5stack-cores3": "m5stack-cores3", "m5stack-core2": null,
};

export function designReport(state: EditableState, printer?: { bedX: number; bedY: number; bedZ: number }): DesignFinding[] {
  const out: DesignFinding[] = [];
  const objects = cadObjects(state);
  const objIds = new Set(objects.map((o) => o.id));
  const { components, wires } = circuitOf(state);
  const robot = robotOf(state);
  const screens = state.document.workspaces.displays.screens as Screen[];
  const nets = buildNetlist(components, wires);
  const board = components.find((c) => { const d = componentDef(c.type); return d?.electrical.kind === "board" && d.gpio; });
  const boardDef = board ? componentDef(board.type) : undefined;

  // --- robot joints vs 3D objects and wiring ---
  if (robot && robot.joints.length) {
    const pins = new Map<number, string[]>();
    for (const j of robot.joints) {
      if (!objIds.has(j.child) || (j.parent && !objIds.has(j.parent))) {
        out.push({ area: "Robot", severity: "warning", message: `Joint "${j.name}" points at a 3D object that no longer exists.`, fix: "Delete the joint and make it again in Robotics Studio." });
      }
      if (j.servo.pin === null) { out.push({ area: "Robot", severity: "info", message: `Joint "${j.name}" has no servo pin yet, so it cannot move on the real robot.`, fix: "Set its pin in Robotics Studio." }); continue; }
      pins.set(j.servo.pin, [...(pins.get(j.servo.pin) ?? []), j.name]);
      if (!board || !boardDef) continue;
      const pinId = boardDef.gpio!(j.servo.pin);
      if (!pinId) { out.push({ area: "Wiring", severity: "warning", message: `Joint "${j.name}" uses pin ${j.servo.pin}, which ${boardDef.name} does not have.`, fix: "Pick a pin the board has (Robotics Studio)." }); continue; }
      const net = nets.find(pinKey(board.id, pinId));
      const servo = components.find((c) => c.type === "servo" && nets.find(pinKey(c.id, "SIG")) === net);
      if (!servo) out.push({ area: "Wiring", severity: "warning", message: `Joint "${j.name}" expects a servo on ${boardDef.name} ${pinId}, but no servo signal is wired there in Circuit Studio.`, fix: "In Circuit Studio use \"Wire my robot\", or wire the servo's signal to that pin." });
    }
    for (const [pin, names] of pins) if (names.length > 1) out.push({ area: "Robot", severity: "warning", message: `Joints ${names.map((n) => `"${n}"`).join(" and ")} share pin ${pin}: they would always move together.`, fix: "Give each joint its own pin." });
    if (!board && [...pins.keys()].length) out.push({ area: "Wiring", severity: "info", message: "The robot has servo pins but Circuit Studio has no board yet.", fix: "Use \"Wire my robot\" in Circuit Studio." });
  }

  // --- screens ---
  for (const m of robot?.mounts ?? []) {
    const s = screens.find((x) => x.id === m.screenId);
    if (!s) { out.push({ area: "Screens", severity: "warning", message: "A screen mount shows a face that no longer exists.", fix: "Mount another face in Robotics Studio." }); continue; }
    if (!objIds.has(m.objectId)) out.push({ area: "Screens", severity: "warning", message: `"${s.name}" is mounted on a 3D object that no longer exists.` });
    const part = DISPLAY_PART[s.display];
    if (part === null || part === undefined) out.push({ area: "Screens", severity: "info", message: `"${s.name}" uses a ${s.display} screen, which Circuit Studio cannot check yet: wire it by its datasheet.` });
    else if (!components.some((c) => c.type === part)) out.push({ area: "Screens", severity: "warning", message: `"${s.name}" is on the robot, but its screen (${componentDef(part)?.name ?? part}) is not in Circuit Studio.`, fix: "Use \"Wire my robot\" or add the screen part and wire it." });
  }

  // --- circuit ---
  if (components.length) {
    const r = checkCircuit(components, wires);
    const d = r.findings.filter((f) => f.severity === "danger").length, w = r.findings.filter((f) => f.severity === "warning").length;
    out.push(d ? { area: "Wiring", severity: "danger", message: `Circuit Studio reports ${d} danger finding${d > 1 ? "s" : ""}${w ? ` and ${w} warning${w > 1 ? "s" : ""}` : ""}.`, fix: "Open Circuit Studio and fix them first." }
      : w ? { area: "Wiring", severity: "warning", message: `Circuit Studio reports ${w} warning${w > 1 ? "s" : ""}.`, fix: "Open Circuit Studio to see them." }
        : { area: "Wiring", severity: "ok", message: `Circuit checks: ${r.summary}` });
  }

  // --- printing: top-level objects vs the printer's build volume ---
  if (printer) {
    for (const o of objects.filter((x) => x.parentId === null && x.visible && !x.hole)) {
      let b;
      try { b = worldBounds([o.id], objects); } catch { continue; }
      if (b.isEmpty()) continue;
      const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
      if (size[0]! > printer.bedX || size[1]! > printer.bedY || size[2]! > printer.bedZ) {
        out.push({ area: "Printing", severity: "warning", message: `"${o.name}" is ${size.map((v) => v.toFixed(0)).join(" × ")} mm: bigger than the ${printer.bedX} × ${printer.bedY} × ${printer.bedZ} mm build volume.`, fix: "Split it into parts or scale it down." });
      } else if (b.min.z < -0.05) out.push({ area: "Printing", severity: "info", message: `"${o.name}" goes below the bed (z < 0).`, fix: "Select it and press D (drop to bed)." });
    }
  }
  if (!out.some((f) => f.severity !== "ok")) out.push({ area: "Robot", severity: "ok", message: "No cross-studio problems found. This is not a guarantee: test-fit and test-wire before the final build." });
  return out;
}
