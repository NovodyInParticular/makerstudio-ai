import { useEffect } from "react";
import { duplicateCurrent, exportCopy, newProject, openProject, redo, refreshRecent, saveProject, toggleAiPanel, undo } from "./actions";
import { CadWorkspace } from "./cad/CadWorkspace";
import { CircuitWorkspace } from "./circuit/CircuitWorkspace";
import { DisplayWorkspace } from "./display/DisplayWorkspace";
import { RoboticsWorkspace } from "./robot/RoboticsWorkspace";
import { DroneWorkspace } from "./drone/DroneWorkspace";
import { handleCadKey } from "./cad/cadState";
import { installAiBridge } from "./ai/bridge";
import { installChat } from "./ai/chatState";
import { loadCsg } from "./cad/csgLoader";
import { AiEngineer, AiPanel, DialogHost, Sidebar, Toasts, TopBar, useWindowSync } from "./components/Shell";
import { HomePage } from "./pages/Home";
import { WorkspaceErrorBoundary } from "./components/ErrorBoundary";
import { PlannedPage } from "./pages/Planned";
import { ProjectsPage } from "./pages/Projects";
import { SettingsPage } from "./pages/Settings";
import { DevicePage } from "./pages/Device";
import { PartsPage } from "./pages/Parts";
import { useUi } from "./state";
import { WORKSPACES, workspaceInfo } from "./workspaces";

const menuActions: Record<string, () => unknown> = {
  "project:new": newProject,
  "project:open": () => openProject(),
  "project:save": () => saveProject(false),
  "project:saveAs": () => saveProject(true),
  "project:duplicate": duplicateCurrent,
  "project:export": exportCopy,
  "edit:undo": undo,
  "edit:redo": redo,
  "view:toggleAi": toggleAiPanel,
};

function shortcutAction(e: KeyboardEvent): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "n" && !e.shiftKey) return "project:new";
  if (key === "o" && !e.shiftKey) return "project:open";
  if (key === "s") return e.shiftKey ? "project:saveAs" : "project:save";
  if (key === "z") return e.shiftKey ? "edit:redo" : "edit:undo";
  if (key === "y" && !e.shiftKey) return "edit:redo";
  if (key === "j" && !e.shiftKey) return "view:toggleAi";
  return null;
}

export function App() {
  const workspace = useUi((s) => s.workspace);
  const dialogOpen = useUi((s) => s.dialog !== null);
  useWindowSync();

  useEffect(() => {
    installAiBridge();
    installChat();
    void loadCsg();
    void (async () => {
      const settings = await window.makerstudio.getSettings();
      useUi.getState().setSettings(settings);
      window.makerstudio.onSettingsChanged((s) => useUi.getState().setSettings(s));
      useUi.getState().setAiPanelOpen(settings.aiPanelOpen);
      await refreshRecent();
      const file = await window.makerstudio.takePendingFile();
      if (file) await openProject(file);
    })();
    window.makerstudio.onOpenFile((file) => void openProject(file));
    // "Save" in the quit prompt: close only when the save worked (not when it was cancelled or failed).
    window.makerstudio.onSaveAndClose(() => {
      void saveProject(false).then((saved) => { if (saved) window.makerstudio.closeAfterSave(); });
    });
  }, []);

  useEffect(() => {
    const onMenu = (e: Event) => {
      if (useUi.getState().dialog) return;
      void menuActions[(e as CustomEvent<string>).detail]?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        void window.makerstudio.toggleFullScreen();
        return;
      }
      if (useUi.getState().dialog) return; // dialogs handle their own keys
      const digit = /^Digit([0-9])$/.exec(e.code);
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && digit) {
        const target = WORKSPACES.find((w) => w.key === digit[1]);
        if (target) {
          e.preventDefault();
          useUi.getState().setWorkspace(target.id);
        }
        return;
      }
      const action = shortcutAction(e);
      if (!action) {
        if (useUi.getState().workspace === "cad" && handleCadKey(e)) e.preventDefault();
        return;
      }
      e.preventDefault();
      // Commit a half-typed field (for example the project name) before saving or undoing.
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      void menuActions[action]?.();
    };
    window.addEventListener("makerstudio:menu", onMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("makerstudio:menu", onMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const info = workspaceInfo(workspace);
  let page;
  if (workspace === "home") page = <HomePage />;
  else if (workspace === "projects") page = <ProjectsPage />;
  else if (workspace === "settings") page = <SettingsPage />;
  else if (workspace === "device") page = <DevicePage />;
  else if (workspace === "parts") page = <PartsPage />;
  else if (workspace === "cad") page = <CadWorkspace />;
  else if (workspace === "display") page = <DisplayWorkspace />;
  else if (workspace === "circuit") page = <CircuitWorkspace />;
  else if (workspace === "robotics") page = <RoboticsWorkspace />;
  else if (workspace === "drone") page = <DroneWorkspace />;
  else if (workspace === "ai") page = <AiEngineer variant="page" />;
  else page = <PlannedPage info={info} />;

  return (
    <div className="app" aria-hidden={dialogOpen || undefined}>
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="workspace" data-testid={`workspace-${workspace}`}>
          <WorkspaceErrorBoundary resetKey={workspace} onBack={() => useUi.getState().setWorkspace("home")}>{page}</WorkspaceErrorBoundary>
        </main>
        <AiPanel />
      </div>
      <Toasts />
      <DialogHost />
    </div>
  );
}
