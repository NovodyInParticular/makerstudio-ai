// Commands are the only way a project document changes.
// The same commands will be used by the mouse, the keyboard, menus and (in Phase 4) the AI.
// Each command edits a draft copy; immer records the change as patches,
// which gives undo/redo and AI previews for free.

import type { ProjectDocument } from "../../shared/format";

/** The editable part of a project: the design document plus the notes. */
export interface EditableState {
  document: ProjectDocument;
  notes: string;
}

export interface CommandDefinition<P> {
  type: string;
  /** Human-readable label for undo menus and history, e.g. "Rename project". */
  label(params: P): string;
  /** Throw an Error with a clear message when params are invalid. */
  apply(draft: EditableState, params: P): void;
  /**
   * Consecutive commands with the same merge key, within a short time, become one undo step
   * (so typing a paragraph of notes is undone as one change, not letter by letter).
   */
  mergeKey?(params: P): string | undefined;
}

export interface Command<P = unknown> {
  type: string;
  params: P;
}

const registry = new Map<string, CommandDefinition<any>>();

export function defineCommand<P>(definition: CommandDefinition<P>) {
  if (registry.has(definition.type)) throw new Error(`Command "${definition.type}" is defined twice.`);
  registry.set(definition.type, definition);
  return (params: P): Command<P> => ({ type: definition.type, params });
}

export function getCommand(type: string): CommandDefinition<unknown> {
  const definition = registry.get(type);
  if (!definition) throw new Error(`Unknown command "${type}".`);
  return definition;
}

export function listCommands(): string[] {
  return [...registry.keys()].sort();
}

// --- Phase 2 commands -------------------------------------------------------

export const renameProject = defineCommand<{ name: string }>({
  type: "project.rename",
  label: ({ name }) => `Rename project to "${name.trim()}"`,
  apply(draft, { name }) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A project name cannot be empty.");
    if (trimmed.length > 200) throw new Error("A project name can be at most 200 characters.");
    draft.document.name = trimmed;
  },
});

export const setDescription = defineCommand<{ description: string }>({
  type: "project.setDescription",
  label: () => "Edit project description",
  apply(draft, { description }) {
    if (description.length > 5000) throw new Error("The description can be at most 5000 characters.");
    draft.document.description = description;
  },
  mergeKey: () => "project.description",
});

export const setNotes = defineCommand<{ notes: string }>({
  type: "notes.set",
  label: () => "Edit design notes",
  apply(draft, { notes }) {
    draft.notes = notes;
  },
  mergeKey: () => "notes",
});
