// Robots: joints (servos) between 3D Studio parts, and screens mounted on parts.
//
// The 3D model as designed is the robot's "home pose": every joint at 0°. A joint turns its
// moving part (and everything attached further down the chain) around an axis through a
// pivot point. Pivots and screen positions are stored in world millimetres at the home pose.

import { Matrix4, Vector3 } from "three";
import type { Axis, Joint, Robot } from "./schema";

export * from "./schema";

export function axisVector(axis: Axis): Vector3 {
  const v = new Vector3(axis.endsWith("x") ? 1 : 0, axis.endsWith("y") ? 1 : 0, axis.endsWith("z") ? 1 : 0);
  return axis.startsWith("-") ? v.negate() : v;
}

export const clampAngle = (j: Joint, deg: number) => Math.min(j.max, Math.max(j.min, deg));

/**
 * How far each top-level object has moved from the home pose: a world-space matrix that is
 * applied on top of the object's own placement. Objects without a joint do not move
 * (unless they hang below a joint, through `parent`).
 */
export function poseMatrices(robot: Robot, angles: Record<string, number>): Map<string, Matrix4> {
  const byChild = new Map(robot.joints.map((j) => [j.child, j]));
  const result = new Map<string, Matrix4>();
  const visiting = new Set<string>();
  const delta = (objectId: string): Matrix4 => {
    const done = result.get(objectId);
    if (done) return done;
    const joint = byChild.get(objectId);
    if (!joint || visiting.has(objectId)) return new Matrix4();
    visiting.add(objectId);
    const parentDelta = joint.parent ? delta(joint.parent) : new Matrix4();
    const angle = (clampAngle(joint, angles[joint.id] ?? 0) * Math.PI) / 180;
    const p = new Vector3(...joint.pivot);
    const local = new Matrix4().makeTranslation(p.x, p.y, p.z)
      .multiply(new Matrix4().makeRotationAxis(axisVector(joint.axis), angle))
      .multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    const m = parentDelta.clone().multiply(local);
    visiting.delete(objectId);
    result.set(objectId, m);
    return m;
  };
  for (const j of robot.joints) delta(j.child);
  return result;
}

/** Problems that make a joint impossible; null when it is fine. */
export function jointProblem(robot: Robot, joint: Joint, topLevelIds: Set<string>): string | null {
  if (!topLevelIds.has(joint.child)) return "The moving part no longer exists (or is inside a group).";
  if (joint.parent !== null && !topLevelIds.has(joint.parent)) return "The part it is attached to no longer exists.";
  if (joint.parent === joint.child) return "A part cannot be attached to itself.";
  if (robot.joints.some((j) => j.id !== joint.id && j.child === joint.child)) return "That part already has a joint. A part can be moved by one joint (chain joints through parts instead).";
  // Following the chain upward must never come back to the moving part.
  const byChild = new Map(robot.joints.filter((j) => j.id !== joint.id).map((j) => [j.child, j]));
  let up = joint.parent;
  for (let guard = 0; up && guard < 100; guard++) {
    if (up === joint.child) return "That would make a loop: the part would be attached to itself through other joints.";
    up = byChild.get(up)?.parent ?? null;
  }
  return null;
}
