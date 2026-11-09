// Commands for the Drone Studio. One drone design per project.

import { cadObjects } from "../cad/commands";
import { worldBounds } from "../cad/geometry";
import type { CadObject } from "../cad/model";
import { defineCommand, type EditableState } from "../document/commands";
import { defaultDrone, DroneSchema, quadX, type Drone, type Motor } from "./model";

export function droneOf(state: EditableState): Drone | null {
  return (state.document.workspaces as { drone?: Drone }).drone ?? null;
}

/** Replaces the drone design (validated). Undoable; quick edits to the same field merge into one step. */
export const setDrone = defineCommand<{ drone: Drone; label?: string; merge?: string }>({
  type: "drone.set",
  label: ({ label }) => label ?? "Change drone design",
  apply(draft, { drone }) {
    const parsed = DroneSchema.parse(drone);
    const known = new Set(cadObjects(draft).filter((o) => o.parentId === null).map((o) => o.id));
    if (parsed.frame.some((id) => !known.has(id))) throw new Error("A frame part no longer exists in 3D Studio.");
    (draft.document.workspaces as { drone?: Drone }).drone = parsed;
  },
  mergeKey: ({ merge }) => merge,
});

export const clearDrone = defineCommand<Record<string, never>>({
  type: "drone.clear",
  label: () => "Remove drone design",
  apply(draft) {
    delete (draft.document.workspaces as { drone?: Drone }).drone;
  },
});

/**
 * Motor positions for a new design: 3D objects named like "Motor …" (3 to 8 of them: their
 * centres, top height), or an X quad sized to the frame. Spins alternate around the centre.
 */
export function guessMotors(objects: CadObject[]): { motors: Motor[]; from: string } {
  const named = objects.filter((o) => o.visible && !o.hole && /motor/i.test(o.name) && !/hole/i.test(o.name));
  const centres = named.map((o) => { const b = worldBounds([o.id], objects); return [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z] as [number, number, number]; })
    .filter((c) => c.every(Number.isFinite));
  if (centres.length >= 3 && centres.length <= 8) {
    const cx = centres.reduce((s, c) => s + c[0], 0) / centres.length, cy = centres.reduce((s, c) => s + c[1], 0) / centres.length;
    const sorted = [...centres].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    return { motors: sorted.map((position, i) => ({ position, spin: i % 2 ? 1 : -1 })), from: `the ${centres.length} objects named "Motor…" in 3D Studio` };
  }
  const roots = objects.filter((o) => o.parentId === null && o.visible);
  if (roots.length) {
    const b = worldBounds(roots.map((o) => o.id), objects);
    if (!b.isEmpty()) {
      const size = Math.min(b.max.x - b.min.x, b.max.y - b.min.y);
      const diagonal = Math.max(60, size * Math.SQRT2 * 0.9);
      return { motors: quadX(diagonal, [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2], b.max.z), from: "an X quad sized to the frame (move them to your motor mounts)" };
    }
  }
  return { motors: quadX(120), from: "a 120 mm X quad (no frame yet)" };
}

export function newDroneDesign(objects: CadObject[]): { drone: Drone; from: string } {
  const { motors, from } = guessMotors(objects);
  const drone = defaultDrone(motors);
  // The frame: top-level objects whose centre lies within the motor layout (leaves out things
  // like a nameplate or a stand lying next to the drone).
  const xs = motors.map((m) => m.position[0]), ys = motors.map((m) => m.position[1]);
  const area = { x0: Math.min(...xs) - 5, x1: Math.max(...xs) + 5, y0: Math.min(...ys) - 5, y1: Math.max(...ys) + 5 };
  const roots = objects.filter((o) => o.parentId === null && o.visible);
  const inside = roots.filter((o) => {
    const b = worldBounds([o.id], objects);
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2;
    return !b.isEmpty() && cx >= area.x0 && cx <= area.x1 && cy >= area.y0 && cy <= area.y1;
  });
  if (inside.length && inside.length < roots.length) drone.frame = inside.map((o) => o.id);
  return { drone, from };
}
