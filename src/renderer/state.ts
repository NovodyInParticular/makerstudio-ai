// User-interface state (which workspace is open, panels, notifications, dialogs)
// and the single project store shared by the whole interface.

import { create, useStore } from "zustand";
import { createProjectStore, type ProjectActions, type ProjectState } from "../core/document/store";
import type { RecentProject, Settings } from "../shared/ipc";
import type { WorkspaceId } from "./workspaces";

export const APP_VERSION = __APP_VERSION__;

export const projectStore = createProjectStore(undefined, APP_VERSION);

export function useProject<T>(selector: (state: ProjectState & ProjectActions) => T): T {
  return useStore(projectStore, selector);
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

export interface DialogButton {
  label: string;
  value: string;
  variant?: "primary" | "danger" | "plain";
}

export interface DialogRequest {
  title: string;
  message: string;
  /** When set, the dialog shows a text field with this starting value. */
  input?: { label: string; value: string };
  buttons: DialogButton[];
  resolve(result: { button: string; text: string }): void;
}

interface UiState {
  workspace: WorkspaceId;
  aiPanelOpen: boolean;
  settings: Settings | null;
  recent: RecentProject[];
  toasts: Toast[];
  dialog: DialogRequest | null;
  setWorkspace(id: WorkspaceId): void;
  setAiPanelOpen(open: boolean): void;
  setSettings(settings: Settings): void;
  setRecent(recent: RecentProject[]): void;
  notify(kind: Toast["kind"], message: string): void;
  dismiss(id: number): void;
  setDialog(dialog: DialogRequest | null): void;
}

let toastId = 0;
const MAX_TOASTS = 4;

export const useUi = create<UiState>()((set, get) => ({
  workspace: "home",
  aiPanelOpen: true,
  settings: null,
  recent: [],
  toasts: [],
  dialog: null,
  setWorkspace: (workspace) => set({ workspace }),
  setAiPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),
  setSettings: (settings) => set({ settings }),
  setRecent: (recent) => set({ recent }),
  notify(kind, message) {
    const id = ++toastId;
    // Keep only the newest few so a burst of messages never covers the window.
    set({ toasts: [...get().toasts, { id, kind, message }].slice(-MAX_TOASTS) });
    if (kind !== "error") setTimeout(() => get().dismiss(id), 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setDialog: (dialog) => set({ dialog }),
}));

/** Shows an in-app dialog and waits for the user's choice. */
export function ask(request: Omit<DialogRequest, "resolve">): Promise<{ button: string; text: string }> {
  return new Promise((resolve) => {
    useUi.getState().setDialog({
      ...request,
      resolve: (result) => {
        useUi.getState().setDialog(null);
        resolve(result);
      },
    });
  });
}
