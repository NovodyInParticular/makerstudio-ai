import { describe, expect, it } from "vitest";
import { AnimationSchema, blinkAt, sampleAnimation, TEMPLATES, type Animation } from "../../src/core/display/animation";
import { addAnimation, addScreen, deleteAnimation, setAnimation } from "../../src/core/display/commands";
import { DEFAULT_FACE, type Screen } from "../../src/core/display/face";
import { createProjectStore } from "../../src/core/document/store";
import { createEmptyProject, packProject, unpackProject } from "../../src/shared/format";

const anim = (keyframes: Animation["keyframes"], loop = false, duration = 1000): Animation => ({ id: "a", name: "Test", duration, loop, keyframes });

describe("animation sampler", () => {
  it("interpolates each channel on its own, easing between keyframes", () => {
    const a = anim([{ t: 0, lookX: -1 }, { t: 1000, lookX: 1 }, { t: 400, blink: 0 }, { t: 600, blink: 1 }]);
    expect(sampleAnimation(a, 0).lookX).toBe(-1);
    expect(sampleAnimation(a, 500).lookX).toBeCloseTo(0, 6); // eased midpoint
    expect(sampleAnimation(a, 250).lookX).toBeLessThan(-0.5); // ease-in: slow start
    expect(sampleAnimation(a, 1000).lookX).toBe(1);
    expect(sampleAnimation(a, 200).blink).toBe(0); // before its first key: held
    expect(sampleAnimation(a, 500).blink).toBeCloseTo(0.5, 6);
    expect(sampleAnimation(a, 900).blink).toBe(1); // after its last key: held
    expect(sampleAnimation(a, 500).talk).toBe(0); // untouched channel keeps the base
  });

  it("switches the mood at its keyframe", () => {
    const a = anim([{ t: 0, mood: "sleepy" }, { t: 600, mood: "happy" }]);
    expect(sampleAnimation(a, 599).mood).toBe("sleepy");
    expect(sampleAnimation(a, 600).mood).toBe("happy");
  });

  it("wraps looping animations and eases back to the start", () => {
    const a = anim([{ t: 0, lookX: 0 }, { t: 500, lookX: 1 }], true, 1000);
    expect(sampleAnimation(a, 1500).lookX).toBeCloseTo(1, 6);
    expect(sampleAnimation(a, 750).lookX).toBeCloseTo(0.5, 6); // halfway back to the first key
    expect(sampleAnimation(a, 2000).lookX).toBeCloseTo(0, 6);
    const once = anim([{ t: 0, lookX: 0 }, { t: 500, lookX: 1 }], false, 1000);
    expect(sampleAnimation(once, 5000).lookX).toBe(1); // holds the end
  });

  it("blinks close and open", () => {
    const a = anim(blinkAt(100));
    expect(sampleAnimation(a, 100).blink).toBe(0);
    expect(sampleAnimation(a, 180).blink).toBe(1);
    expect(sampleAnimation(a, 280).blink).toBe(0);
  });

  it("ships valid templates", () => {
    for (const t of TEMPLATES) {
      const a = AnimationSchema.parse({ id: "x", ...t.make() });
      expect(a.keyframes.every((k) => k.t <= a.duration)).toBe(true);
    }
    const wake = AnimationSchema.parse({ id: "w", ...TEMPLATES[0]!.make() });
    expect(sampleAnimation(wake, 0).mood).toBe("sleepy");
    expect(sampleAnimation(wake, 0).blink).toBe(1);
    expect(sampleAnimation(wake, wake.duration).mood).toBe("happy");
    expect(sampleAnimation(wake, wake.duration).blink).toBe(0);
  });
});

describe("animation commands", () => {
  const screen: Screen = { id: "s", name: "Face", display: "m5stack-cores3", face: DEFAULT_FACE };
  const setup = () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addScreen({ screen }));
    s.getState().execute(addAnimation({ screenId: "s", animation: { id: "a", ...TEMPLATES[1]!.make() } }));
    return s;
  };
  const get = (s: ReturnType<typeof setup>) => (s.getState().project.document.workspaces.displays.screens as Screen[])[0]!.animations![0]!;

  it("edits keyframes (sorted), length and loop, with undo", () => {
    const s = setup();
    s.getState().execute(setAnimation({ screenId: "s", animId: "a", keyframes: [{ t: 900, talk: 1 }, { t: 100, talk: 0 }] }));
    expect(get(s).keyframes.map((k) => k.t)).toEqual([100, 900]);
    s.getState().execute(setAnimation({ screenId: "s", animId: "a", duration: 500 }));
    expect(get(s).keyframes.map((k) => k.t)).toEqual([100]); // past the new end: dropped
    s.getState().undo();
    expect(get(s).keyframes.map((k) => k.t)).toEqual([100, 900]);
    s.getState().execute(setAnimation({ screenId: "s", animId: "a", loop: false, name: "Glance" }));
    expect(get(s)).toMatchObject({ loop: false, name: "Glance" });
  });

  it("refuses bad keyframes", () => {
    const s = setup();
    expect(() => s.getState().execute(setAnimation({ screenId: "s", animId: "a", keyframes: [{ t: 10, lookX: 3 }] }))).toThrow(/Invalid animation/);
    expect(() => s.getState().execute(setAnimation({ screenId: "s", animId: "a", keyframes: [{ t: -5 }] }))).toThrow(/Invalid animation/);
    expect(() => s.getState().execute(setAnimation({ screenId: "s", animId: "a", duration: 10 }))).toThrow(/Invalid animation/);
  });

  it("deletes, saves and reopens; old files without animations still open", () => {
    const s = setup();
    const p = s.getState().project;
    const back = unpackProject(packProject(p));
    expect((back.document.workspaces.displays.screens as Screen[])[0]!.animations).toHaveLength(1);
    s.getState().execute(deleteAnimation({ screenId: "s", animId: "a" }));
    expect((s.getState().project.document.workspaces.displays.screens as Screen[])[0]!.animations).toEqual([]);
    const old = createEmptyProject("Old", "test");
    old.document.workspaces.displays.screens = [screen];
    expect((unpackProject(packProject(old)).document.workspaces.displays.screens as Screen[])[0]!.animations).toBeUndefined();
  });
});
