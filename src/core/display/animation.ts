// Face animations: keyframes on a timeline.
//
// A keyframe sets only the channels it names (mood, gaze, blink, talk). Each channel is
// interpolated on its own between the keyframes that set it, so a blink keyframe does not
// freeze where the eyes are looking. Numbers ease smoothly; the mood switches at its keyframe.
// The same sampler will drive the robot (Phase 8c exports the keyframes to code).

import { z } from "zod";
import { MOODS, NEUTRAL, type FaceState } from "./mood";

export const MAX_DURATION = 60000; // ms
export const MAX_KEYFRAMES = 400;

export const KeyframeSchema = z.object({
  /** Time from the start, ms. */
  t: z.number().int().min(0).max(MAX_DURATION),
  mood: z.enum(MOODS).optional(),
  lookX: z.number().min(-1).max(1).optional(),
  lookY: z.number().min(-1).max(1).optional(),
  blink: z.number().min(0).max(1).optional(),
  talk: z.number().min(0).max(1).optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const AnimationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  duration: z.number().int().min(100).max(MAX_DURATION),
  loop: z.boolean(),
  keyframes: z.array(KeyframeSchema).max(MAX_KEYFRAMES),
});
export type Animation = z.infer<typeof AnimationSchema>;

export const CHANNELS = ["mood", "lookX", "lookY", "blink", "talk"] as const;
export type Channel = (typeof CHANNELS)[number];
type NumberChannel = Exclude<Channel, "mood">;

/** Smooth start and end (ease in-out). */
const ease = (x: number) => x * x * (3 - 2 * x);

/** The face state at time t (ms). Looping animations wrap; others hold the last frame. */
export function sampleAnimation(anim: Animation, t: number, base: FaceState = NEUTRAL): FaceState {
  const time = anim.loop ? ((t % anim.duration) + anim.duration) % anim.duration : Math.min(Math.max(t, 0), anim.duration);
  const frames = [...anim.keyframes].sort((a, b) => a.t - b.t);
  const state: FaceState = { ...base };

  // Mood: the last mood keyframe at or before now (or the first one, before it starts).
  const moods = frames.filter((k) => k.mood !== undefined);
  if (moods.length) {
    let current = moods[0]!.mood!;
    for (const k of moods) if (k.t <= time) current = k.mood!;
    state.mood = current;
  }

  for (const channel of ["lookX", "lookY", "blink", "talk"] as NumberChannel[]) {
    const keys = frames.filter((k) => k[channel] !== undefined);
    if (keys.length === 0) continue;
    if (time <= keys[0]!.t) { state[channel] = keys[0]![channel]!; continue; }
    const last = keys[keys.length - 1]!;
    if (time >= last.t) {
      // A looping animation eases from its last key back to its first.
      if (anim.loop && keys.length > 1) {
        const span = anim.duration - last.t + keys[0]!.t;
        const x = span > 0 ? (time - last.t) / span : 1;
        state[channel] = last[channel]! + (keys[0]![channel]! - last[channel]!) * ease(Math.min(1, x));
      } else state[channel] = last[channel]!;
      continue;
    }
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i]!, b = keys[i + 1]!;
      if (time >= a.t && time <= b.t) {
        const x = b.t === a.t ? 1 : (time - a.t) / (b.t - a.t);
        state[channel] = a[channel]! + (b[channel]! - a[channel]!) * ease(x);
        break;
      }
    }
  }
  return state;
}

// --- ready-made animations (original) ---------------------------------------------------

/** A quick blink (close and open) starting at time t. */
export function blinkAt(t: number): Keyframe[] {
  return [{ t, blink: 0 }, { t: t + 80, blink: 1 }, { t: t + 180, blink: 0 }];
}

export const TEMPLATES: { name: string; make(): Omit<Animation, "id"> }[] = [
  {
    name: "Wake up",
    make: () => ({
      name: "Wake up", duration: 4000, loop: false,
      keyframes: [
        { t: 0, mood: "sleepy", blink: 1, lookX: 0, lookY: 0.3 },
        { t: 900, blink: 0.6 },
        { t: 1300, blink: 1 },
        { t: 2000, mood: "neutral", blink: 0, lookY: 0 },
        ...blinkAt(2600).slice(1),
        { t: 3300, mood: "happy" },
      ],
    }),
  },
  {
    name: "Look around",
    make: () => ({
      name: "Look around", duration: 6000, loop: true,
      keyframes: [
        { t: 0, lookX: 0, lookY: 0 },
        { t: 900, lookX: -0.9, lookY: 0 },
        { t: 1900, lookX: -0.9, lookY: 0 },
        ...blinkAt(2100),
        { t: 2800, lookX: 0.9, lookY: -0.3 },
        { t: 3900, lookX: 0.9, lookY: -0.3 },
        { t: 4700, lookX: 0, lookY: 0 },
        ...blinkAt(5300),
      ],
    }),
  },
  {
    name: "Happy hello",
    make: () => ({
      name: "Happy hello", duration: 3000, loop: false,
      keyframes: [
        { t: 0, mood: "surprised", talk: 0 },
        { t: 500, mood: "happy" },
        { t: 700, talk: 0 }, { t: 850, talk: 0.9 }, { t: 1000, talk: 0.2 }, { t: 1150, talk: 0.8 }, { t: 1350, talk: 0 },
        ...blinkAt(2000),
      ],
    }),
  },
  {
    name: "Fall asleep",
    make: () => ({
      name: "Fall asleep", duration: 5000, loop: false,
      keyframes: [
        { t: 0, mood: "neutral", blink: 0, lookY: 0 },
        { t: 1200, mood: "sleepy" },
        { t: 2500, blink: 0.5, lookY: 0.4 },
        { t: 3000, blink: 0.1 },
        { t: 4200, blink: 1, lookY: 0.5 },
      ],
    }),
  },
];
