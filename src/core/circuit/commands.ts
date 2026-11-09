// Commands for the Circuit Studio.

import { defineCommand, getCommand, type EditableState } from "../document/commands";
import { componentDef } from "./catalog";
import { CircuitComponentSchema, WireSchema, type CircuitComponent, type Wire } from "./schema";

export function circuitOf(state: EditableState): { components: CircuitComponent[]; wires: Wire[] } {
  return state.document.workspaces.circuit as { components: CircuitComponent[]; wires: Wire[] };
}

function findComponent(state: EditableState, id: string): CircuitComponent {
  const c = circuitOf(state).components.find((x) => x.id === id);
  if (!c) throw new Error("That part no longer exists.");
  return c;
}

function checkProps(c: CircuitComponent) {
  const def = componentDef(c.type);
  if (!def) throw new Error("Unknown part type.");
  for (const [key, value] of Object.entries(c.props)) {
    const p = def.props.find((x) => x.key === key);
    if (!p) throw new Error(`"${def.name}" has no setting "${key}".`);
    if (p.kind === "number" && (typeof value !== "number" || (p.min !== undefined && value < p.min) || (p.max !== undefined && value > p.max))) {
      throw new Error(`${p.label} must be a number${p.min !== undefined ? ` from ${p.min}` : ""}${p.max !== undefined ? ` to ${p.max}` : ""}${p.unit ? ` ${p.unit}` : ""}.`);
    }
    if (p.kind === "choice" && !p.choices!.includes(String(value))) throw new Error(`${p.label} must be one of: ${p.choices!.join(", ")}.`);
    if (p.kind === "boolean" && typeof value !== "boolean") throw new Error(`${p.label} must be on or off.`);
  }
}

export const addPart = defineCommand<{ component: CircuitComponent }>({
  type: "circuit.addPart",
  label: ({ component }) => `Add ${component.label}`,
  apply(draft, { component }) {
    const c = CircuitComponentSchema.parse(component);
    checkProps(c);
    const list = circuitOf(draft).components;
    if (list.some((x) => x.id === c.id)) throw new Error("A part with this id already exists.");
    if (list.length >= 500) throw new Error("A circuit can have at most 500 parts.");
    list.push(c);
  },
});

export const updatePart = defineCommand<{ id: string; changes: Partial<Omit<CircuitComponent, "id" | "type">>; merge?: string; label?: string }>({
  type: "circuit.updatePart",
  label: ({ label, changes }) => label ?? (changes.x !== undefined || changes.y !== undefined ? "Move part" : changes.rotation !== undefined ? "Rotate part" : changes.label !== undefined ? `Rename part to "${changes.label}"` : "Change part"),
  apply(draft, { id, changes }) {
    const c = findComponent(draft, id);
    const next = CircuitComponentSchema.safeParse({ ...c, ...changes, props: { ...c.props, ...(changes.props ?? {}) } });
    if (!next.success) throw new Error(`Invalid part: ${next.error.issues[0]?.path.join(".")} ${next.error.issues[0]?.message}`);
    checkProps(next.data);
    Object.assign(c, next.data);
  },
  mergeKey: ({ merge }) => merge,
});

export const deleteParts = defineCommand<{ ids: string[] }>({
  type: "circuit.deleteParts",
  label: ({ ids }) => (ids.length === 1 ? "Delete part" : `Delete ${ids.length} parts`),
  apply(draft, { ids }) {
    const circuit = circuitOf(draft);
    const gone = new Set(ids);
    circuit.components = circuit.components.filter((c) => !gone.has(c.id));
    // Wires to deleted parts go too.
    circuit.wires = circuit.wires.filter((w) => !gone.has(w.from.component) && !gone.has(w.to.component));
  },
});

export const addWire = defineCommand<{ wire: Wire }>({
  type: "circuit.addWire",
  label: () => "Connect",
  apply(draft, { wire }) {
    const w = WireSchema.parse(wire);
    const circuit = circuitOf(draft);
    for (const end of [w.from, w.to]) {
      const c = circuit.components.find((x) => x.id === end.component);
      if (!c) throw new Error("That part no longer exists.");
      if (!componentDef(c.type)?.pins.some((p) => p.id === end.pin)) throw new Error(`"${c.label}" has no pin "${end.pin}".`);
    }
    if (w.from.component === w.to.component && w.from.pin === w.to.pin) throw new Error("A wire needs two different pins.");
    const same = (a: Wire) => (a.from.component === w.from.component && a.from.pin === w.from.pin && a.to.component === w.to.component && a.to.pin === w.to.pin)
      || (a.from.component === w.to.component && a.from.pin === w.to.pin && a.to.component === w.from.component && a.to.pin === w.from.pin);
    if (circuit.wires.some(same)) throw new Error("These pins are already connected.");
    if (circuit.wires.length >= 2000) throw new Error("A circuit can have at most 2000 wires.");
    circuit.wires.push(w);
  },
});

export const deleteWires = defineCommand<{ ids: string[] }>({
  type: "circuit.deleteWires",
  label: ({ ids }) => (ids.length === 1 ? "Delete wire" : `Delete ${ids.length} wires`),
  apply(draft, { ids }) {
    const circuit = circuitOf(draft);
    const gone = new Set(ids);
    circuit.wires = circuit.wires.filter((w) => !gone.has(w.id));
  },
});

/** Adds several parts and wires as one undo step (used by "From my robot"). */
export const addMany = defineCommand<{ components: CircuitComponent[]; wires: Wire[]; label: string }>({
  type: "circuit.addMany",
  label: ({ label }) => label,
  apply(draft, { components, wires }) {
    for (const component of components) getCommand("circuit.addPart").apply(draft, { component });
    for (const wire of wires) getCommand("circuit.addWire").apply(draft, { wire });
  },
});

/** The sketch a board runs in the simulator. */
export function sketchOf(state: EditableState, id: string): string | undefined {
  return (state.document.workspaces.circuit as { code?: Record<string, string> }).code?.[id];
}

export const setSketch = defineCommand<{ id: string; code: string }>({
  type: "circuit.setSketch",
  label: () => "Edit code",
  apply(draft, { id, code }) {
    findComponent(draft, id);
    if (code.length > 200000) throw new Error("The code is too long (200,000 characters at most).");
    const w = draft.document.workspaces.circuit as { code?: Record<string, string> };
    w.code = { ...(w.code ?? {}), [id]: code };
  },
  mergeKey: ({ id }) => `sketch-${id}`,
});
