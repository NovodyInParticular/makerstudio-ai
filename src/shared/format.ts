// MakerStudio project file format (.msproj).
// A .msproj file is a zip archive of JSON files plus binary assets.
// All lengths are millimetres. Paths inside the archive always use "/".

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import { decodeMesh } from "../core/cad/meshCodec";
import { CadObjectSchema } from "../core/cad/model";
import { ScreenSchema } from "../core/display/face";
import { RobotSchema } from "../core/robot/schema";
import { DroneSchema } from "../core/drone/model";
import { CircuitComponentSchema, WireSchema } from "../core/circuit/schema";

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = "msproj";

const isoDate = z.string().min(1);

export const ManifestSchema = z.object({
  format: z.literal("makerstudio-project"),
  formatVersion: z.number().int().positive(),
  appVersion: z.string(),
  units: z.literal("mm"),
  createdAt: isoDate,
  modifiedAt: isoDate,
});
export type Manifest = z.infer<typeof ManifestSchema>;

// The editable design document. Later phases add real content to each workspace;
// the empty arrays are kept so that the file shape is stable from version 1.
export const DocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(5000),
  workspaces: z.object({
    cad: z.object({ objects: z.array(CadObjectSchema) }),
    circuit: z.object({
      components: z.array(CircuitComponentSchema).max(500), wires: z.array(WireSchema).max(2000),
      /** Arduino sketch per board (part id → code), for the emulator. */
      code: z.record(z.string(), z.string().max(200000)).optional(),
    }),
    robotics: z.object({ assemblies: z.array(RobotSchema).max(1) }),
    displays: z.object({ screens: z.array(ScreenSchema) }),
    /** Drone Studio design (added 2026-11-09; absent in older projects). */
    drone: DroneSchema.optional(),
  }),
});
export type ProjectDocument = z.infer<typeof DocumentSchema>;

export const HistoryEntrySchema = z.object({
  id: z.string(),
  at: isoDate,
  label: z.string(),
  author: z.enum(["user", "ai", "system"]),
  kind: z.enum(["change", "undo", "redo", "save"]),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const RevisionSchema = z.object({
  number: z.number().int().positive(),
  at: isoDate,
  changes: z.number().int().nonnegative(),
  summary: z.string(),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const HistoryFileSchema = z.object({
  entries: z.array(HistoryEntrySchema),
  revisions: z.array(RevisionSchema),
});
export type HistoryFile = z.infer<typeof HistoryFileSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: isoDate,
  messages: z.array(z.object({ role: z.string(), content: z.unknown(), at: isoDate })),
});
export type Conversation = z.infer<typeof ConversationSchema>;

/** Everything a project contains, in memory. */
export interface Project {
  manifest: Manifest;
  document: ProjectDocument;
  history: HistoryFile;
  notes: string;
  conversations: Conversation[];
  /** Binary assets keyed by their archive path below "assets/". */
  assets: Record<string, Uint8Array>;
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export function newId(): string {
  // crypto.randomUUID exists in Electron's main process, renderer and in Node tests.
  return globalThis.crypto.randomUUID();
}

export function createEmptyProject(name: string, appVersion: string, now = new Date()): Project {
  const at = now.toISOString();
  return {
    manifest: {
      format: "makerstudio-project",
      formatVersion: FORMAT_VERSION,
      appVersion,
      units: "mm",
      createdAt: at,
      modifiedAt: at,
    },
    document: {
      id: newId(),
      name: name.trim() || "Untitled project",
      description: "",
      workspaces: {
        cad: { objects: [] },
        circuit: { components: [], wires: [] },
        robotics: { assemblies: [] },
        displays: { screens: [] },
      },
    },
    history: { entries: [], revisions: [] },
    notes: "",
    conversations: [],
    assets: {},
  };
}

function json(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

/** Rejects archive paths that could escape the project (absolute paths, "..", backslashes). */
export function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.length > 400) return false;
  if (path.startsWith("/") || path.includes("\\") || /^[a-zA-Z]:/.test(path)) return false;
  return path.split("/").every((part) => part !== ".." && part !== ".");
}

export function packProject(project: Project): Uint8Array {
  const files: Zippable = {
    "manifest.json": json(project.manifest),
    "document.json": json(project.document),
    "history.json": json(project.history),
    "notes.md": strToU8(project.notes),
  };
  for (const conversation of project.conversations) {
    files[`ai/conversations/${conversation.id}.json`] = json(conversation);
  }
  for (const [name, bytes] of Object.entries(project.assets)) {
    const path = `assets/${name}`;
    if (!isSafeArchivePath(path)) throw new ProjectFormatError(`Unsafe asset name: ${name}`);
    files[path] = [bytes, { level: 0 }];
  }
  return zipSync(files, { level: 6 });
}

function readJson<T>(files: Record<string, Uint8Array>, path: string, schema: z.ZodType<T>): T {
  const bytes = files[path];
  if (!bytes) throw new ProjectFormatError(`The project file is missing "${path}".`);
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch {
    throw new ProjectFormatError(`"${path}" is not valid JSON.`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length ? issue.path.join(".") : "(root)";
    throw new ProjectFormatError(`"${path}" is invalid at ${where}: ${issue?.message ?? "unknown problem"}`);
  }
  return result.data;
}

/**
 * Upgrades older file versions. Each future format version adds one step here,
 * so old projects keep opening.
 */
export function migrate(manifest: Manifest): Manifest {
  if (manifest.formatVersion > FORMAT_VERSION) {
    throw new ProjectFormatError(
      `This project was saved by a newer MakerStudio AI (file format ${manifest.formatVersion}). ` +
        `This version reads format ${FORMAT_VERSION}. Please update the app.`,
    );
  }
  return manifest;
}

export function unpackProject(bytes: Uint8Array): Project {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ProjectFormatError("This file is not a MakerStudio project (it is not a valid zip archive).");
  }
  for (const path of Object.keys(files)) {
    if (!isSafeArchivePath(path)) throw new ProjectFormatError(`The project contains an unsafe path: ${path}`);
  }
  const manifest = migrate(readJson(files, "manifest.json", ManifestSchema));
  const document = readJson(files, "document.json", DocumentSchema);
  const history = files["history.json"]
    ? readJson(files, "history.json", HistoryFileSchema)
    : { entries: [], revisions: [] };
  const notes = files["notes.md"] ? strFromU8(files["notes.md"]) : "";
  const conversations: Conversation[] = [];
  const assets: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith("ai/conversations/") && path.endsWith(".json")) {
      conversations.push(readJson(files, path, ConversationSchema));
    } else if (path.startsWith("assets/") && !path.endsWith("/")) {
      assets[path.slice("assets/".length)] = data;
    }
  }
  for (const object of document.workspaces.cad.objects) {
    if (object.kind !== "mesh") continue;
    const bytes = object.mesh ? assets[object.mesh] : undefined;
    if (!bytes) throw new ProjectFormatError(`The mesh for "${object.name}" is missing from the project file.`);
    try {
      decodeMesh(bytes);
    } catch (error) {
      throw new ProjectFormatError(`The mesh for "${object.name}" is damaged: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { manifest, document, history, notes, conversations, assets };
}

/** A copy with a new identity, used by "Duplicate project". */
export function duplicateProject(project: Project, newName: string, now = new Date()): Project {
  const at = now.toISOString();
  return {
    ...structuredClone(project),
    manifest: { ...project.manifest, createdAt: at, modifiedAt: at },
    document: { ...structuredClone(project.document), id: newId(), name: newName },
    history: {
      entries: [
        ...project.history.entries,
        { id: newId(), at, label: `Duplicated from "${project.document.name}"`, author: "system", kind: "change" },
      ],
      revisions: [],
    },
  };
}
