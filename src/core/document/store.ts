// The project store: holds the open project, applies commands, and keeps undo/redo stacks.
// It is plain TypeScript (no React), so it can be unit-tested directly.

import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";
import { createStore } from "zustand/vanilla";
import { createEmptyProject, DocumentSchema, newId, type HistoryEntry, type Project } from "../../shared/format";
import { getCommand, type Command, type EditableState } from "./commands";
import { registerMeshAssets } from "../cad/meshes";
import type { CadObject } from "../cad/model";

enablePatches();

export const MERGE_WINDOW_MS = 1500;
export const UNDO_LIMIT = 200;
export const HISTORY_LIMIT = 1000;

export interface UndoStep {
  label: string;
  author: "user" | "ai";
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  at: number;
}

export interface ProjectState {
  project: Project;
  filePath: string | null;
  /** Increases on every change, undo and redo. */
  version: number;
  savedVersion: number;
  undoStack: UndoStep[];
  redoStack: UndoStep[];
}

export interface ProjectActions {
  execute(command: Command, options?: { author?: "user" | "ai"; now?: number }): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  isDirty(): boolean;
  /** Replace the open project (new / open / duplicate). Clears undo history. */
  load(project: Project, filePath: string | null): void;
  /**
   * Call after the snapshot was written to disk. Keeps any edits made while saving,
   * records the revision and marks the saved version clean.
   */
  markSaved(filePath: string, snapshot: Project, versionAtSnapshot: number): void;
  /**
   * Adds a binary file (for example an imported mesh). Assets never change once added, so they
   * are not part of undo; the object that uses one is. Unused meshes are dropped when saving.
   */
  addAsset(name: string, bytes: Uint8Array): void;
  /** The project as it should be written to disk right now (with a fresh modified date and save revision). */
  snapshotForSave(now?: Date): Project;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

/** Assets to write: everything except meshes that no object uses any more (e.g. after undoing an import). */
function usedAssets(project: Project): Record<string, Uint8Array> {
  const used = new Set((project.document.workspaces.cad.objects as CadObject[]).map((o) => o.mesh).filter(Boolean));
  return Object.fromEntries(Object.entries(project.assets).filter(([name]) => !name.startsWith("meshes/") || used.has(name)));
}

function editable(project: Project): EditableState {
  return { document: project.document, notes: project.notes };
}

function historyEntry(label: string, author: HistoryEntry["author"], kind: HistoryEntry["kind"]): HistoryEntry {
  return { id: newId(), at: new Date().toISOString(), label, author, kind };
}

function appendHistory(project: Project, entry: HistoryEntry): Project {
  const entries = [...project.history.entries, entry].slice(-HISTORY_LIMIT);
  return { ...project, history: { ...project.history, entries } };
}

function changesSinceLastSave(project: Project): number {
  let count = 0;
  for (let i = project.history.entries.length - 1; i >= 0; i--) {
    const entry = project.history.entries[i]!;
    if (entry.kind === "save") break;
    count++;
  }
  return count;
}

/** Validation errors arrive as a JSON list of issues; turn them into one plain sentence. */
export function readableError(error: unknown): unknown {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] } | null)?.issues;
  if (!Array.isArray(issues) || !issues.length) return error;
  const first = issues[0]!;
  const where = first.path.length ? `${first.path.map(String).join(".")}: ` : "";
  return new Error(`Invalid value (${where}${first.message})${issues.length > 1 ? ` and ${issues.length - 1} more problem${issues.length > 2 ? "s" : ""}` : ""}.`);
}

export function createProjectStore(initial?: Project, appVersion = "0.0.0") {
  return createStore<ProjectState & ProjectActions>()((set, get) => ({
    project: initial ?? createEmptyProject("Untitled project", appVersion),
    filePath: null,
    version: 0,
    savedVersion: 0,
    undoStack: [],
    redoStack: [],

    execute(command, options = {}) {
      const definition = getCommand(command.type);
      const author = options.author ?? "user";
      const now = options.now ?? Date.now();
      const state = get();
      const [next, patches, inverse] = produceWithPatches(editable(state.project), (draft) => {
        try {
          definition.apply(draft, command.params);
        } catch (error) {
          throw readableError(error);
        }
      });
      if (patches.length === 0) return; // nothing changed
      // Last line of defence: a change that would make the saved file unreadable is refused,
      // so a project can always be opened again (whatever a command or the AI sent).
      const valid = DocumentSchema.safeParse(next.document);
      if (!valid.success) {
        const issue = valid.error.issues[0];
        throw new Error(`That change was refused because it would damage the project (${issue?.path.join(".") || "document"}: ${issue?.message ?? "invalid"}).`);
      }
      const label = definition.label(command.params);
      const mergeKey = definition.mergeKey?.(command.params);
      const last = state.undoStack[state.undoStack.length - 1];
      let undoStack: UndoStep[];
      let project: Project = { ...state.project, document: next.document, notes: next.notes };
      const canMerge =
        last && mergeKey && last.mergeKey === mergeKey && last.author === author && now - last.at < MERGE_WINDOW_MS &&
        state.version !== state.savedVersion; // never merge across a save
      if (canMerge) {
        const merged: UndoStep = { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now };
        undoStack = [...state.undoStack.slice(0, -1), merged];
      } else {
        undoStack = [...state.undoStack, { label, author, patches, inverse, mergeKey, at: now }].slice(-UNDO_LIMIT);
        project = appendHistory(project, historyEntry(label, author, "change"));
      }
      set({ project, undoStack, redoStack: [], version: state.version + 1 });
    },

    undo() {
      const state = get();
      const step = state.undoStack[state.undoStack.length - 1];
      if (!step) return;
      const next = applyPatches(editable(state.project), step.inverse);
      let project: Project = { ...state.project, document: next.document, notes: next.notes };
      project = appendHistory(project, historyEntry(`Undo: ${step.label}`, "user", "undo"));
      set({
        project,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, { ...step, mergeKey: undefined }],
        version: state.version + 1,
      });
    },

    redo() {
      const state = get();
      const step = state.redoStack[state.redoStack.length - 1];
      if (!step) return;
      const next = applyPatches(editable(state.project), step.patches);
      let project: Project = { ...state.project, document: next.document, notes: next.notes };
      project = appendHistory(project, historyEntry(`Redo: ${step.label}`, "user", "redo"));
      set({
        project,
        undoStack: [...state.undoStack, step],
        redoStack: state.redoStack.slice(0, -1),
        version: state.version + 1,
      });
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,
    isDirty: () => get().version !== get().savedVersion,

    load(project, filePath) {
      registerMeshAssets(project.assets);
      set({ project, filePath, version: 0, savedVersion: 0, undoStack: [], redoStack: [] });
    },

    snapshotForSave(now = new Date()) {
      const { project } = get();
      const at = now.toISOString();
      const changes = changesSinceLastSave(project);
      const number = (project.history.revisions[project.history.revisions.length - 1]?.number ?? 0) + 1;
      const summary = changes === 0 ? "Saved (no changes)" : `Saved ${changes} change${changes === 1 ? "" : "s"}`;
      return {
        ...project,
        assets: usedAssets(project),
        manifest: { ...project.manifest, modifiedAt: at },
        history: {
          entries: [...project.history.entries, { id: newId(), at, label: summary, author: "system" as const, kind: "save" as const }].slice(-HISTORY_LIMIT),
          revisions: [...project.history.revisions, { number, at, changes, summary }],
        },
      };
    },

    addAsset(name, bytes) {
      set((state) => ({ project: { ...state.project, assets: { ...state.project.assets, [name]: bytes } } }));
    },

    markSaved(filePath, snapshot, versionAtSnapshot) {
      set((state) => {
        const snapEntries = snapshot.history.entries;
        const lastBeforeSave = snapEntries[snapEntries.length - 2]?.id;
        const current = state.project.history.entries;
        const index = lastBeforeSave ? current.findIndex((e) => e.id === lastBeforeSave) : -1;
        const madeWhileSaving = current.slice(index + 1);
        return {
          project: {
            ...state.project,
            manifest: snapshot.manifest,
            history: {
              entries: [...snapEntries, ...madeWhileSaving].slice(-HISTORY_LIMIT),
              revisions: snapshot.history.revisions,
            },
          },
          filePath,
          savedVersion: versionAtSnapshot,
        };
      });
    },
  }));
}
