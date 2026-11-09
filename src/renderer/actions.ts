// Project-level actions used by buttons, menus and keyboard shortcuts.

import { createPracticeProject, type PracticeProject } from "../core/practice/catalog";
import { createEmptyProject, duplicateProject } from "../shared/format";
import { APP_VERSION, ask, projectStore, useUi } from "./state";

const api = () => window.makerstudio;

export async function refreshRecent() {
  useUi.getState().setRecent(await api().recentProjects());
}

/** If there are unsaved changes, asks what to do. Returns false when the user cancels. */
async function confirmDiscard(action: string): Promise<boolean> {
  if (!projectStore.getState().isDirty()) return true;
  const { button } = await ask({
    title: "Unsaved changes",
    message: `"${projectStore.getState().project.document.name}" has unsaved changes. Save them before you ${action}?`,
    buttons: [
      { label: "Cancel", value: "cancel", variant: "plain" },
      { label: "Discard changes", value: "discard", variant: "danger" },
      { label: "Save", value: "save", variant: "primary" },
    ],
  });
  if (button === "save") return saveProject(false);
  return button === "discard";
}

export async function newProject() {
  if (!(await confirmDiscard("start a new project"))) return;
  const { button, text } = await ask({
    title: "New project",
    message: "Give the project a name. You can change it later.",
    input: { label: "Project name", value: "My robot" },
    buttons: [
      { label: "Cancel", value: "cancel", variant: "plain" },
      { label: "Create", value: "ok", variant: "primary" },
    ],
  });
  if (button !== "ok") return;
  projectStore.getState().load(createEmptyProject(text, APP_VERSION), null);
  useUi.getState().setWorkspace("projects");
  useUi.getState().notify("success", `Created "${projectStore.getState().project.document.name}". Save it to choose where it is stored.`);
}

/** Starts a new practice project from the catalog (asks first if there are unsaved changes). */
export async function startPracticeProject(p: PracticeProject) {
  if (!(await confirmDiscard("start a practice project"))) return;
  projectStore.getState().load(createPracticeProject(p, APP_VERSION), null);
  useUi.getState().setWorkspace("projects");
  const loaded: string[] = [];
  for (const key of p.localModels ?? []) {
    const result = await api().readLocalModel(key);
    if (!result.ok) { useUi.getState().notify("error", result.error); continue; }
    const { importModelBytes } = await import("./cad/fileActions");
    if (importModelBytes(result.value.name, result.value.bytes)) loaded.push(result.value.name);
  }
  if (loaded.length) {
    // Small parts look lost on the 256 mm bed: start the 3D view zoomed to them.
    const { useCad } = await import("./cad/cadState");
    useCad.getState().select([]);
    useCad.getState().requestView("fit");
  }
  useUi.getState().notify("success", `Started "${p.title}". The build plan is in the design notes${loaded.length ? `, and ${loaded.join(", ")} is in 3D Studio` : ", and starter shapes are in 3D Studio"}. Save it to keep it.`);
}

export async function openProject(path: string | null = null) {
  if (!(await confirmDiscard("open another project"))) return;
  const result = await api().openProject(path);
  if (!result.ok) {
    useUi.getState().notify("error", result.error);
    return;
  }
  if (!result.value) return; // cancelled
  projectStore.getState().load(result.value.project, result.value.path);
  await refreshRecent();
  useUi.getState().notify("success", `Opened "${result.value.project.document.name}".`);
}

/** Returns true when the project was saved. */
export async function saveProject(saveAs: boolean): Promise<boolean> {
  const store = projectStore.getState();
  const version = store.version;
  const snapshot = store.snapshotForSave();
  const target = saveAs ? null : store.filePath;
  const result = await api().saveProject(snapshot, target, snapshot.document.name);
  if (!result.ok) {
    useUi.getState().notify("error", result.error);
    return false;
  }
  if (!result.value) return false; // cancelled
  projectStore.getState().markSaved(result.value, snapshot, version);
  await refreshRecent();
  useUi.getState().notify("success", `Saved to ${result.value}`);
  return true;
}

export async function duplicateCurrent() {
  const current = projectStore.getState().project;
  const { button, text } = await ask({
    title: "Duplicate project",
    message: "The copy gets its own identity. Choose a name, then where to save it.",
    input: { label: "Name of the copy", value: `${current.document.name} copy` },
    buttons: [
      { label: "Cancel", value: "cancel", variant: "plain" },
      { label: "Duplicate", value: "ok", variant: "primary" },
    ],
  });
  if (button !== "ok" || !text.trim()) return;
  const copy = duplicateProject(current, text.trim());
  // Keep the whole current state (including unsaved changes and undo history) to restore on cancel.
  const previous = projectStore.getState();
  projectStore.getState().load(copy, null);
  const saved = await saveProject(true);
  if (!saved) {
    projectStore.setState(previous, true);
    useUi.getState().notify("info", "Duplicate cancelled.");
  }
}

export async function exportCopy() {
  const snapshot = projectStore.getState().project;
  const result = await api().exportProject(snapshot, `${snapshot.document.name} export`);
  if (!result.ok) useUi.getState().notify("error", result.error);
  else if (result.value) useUi.getState().notify("success", `Exported a copy to ${result.value}`);
}

export function undo() {
  projectStore.getState().undo();
}

export function redo() {
  projectStore.getState().redo();
}

export async function toggleAiPanel() {
  const open = !useUi.getState().aiPanelOpen;
  useUi.getState().setAiPanelOpen(open);
  try {
    useUi.getState().setSettings(await api().setSettings({ aiPanelOpen: open }));
  } catch {
    // remembering the panel state is a convenience; ignore failures
  }
}
