// Secret storage for API keys (used from Phase 4).
// Keys are encrypted with the operating system's keychain through Electron's safeStorage
// and only ever read in the main process. The user interface can only ask whether a key exists.

import { safeStorage } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SecureStorageStatus } from "../shared/ipc";
import { writeFileAtomic } from "./storage";

export function secureStorageStatus(): SecureStorageStatus {
  const available = safeStorage.isEncryptionAvailable();
  let backend = process.platform === "win32" ? "windows-dpapi" : process.platform === "darwin" ? "keychain" : "unknown";
  if (process.platform === "linux") {
    try {
      backend = safeStorage.getSelectedStorageBackend();
    } catch {
      backend = "unknown";
    }
  }
  return { available, backend, weak: backend === "basic_text" };
}

export class SecretStore {
  constructor(private readonly dir: string) {}

  private file() {
    return path.join(this.dir, "secrets.json");
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.file(), "utf8"));
    } catch {
      return {};
    }
  }

  async set(name: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is not available on this system, so the key was not saved.");
    }
    const all = await this.readAll();
    all[name] = safeStorage.encryptString(value).toString("base64");
    await writeFileAtomic(this.file(), JSON.stringify(all, null, 2));
  }

  async get(name: string): Promise<string | null> {
    const stored = (await this.readAll())[name];
    if (!stored) return null;
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  }

  async has(name: string): Promise<boolean> {
    return Boolean((await this.readAll())[name]);
  }

  async remove(name: string): Promise<void> {
    const all = await this.readAll();
    delete all[name];
    await writeFileAtomic(this.file(), JSON.stringify(all, null, 2));
  }
}
