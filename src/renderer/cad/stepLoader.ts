// Talks to the STEP worker (see step.worker.ts). The worker and its 22 MB engine are only
// started the first time STEP is used.

import type { ExportPart } from "../../core/cad/exporting";
import type { CadObject } from "../../core/cad/model";
import type { StepExport, StepImport } from "../../core/cad/step";
import { useUi } from "../state";
import type { StepRequest, StepResponse } from "./step.worker";

let worker: Worker | null = null;
let nextId = 1;
let warmedUp = false;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

type Payload = StepRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

function request<T>(payload: Payload, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./step.worker.ts", import.meta.url), { type: "module", name: "step" });
    worker.onmessage = (event: MessageEvent<StepResponse>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.ok) job.resolve(event.data.value);
      else job.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      const error = new Error(`The STEP engine stopped: ${event.message || "unknown error"}`);
      for (const job of pending.values()) job.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextId++;
  const slow = warmedUp ? null : setTimeout(() => useUi.getState().notify("info", "Loading the STEP engine (first time only)…"), 400);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, ...payload }, transfer);
  }).finally(() => {
    if (slow) clearTimeout(slow);
    warmedUp = true;
  });
}

/** Reads a STEP file into meshes (millimetres). The bytes are handed over to the worker. */
export function readStepFile(bytes: Uint8Array): Promise<StepImport> {
  const copy = bytes.slice();
  return request<StepImport>({ type: "read", bytes: copy }, [copy.buffer]);
}

/** Writes a STEP file for the given parts. */
export function writeStepFile(parts: ExportPart[], objects: CadObject[]): Promise<StepExport> {
  return request<StepExport>({ type: "write", parts, objects });
}
