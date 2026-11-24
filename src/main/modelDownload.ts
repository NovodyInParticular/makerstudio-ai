// Downloads the print files of a practice project from GitHub (see shared/remoteModels.ts).
// Each file comes from the pinned commit and must match its git blob id, so a changed or
// broken download is never used. Good files are kept in a cache folder by commit, so the
// next start needs no internet.

import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import type { FileData } from "../shared/ipc";
import type { RemoteModel, RemoteModelFile } from "../shared/remoteModels";
import { writeFileAtomic } from "./storage";

export const RAW_BASE = "https://raw.githubusercontent.com";
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024;
const PARALLEL = 4;
const TIMEOUT_MS = 180_000;

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** True for a plain relative path inside a repository (no "..", no absolute or empty parts). */
export function safeRepoPath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 300 || p.includes("\\")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.includes("\0"));
}

export function blobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function checkEntry(m: RemoteModel) {
  if (!REPO.test(m.repo) || !COMMIT.test(m.commit)) throw new Error("Invalid model source.");
  for (const f of m.files) {
    if (!safeRepoPath(f.path) || !/^[0-9a-f]{40}$/.test(f.sha) || f.size > MAX_FILE_BYTES) throw new Error(`Invalid model file: ${f.path}`);
  }
}

async function getFile(m: RemoteModel, f: RemoteModelFile, cacheDir: string, base: string, fetcher: Fetch): Promise<Uint8Array> {
  const cached = path.join(cacheDir, m.repo.replace("/", "__"), m.commit, ...f.path.split("/"));
  if (existsSync(cached)) {
    const bytes = new Uint8Array(await fs.readFile(cached));
    if (blobSha(bytes) === f.sha) return bytes;
  }
  const url = `${base.replace(/\/+$/, "")}/${m.repo}/${m.commit}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("the file is too large");
  if (blobSha(bytes) !== f.sha) throw new Error("the downloaded file is not the expected one, so it was not used");
  await writeFileAtomic(cached, bytes);
  return bytes;
}

function unzipModels(zip: Uint8Array, folders: string[]): FileData[] {
  let total = 0;
  const picked = unzipSync(zip, {
    filter: (entry) => {
      const ok = /\.stl$/i.test(entry.name) && !entry.name.includes("__MACOSX") && folders.some((d) => entry.name.startsWith(d) && !entry.name.slice(d.length).includes("/"));
      if (ok) total += entry.originalSize;
      if (total > MAX_UNZIPPED_BYTES) throw new Error("the ZIP file unpacks too large");
      return ok;
    },
  });
  return Object.entries(picked)
    .map(([name, bytes]) => ({ name: name.slice(name.lastIndexOf("/") + 1), bytes }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** The model files of a set, downloaded or from the cache; ZIP files are unpacked. */
export async function fetchRemoteModel(m: RemoteModel, options: { cacheDir: string; base?: string; fetch: Fetch }): Promise<FileData[]> {
  checkEntry(m);
  const base = options.base ?? RAW_BASE;
  const results: Uint8Array[] = new Array(m.files.length);
  let next = 0;
  const worker = async () => {
    while (next < m.files.length) {
      const i = next++;
      const f = m.files[i]!;
      try {
        results[i] = await getFile(m, f, options.cacheDir, base, options.fetch);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${path.posix.basename(f.path)}: ${reason}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, m.files.length) }, worker));
  return m.files.flatMap((f, i) => (f.unzip ? unzipModels(results[i]!, f.unzip) : [{ name: path.posix.basename(f.path), bytes: results[i]! }]));
}
