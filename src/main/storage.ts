// Small JSON files in the app's user-data folder: settings and the recent-projects list.
// Writes are atomic (write to a temporary file, then rename) so a crash never leaves half a file.

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { RecentProject, Settings } from "../shared/ipc";

export async function writeFileAtomic(target: string, data: Uint8Array | string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export const DEFAULT_SETTINGS: Settings = {
  units: "mm",
  gridSize: 1,
  snapEnabled: true,
  aiPanelOpen: true,
  // Bambu Lab A1 build volume and default nozzle.
  printer: { name: "Bambu Lab A1", bedX: 256, bedY: 256, bedZ: 256, nozzle: 0.4 },
  // Claude Code connection (MCP): off until the owner turns it on; the token is made then.
  mcp: { enabled: false, port: 47219, token: "" },
  // In-app chat: local Ollama by default (no account, nothing leaves the computer).
  uiZoom: 1,
  ai: { provider: "ollama", ollamaUrl: "http://127.0.0.1:11434", ollamaModel: "qwen3.5:4b", openaiUrl: "https://api.openai.com/v1", openaiModel: "", anthropicModel: "claude-opus-5-5" },
};

const SettingsSchema = z.object({
  units: z.literal("mm"),
  gridSize: z.number().positive().max(100),
  snapEnabled: z.boolean(),
  aiPanelOpen: z.boolean(),
  uiZoom: z.number().min(0.5).max(3),
  printer: z.object({
    name: z.string().min(1).max(100),
    bedX: z.number().positive().max(2000),
    bedY: z.number().positive().max(2000),
    bedZ: z.number().positive().max(2000),
    nozzle: z.number().positive().max(5),
  }),
  mcp: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65535),
    token: z.string().max(200),
  }),
  ai: z.object({
    provider: z.enum(["claude-code", "ollama", "openai", "anthropic"]),
    ollamaUrl: z.string().url().max(300),
    ollamaModel: z.string().max(200),
    openaiUrl: z.string().url().max(300),
    openaiModel: z.string().max(200),
    anthropicModel: z.string().max(200),
  }),
});

const RecentSchema = z.array(z.object({ path: z.string(), name: z.string(), openedAt: z.string() }));
const RECENT_LIMIT = 12;

export class JsonStorage {
  constructor(private readonly dir: string) {}

  private file(name: string) {
    return path.join(this.dir, name);
  }

  private async read(name: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(this.file(name), "utf8"));
    } catch {
      return undefined; // missing or damaged: fall back to defaults
    }
  }

  async getSettings(): Promise<Settings> {
    const raw = await this.read("settings.json");
    const merged = { ...DEFAULT_SETTINGS, ...(typeof raw === "object" && raw ? raw : {}) };
    const parsed = SettingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const next = SettingsSchema.parse({ ...current, ...patch, printer: { ...current.printer, ...patch.printer }, mcp: { ...current.mcp, ...patch.mcp }, ai: { ...current.ai, ...patch.ai } });
    await writeFileAtomic(this.file("settings.json"), JSON.stringify(next, null, 2));
    return next;
  }

  async getRecent(): Promise<RecentProject[]> {
    const parsed = RecentSchema.safeParse(await this.read("recent.json"));
    return parsed.success ? parsed.data : [];
  }

  async addRecent(entry: RecentProject): Promise<void> {
    const list = (await this.getRecent()).filter((item) => item.path !== entry.path);
    await writeFileAtomic(this.file("recent.json"), JSON.stringify([entry, ...list].slice(0, RECENT_LIMIT), null, 2));
  }

  async removeRecent(target: string): Promise<void> {
    const list = (await this.getRecent()).filter((item) => item.path !== target);
    await writeFileAtomic(this.file("recent.json"), JSON.stringify(list, null, 2));
  }
}
