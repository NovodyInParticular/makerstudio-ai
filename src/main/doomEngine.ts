// The Doom handheld preview's game engine and data are NOT part of MakerStudio: they are
// downloaded on first use into the app's data folder and checked against pinned SHA-256 hashes.
//   Engine: jacobenget/doom.wasm v0.1.0 (GPL-2.0; Doom source by id Software, GPL), with the
//           Doom shareware WAD built in.
//   Freedoom 0.13.0 (BSD-style license, see its COPYING.txt): free replacement game data.

import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export const ENGINE = {
  url: "https://github.com/jacobenget/doom.wasm/releases/download/v0.1.0/doom-v0.1.0.wasm",
  sha256: "8edfe49a7583fd975199969302d8e9adcf8e714d0af72bf3e672f991fd810faa",
  file: "doom-v0.1.0.wasm",
};
export const FREEDOOM = {
  url: "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip",
  // Same value as Freedoom's signed freedoom-0.13.0-CHECKSUM file.
  sha256: "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59",
  file: "freedoom1.wad",
};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function download(url: string, expected: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}) from ${new URL(url).host}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (sha(bytes) !== expected) throw new Error("The downloaded file does not match its expected checksum, so it was not used.");
  return bytes;
}

export async function getEngine(dir: string): Promise<Uint8Array> {
  const p = process.env.MAKERSTUDIO_DOOM_ENGINE ?? path.join(dir, ENGINE.file);
  if (existsSync(p)) {
    const b = new Uint8Array(await fs.readFile(p));
    if (sha(b) === ENGINE.sha256) return b;
  }
  const b = await download(ENGINE.url, ENGINE.sha256);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, ENGINE.file), b);
  return b;
}

export async function getFreedoom(dir: string): Promise<Uint8Array> {
  const p = path.join(dir, FREEDOOM.file);
  if (existsSync(p)) return new Uint8Array(await fs.readFile(p));
  const zip = await download(FREEDOOM.url, FREEDOOM.sha256);
  const files = unzipSync(zip, { filter: (f) => f.name.endsWith("/freedoom1.wad") || f.name.endsWith("/COPYING.txt") });
  const wad = Object.entries(files).find(([n]) => n.endsWith("freedoom1.wad"))?.[1];
  if (!wad) throw new Error("freedoom1.wad was not found in the Freedoom download.");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(p, wad);
  const copying = Object.entries(files).find(([n]) => n.endsWith("COPYING.txt"))?.[1];
  if (copying) await fs.writeFile(path.join(dir, "FREEDOOM-COPYING.txt"), copying);
  return wad;
}
