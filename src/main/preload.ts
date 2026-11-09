// Runs before the user interface loads and exposes a small, fixed API to it.
// The interface gets no direct access to Node.js or the file system.

import { contextBridge, ipcRenderer } from "electron";
import type { MakerStudioApi } from "../shared/ipc";

const api: MakerStudioApi = {
  appInfo: () => ipcRenderer.invoke("app:info"),
  saveProject: (project, path, suggestedName) => ipcRenderer.invoke("project:save", project, path, suggestedName),
  openProject: (path) => ipcRenderer.invoke("project:open", path),
  exportProject: (project, suggestedName) => ipcRenderer.invoke("project:export", project, suggestedName),
  importModelFiles: () => ipcRenderer.invoke("model:import"),
  pickScript: () => ipcRenderer.invoke("script:pick"),
  inspectScript: (path) => ipcRenderer.invoke("script:inspect", path),
  buildScript: (path, values) => ipcRenderer.invoke("script:build", path, values),
  saveExportFile: (suggestedName, bytes, filter) => ipcRenderer.invoke("model:export", suggestedName, bytes, filter),
  saveExportFiles: (files) => ipcRenderer.invoke("model:exportMany", files),
  exportCodeProject: (folderName, files) => ipcRenderer.invoke("code:exportProject", folderName, files),
  readLocalModel: (key) => ipcRenderer.invoke("model:readLocal", key),
  slicerStatus: () => ipcRenderer.invoke("slicer:status"),
  mcpStatus: () => ipcRenderer.invoke("mcp:status"),
  takePendingFile: () => ipcRenderer.invoke("app:takePendingFile"),
  deviceTools: () => ipcRenderer.invoke("device:tools"),
  avrBuild: (code, board) => ipcRenderer.invoke("avr:build", code, board),
  doomEngine: () => ipcRenderer.invoke("doom:engine"),
  doomFreedoom: () => ipcRenderer.invoke("doom:freedoom"),
  doomPickWad: () => ipcRenderer.invoke("doom:pickWad"),
  devicePorts: () => ipcRenderer.invoke("device:ports"),
  deviceFlash: (port, address) => ipcRenderer.invoke("device:flash", port, address),
  deviceUpload: (port) => ipcRenderer.invoke("device:upload", port),
  deviceMonitor: (port, baud) => ipcRenderer.invoke("device:monitor", port, baud),
  deviceSend: (text) => ipcRenderer.invoke("device:send", text),
  deviceStop: (job) => ipcRenderer.send("device:stop", job),
  onDeviceEvent: (handler) => { ipcRenderer.on("device:event", (_e, event) => handler(event)); },
  onOpenFile: (handler) => { ipcRenderer.on("app:openFile", (_e, file: string) => handler(file)); },
  chatSend: (chatId, text, mode, imageToken) => ipcRenderer.invoke("chat:send", chatId, text, mode, imageToken),
  chatPickImage: () => ipcRenderer.invoke("chat:pickImage"),
  chatCancel: (chatId) => ipcRenderer.send("chat:cancel", chatId),
  chatForget: (chatId) => ipcRenderer.send("chat:forget", chatId),
  onChatEvent: (handler) => { ipcRenderer.on("chat:event", (_e, event) => handler(event)); },
  aiKeyStatus: () => ipcRenderer.invoke("ai:keyStatus"),
  aiSetKey: (provider, key) => ipcRenderer.invoke("ai:setKey", provider, key),
  ollamaModels: () => ipcRenderer.invoke("ai:ollamaModels"),
  mcpNewToken: () => ipcRenderer.invoke("mcp:newToken"),
  onAiRequest: (handler) => { ipcRenderer.on("ai:request", (_e, request) => handler(request)); },
  aiRespond: (response) => ipcRenderer.send("ai:response", response),
  openInSlicer: (folderName, files) => ipcRenderer.invoke("slicer:open", folderName, files),
  recentProjects: () => ipcRenderer.invoke("recent:list"),
  forgetRecent: (path) => ipcRenderer.invoke("recent:forget", path),
  revealInFolder: (path) => ipcRenderer.invoke("shell:reveal", path),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  secureStorageStatus: () => ipcRenderer.invoke("secrets:status"),
  setDirty: (dirty) => ipcRenderer.send("app:dirty", dirty),
  setTitle: (title) => ipcRenderer.send("app:title", title),
  onSaveAndClose: (handler) => { ipcRenderer.on("app:saveAndClose", () => handler()); },
  closeAfterSave: () => ipcRenderer.send("app:closeAfterSave"),
  toggleFullScreen: () => ipcRenderer.invoke("app:toggleFullScreen"),
  onSettingsChanged: (handler) => { ipcRenderer.on("settings:changed", (_e, s) => handler(s)); },
  droneConnect: (host, port) => ipcRenderer.invoke("drone:connect", host, port),
  droneSticks: (s) => ipcRenderer.send("drone:sticks", s),
  droneDisconnect: () => ipcRenderer.invoke("drone:disconnect"),
  onDroneTelemetry: (handler) => { const f = (_e: unknown, t: Parameters<typeof handler>[0]) => handler(t); ipcRenderer.on("drone:telemetry", f); return () => ipcRenderer.removeListener("drone:telemetry", f); },
  onFullScreen: (handler) => { ipcRenderer.on("app:fullScreen", (_e, on: boolean) => handler(on)); },
};

contextBridge.exposeInMainWorld("makerstudio", api);

// Menu clicks arrive as DOM events so the React app can listen without extra bridge code.
ipcRenderer.on("menu", (_event, action: string) => {
  window.dispatchEvent(new CustomEvent("makerstudio:menu", { detail: action }));
});
