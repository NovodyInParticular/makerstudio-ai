// Talks to the print worker (see print.worker.ts).

import { rememberWatertight } from "../../core/cad/csg";
import { getMesh, type MeshData } from "../../core/cad/meshes";
import type { CadObject } from "../../core/cad/model";
import type { PrinterSpec } from "../../core/cad/printcheck";
import type { PrintRequest, PrintResponse, PrintResult } from "./print.worker";

let worker: Worker | null = null;
let nextId = 1;
/** Meshes the current worker already has. */
let sent = new Set<string>();
const pending = new Map<number, { resolve(value: PrintResult): void; reject(error: Error): void }>();

function start(): Worker {
  const w = new Worker(new URL("./print.worker.ts", import.meta.url), { type: "module", name: "print" });
  w.onmessage = (event: MessageEvent<PrintResponse>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.ok) {
      for (const [key, ok] of Object.entries(event.data.value.watertight)) rememberWatertight(key, ok);
      job.resolve(event.data.value);
    } else job.reject(new Error(event.data.error));
  };
  w.onerror = (event) => {
    const error = new Error(`The print check stopped: ${event.message || "unknown error"}`);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    w.terminate();
    worker = null;
    sent = new Set();
  };
  return w;
}

export function printJob(type: PrintRequest["type"], ids: string[], objects: CadObject[], printer: PrinterSpec): Promise<PrintResult> {
  worker ??= start();
  const meshes: Record<string, MeshData> = {};
  for (const o of objects) {
    if (o.kind !== "mesh" || !o.mesh || sent.has(o.mesh)) continue;
    const data = getMesh(o.mesh);
    if (data) { meshes[o.mesh] = data; sent.add(o.mesh); }
  }
  const id = nextId++;
  return new Promise<PrintResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, type, ids, objects, meshes, printer } satisfies PrintRequest);
  });
}

// --- the inspector's mesh info, worked out in the worker and remembered per mesh ---

export interface MeshInfo { watertight: boolean; volume: number }
const meshInfoCache = new Map<string, MeshInfo>();
const meshInfoPending = new Map<string, Promise<MeshInfo | null>>();

export function cachedMeshInfo(key: string | undefined): MeshInfo | undefined {
  return key ? meshInfoCache.get(key) : undefined;
}

/** Watertight / volume of an imported mesh, without blocking the window (mesh data never changes for a key). */
export function meshInfo(object: CadObject): Promise<MeshInfo | null> {
  const key = object.mesh;
  if (!key) return Promise.resolve(null);
  const hit = meshInfoCache.get(key);
  if (hit) return Promise.resolve(hit);
  let job = meshInfoPending.get(key);
  if (!job) {
    job = printJob("meshInfo", [], [object], { name: "", bedX: 1, bedY: 1, bedZ: 1, nozzle: 0.4 })
      .then((r) => { const info = r.meshInfo?.[key] ?? null; if (info) meshInfoCache.set(key, info); return info; })
      .catch(() => null)
      .finally(() => meshInfoPending.delete(key));
    meshInfoPending.set(key, job);
  }
  return job;
}
