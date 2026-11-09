// Robot data as saved in the project file (zod only, no 3D library, so the main process can use it).

import { z } from "zod";
import { MOODS, type Mood } from "../display/mood";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const AXES = ["x", "y", "z", "-x", "-y", "-z"] as const;
export type Axis = (typeof AXES)[number];

export const JointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  /** Top-level 3D Studio object that this joint moves. */
  child: z.string().min(1),
  /** Top-level object it is attached to, or null for the fixed base (the bed). */
  parent: z.string().min(1).nullable(),
  pivot: vec3,
  axis: z.enum(AXES),
  /** Allowed range in degrees around the home pose (0°). */
  min: z.number().min(-180).max(0),
  max: z.number().min(0).max(180),
  /** How it is driven on the real robot (used by the firmware export). */
  servo: z.object({
    /** Board pin for a hobby (PWM) servo, or null if not wired yet. */
    pin: z.number().int().min(0).max(64).nullable(),
    /** Servo angle (0-180°) at the home pose; usually 90 (centred). */
    center: z.number().min(0).max(180),
    reversed: z.boolean(),
  }),
});
export type Joint = z.infer<typeof JointSchema>;

export const ScreenMountSchema = z.object({
  id: z.string().min(1),
  /** Display Studio screen shown here. */
  screenId: z.string().min(1),
  /** Top-level object the screen is fixed to (it moves with it). */
  objectId: z.string().min(1),
  /** Centre of the screen and the direction it faces, world mm at the home pose. */
  position: vec3,
  normal: vec3,
  /** Visible width of the screen, mm. */
  width: z.number().min(5).max(500),
});
export type ScreenMount = z.infer<typeof ScreenMountSchema>;

const ms = z.number().int().min(0).max(60000);
const wait = z.boolean(); // false = start it and go straight on to the next step

export type Step =
  | { kind: "mood"; mood: Mood }
  | { kind: "look"; x: number; y: number; ms: number; wait: boolean }
  | { kind: "move"; joint: string; angle: number; ms: number; wait: boolean }
  | { kind: "animation"; screen: string; animation: string; wait: boolean }
  | { kind: "talk"; ms: number; wait: boolean }
  | { kind: "blink" }
  | { kind: "wait"; ms: number }
  | { kind: "repeat"; times: number; steps: Step[] };

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("mood"), mood: z.enum(MOODS) }),
    z.object({ kind: z.literal("look"), x: z.number().min(-1).max(1), y: z.number().min(-1).max(1), ms, wait }),
    z.object({ kind: z.literal("move"), joint: z.string().min(1), angle: z.number().min(-180).max(180), ms, wait }),
    z.object({ kind: z.literal("animation"), screen: z.string().min(1), animation: z.string().min(1), wait }),
    z.object({ kind: z.literal("talk"), ms, wait }),
    z.object({ kind: z.literal("blink") }),
    z.object({ kind: z.literal("wait"), ms }),
    /** times 0 = forever */
    z.object({ kind: z.literal("repeat"), times: z.number().int().min(0).max(1000), steps: z.array(StepSchema).max(100) }),
  ]),
);

export const BehaviorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  /** Blink and glance around on its own between steps. */
  idle: z.boolean(),
  steps: z.array(StepSchema).max(200),
});
export type Behavior = z.infer<typeof BehaviorSchema>;


export const RobotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  joints: z.array(JointSchema).max(64),
  mounts: z.array(ScreenMountSchema).max(16),
  /** Missing in files made before Phase 9b. */
  behaviors: z.array(BehaviorSchema).max(20).optional(),
});
export type Robot = z.infer<typeof RobotSchema>;

