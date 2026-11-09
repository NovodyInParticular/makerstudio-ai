// Behaviours: what the robot does, as a list of simple steps.
//
// The runner is deterministic: the same behaviour gives the same motion every time (idle
// blinking uses a fixed pseudo-random sequence), and it advances in fixed 10 ms ticks.
// Phase 9c ports this runner to C++ for the real robot.

import { sampleAnimation, type Animation } from "../display/animation";
import { NEUTRAL, type FaceState, type Mood } from "../display/mood";
import { clampAngle, type Robot } from "./model";
import type { Behavior, Step } from "./schema";

export { BehaviorSchema, StepSchema, type Behavior, type Step } from "./schema";

export const TICK_MS = 10;

/** Depth of nested repeats (kept small so it stays easy to follow, and safe on small boards). */
export function nestingDepth(steps: Step[]): number {
  return steps.reduce((d, s) => Math.max(d, s.kind === "repeat" ? 1 + nestingDepth(s.steps) : 0), 0);
}
export const MAX_NESTING = 3;

// --- runner ---------------------------------------------------------------------------------

interface Tween { from: number; to: number; start: number; ms: number }
interface Frame { steps: Step[]; index: number; left: number /* repeats left after this pass; -1 = forever */ }

export interface RobotOutput {
  face: FaceState;
  angles: Record<string, number>;
  done: boolean;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const tweenValue = (tw: Tween, t: number) => tw.ms <= 0 || t >= tw.start + tw.ms ? tw.to : tw.from + (tw.to - tw.from) * ease((t - tw.start) / tw.ms);

/** Small fixed pseudo-random sequence (same numbers on the robot). */
export function nextRandom(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) >>> 0;
}

export class BehaviorRunner {
  t = 0;
  private stack: Frame[];
  private waitUntil = 0;
  private mood: Mood = "neutral";
  private look = { x: { from: 0, to: 0, start: 0, ms: 0 } as Tween, y: { from: 0, to: 0, start: 0, ms: 0 } as Tween };
  private lookSetAt = -1e9;
  private talkUntil = 0;
  private blinkAt = -1e9;
  private joints = new Map<string, Tween>();
  private anim: { a: Animation; start: number } | null = null;
  private seed = 12345;
  private nextIdleBlink = 1500;
  private nextGlance = 2500;
  private done = false;

  constructor(private behavior: Behavior, private robot: Robot | null, private findAnimation: (screen: string, id: string) => Animation | undefined) {
    this.stack = [{ steps: behavior.steps, index: 0, left: 0 }];
    for (const j of robot?.joints ?? []) this.joints.set(j.id, { from: 0, to: 0, start: 0, ms: 0 });
  }

  private rand(n: number): number {
    this.seed = nextRandom(this.seed);
    return (this.seed >>> 8) % n;
  }

  /** Runs steps that are due now (several can start in the same moment). */
  private advance() {
    let guard = 0;
    while (!this.done && this.t >= this.waitUntil && guard++ < 1000) {
      const frame = this.stack[this.stack.length - 1];
      if (!frame) { this.done = true; return; }
      if (frame.index >= frame.steps.length) {
        if (frame.left !== 0 && frame.steps.length) { frame.index = 0; if (frame.left > 0) frame.left--; continue; }
        this.stack.pop();
        if (!this.stack.length) { this.done = true; return; }
        continue;
      }
      const step = frame.steps[frame.index++]!;
      this.start(step);
    }
  }

  private start(step: Step) {
    const t = this.t;
    switch (step.kind) {
      case "mood": this.mood = step.mood; break;
      case "look": {
        const now = this.lookNow();
        this.look = { x: { from: now.x, to: step.x, start: t, ms: step.ms }, y: { from: now.y, to: step.y, start: t, ms: step.ms } };
        this.lookSetAt = t;
        if (step.wait) this.waitUntil = t + step.ms;
        break;
      }
      case "move": {
        const joint = this.robot?.joints.find((j) => j.id === step.joint);
        if (!joint) break; // joint was deleted: skip the step
        const tw = this.joints.get(joint.id)!;
        this.joints.set(joint.id, { from: tweenValue(tw, t), to: clampAngle(joint, step.angle), start: t, ms: step.ms });
        if (step.wait) this.waitUntil = t + step.ms;
        break;
      }
      case "animation": {
        const a = this.findAnimation(step.screen, step.animation);
        if (!a) break;
        this.anim = { a, start: t };
        if (step.wait) this.waitUntil = t + a.duration;
        break;
      }
      case "talk":
        this.talkUntil = t + step.ms;
        if (step.wait) this.waitUntil = t + step.ms;
        break;
      case "blink": this.blinkAt = t; break;
      case "wait": this.waitUntil = t + step.ms; break;
      case "repeat":
        if (step.steps.length > 0) this.stack.push({ steps: step.steps, index: 0, left: step.times === 0 ? -1 : step.times - 1 });
        break;
    }
  }

  private lookNow() {
    return { x: tweenValue(this.look.x, this.t), y: tweenValue(this.look.y, this.t) };
  }

  private idle() {
    if (!this.behavior.idle) return;
    if (this.t >= this.nextIdleBlink) { this.blinkAt = this.t; this.nextIdleBlink = this.t + 2200 + this.rand(3200); }
    // Glance around only when no step has set where to look for a while.
    if (this.t >= this.nextGlance) {
      if (this.t - this.lookSetAt > 3000) {
        const now = this.lookNow();
        const centre = this.rand(100) < 35;
        const x = centre ? 0 : (this.rand(201) - 100) / 100, y = centre ? 0 : (this.rand(121) - 60) / 100;
        this.look = { x: { from: now.x, to: x, start: this.t, ms: 400 }, y: { from: now.y, to: y, start: this.t, ms: 400 } };
      }
      this.nextGlance = this.t + 1200 + this.rand(2400);
    }
  }

  /** The robot at the current time. */
  output(): RobotOutput {
    const t = this.t;
    const look = this.lookNow();
    let face: FaceState = { ...NEUTRAL, mood: this.mood, lookX: look.x, lookY: look.y };
    if (t < this.talkUntil) face.talk = Math.max(0, Math.sin(t / 90) * 0.5 + Math.sin(t / 37) * 0.35 + 0.15);
    const bt = t - this.blinkAt;
    if (bt >= 0 && bt < 180) face.blink = Math.sin((bt / 180) * Math.PI);
    if (this.anim) {
      const at = t - this.anim.start;
      if (!this.anim.a.loop && at > this.anim.a.duration) {
        // keep the animation's final mood once it has finished
        this.mood = sampleAnimation(this.anim.a, this.anim.a.duration, face).mood;
        face.mood = this.mood;
        this.anim = null;
      } else face = sampleAnimation(this.anim.a, at, face);
    }
    const angles: Record<string, number> = {};
    for (const [id, tw] of this.joints) angles[id] = tweenValue(tw, t);
    return { face, angles, done: this.done };
  }

  /** Moves time forward in fixed ticks. */
  advanceTo(t: number) {
    if (this.t === 0) this.advance();
    while (this.t + TICK_MS <= t) {
      this.t += TICK_MS;
      this.idle();
      this.advance();
    }
  }
}

/** Ready-made behaviours for a desk robot (original). Joint steps use the robot's own joints. */
export function behaviorTemplates(robot: Robot | null): { name: string; make(): Omit<Behavior, "id"> }[] {
  const pan = robot?.joints.find((j) => j.axis === "z" || j.axis === "-z");
  const tilt = robot?.joints.find((j) => j !== pan && (j.axis.endsWith("x") || j.axis.endsWith("y")));
  const move = (j: typeof pan, angle: number, ms: number, w = true): Step[] => (j ? [{ kind: "move", joint: j.id, angle, ms, wait: w }] : []);
  return [
    {
      name: "Say hello",
      make: () => ({
        name: "Say hello", idle: true,
        steps: [
          { kind: "look", x: 0, y: 0, ms: 300, wait: true },
          { kind: "mood", mood: "happy" },
          ...move(tilt, 15, 300), ...move(tilt, -10, 300), ...move(tilt, 0, 300),
          { kind: "talk", ms: 1200, wait: true },
          { kind: "blink" },
          { kind: "wait", ms: 800 },
          { kind: "mood", mood: "neutral" },
        ],
      }),
    },
    {
      name: "Curious",
      make: () => ({
        name: "Curious", idle: true,
        steps: [{
          kind: "repeat", times: 0, steps: [
            { kind: "look", x: -0.9, y: 0, ms: 400, wait: false }, ...move(pan, 35, 900),
            { kind: "wait", ms: 700 },
            { kind: "mood", mood: "surprised" }, ...move(tilt, 12, 250), { kind: "wait", ms: 400 }, { kind: "mood", mood: "neutral" }, ...move(tilt, 0, 300),
            { kind: "look", x: 0.9, y: -0.2, ms: 400, wait: false }, ...move(pan, -35, 1400),
            { kind: "wait", ms: 900 },
            { kind: "look", x: 0, y: 0, ms: 400, wait: false }, ...move(pan, 0, 900),
            { kind: "wait", ms: 1500 },
          ],
        }],
      }),
    },
    {
      name: "Doze off",
      make: () => ({
        name: "Doze off", idle: false,
        steps: [
          { kind: "mood", mood: "sleepy" },
          { kind: "look", x: 0, y: 0.5, ms: 1500, wait: false }, ...move(tilt, 20, 1500),
          { kind: "repeat", times: 3, steps: [...move(tilt, 14, 900), ...move(tilt, 20, 900)] },
        ],
      }),
    },
  ];
}
