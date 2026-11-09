// What the AI can see: a compact, structured snapshot of the project (AI_ARCHITECTURE.md §2).
// Large scenes are summarised: the first objects in full, the rest counted.

import { cadObjects } from "../cad/commands";
import { worldBounds } from "../cad/geometry";
import type { CadObject } from "../cad/model";
import { checkCircuit } from "../circuit/checks";
import { circuitOf } from "../circuit/commands";
import type { EditableState } from "../document/commands";
import type { Screen } from "../display/face";
import { robotOf } from "../robot/commands";

const MAX_OBJECTS = 60;
const MAX_PARTS = 80;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SnapshotExtras {
  workspace?: string;
  selection?: string[];
  printer?: { name: string; bedX: number; bedY: number; bedZ: number; nozzle: number };
}

export function projectSnapshot(state: EditableState, extras: SnapshotExtras = {}) {
  const objects = cadObjects(state);
  const describe = (o: CadObject) => {
    let bbox: { min: number[]; max: number[] } | undefined;
    try {
      const b = worldBounds([o.id], objects);
      if (!b.isEmpty()) bbox = { min: b.min.toArray().map(r2), max: b.max.toArray().map(r2) };
    } catch { /* bounds need the geometry engine for groups; leave them out */ }
    return {
      id: o.id, name: o.name, kind: o.kind, parent: o.parentId,
      params: o.params, ...(o.text !== undefined ? { text: o.text } : {}),
      position: o.transform.position, rotation: o.transform.rotation, scale: o.transform.scale,
      hole: o.hole, visible: o.visible, locked: o.locked, color: o.color, ...(o.boolean ? { boolean: o.boolean } : {}),
      ...(bbox ? { bbox_mm: bbox } : {}),
    };
  };
  const circuit = circuitOf(state);
  const report = checkCircuit(circuit.components, circuit.wires);
  const screens = state.document.workspaces.displays.screens as Screen[];
  const robot = robotOf(state);
  return {
    project: state.document.name,
    units: "mm",
    workspace: extras.workspace ?? null,
    selection: extras.selection ?? [],
    printer: extras.printer ?? null,
    cad: {
      count: objects.length,
      objects: objects.slice(0, MAX_OBJECTS).map(describe),
      ...(objects.length > MAX_OBJECTS ? { more: objects.length - MAX_OBJECTS } : {}),
    },
    circuit: {
      parts: circuit.components.slice(0, MAX_PARTS).map((c) => ({ id: c.id, type: c.type, label: c.label, props: c.props })),
      wires: circuit.wires.slice(0, MAX_PARTS * 2).map((w) => ({ id: w.id, from: w.from, to: w.to })),
      ...(circuit.components.length > MAX_PARTS ? { more_parts: circuit.components.length - MAX_PARTS } : {}),
      checks: { summary: report.summary, findings: report.findings.map((f) => ({ severity: f.severity, rule: f.rule, message: f.message, fix: f.fix, parts: f.components })) },
    },
    displays: screens.map((s) => ({ id: s.id, name: s.name, display: s.display, face: s.face, animations: (s.animations ?? []).map((a) => ({ id: a.id, name: a.name, duration_ms: a.duration, loop: a.loop })) })),
    robot: robot ? {
      joints: robot.joints.map((j) => ({ id: j.id, name: j.name, moves: j.child, attached_to: j.parent, axis: j.axis, pivot: j.pivot, range: [j.min, j.max], servo: j.servo })),
      mounts: robot.mounts.map((m) => ({ id: m.id, screen: m.screenId, on: m.objectId, width_mm: m.width })),
      behaviors: (robot.behaviors ?? []).map((b) => ({ id: b.id, name: b.name, steps: b.steps.length })),
    } : null,
    notes_characters: state.notes.length,
  };
}
