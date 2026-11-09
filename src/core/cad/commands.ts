// 3D Studio commands. Every change to the 3D model goes through one of these, so it is
// validated, undoable, recorded in history, and (from Phase 4) available to the AI as a tool.

import { Matrix4, Quaternion, Vector3 } from "three";
import { defineCommand, getCommand, type EditableState } from "../document/commands";
import { byId, decompose, localMatrix, subtreeIds, worldBounds, worldMatrix } from "./geometry";
import { openMeshIn } from "./csg";
import { hasGlyphs } from "./text";
import { getMesh } from "./meshes";
import { CadObjectSchema, KIND_LABELS, ScriptSourceSchema, TransformSchema, validateParams, type CadObject, type Transform } from "./model";

export function cadObjects(state: EditableState): CadObject[] {
  return state.document.workspaces.cad.objects as CadObject[];
}

/** Groups combine their contents into one solid, which an open (not watertight) mesh cannot join. */
function assertCombinable(ids: string[], objects: CadObject[]) {
  const open = openMeshIn(ids, objects);
  if (open) {
    throw new Error(`"${open}" is not a closed (watertight) solid, so it cannot be grouped or combined. It can still be moved, scaled and exported on its own; a mesh repair tool can close it.`);
  }
}

function find(objects: CadObject[], id: string): CadObject {
  const object = objects.find((o) => o.id === id);
  if (!object) throw new Error(`There is no object with id "${id}".`);
  return object;
}

function names(objects: CadObject[], ids: string[]): string {
  const list = ids.map((id) => objects.find((o) => o.id === id)?.name ?? id);
  return list.length <= 2 ? list.map((n) => `"${n}"`).join(" and ") : `${list.length} objects`;
}

/** Moves objects so their world bounding box shifts by `delta` (mm, world axes). */
function moveWorld(objects: CadObject[], ids: string[], delta: Vector3) {
  const index = byId(objects);
  for (const id of ids) {
    const object = find(objects, id);
    if (![delta.x, delta.y, delta.z].every(Number.isFinite)) throw new Error(`"${object.name}" could not be moved (its size could not be measured).`);
    const origin = new Vector3().setFromMatrixPosition(worldMatrix(object, index)).add(delta);
    const parent = object.parentId ? index.get(object.parentId) : undefined;
    if (parent) origin.applyMatrix4(worldMatrix(parent, index).invert());
    object.transform.position = [round(origin.x), round(origin.y), round(origin.z)];
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The ids without repeats, and without objects whose group is also listed (the group already
 * carries them; handling both would move or copy them twice).
 */
function topMost(ids: string[], objects: CadObject[]): string[] {
  const set = new Set(ids);
  const index = byId(objects);
  return [...set].filter((id) => {
    for (let p = index.get(id)?.parentId, depth = 0; p && depth < 60; p = index.get(p)?.parentId, depth++) if (set.has(p)) return false;
    return true;
  });
}

function checkText(text: string | undefined) {
  if (!text || !text.trim()) throw new Error("Text cannot be empty.");
  if (text.length > 200) throw new Error("Text can be at most 200 characters.");
  if (!hasGlyphs(text)) throw new Error("None of these characters exist in the font. Use letters, digits and common symbols.");
}

// ---------------------------------------------------------------------------

export const addObject = defineCommand<{ object: CadObject }>({
  type: "cad.add",
  label: ({ object }) => `Add ${KIND_LABELS[object.kind].toLowerCase()} "${object.name}"`,
  apply(draft, { object }) {
    const parsed = CadObjectSchema.parse(object);
    validateParams(parsed.kind, parsed.params);
    if (parsed.kind === "text") checkText(parsed.text);
    if (parsed.kind === "mesh" && !getMesh(parsed.mesh)) throw new Error("The mesh data for this object has not been loaded.");
    const objects = cadObjects(draft);
    if (objects.some((o) => o.id === parsed.id)) throw new Error(`An object with id "${parsed.id}" already exists.`);
    if (parsed.parentId && find(objects, parsed.parentId).kind !== "group") throw new Error("Objects can only be put inside a group.");
    objects.push(parsed);
    if (parsed.parentId) assertCombinable([parsed.id], objects);
  },
});

export const deleteObjects = defineCommand<{ ids: string[] }>({
  type: "cad.delete",
  label: ({ ids }) => (ids.length === 1 ? "Delete object" : `Delete ${ids.length} objects`),
  apply(draft, { ids }) {
    const objects = cadObjects(draft);
    const remove = new Set<string>();
    for (const id of ids) for (const sub of subtreeIds(find(objects, id).id, objects)) remove.add(sub);
    draft.document.workspaces.cad.objects = objects.filter((o) => !remove.has(o.id));
  },
});

export const setTransforms = defineCommand<{ updates: { id: string; transform: Partial<Transform> }[]; label?: string; merge?: string }>({
  type: "cad.setTransform",
  label: ({ updates, label }) => label ?? (updates.length === 1 ? "Move / rotate / scale" : `Transform ${updates.length} objects`),
  apply(draft, { updates }) {
    const objects = cadObjects(draft);
    for (const { id, transform } of updates) {
      const object = find(objects, id);
      if (object.locked) throw new Error(`"${object.name}" is locked. Unlock it to move it.`);
      const next = TransformSchema.safeParse({ ...object.transform, ...transform });
      if (!next.success) throw new Error(`Invalid position, rotation or scale for "${object.name}": ${next.error.issues[0]?.message}`);
      object.transform = next.data;
    }
  },
  mergeKey: ({ merge }) => merge,
});

export const setParams = defineCommand<{ id: string; params: Record<string, number> }>({
  type: "cad.setParams",
  label: ({ params }) => `Change ${Object.keys(params).join(", ")}`,
  apply(draft, { id, params }) {
    const object = find(cadObjects(draft), id);
    if (object.kind === "group") throw new Error("Groups have no size of their own. Change the shapes inside.");
    if (object.kind === "mesh") throw new Error("Imported meshes have no size fields. Use Scale to resize them.");
    object.params = validateParams(object.kind, { ...object.params, ...params });
  },
});

export const setProps = defineCommand<{ ids: string[]; props: Partial<Pick<CadObject, "name" | "hole" | "color" | "visible" | "locked">> }>({
  type: "cad.setProps",
  label: ({ props, ids }) => {
    if (props.name !== undefined) return `Rename to "${props.name}"`;
    if (props.hole !== undefined) return props.hole ? "Make hole" : "Make solid";
    if (props.visible !== undefined) return props.visible ? "Show" : "Hide";
    if (props.locked !== undefined) return props.locked ? "Lock" : "Unlock";
    if (props.color !== undefined) return "Change color";
    return `Change ${ids.length} objects`;
  },
  apply(draft, { ids, props }) {
    const objects = cadObjects(draft);
    for (const id of ids) {
      const object = find(objects, id);
      const next = CadObjectSchema.safeParse({ ...object, ...props, name: props.name?.trim() ?? object.name });
      if (!next.success) throw new Error(`Invalid value: ${next.error.issues[0]?.message}`);
      Object.assign(object, next.data);
    }
  },
  // Dragging in the colour picker sends many changes; keep them as one undo step.
  mergeKey: ({ ids, props }) => (Object.keys(props).length === 1 && props.color !== undefined ? `color:${ids.join(",")}` : undefined),
});

/** Prepares new ids for duplicating objects (and the contents of groups). */
export function planDuplicate(ids: string[], objects: CadObject[], makeId: () => string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of ids) for (const sub of subtreeIds(id, objects)) map[sub] ??= makeId();
  return map;
}

export const duplicateObjects = defineCommand<{ ids: string[]; idMap: Record<string, string>; offset: [number, number, number] }>({
  type: "cad.duplicate",
  label: ({ ids }) => (ids.length === 1 ? "Duplicate object" : `Duplicate ${ids.length} objects`),
  apply(draft, { ids, idMap, offset }) {
    const objects = cadObjects(draft);
    if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) throw new Error("Invalid duplicate offset.");
    const copies: CadObject[] = [];
    const taken = new Set(objects.map((o) => o.id));
    for (const id of ids) find(objects, id);
    for (const id of topMost(ids, objects)) {
      const copied = new Set(subtreeIds(id, objects));
      for (const sub of copied) {
        const source = find(objects, sub);
        const newId = idMap[sub];
        if (!newId) throw new Error("Duplicate is missing new ids.");
        if (taken.has(newId)) throw new Error(`An object with id "${newId}" already exists.`);
        taken.add(newId);
        const copy: CadObject = JSON.parse(JSON.stringify(source));
        copy.id = newId;
        // Inside the copied part, point at the copied group; the copied part itself stays where the original is.
        copy.parentId = sub !== id && source.parentId && copied.has(source.parentId) ? idMap[source.parentId]! : source.parentId;
        if (sub === id) {
          copy.name = `${source.name} copy`.slice(0, 120);
          copy.transform.position = source.transform.position.map((v, i) => round(v + offset[i]!)) as [number, number, number];
          copy.locked = false;
        }
        copies.push(copy);
      }
    }
    objects.push(...copies);
  },
});

export const groupObjects = defineCommand<{ ids: string[]; groupId: string; name?: string }>({
  type: "cad.group",
  label: ({ ids }) => `Group ${ids.length} objects`,
  apply(draft, { ids: requested, groupId, name }) {
    const objects = cadObjects(draft);
    const ids = [...new Set(requested)];
    if (ids.length < 2) throw new Error("Select at least two objects to group.");
    if (objects.some((o) => o.id === groupId)) throw new Error(`An object with id "${groupId}" already exists.`);
    const members = ids.map((id) => find(objects, id));
    const parentId = members[0]!.parentId;
    if (members.some((m) => m.parentId !== parentId)) throw new Error("Objects must be at the same level to be grouped.");
    assertCombinable(ids, objects);
    const index = byId(objects);
    // Place the group's origin at the bottom centre of its contents.
    const box = worldBounds(ids, objects);
    // Nothing solid to measure (for example only holes): use the first object's place.
    const anchor = box.isEmpty()
      ? new Vector3().setFromMatrixPosition(worldMatrix(members[0]!, index))
      : new Vector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z);
    const parent = parentId ? index.get(parentId) : undefined;
    if (parent) anchor.applyMatrix4(worldMatrix(parent, index).invert());
    const position: [number, number, number] = [round(anchor.x), round(anchor.y), round(anchor.z)];
    objects.push({
      id: groupId,
      name: (name ?? "Group").slice(0, 120),
      kind: "group",
      params: {},
      transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
      hole: false,
      color: members[0]!.color,
      parentId,
      visible: true,
      locked: false,
    });
    for (const member of members) {
      member.parentId = groupId;
      member.transform.position = member.transform.position.map((v, i) => round(v - position[i]!)) as [number, number, number];
    }
  },
});

export const ungroup = defineCommand<{ groupId: string }>({
  type: "cad.ungroup",
  label: () => "Ungroup",
  apply(draft, { groupId }) {
    const objects = cadObjects(draft);
    const group = find(objects, groupId);
    if (group.kind !== "group") throw new Error(`"${group.name}" is not a group.`);
    const groupLocal = localMatrix(group.transform);
    for (const child of objects.filter((o) => o.parentId === groupId)) {
      child.transform = decompose(new Matrix4().multiplyMatrices(groupLocal, localMatrix(child.transform)));
      child.parentId = group.parentId;
    }
    draft.document.workspaces.cad.objects = objects.filter((o) => o.id !== groupId);
  },
});

export type AlignMode = "min" | "center" | "max";

export const alignObjects = defineCommand<{ ids: string[]; axis: 0 | 1 | 2; mode: AlignMode }>({
  type: "cad.align",
  label: ({ axis, mode }) => `Align ${["X", "Y", "Z"][axis]} ${mode === "center" ? "centres" : mode === "min" ? "minimum" : "maximum"}`,
  apply(draft, { ids: requested, axis, mode }) {
    const objects = cadObjects(draft);
    for (const id of requested) find(objects, id);
    // Objects with nothing solid to measure (an empty Intersect, only holes) are left where they are.
    const ids = topMost(requested, objects).filter((id) => !worldBounds([id], objects).isEmpty());
    if (ids.length < 2) throw new Error("Select at least two objects to align.");
    const all = worldBounds(ids, objects);
    const key = (["x", "y", "z"] as const)[axis];
    const target = mode === "min" ? all.min[key] : mode === "max" ? all.max[key] : (all.min[key] + all.max[key]) / 2;
    for (const id of ids) {
      const box = worldBounds([id], objects);
      const current = mode === "min" ? box.min[key] : mode === "max" ? box.max[key] : (box.min[key] + box.max[key]) / 2;
      const delta = new Vector3();
      delta[key] = target - current;
      if (Math.abs(delta[key]) > 1e-9) moveWorld(objects, [id], delta);
    }
  },
});

export const dropToBed = defineCommand<{ ids: string[] }>({
  type: "cad.dropToBed",
  label: () => "Drop to bed",
  apply(draft, { ids }) {
    const objects = cadObjects(draft);
    for (const id of topMost(ids, objects)) {
      const box = worldBounds([id], objects);
      if (box.isEmpty()) continue;
      if (Math.abs(box.min.z) > 1e-9) moveWorld(objects, [id], new Vector3(0, 0, -box.min.z));
    }
  },
});

/**
 * Turns top-level objects for printing: each rotation (x, y, z, w quaternion, world space) is
 * applied about the centre of the object's bounding box, then the object is put on the bed.
 */
export const orientObjects = defineCommand<{ updates: { id: string; quaternion: [number, number, number, number] }[] }>({
  type: "cad.orient",
  label: ({ updates }) => (updates.length === 1 ? "Orient for printing" : `Orient ${updates.length} objects for printing`),
  apply(draft, { updates }) {
    const objects = cadObjects(draft);
    for (const { id, quaternion } of updates) {
      const object = find(objects, id);
      if (object.parentId !== null) throw new Error("Only top-level objects can be oriented for printing.");
      if (object.locked) throw new Error(`"${object.name}" is locked.`);
      if (quaternion.length !== 4 || quaternion.some((n) => !Number.isFinite(n))) throw new Error("Invalid rotation.");
      const centre = worldBounds([id], objects).getCenter(new Vector3());
      const rotation = new Matrix4().makeRotationFromQuaternion(new Quaternion(...quaternion).normalize());
      const m = new Matrix4().makeTranslation(centre.x, centre.y, centre.z)
        .multiply(rotation)
        .multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z))
        .multiply(localMatrix(object.transform));
      object.transform = TransformSchema.parse(decompose(m));
      const box = worldBounds([id], objects);
      if (!box.isEmpty() && Math.abs(box.min.z) > 1e-9) moveWorld(objects, [id], new Vector3(0, 0, -box.min.z));
    }
  },
});

export const setText = defineCommand<{ id: string; text: string }>({
  type: "cad.setText",
  label: ({ text }) => `Change text to "${text.slice(0, 30)}"`,
  apply(draft, { id, text }) {
    const object = find(cadObjects(draft), id);
    if (object.kind !== "text") throw new Error("Only text shapes have text.");
    checkText(text);
    object.text = text;
  },
});

export const setBooleanMode = defineCommand<{ id: string; mode: "union" | "intersect" }>({
  type: "cad.setBooleanMode",
  label: ({ mode }) => (mode === "intersect" ? "Keep only the overlap (intersect)" : "Combine solids (union)"),
  apply(draft, { id, mode }) {
    const object = find(cadObjects(draft), id);
    if (object.kind !== "group") throw new Error("Only groups combine shapes.");
    object.boolean = mode;
  },
});

export type BooleanOp = "union" | "subtract" | "intersect";

/**
 * One-step Boolean operations on a selection (they create a group, so they can be undone or ungrouped):
 * - union: join the solids; any holes in the selection are cut out
 * - subtract: the FIRST selected object stays solid, all others become holes and are cut out of it
 * - intersect: keep only the space shared by all the solids
 */
export const booleanOp = defineCommand<{ ids: string[]; groupId: string; op: BooleanOp }>({
  type: "cad.boolean",
  label: ({ op, ids }) => `${op === "union" ? "Union" : op === "subtract" ? "Subtract" : "Intersect"} ${ids.length} objects`,
  apply(draft, { ids: requested, groupId, op }) {
    const ids = [...new Set(requested)];
    if (ids.length < 2) throw new Error("Select at least two objects.");
    const objects = cadObjects(draft);
    const members = ids.map((id) => find(objects, id));
    if (op === "subtract") {
      if (members[0]!.hole) throw new Error("The first selected object is the one that is kept, so it cannot be a hole.");
      for (const m of members.slice(1)) m.hole = true;
    }
    if (op === "intersect" && members.filter((m) => !m.hole).length < 2) {
      throw new Error("Intersect needs at least two solid (non-hole) objects.");
    }
    getCommand("cad.group").apply(draft, { ids, groupId, name: op === "union" ? "Union" : op === "subtract" ? "Subtraction" : "Intersection" });
    if (op === "intersect") find(objects, groupId).boolean = "intersect";
  },
});

/**
 * Applies a part-script build as one undo step: parts it made before get their new mesh (and
 * keep their place, rotation and scale), new parts are added. Meshes must already be loaded.
 */
export const applyScriptBuild = defineCommand<{ path: string; values: Record<string, unknown>; updates: { id: string; mesh: string }[]; adds: CadObject[] }>({
  type: "cad.scriptBuild",
  label: ({ path }) => `Build ${path.split(/[\\/]/).pop()}`,
  apply(draft, { path, values, updates, adds }) {
    const objects = cadObjects(draft);
    for (const { id, mesh } of updates) {
      const object = find(objects, id);
      if (object.kind !== "mesh" || !object.script || object.script.path !== path) throw new Error(`"${object.name}" was not made by this script.`);
      if (!getMesh(mesh)) throw new Error("The new mesh data has not been loaded.");
      object.mesh = mesh;
      object.script = ScriptSourceSchema.parse({ ...object.script, values });
    }
    for (const add of adds) {
      if (add.kind !== "mesh" || !add.script || add.script.path !== path) throw new Error("Only parts made by this script can be added here.");
      getCommand("cad.add").apply(draft, { object: { ...add, script: { ...add.script, values } } });
    }
  },
});
