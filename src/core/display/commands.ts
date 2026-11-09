// Commands for the Display Studio (screens and their faces). Undoable like everything else.

import { defineCommand, type EditableState } from "../document/commands";
import { displayById } from "./catalog";
import { AnimationSchema, type Animation, type Keyframe } from "./animation";
import { FaceSpecSchema, ScreenSchema, type FaceSpec, type Screen } from "./face";

export function screens(state: EditableState): Screen[] {
  return state.document.workspaces.displays.screens as Screen[];
}

function find(list: Screen[], id: string): Screen {
  const screen = list.find((s) => s.id === id);
  if (!screen) throw new Error("That screen no longer exists.");
  return screen;
}

export const MAX_SCREENS = 50;

export const addScreen = defineCommand<{ screen: Screen }>({
  type: "display.addScreen",
  label: ({ screen }) => `Add screen "${screen.name}"`,
  apply(draft, { screen }) {
    const list = screens(draft);
    if (list.length >= MAX_SCREENS) throw new Error(`A project can have at most ${MAX_SCREENS} screens.`);
    const parsed = ScreenSchema.parse(screen);
    if (!displayById(parsed.display)) throw new Error("Unknown display type.");
    if (list.some((s) => s.id === parsed.id)) throw new Error("A screen with this id already exists.");
    list.push(parsed);
  },
});

export const deleteScreen = defineCommand<{ id: string }>({
  type: "display.deleteScreen",
  label: () => "Delete screen",
  apply(draft, { id }) {
    const list = screens(draft);
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) throw new Error("That screen no longer exists.");
    list.splice(i, 1);
  },
});

export const setScreen = defineCommand<{ id: string; name?: string; display?: string }>({
  type: "display.setScreen",
  label: ({ name, display }) => (name !== undefined ? `Rename screen to "${name.trim()}"` : display ? "Change display type" : "Change screen"),
  apply(draft, { id, name, display }) {
    const screen = find(screens(draft), id);
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 120) throw new Error("A screen name must be 1 to 120 characters.");
      screen.name = trimmed;
    }
    if (display !== undefined) {
      if (!displayById(display)) throw new Error("Unknown display type.");
      screen.display = display;
    }
  },
});

/** Changes face settings. Dragging a slider merges into one undo step (merge key). */
export const setFace = defineCommand<{ id: string; face: Partial<FaceSpec>; merge?: string }>({
  type: "display.setFace",
  label: ({ face }) => {
    const keys = Object.keys(face);
    return keys.length === 1 ? `Change face: ${keys[0]}` : "Change face";
  },
  apply(draft, { id, face }) {
    const screen = find(screens(draft), id);
    const next = FaceSpecSchema.safeParse({ ...screen.face, ...face });
    if (!next.success) throw new Error(`Invalid face setting: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    screen.face = next.data;
  },
  mergeKey: ({ merge }) => merge,
});

// --- animations (Phase 8b) -------------------------------------------------------------

function findAnimation(screen: Screen, animId: string): Animation {
  const anim = (screen.animations ?? []).find((a) => a.id === animId);
  if (!anim) throw new Error("That animation no longer exists.");
  return anim;
}

export const addAnimation = defineCommand<{ screenId: string; animation: Animation }>({
  type: "display.addAnimation",
  label: ({ animation }) => `Add animation "${animation.name}"`,
  apply(draft, { screenId, animation }) {
    const screen = find(screens(draft), screenId);
    const list = (screen.animations ??= []);
    if (list.length >= 50) throw new Error("A screen can have at most 50 animations.");
    const parsed = AnimationSchema.parse(animation);
    if (list.some((a) => a.id === parsed.id)) throw new Error("An animation with this id already exists.");
    list.push(parsed);
  },
});

export const deleteAnimation = defineCommand<{ screenId: string; animId: string }>({
  type: "display.deleteAnimation",
  label: () => "Delete animation",
  apply(draft, { screenId, animId }) {
    const screen = find(screens(draft), screenId);
    const list = screen.animations ?? [];
    const i = list.findIndex((a) => a.id === animId);
    if (i < 0) throw new Error("That animation no longer exists.");
    list.splice(i, 1);
  },
});

export const setAnimation = defineCommand<{ screenId: string; animId: string; name?: string; duration?: number; loop?: boolean; keyframes?: Keyframe[]; merge?: string; label?: string }>({
  type: "display.setAnimation",
  label: ({ label, name, duration, loop }) => label ?? (name !== undefined ? `Rename animation to "${name}"` : duration !== undefined ? "Change animation length" : loop !== undefined ? (loop ? "Loop animation" : "Play animation once") : "Edit keyframes"),
  apply(draft, { screenId, animId, name, duration, loop, keyframes }) {
    const anim = findAnimation(find(screens(draft), screenId), animId);
    const next = AnimationSchema.safeParse({
      ...anim,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(duration !== undefined ? { duration: Math.round(duration) } : {}),
      ...(loop !== undefined ? { loop } : {}),
      ...(keyframes !== undefined ? { keyframes: [...keyframes].sort((a, b) => a.t - b.t) } : {}),
    });
    if (!next.success) throw new Error(`Invalid animation: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    // Keyframes past a shortened end are dropped (the change says so in its label).
    next.data.keyframes = next.data.keyframes.filter((k) => k.t <= next.data.duration);
    Object.assign(anim, next.data);
  },
  mergeKey: ({ merge }) => merge,
});
