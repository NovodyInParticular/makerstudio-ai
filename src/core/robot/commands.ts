// Commands for the Robotics Studio. One robot per project (created on first use).

import { cadObjects } from "../cad/commands";
import { defineCommand, type EditableState } from "../document/commands";
import { MAX_NESTING, nestingDepth } from "./behavior";
import { jointProblem, JointSchema, RobotSchema, ScreenMountSchema, type Joint, type Robot, type ScreenMount } from "./model";
import { BehaviorSchema, type Behavior } from "./schema";

export function robotOf(state: EditableState): Robot | null {
  return (state.document.workspaces.robotics.assemblies[0] as Robot | undefined) ?? null;
}

function ensureRobot(draft: EditableState): Robot {
  const list = draft.document.workspaces.robotics.assemblies as Robot[];
  if (!list[0]) list.push(RobotSchema.parse({ id: "robot", name: "Robot", joints: [], mounts: [] }));
  return list[0]!;
}

function topLevel(draft: EditableState): Set<string> {
  return new Set(cadObjects(draft).filter((o) => o.parentId === null).map((o) => o.id));
}

function check(robot: Robot, joint: Joint, draft: EditableState) {
  const problem = jointProblem(robot, joint, topLevel(draft));
  if (problem) throw new Error(problem);
}

export const addJoint = defineCommand<{ joint: Joint }>({
  type: "robot.addJoint",
  label: ({ joint }) => `Add joint "${joint.name}"`,
  apply(draft, { joint }) {
    const robot = ensureRobot(draft);
    const parsed = JointSchema.parse(joint);
    if (robot.joints.some((j) => j.id === parsed.id)) throw new Error("A joint with this id already exists.");
    if (robot.joints.length >= 64) throw new Error("A robot can have at most 64 joints.");
    check(robot, parsed, draft);
    robot.joints.push(parsed);
  },
});

export const setJoint = defineCommand<{ id: string; changes: Partial<Omit<Joint, "id">>; merge?: string }>({
  type: "robot.setJoint",
  label: ({ changes }) => (changes.name !== undefined ? `Rename joint to "${changes.name}"` : "Change joint"),
  apply(draft, { id, changes }) {
    const robot = ensureRobot(draft);
    const i = robot.joints.findIndex((j) => j.id === id);
    if (i < 0) throw new Error("That joint no longer exists.");
    const next = JointSchema.safeParse({ ...robot.joints[i], ...changes, servo: { ...robot.joints[i]!.servo, ...(changes.servo ?? {}) } });
    if (!next.success) throw new Error(`Invalid joint: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    check(robot, next.data, draft);
    robot.joints[i] = next.data;
  },
  mergeKey: ({ merge }) => merge,
});

export const deleteJoint = defineCommand<{ id: string }>({
  type: "robot.deleteJoint",
  label: () => "Delete joint",
  apply(draft, { id }) {
    const robot = ensureRobot(draft);
    const i = robot.joints.findIndex((j) => j.id === id);
    if (i < 0) throw new Error("That joint no longer exists.");
    robot.joints.splice(i, 1);
  },
});

export const addMount = defineCommand<{ mount: ScreenMount }>({
  type: "robot.addMount",
  label: () => "Mount screen",
  apply(draft, { mount }) {
    const robot = ensureRobot(draft);
    const parsed = ScreenMountSchema.parse(mount);
    if (!topLevel(draft).has(parsed.objectId)) throw new Error("A screen must be mounted on a top-level part.");
    if (!(draft.document.workspaces.displays.screens as { id: string }[]).some((s) => s.id === parsed.screenId)) throw new Error("That screen no longer exists.");
    if (robot.mounts.length >= 16) throw new Error("A robot can have at most 16 screens.");
    robot.mounts.push(parsed);
  },
});

export const setMount = defineCommand<{ id: string; changes: Partial<Omit<ScreenMount, "id">>; merge?: string }>({
  type: "robot.setMount",
  label: () => "Change mounted screen",
  apply(draft, { id, changes }) {
    const robot = ensureRobot(draft);
    const i = robot.mounts.findIndex((m) => m.id === id);
    if (i < 0) throw new Error("That mounted screen no longer exists.");
    const next = ScreenMountSchema.safeParse({ ...robot.mounts[i], ...changes });
    if (!next.success) throw new Error(`Invalid screen mount: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    if (!topLevel(draft).has(next.data.objectId)) throw new Error("A screen must be mounted on a top-level part.");
    robot.mounts[i] = next.data;
  },
  mergeKey: ({ merge }) => merge,
});

export const deleteMount = defineCommand<{ id: string }>({
  type: "robot.deleteMount",
  label: () => "Remove mounted screen",
  apply(draft, { id }) {
    const robot = ensureRobot(draft);
    const i = robot.mounts.findIndex((m) => m.id === id);
    if (i < 0) throw new Error("That mounted screen no longer exists.");
    robot.mounts.splice(i, 1);
  },
});

// --- behaviours (Phase 9b) ----------------------------------------------------------------

function checkBehavior(b: Behavior) {
  if (nestingDepth(b.steps) > MAX_NESTING) throw new Error(`Repeats can be nested at most ${MAX_NESTING} deep.`);
}

export const addBehavior = defineCommand<{ behavior: Behavior }>({
  type: "robot.addBehavior",
  label: ({ behavior }) => `Add behaviour "${behavior.name}"`,
  apply(draft, { behavior }) {
    const robot = ensureRobot(draft);
    const list = (robot.behaviors ??= []);
    if (list.length >= 20) throw new Error("A robot can have at most 20 behaviours.");
    const parsed = BehaviorSchema.parse(behavior);
    checkBehavior(parsed);
    if (list.some((b) => b.id === parsed.id)) throw new Error("A behaviour with this id already exists.");
    list.push(parsed);
  },
});

export const setBehavior = defineCommand<{ id: string; changes: Partial<Omit<Behavior, "id">>; merge?: string; label?: string }>({
  type: "robot.setBehavior",
  label: ({ label, changes }) => label ?? (changes.name !== undefined ? `Rename behaviour to "${changes.name}"` : "Edit behaviour"),
  apply(draft, { id, changes }) {
    const robot = ensureRobot(draft);
    const list = robot.behaviors ?? [];
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) throw new Error("That behaviour no longer exists.");
    const next = BehaviorSchema.safeParse({ ...list[i], ...changes });
    if (!next.success) throw new Error(`Invalid behaviour: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    checkBehavior(next.data);
    list[i] = next.data;
  },
  mergeKey: ({ merge }) => merge,
});

export const deleteBehavior = defineCommand<{ id: string }>({
  type: "robot.deleteBehavior",
  label: () => "Delete behaviour",
  apply(draft, { id }) {
    const list = ensureRobot(draft).behaviors ?? [];
    const i = list.findIndex((b) => b.id === id);
    if (i < 0) throw new Error("That behaviour no longer exists.");
    list.splice(i, 1);
  },
});
