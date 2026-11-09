import { existsSync } from "node:fs";
// Electron main process: owns the window, the file system and (later) AI provider calls.

import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FILE_EXTENSION, packProject, ProjectFormatError, unpackProject, type Project } from "../shared/format";
import type { AiRequest, AiResponse, FileData, FileFilter, OpenedProject, Result, ScriptBuild, ScriptParameter, ScriptValues, Settings } from "../shared/ipc";
import { buildScript, inspectScript } from "./scriptParts";
import { sendSticks, startLink, stopLink, type DroneSticks } from "./droneLink";

import { LOCAL_MODELS } from "../shared/localModels";
import { randomBytes } from "node:crypto";
import { mcpStatus, startMcp, stopMcp, type ToolBridge } from "./mcp";
import { cancelChat, chatTurn, forgetChat } from "./chat";
import { buildSketch } from "./avrbuild";
import { getEngine, getFreedoom } from "./doomEngine";
import { flashImage, isPort, listPorts, sendToMonitor, startMonitor, stopAll, stopJob, toolStatus, uploadProject } from "./device";
import { SecretStore } from "./secrets";
import { secureStorageStatus } from "./secrets";
import { openInSlicer, slicerStatus } from "./slicer";
import { JsonStorage, writeFileAtomic } from "./storage";

// Tests point this at a temporary folder so they never touch real user data.
if (process.env.MAKERSTUDIO_USER_DATA) app.setPath("userData", process.env.MAKERSTUDIO_USER_DATA);
if (process.env.MAKERSTUDIO_DOCUMENTS) app.setPath("documents", process.env.MAKERSTUDIO_DOCUMENTS);

// Electron only picks the system keyring on desktops it recognises (GNOME, KDE...).
// On others, such as Hyprland/Omarchy, it would fall back to weak "basic_text" storage even
// though a Secret Service keyring (gnome-keyring, KeePassXC...) is running. Ask for libsecret
// explicitly; if no keyring exists, Chromium still falls back and Settings reports it as weak.
if (process.platform === "linux" && !app.commandLine.hasSwitch("password-store")) {
  app.commandLine.appendSwitch("password-store", process.env.MAKERSTUDIO_PASSWORD_STORE ?? "gnome-libsecret");
}

const storage = new JsonStorage(app.getPath("userData"));
const devUrl = process.env.MAKERSTUDIO_DEV_URL;
let mainWindow: BrowserWindow | null = null;
let dirty = false;

const fileFilters = [{ name: "MakerStudio project", extensions: [FILE_EXTENSION] }];

function projectsFolder() {
  return path.join(app.getPath("documents"), "MakerStudio");
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 120);
  return cleaned || "project";
}

function withExtension(file: string) {
  return file.toLowerCase().endsWith(`.${FILE_EXTENSION}`) ? file : `${file}.${FILE_EXTENSION}`;
}

function describeError(error: unknown): string {
  if (error instanceof ProjectFormatError) return error.message;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return "The file could not be found. It may have been moved or deleted.";
  if (code === "EACCES" || code === "EPERM") return "Permission denied. Choose a folder you are allowed to write to.";
  if (code === "ENOSPC") return "The disk is full.";
  return error instanceof Error ? error.message : String(error);
}

async function askSavePath(suggestedName: string, title: string): Promise<string | null> {
  await fs.mkdir(projectsFolder(), { recursive: true });
  const options = {
    title,
    defaultPath: path.join(projectsFolder(), withExtension(safeFileName(suggestedName))),
    filters: fileFilters,
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : withExtension(result.filePath);
}

async function writeProject(project: Project, target: string) {
  await writeFileAtomic(target, packProject(project));
}

const MODEL_EXTENSIONS = ["stl", "obj", "step", "stp", "3mf"];
const MAX_MODEL_BYTES = 300 * 1024 * 1024;

function exportsFolder() {
  return path.join(projectsFolder(), "Exports");
}

/** Only a plain file name with an allowed extension is accepted from the interface. */
function checkExportName(name: unknown, extensions: string[]): string {
  if (typeof name !== "string" || !name || name !== path.basename(name) || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`Invalid file name: ${String(name)}`);
  }
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!extensions.includes(ext)) throw new Error(`Unsupported file type: ${name}`);
  return name;
}

function registerModelIpc() {
  // --- script parts: Python scripts with a PARAMETERS block, built in a temporary copy ---
  const trustedScripts = new Set<string>(); // confirmed by the owner in this session
  ipcMain.handle("script:pick", async (): Promise<Result<{ path: string; parameters: ScriptParameter[] | null } | null>> => {
    try {
      const options = { title: "Open a part script", filters: [{ name: "Python part script", extensions: ["py"] }], properties: ["openFile" as const] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
      const file = path.resolve(result.filePaths[0]);
      return { ok: true, value: { path: file, parameters: await inspectScript(file) } };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });
  ipcMain.handle("script:inspect", async (_e, file: string): Promise<Result<ScriptParameter[] | null>> => {
    try { return { ok: true, value: await inspectScript(path.resolve(String(file))) }; } catch (error) { return { ok: false, error: describeError(error) }; }
  });
  ipcMain.handle("script:build", async (_e, file: string, values: ScriptValues): Promise<Result<ScriptBuild | null>> => {
    try {
      const script = path.resolve(String(file));
      if (!trustedScripts.has(script)) {
        const options = {
          type: "warning" as const,
          buttons: ["Run script", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          title: "Run a Python script?",
          message: `Build "${path.basename(script)}" with Python?`,
          detail: `${script}\n\nThis runs the script on your computer, like running it in a terminal. MakerStudio runs a temporary copy with your changed sizes; the script and its out folder are not changed. Only run scripts you trust.`,
        };
        const answer = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
        if (answer.response !== 0) return { ok: true, value: null };
        trustedScripts.add(script);
      }
      return { ok: true, value: await buildScript(script, values) };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });

  // --- real drone link (UDP) ---
  ipcMain.handle("drone:connect", (_e, host: string, port: number): Result<null> => {
    try {
      startLink(String(host), Number(port), (t) => mainWindow?.webContents.send("drone:telemetry", t));
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });
  ipcMain.on("drone:sticks", (_e, s: DroneSticks) => sendSticks(s));
  ipcMain.handle("drone:disconnect", async () => { await stopLink(); return { ok: true, value: null }; });

  ipcMain.handle("model:import", async (): Promise<Result<FileData[] | null>> => {
    try {
      await fs.mkdir(projectsFolder(), { recursive: true });
      const options = {
        title: "Import 3D model",
        defaultPath: projectsFolder(),
        filters: [{ name: "3D models (STL, OBJ, STEP, 3MF)", extensions: MODEL_EXTENSIONS }],
        properties: ["openFile" as const, "multiSelections" as const],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return { ok: true, value: null };
      const files: FileData[] = [];
      for (const file of result.filePaths) {
        const info = await fs.stat(file);
        if (info.size > MAX_MODEL_BYTES) throw new Error(`"${path.basename(file)}" is larger than ${MAX_MODEL_BYTES / 1024 / 1024} MB.`);
        files.push({ name: path.basename(file), bytes: new Uint8Array(await fs.readFile(file)) });
      }
      return { ok: true, value: files };
    } catch (error) {
      return { ok: false, error: `Could not import: ${describeError(error)}` };
    }
  });

  ipcMain.handle("model:export", async (_e, suggestedName: string, bytes: Uint8Array, filter: FileFilter): Promise<Result<string | null>> => {
    try {
      const ext = String(filter?.extensions?.[0] ?? "").toLowerCase();
      checkExportName(suggestedName, [ext]);
      await fs.mkdir(exportsFolder(), { recursive: true });
      const options = { title: "Export", defaultPath: path.join(exportsFolder(), suggestedName), filters: [{ name: String(filter.name), extensions: [ext] }] };
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { ok: true, value: null };
      const target = path.extname(result.filePath).toLowerCase() === `.${ext}` ? result.filePath : `${result.filePath}.${ext}`;
      await writeFileAtomic(target, bytes);
      return { ok: true, value: target };
    } catch (error) {
      return { ok: false, error: `Could not export: ${describeError(error)}` };
    }
  });

  ipcMain.handle("model:exportMany", async (_e, files: FileData[]): Promise<Result<string | null>> => {
    try {
      if (!Array.isArray(files) || files.length === 0) throw new Error("Nothing to export.");
      for (const f of files) checkExportName(f.name, MODEL_EXTENSIONS);
      await fs.mkdir(exportsFolder(), { recursive: true });
      const options = { title: "Choose a folder for the parts", defaultPath: exportsFolder(), properties: ["openDirectory" as const, "createDirectory" as const] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
      const folder = result.filePaths[0];
      const existing: string[] = [];
      for (const f of files) {
        if (await fs.stat(path.join(folder, f.name)).then(() => true, () => false)) existing.push(f.name);
      }
      if (existing.length && mainWindow && !process.env.MAKERSTUDIO_SKIP_CLOSE_PROMPT) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "question",
          buttons: ["Replace", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          message: `${existing.length} file${existing.length === 1 ? "" : "s"} already exist in this folder.`,
          detail: existing.slice(0, 10).join("\n") + (existing.length > 10 ? "\n…" : ""),
        });
        if (choice.response !== 0) return { ok: true, value: null };
      }
      for (const f of files) await writeFileAtomic(path.join(folder, f.name), f.bytes);
      return { ok: true, value: folder };
    } catch (error) {
      return { ok: false, error: `Could not export: ${describeError(error)}` };
    }
  });
}

const CODE_FILE = /^(?:(?:src|include|lib|data)\/)?[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}\.(?:ini|md|h|hpp|c|cpp|txt|json)$/;

// --- AI requests answered by the window (tools live next to the project) ---------------------
let aiRequestId = 0;
const aiPending = new Map<number, (r: AiResponse) => void>();

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function askWindow(request: WithoutId<AiRequest>, timeoutMs = 30000): Promise<AiResponse> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return Promise.resolve({ id: 0, ok: false, error: "MakerStudio's window is not open." });
  const id = ++aiRequestId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { aiPending.delete(id); resolve({ id, ok: false, error: "MakerStudio did not answer in time." }); }, timeoutMs);
    aiPending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    win.webContents.send("ai:request", { ...request, id } as AiRequest);
  });
}

const claudeCodeBridge: ToolBridge = {
  async specs() {
    const r = await askWindow({ kind: "specs" });
    return r.ok ? (r.data as Awaited<ReturnType<ToolBridge["specs"]>>) : [];
  },
  async call(name, params) {
    const r = await askWindow({ kind: "call", source: "claude-code", name, params });
    return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
  },
};

async function applyMcpSettings(settings: Settings) {
  if (settings.mcp.enabled && settings.mcp.token) await startMcp(settings.mcp.port, settings.mcp.token, claudeCodeBridge);
  else await stopMcp();
}

function registerAiIpc() {
  ipcMain.on("ai:response", (_e, response: AiResponse) => {
    const done = aiPending.get(response?.id);
    if (done) { aiPending.delete(response.id); done(response); }
  });
  ipcMain.handle("mcp:status", () => mcpStatus());

  // --- real boards over USB ---
  const emitDevice = (event: unknown) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("device:event", event); };
  const guard = async <T>(fn: () => Promise<T>): Promise<Result<T>> => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: describeError(error) }; } };
  ipcMain.handle("device:tools", () => guard(toolStatus));
  // Doom handheld preview (engine and data downloaded on first use, checksum-verified).
  const doomDir = () => path.join(app.getPath("userData"), "doom-preview");
  ipcMain.handle("doom:engine", () => guard(() => getEngine(doomDir())));
  ipcMain.handle("doom:freedoom", () => guard(() => getFreedoom(doomDir())));
  ipcMain.handle("doom:pickWad", () => guard(async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: "Your Doom WAD (IWAD)", filters: [{ name: "Doom WAD", extensions: ["wad", "WAD"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = await fs.stat(r.filePaths[0]);
    if (st.size > 64 * 1024 * 1024) throw new Error("That file is larger than 64 MB.");
    const bytes = new Uint8Array(await fs.readFile(r.filePaths[0]));
    if (!["IWAD", "PWAD"].includes(new TextDecoder().decode(bytes.subarray(0, 4)))) throw new Error("That is not a Doom WAD file.");
    return { name: path.basename(r.filePaths[0]), bytes };
  }));
  ipcMain.handle("avr:build", (_e, code: unknown, board: unknown) => guard(async () => {
    if (typeof code !== "string" || code.length > 200000) throw new Error("Invalid code.");
    return buildSketch(path.join(app.getPath("userData"), "avr-builds"), code, board === "pico" ? "pico" : "uno");
  }));
  ipcMain.handle("device:ports", () => guard(listPorts));
  ipcMain.handle("device:flash", (_e, port: unknown, address: unknown) => guard(async () => {
    if (!isPort(port)) throw new Error("Choose a connected board first.");
    const pick = await dialog.showOpenDialog(mainWindow!, { title: "Firmware image to flash", filters: [{ name: "Firmware image", extensions: ["img", "bin"] }], properties: ["openFile"] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    await flashImage(port, pick.filePaths[0], typeof address === "string" ? address : "0x0", emitDevice);
    return path.basename(pick.filePaths[0]);
  }));
  ipcMain.handle("device:upload", (_e, port: unknown) => guard(async () => {
    const pick = await dialog.showOpenDialog(mainWindow!, { title: "PlatformIO project folder to upload", properties: ["openDirectory"], defaultPath: path.join(projectsFolder(), "Exports") });
    if (pick.canceled || !pick.filePaths[0]) return null;
    await uploadProject(pick.filePaths[0], isPort(port) ? port : null, emitDevice);
    return path.basename(pick.filePaths[0]);
  }));
  ipcMain.handle("device:monitor", (_e, port: unknown, baud: unknown) => guard(async () => {
    if (!isPort(port)) throw new Error("Choose a connected board first.");
    const b = Number(baud);
    if (![9600, 57600, 115200, 230400, 460800, 921600].includes(b)) throw new Error("Unsupported baud rate.");
    await startMonitor(port, b, emitDevice);
    return null;
  }));
  ipcMain.handle("device:send", (_e, text: unknown) => guard(async () => { if (typeof text !== "string" || text.length > 1000) throw new Error("Message too long."); sendToMonitor(text); return null; }));
  ipcMain.on("device:stop", (_e, job: unknown) => { if (job === "flash" || job === "upload" || job === "monitor") stopJob(job); });

  // --- in-app chat ---
  const secrets = new SecretStore(app.getPath("userData"));
  // Pictures for the chat: only files the owner picked in our own dialog are read.
  const picked = new Map<string, { path: string; mime: string }>();
  ipcMain.handle("chat:pickImage", async (): Promise<Result<{ token: string; name: string; preview: string } | null>> => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: "Picture or sketch for the AI", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }], properties: ["openFile"] });
    if (r.canceled || !r.filePaths[0]) return { ok: true, value: null };
    const file = r.filePaths[0];
    const stat = await fs.stat(file);
    if (stat.size > 5 * 1024 * 1024) return { ok: false, error: "The picture is larger than 5 MB: use a smaller one." };
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    const token = randomBytes(12).toString("hex");
    picked.set(token, { path: file, mime });
    const data = (await fs.readFile(file)).toString("base64");
    return { ok: true, value: { token, name: path.basename(file), preview: `data:${mime};base64,${data}` } };
  });
  ipcMain.handle("chat:send", async (_e, chatId: string, text: string, mode: string, imageToken?: string) => {
    if (typeof chatId !== "string" || typeof text !== "string" || !text.trim() || text.length > 20000) return;
    const settings = await storage.getSettings();
    const pick = typeof imageToken === "string" ? picked.get(imageToken) : undefined;
    const image = pick ? { path: pick.path, mime: pick.mime, data: (await fs.readFile(pick.path)).toString("base64") } : undefined;
    await chatTurn(chatId, text, ["observe", "assist", "create"].includes(mode) ? mode : "assist", settings.ai, {
      key: (provider) => secrets.get(`ai-key-${provider}`),
      specs: async (readOnly) => {
        const r = await askWindow({ kind: "specs", readOnly });
        return r.ok ? (r.data as Awaited<ReturnType<ToolBridge["specs"]>>) : [];
      },
      callTool: async (name, params) => {
        const r = await askWindow({ kind: "call", source: "chat", name, params });
        return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
      },
      emit: (event) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("chat:event", event); },
      claudeCodeSetup: async () => {
        // Claude Code reaches the project through the local MCP server: switch it on if needed.
        let s = await storage.getSettings();
        if (!s.mcp.enabled || !s.mcp.token) {
          s = await storage.setSettings({ mcp: { ...s.mcp, enabled: true, token: s.mcp.token || randomBytes(32).toString("base64url") } });
          mainWindow?.webContents.send("settings:changed", s);
        }
        if (!mcpStatus().running) await applyMcpSettings(s);
        if (!mcpStatus().running) throw new Error(`The MakerStudio connection could not start: ${mcpStatus().error ?? "unknown error"}`);
        const dir = path.join(app.getPath("userData"), "claude-chat");
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const mcpConfig = path.join(dir, "mcp.json");
        await fs.writeFile(mcpConfig, JSON.stringify({ mcpServers: { makerstudio: { type: "http", url: `http://127.0.0.1:${s.mcp.port}/mcp`, headers: { Authorization: `Bearer ${s.mcp.token}` } } } }), { mode: 0o600 });
        await fs.chmod(mcpConfig, 0o600);
        return { mcpConfig, cwd: dir };
      },
    }, image);
  });
  ipcMain.on("chat:cancel", (_e, chatId: string) => cancelChat(chatId));
  ipcMain.on("chat:forget", (_e, chatId: string) => forgetChat(chatId));
  ipcMain.handle("ai:keyStatus", async () => ({ openai: await secrets.has("ai-key-openai"), anthropic: await secrets.has("ai-key-anthropic") }));
  ipcMain.handle("ai:setKey", async (_e, provider: string, key: string | null): Promise<Result<null>> => {
    if (provider !== "openai" && provider !== "anthropic") return { ok: false, error: "Unknown provider." };
    try {
      if (key === null || key.trim() === "") await secrets.remove(`ai-key-${provider}`);
      else await secrets.set(`ai-key-${provider}`, key.trim());
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });
  ipcMain.handle("ai:ollamaModels", async (): Promise<Result<string[]>> => {
    const { ai } = await storage.getSettings();
    try {
      const res = await fetch(`${ai.ollamaUrl.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as { models?: { name: string }[] };
      return { ok: true, value: (body.models ?? []).map((m) => m.name).sort() };
    } catch {
      return { ok: false, error: `Ollama is not reachable at ${ai.ollamaUrl}.` };
    }
  });
  ipcMain.handle("mcp:newToken", async () => {
    const next = await storage.setSettings({ mcp: { ...(await storage.getSettings()).mcp, token: randomBytes(32).toString("base64url") } });
    await applyMcpSettings(next);
    return next;
  });
}

function registerLocalModelIpc() {
  ipcMain.handle("model:readLocal", async (_e, key: string): Promise<Result<FileData>> => {
    const entry = Object.prototype.hasOwnProperty.call(LOCAL_MODELS, key) ? LOCAL_MODELS[key] : undefined;
    if (!entry) return { ok: false, error: "Unknown model." };
    const file = path.join(app.getPath("home"), entry.file);
    try {
      const info = await fs.stat(file);
      if (info.size > MAX_MODEL_BYTES) throw new Error("The file is too large.");
      return { ok: true, value: { name: path.basename(file), bytes: new Uint8Array(await fs.readFile(file)) } };
    } catch (error) {
      return { ok: false, error: `Could not load ${entry.name} (${entry.file}): ${describeError(error)}` };
    }
  });
}

function registerCodeIpc() {
  ipcMain.handle("code:exportProject", async (_e, folderName: string, files: { path: string; text: string }[]): Promise<Result<string | null>> => {
    try {
      if (!Array.isArray(files) || files.length === 0 || files.length > 50) throw new Error("Invalid project.");
      for (const f of files) {
        if (typeof f?.path !== "string" || !CODE_FILE.test(f.path) || typeof f.text !== "string" || f.text.length > 2_000_000) {
          throw new Error(`Invalid file in project: ${String(f?.path)}`);
        }
      }
      const base = safeFileName(String(folderName)).slice(0, 80) || "robot-face";
      const parent = path.join(projectsFolder(), "Firmware");
      await fs.mkdir(parent, { recursive: true });
      const options = { title: "Choose where to put the code project", defaultPath: parent, properties: ["openDirectory" as const, "createDirectory" as const] };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
      // Always a new folder, so an earlier export (maybe with your own changes) is never overwritten.
      let folder = path.join(result.filePaths[0], base);
      for (let n = 2; await fs.stat(folder).then(() => true, () => false); n++) folder = path.join(result.filePaths[0], `${base} (${n})`);
      for (const f of files) {
        const target = path.join(folder, f.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await writeFileAtomic(target, new TextEncoder().encode(f.text));
      }
      return { ok: true, value: folder };
    } catch (error) {
      return { ok: false, error: `Could not export the code: ${describeError(error)}` };
    }
  });
}

function registerSlicerIpc() {
  ipcMain.handle("slicer:status", () => slicerStatus());
  ipcMain.handle("slicer:open", async (_e, folderName: string, files: FileData[]): Promise<Result<string>> => {
    try {
      if (!Array.isArray(files) || files.length === 0) throw new Error("Nothing to open.");
      if (files.length > 200) throw new Error("Too many parts to open at once.");
      for (const f of files) checkExportName(f.name, ["stl"]);
      // A fresh folder per hand-off, so files already open in the slicer are never overwritten.
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const folder = path.join(exportsFolder(), "For Bambu Studio", `${safeFileName(String(folderName))} ${stamp}`);
      await fs.mkdir(folder, { recursive: true });
      const written: string[] = [];
      for (const f of files) {
        const target = path.join(folder, f.name);
        await writeFileAtomic(target, f.bytes);
        written.push(target);
      }
      await openInSlicer(written);
      return { ok: true, value: folder };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  });
}

function registerIpc() {
  registerModelIpc();
  registerSlicerIpc();
  registerCodeIpc();
  registerLocalModelIpc();
  registerAiIpc();
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  ipcMain.handle(
    "project:save",
    async (_e, project: Project, target: string | null, suggestedName: string): Promise<Result<string | null>> => {
      try {
        const file = target ?? (await askSavePath(suggestedName, "Save project"));
        if (!file) return { ok: true, value: null };
        await writeProject(project, file);
        await storage.addRecent({ path: file, name: project.document.name, openedAt: new Date().toISOString() });
        return { ok: true, value: file };
      } catch (error) {
        return { ok: false, error: `Could not save the project: ${describeError(error)}` };
      }
    },
  );

  ipcMain.handle("project:export", async (_e, project: Project, suggestedName: string): Promise<Result<string | null>> => {
    try {
      const file = await askSavePath(suggestedName, "Export a copy of the project");
      if (!file) return { ok: true, value: null };
      await writeProject(project, file);
      return { ok: true, value: file };
    } catch (error) {
      return { ok: false, error: `Could not export the project: ${describeError(error)}` };
    }
  });

  ipcMain.handle("project:open", async (_e, target: string | null): Promise<Result<OpenedProject | null>> => {
    try {
      let file = target;
      if (!file) {
        await fs.mkdir(projectsFolder(), { recursive: true });
        const options = { title: "Open project", defaultPath: projectsFolder(), filters: fileFilters, properties: ["openFile" as const] };
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0]) return { ok: true, value: null };
        file = result.filePaths[0];
      }
      const project = unpackProject(new Uint8Array(await fs.readFile(file)));
      await storage.addRecent({ path: file, name: project.document.name, openedAt: new Date().toISOString() });
      return { ok: true, value: { path: file, project } };
    } catch (error) {
      return { ok: false, error: `Could not open the project: ${describeError(error)}` };
    }
  });

  ipcMain.handle("recent:list", () => storage.getRecent());
  ipcMain.handle("recent:forget", (_e, target: string) => storage.removeRecent(target));
  ipcMain.handle("shell:reveal", (_e, target: string) => shell.showItemInFolder(target));
  ipcMain.handle("settings:get", () => storage.getSettings());
  ipcMain.handle("settings:set", async (_e, patch: Partial<Settings>) => {
    if (patch.uiZoom !== undefined) mainWindow?.webContents.setZoomFactor(Math.min(3, Math.max(0.5, patch.uiZoom)));
    const before = await storage.getSettings();
    // Turning the Claude Code connection on for the first time makes its token.
    if (patch.mcp?.enabled && !before.mcp.token && !patch.mcp.token) patch = { ...patch, mcp: { ...before.mcp, ...patch.mcp, token: randomBytes(32).toString("base64url") } };
    const next = await storage.setSettings(patch);
    if (JSON.stringify(next.mcp) !== JSON.stringify(before.mcp)) await applyMcpSettings(next);
    return next;
  });
  ipcMain.handle("secrets:status", () => secureStorageStatus());
  ipcMain.on("app:dirty", (_e, value: boolean) => {
    dirty = Boolean(value);
    mainWindow?.setDocumentEdited(dirty); // macOS only, harmless elsewhere
  });
  // After "Save" in the quit prompt: the project is saved, so close without asking again.
  ipcMain.on("app:closeAfterSave", () => {
    dirty = false;
    mainWindow?.close();
  });
  ipcMain.handle("app:toggleFullScreen", () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.on("app:title", (_e, title: string) => mainWindow?.setTitle(String(title).slice(0, 200)));
}

function sendMenu(action: string) {
  mainWindow?.webContents.send("menu", action);
}

function buildMenu() {
  // Shortcuts are handled inside the app (so they also work with the menu bar hidden);
  // the menu shows them without registering them a second time.
  const item = (label: string, action: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => sendMenu(action),
  });
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        item("New Project", "project:new", "CmdOrCtrl+N"),
        item("Open Project…", "project:open", "CmdOrCtrl+O"),
        { type: "separator" },
        item("Save", "project:save", "CmdOrCtrl+S"),
        item("Save As…", "project:saveAs", "CmdOrCtrl+Shift+S"),
        item("Duplicate Project…", "project:duplicate"),
        item("Export Copy…", "project:export"),
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        item("Undo", "edit:undo", "CmdOrCtrl+Z"),
        item("Redo", "edit:redo", "CmdOrCtrl+Shift+Z"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        item("Toggle AI Panel", "view:toggleAi", "CmdOrCtrl+J"),
        { type: "separator" },
        // Interface size, remembered (Ctrl+0 opens Settings, so actual size is Ctrl+Shift+0).
        { label: "Bigger", accelerator: "CmdOrCtrl+=", click: () => void zoomBy(0.1) },
        { label: "Bigger", accelerator: "CmdOrCtrl+Plus", visible: false, click: () => void zoomBy(0.1) },
        { label: "Smaller", accelerator: "CmdOrCtrl+-", click: () => void zoomBy(-0.1) },
        { label: "Actual size", accelerator: "CmdOrCtrl+Shift+0", click: () => void zoomTo(1) },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as MenuItemConstructorOptions]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Interface size: applied to the window and remembered in the settings. */
async function zoomTo(factor: number) {
  const zoom = Math.round(Math.min(3, Math.max(0.5, factor)) * 100) / 100;
  mainWindow?.webContents.setZoomFactor(zoom);
  const next = await storage.setSettings({ uiZoom: zoom });
  mainWindow?.webContents.send("settings:changed", next);
}
const zoomBy = (step: number) => zoomTo((mainWindow?.webContents.getZoomFactor() ?? 1) + step);

async function createWindow() {
  // How the window was left last time (size, maximized, full screen); first launch opens maximized.
  const stateFile = path.join(app.getPath("userData"), "window-state.json");
  let saved: { bounds?: { x: number; y: number; width: number; height: number }; maximized?: boolean; fullScreen?: boolean } | null = null;
  try { saved = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { saved = null; }
  const b = saved?.bounds;
  const validBounds = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 960 && b.height >= 600;
  mainWindow = new BrowserWindow({
    width: validBounds ? b!.width : 1440,
    height: validBounds ? b!.height : 900,
    ...(validBounds ? { x: b!.x, y: b!.y } : {}),
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#111417",
    title: "MakerStudio AI",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  void storage.getSettings().then((s) => mainWindow?.webContents.setZoomFactor(s.uiZoom));
  mainWindow.webContents.on("did-finish-load", () => void storage.getSettings().then((s) => mainWindow?.webContents.setZoomFactor(s.uiZoom)));
  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) return;
    if (saved?.maximized) mainWindow.maximize();
    mainWindow.show();
    // First launch: full screen (tiling desktops ignore "maximize"). After that, as it was left.
    if (!saved || saved.fullScreen) mainWindow.setFullScreen(true);
  });
  const rememberWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const state = { bounds: mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized(), fullScreen: mainWindow.isFullScreen() };
    void fs.writeFile(stateFile, JSON.stringify(state)).catch(() => {});
  };
  mainWindow.on("close", rememberWindow);
  // F11 toggles full screen here, once (the hidden menu's shortcut would not always reach it).
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11" && !input.control && !input.alt && !input.meta) {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    }
  });
  mainWindow.on("enter-full-screen", () => mainWindow?.webContents.send("app:fullScreen", true));
  mainWindow.on("leave-full-screen", () => mainWindow?.webContents.send("app:fullScreen", false));

  // Links open in the system browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
  });

  mainWindow.on("close", (event) => {
    if (!dirty || !mainWindow || process.env.MAKERSTUDIO_SKIP_CLOSE_PROMPT) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Save", "Quit without saving", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved changes",
      message: "This project has unsaved changes.",
      detail: "Save them before quitting? If you quit without saving, changes since the last save are lost.",
    });
    if (choice === 1) return; // quit without saving
    event.preventDefault();
    // Save: the window saves (asking where, for a new project) and closes itself when that worked.
    if (choice === 0) mainWindow.webContents.send("app:saveAndClose");
  });
  mainWindow.on("closed", () => (mainWindow = null));

  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// A project file given on the command line (double-click in the file manager, or the menu entry's %f).
const projectArg = (argv: string[]) => argv.slice(1).find((a) => a.toLowerCase().endsWith(`.${FILE_EXTENSION}`) && existsSync(a)) ?? null;
let pendingFile = projectArg(process.argv);

// One window per user: a second launch hands its file to the running app instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const file = projectArg(argv);
    if (file) mainWindow.webContents.send("app:openFile", path.resolve(file));
  });
}

app.whenReady().then(async () => {
  ipcMain.handle("app:takePendingFile", () => { const f = pendingFile; pendingFile = null; return f ? path.resolve(f) : null; });
  registerIpc();
  buildMenu();
  await createWindow();
  // Start the Claude Code connection if the owner turned it on.
  void storage.getSettings().then(applyMcpSettings);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("before-quit", () => { void stopMcp(); stopAll(); void stopLink(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
