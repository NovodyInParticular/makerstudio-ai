// The 3D model: what a shape in a project looks like on disk and in memory.
// Coordinates: millimetres, Z is up (the print bed is the XY plane at Z = 0).
// Every primitive's local origin is at the centre of its bottom face, so a new shape
// placed at Z = 0 sits on the bed.

import { z } from "zod";

export const PRIMITIVE_KINDS = ["box", "sphere", "cylinder", "cone", "torus", "wedge", "text"] as const;
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];
export type ObjectKind = PrimitiveKind | "group" | "mesh";

/** Archive path of an imported mesh inside the project (see meshes.ts). */
export const MESH_KEY = /^meshes\/[0-9a-f-]{8,64}\.bin$/;

export const MAX_SIZE = 2000; // mm, a sanity limit for any dimension
export const MIN_SIZE = 0.01; // mm

const size = z.number().finite().min(MIN_SIZE).max(MAX_SIZE);
const segments = z.number().int().min(3).max(256);
const scale = z.number().finite().min(0.001).max(1000);
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const ParamsSchemas = {
  box: z.object({ width: size, depth: size, height: size }),
  sphere: z.object({ radius: size, segments }),
  cylinder: z.object({ radius: size, height: size, segments }),
  // A cone's top radius may be 0 (a point).
  cone: z.object({ bottomRadius: size, topRadius: z.number().finite().min(0).max(MAX_SIZE), height: size, segments }),
  torus: z.object({ radius: size, tube: size, segments }),
  wedge: z.object({ width: size, depth: size, height: size }),
  // size = height of a capital letter, depth = how far the letters stand up
  text: z.object({ size, depth: size }),
  group: z.object({}),
  // Imported meshes have no size fields; they are resized with Scale.
  mesh: z.object({}),
} as const;

export type ParamsOf<K extends ObjectKind> = z.infer<(typeof ParamsSchemas)[K]>;

export const TransformSchema = z.object({
  position: vec3, // mm
  rotation: vec3, // degrees, applied in X, then Y, then Z order
  scale: z.tuple([scale, scale, scale]),
});
export type Transform = z.infer<typeof TransformSchema>;

type ScriptValue = number | boolean | ScriptValue[];
const ScriptValueSchema: z.ZodType<ScriptValue> = z.lazy(() => z.union([z.number().finite(), z.boolean(), z.array(ScriptValueSchema).max(32)]));

/** Where a "script part" came from: a Python part script, the STL it wrote, and the sizes changed in MakerStudio. */
export const ScriptSourceSchema = z.object({
  path: z.string().min(1).max(1000),
  output: z.string().min(1).max(200),
  /** Only the values changed from the script's own (the script keeps the rest). */
  values: z.record(z.string().max(100), ScriptValueSchema),
});
export type ScriptSource = z.infer<typeof ScriptSourceSchema>;

export const CadObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  kind: z.enum([...PRIMITIVE_KINDS, "group", "mesh"]),
  params: z.record(z.string(), z.number()),
  transform: TransformSchema,
  /** Holes are cut out of the solids they are grouped with (Boolean operations arrive in Phase 3c). */
  hole: z.boolean(),
  /** Text shapes only: the characters to write. */
  text: z.string().max(200).optional(),
  /** Imported meshes only: which mesh asset this object shows. */
  mesh: z.string().regex(MESH_KEY).optional(),
  /** Imported meshes made by a part script: rebuilt from it with changed sizes. */
  script: ScriptSourceSchema.optional(),
  /** Groups only: how solids inside combine. Holes are always subtracted. */
  boolean: z.enum(["union", "intersect"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  parentId: z.string().nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
});
export type CadObject = z.infer<typeof CadObjectSchema>;

export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

export const DEFAULT_PARAMS: { [K in ObjectKind]: ParamsOf<K> } = {
  box: { width: 20, depth: 20, height: 20 },
  sphere: { radius: 10, segments: 48 },
  cylinder: { radius: 10, height: 20, segments: 48 },
  cone: { bottomRadius: 10, topRadius: 0, height: 20, segments: 48 },
  torus: { radius: 10, tube: 3, segments: 48 },
  wedge: { width: 20, depth: 20, height: 20 },
  text: { size: 10, depth: 3 },
  group: {},
  mesh: {},
};

export const KIND_LABELS: Record<ObjectKind, string> = {
  box: "Box",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  torus: "Torus",
  wedge: "Wedge",
  text: "Text",
  group: "Group",
  mesh: "Imported mesh",
};

/** Human labels for each parameter, with the unit shown in the inspector. */
export const PARAM_LABELS: Record<string, { label: string; unit: string; integer?: boolean }> = {
  width: { label: "Width (X)", unit: "mm" },
  depth: { label: "Depth (Y)", unit: "mm" },
  height: { label: "Height (Z)", unit: "mm" },
  radius: { label: "Radius", unit: "mm" },
  bottomRadius: { label: "Bottom radius", unit: "mm" },
  topRadius: { label: "Top radius", unit: "mm" },
  tube: { label: "Tube radius", unit: "mm" },
  segments: { label: "Smoothness", unit: "segments", integer: true },
  size: { label: "Letter height", unit: "mm" },
};

/** Label for a parameter of a given kind (some names mean different things per shape). */
export function paramLabel(kind: ObjectKind, key: string): { label: string; unit: string; integer?: boolean } {
  if (kind === "text" && key === "depth") return { label: "Thickness (Z)", unit: "mm" };
  return PARAM_LABELS[key] ?? { label: key, unit: "" };
}

export const PALETTE = ["#2fd6a3", "#22b8c9", "#f2b84b", "#e2725b", "#8f7cf0", "#5aa9e6", "#c3d350", "#e86fa5"];

/** Validates parameters for a kind; throws an Error with a readable message. */
export function validateParams(kind: ObjectKind, params: Record<string, number>): Record<string, number> {
  const result = ParamsSchemas[kind].safeParse(params);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const key = String(issue.path[0] ?? "");
    const label = paramLabel(kind, key).label;
    if (issue.code === "too_small") throw new Error(`${label} must be at least ${key === "segments" ? 3 : key === "topRadius" ? 0 : MIN_SIZE}.`);
    if (issue.code === "too_big") throw new Error(`${label} can be at most ${key === "segments" ? 256 : MAX_SIZE}.`);
    throw new Error(`${label}: ${issue.message}`);
  }
  if (kind === "torus" && params.tube! >= params.radius!) {
    throw new Error("The tube radius must be smaller than the torus radius, otherwise the shape intersects itself.");
  }
  return result.data as Record<string, number>;
}
