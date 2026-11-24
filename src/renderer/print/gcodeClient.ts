// Talks to the G-code worker (see gcode.worker.ts). One parse at a time; a new request replaces an old one.

import type { ToolpathPreview } from "../../core/print/gcode";
import type { GcodeRequest, GcodeResponse } from "./gcode.worker";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(p: ToolpathPreview): void; reject(e: Error): void }>();

function start(): Worker {
  const w = new Worker(new URL("./gcode.worker.ts", import.meta.url), { type: "module", name: "gcode" });
  w.onmessage = (event: MessageEvent<GcodeResponse>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.ok) job.resolve(event.data.preview);
    else job.reject(new Error(event.data.error));
  };
  w.onerror = (event) => {
    const error = new Error(`The preview could not be made: ${event.message || "unknown error"}`);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    w.terminate();
    worker = null;
  };
  return w;
}

export function parseGcodeInWorker(bytes: Uint8Array): Promise<ToolpathPreview> {
  worker ??= start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, bytes } satisfies GcodeRequest, [bytes.buffer]);
  });
}
