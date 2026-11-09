// The typed bridge between the user interface (renderer) and the desktop process (main).
// The renderer never touches the file system directly; it asks main through this API.

import type { Project } from "./format";

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

export interface Settings {
  units: "mm";
  gridSize: number;
  snapEnabled: boolean;
  aiPanelOpen: boolean;
  printer: { name: string; bedX: number; bedY: number; bedZ: number; nozzle: number };
  mcp: { enabled: boolean; port: number; token: string };
  ai: ChatSettings;
  /** Size of the whole interface (1 = 100 %), for big or high-resolution screens. */
  uiZoom: number;
}

export interface ChatSettings {
  provider: "claude-code" | "ollama" | "openai" | "anthropic";
  ollamaUrl: string;
  ollamaModel: string;
  openaiUrl: string;
  openaiModel: string;
  anthropicModel: string;
}

export interface DevicePort { port: string; description: string; hwid: string }
export type DeviceEvent = { job: string; kind: "line"; text: string } | { job: string; kind: "done"; ok: boolean; message: string };

export type ChatEvent =
  | { chatId: string; type: "text"; delta: string }
  | { chatId: string; type: "tool"; name: string; ok: boolean; detail: string }
  | { chatId: string; type: "done"; stop: string }
  | { chatId: string; type: "error"; message: string };

/** A request from the main process (an AI connection) for the window to answer. */
export type AiRequest =
  | { id: number; kind: "specs"; readOnly?: boolean }
  | { id: number; kind: "call"; source: string; name: string; params: unknown };
export type AiResponse = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string };

export interface McpStatus { running: boolean; port: number; url: string; error: string | null; calls: number }

export interface SecureStorageStatus {
  available: boolean;
  /** Linux only: which keyring backend Electron selected. */
  backend: string;
  /** True when keys would only be obfuscated, not encrypted (no keyring running). */
  weak: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface OpenedProject {
  path: string;
  project: Project;
}

export interface FileData {
  /** File name only, no folders. */
  name: string;
  bytes: Uint8Array;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SlicerStatus {
  found: boolean;
  name: string;
  /** Where it was found (a path, or a description such as "Flatpak"). */
  location: string | null;
}

/** One size in a part script's PARAMETERS block (see src/main/scriptRunner.py). */
export interface ScriptParameter {
  name: string;
  line: number;
  /** The "# --- heading ---" it sits under ("" at the top). */
  group: string;
  comment: string;
  /** The value as written in the script. */
  text: string;
  /** Plain values (number, true/false, or a list of them); null for computed ones. */
  value: ScriptValue | null;
  editable: boolean;
}
export type ScriptValue = number | boolean | ScriptValue[];
export type ScriptValues = Record<string, ScriptValue>;
export interface ScriptBuild { files: FileData[]; log: string; seconds: number; skipped: string[] }

export interface MakerStudioApi {
  appInfo(): Promise<{ version: string; platform: string; electron: string; chrome: string; node: string }>;
  /** Shows a save dialog when path is null. Returns the saved path, or null if cancelled. */
  saveProject(project: Project, path: string | null, suggestedName: string): Promise<Result<string | null>>;
  /** Shows an open dialog when path is null. Returns null if cancelled. */
  openProject(path: string | null): Promise<Result<OpenedProject | null>>;
  /** Writes a copy without changing which file is open. */
  exportProject(project: Project, suggestedName: string): Promise<Result<string | null>>;
  /** Asks for a Python part script. Returns its path and parameters (null parameters: none found), or null if cancelled. */
  pickScript(): Promise<Result<{ path: string; parameters: ScriptParameter[] | null } | null>>;
  /** Reads a part script's parameters again (for example after it was edited). */
  inspectScript(path: string): Promise<Result<ScriptParameter[] | null>>;
  /** Builds a part script with changed values in a temporary copy (asks the owner first, once per script). Null if they said no. */
  buildScript(path: string, values: ScriptValues): Promise<Result<ScriptBuild | null>>;
  /** Asks for model files to import (STL / OBJ). Returns null if cancelled. */
  importModelFiles(): Promise<Result<FileData[] | null>>;
  /** Asks where to save one exported file and writes it. Returns the path, or null if cancelled. */
  saveExportFile(suggestedName: string, bytes: Uint8Array, filter: FileFilter): Promise<Result<string | null>>;
  /** Asks for a folder and writes several exported files into it. Returns the folder, or null if cancelled. */
  saveExportFiles(files: FileData[]): Promise<Result<string | null>>;
  /** Asks for a parent folder and writes a code project into a new subfolder. Returns the new folder, or null if cancelled. */
  exportCodeProject(folderName: string, files: { path: string; text: string }[]): Promise<Result<string | null>>;
  /** Reads one of the known local model files (see shared/localModels.ts). */
  readLocalModel(key: string): Promise<Result<FileData>>;
  /** Claude Code (MCP) connection status; turning it on/off is done through settings. */
  mcpStatus(): Promise<McpStatus>;
  /** Makes a new connection token (Claude Code must be set up again). */
  mcpNewToken(): Promise<Settings>;
  /** The window answers AI tool requests coming from the main process. */
  onAiRequest(handler: (request: AiRequest) => void): void;
  aiRespond(response: AiResponse): void;
  /** Compiles an Arduino sketch for the Uno emulator. */
  avrBuild(code: string, board: "uno" | "pico"): Promise<Result<{ ok: true; board: "uno" | "pico"; hex?: string; bin?: Uint8Array; size: string } | { ok: false; errors: string[] }>>;
  /** Doom handheld preview: engine and game data (downloaded on first use, checksum-verified). */
  doomEngine(): Promise<Result<Uint8Array>>;
  doomFreedoom(): Promise<Result<Uint8Array>>;
  doomPickWad(): Promise<Result<{ name: string; bytes: Uint8Array } | null>>;
  /** Real boards over USB. */
  deviceTools(): Promise<Result<{ pio: string | null; esptool: string | null; python: string | null }>>;
  devicePorts(): Promise<Result<DevicePort[]>>;
  /** Asks for a .img/.bin file, then flashes it at the address; null when cancelled. */
  deviceFlash(port: string, address: string): Promise<Result<string | null>>;
  /** Asks for a PlatformIO project folder, then builds and uploads it; null when cancelled. */
  deviceUpload(port: string | null): Promise<Result<string | null>>;
  deviceMonitor(port: string, baud: number): Promise<Result<null>>;
  deviceSend(text: string): Promise<Result<null>>;
  deviceStop(job: "flash" | "upload" | "monitor"): void;
  onDeviceEvent(handler: (event: DeviceEvent) => void): void;
  /** A project file the app was launched with (double-click), once. */
  takePendingFile(): Promise<string | null>;
  /** A project file from a second launch while the app is open. */
  onOpenFile(handler: (file: string) => void): void;
  /** In-app chat: send one message (events arrive through onChatEvent). */
  chatSend(chatId: string, text: string, mode: string, imageToken?: string): Promise<void>;
  /** Lets the owner pick a picture for the chat; returns a token for chatSend and a preview. */
  chatPickImage(): Promise<Result<{ token: string; name: string; preview: string } | null>>;
  chatCancel(chatId: string): void;
  chatForget(chatId: string): void;
  onChatEvent(handler: (event: ChatEvent) => void): void;
  /** Which API keys are stored (never the keys themselves). */
  aiKeyStatus(): Promise<{ openai: boolean; anthropic: boolean }>;
  /** Stores (or with null removes) an API key in the system keyring. */
  aiSetKey(provider: "openai" | "anthropic", key: string | null): Promise<Result<null>>;
  /** Models installed in Ollama. */
  ollamaModels(): Promise<Result<string[]>>;
  /** Whether Bambu Studio is installed. */
  slicerStatus(): Promise<SlicerStatus>;
  /** Writes the files to a new folder under Exports and opens them in Bambu Studio. Returns the folder. */
  openInSlicer(folderName: string, files: FileData[]): Promise<Result<string>>;
  recentProjects(): Promise<RecentProject[]>;
  forgetRecent(path: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  secureStorageStatus(): Promise<SecureStorageStatus>;
  setDirty(dirty: boolean): void;
  setTitle(title: string): void;
  /** The quit prompt's "Save" button: save the project, then call closeAfterSave(). */
  onSaveAndClose(handler: () => void): void;
  closeAfterSave(): void;
  /** Full screen on / off (also F11). Returns the new state. */
  toggleFullScreen(): Promise<boolean>;
  /** Settings changed outside the Settings page (e.g. Ctrl+= zoom). */
  onSettingsChanged(handler: (s: Settings) => void): void;
  /** Real drone: start sending sticks to its UDP port (the computer must be on its Wi-Fi). */
  droneConnect(host: string, port: number): Promise<Result<null>>;
  droneSticks(s: { throttle: number; roll: number; pitch: number; yaw: number; arm: boolean; climb?: number; hold?: boolean }): void;
  droneDisconnect(): Promise<Result<null>>;
  onDroneTelemetry(handler: (t: { armed: boolean; roll: number; pitch: number; yaw: number; volts: number; loopHz: number; calibrated: boolean; height: number | null; holding: boolean; at: number }) => void): () => void;
  onFullScreen(handler: (on: boolean) => void): void;
}

declare global {
  interface Window {
    makerstudio: MakerStudioApi;
  }
}
