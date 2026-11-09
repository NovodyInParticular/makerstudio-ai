import { describe, expect, it } from "vitest";
import { renameProject, setNotes } from "../../src/core/document/commands";
import { createProjectStore, MERGE_WINDOW_MS } from "../../src/core/document/store";

const fresh = () => createProjectStore(undefined, "test");

describe("project store", () => {
  it("applies, undoes and redoes commands", () => {
    const store = fresh();
    store.getState().execute(renameProject({ name: "Rover" }));
    expect(store.getState().project.document.name).toBe("Rover");
    expect(store.getState().isDirty()).toBe(true);
    store.getState().undo();
    expect(store.getState().project.document.name).toBe("Untitled project");
    store.getState().redo();
    expect(store.getState().project.document.name).toBe("Rover");
  });

  it("a new change clears the redo stack", () => {
    const store = fresh();
    store.getState().execute(renameProject({ name: "A" }));
    store.getState().undo();
    store.getState().execute(renameProject({ name: "B" }));
    expect(store.getState().canRedo()).toBe(false);
  });

  it("merges fast typing into one undo step but not slow edits", () => {
    const store = fresh();
    store.getState().execute(setNotes({ notes: "h" }), { now: 1000 });
    store.getState().execute(setNotes({ notes: "he" }), { now: 1100 });
    store.getState().execute(setNotes({ notes: "hey" }), { now: 1200 });
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().execute(setNotes({ notes: "hey!" }), { now: 1200 + MERGE_WINDOW_MS + 1 });
    expect(store.getState().undoStack).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().project.notes).toBe("hey");
    store.getState().undo();
    expect(store.getState().project.notes).toBe("");
  });

  it("does not record anything when nothing changes", () => {
    const store = fresh();
    store.getState().execute(setNotes({ notes: "" }));
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().isDirty()).toBe(false);
  });

  it("leaves the project untouched when a command is invalid", () => {
    const store = fresh();
    expect(() => store.getState().execute(renameProject({ name: "   " }))).toThrow(/cannot be empty/);
    expect(store.getState().project.document.name).toBe("Untitled project");
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("records revisions on save and keeps edits made while saving", () => {
    const store = fresh();
    store.getState().execute(renameProject({ name: "Rover" }));
    const version = store.getState().version;
    const snapshot = store.getState().snapshotForSave();
    store.getState().execute(setNotes({ notes: "typed during save" })); // edit while the file is being written
    store.getState().markSaved("/tmp/rover.msproj", snapshot, version);
    const state = store.getState();
    expect(state.project.history.revisions).toHaveLength(1);
    expect(state.project.history.revisions[0]!.summary).toBe("Saved 1 change");
    expect(state.project.notes).toBe("typed during save");
    expect(state.isDirty()).toBe(true); // the edit after the snapshot is still unsaved
    expect(state.project.history.entries.map((e) => e.kind)).toEqual(["change", "save", "change"]);
    expect(state.filePath).toBe("/tmp/rover.msproj");
  });

  it("history logs undo and redo", () => {
    const store = fresh();
    store.getState().execute(renameProject({ name: "X" }));
    store.getState().undo();
    store.getState().redo();
    expect(store.getState().project.history.entries.map((e) => e.label)).toEqual([
      'Rename project to "X"', 'Undo: Rename project to "X"', 'Redo: Rename project to "X"',
    ]);
  });
});
