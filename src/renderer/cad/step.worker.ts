// Runs the OpenCascade (STEP) engine off the interface thread.
//
// The OCCT WebAssembly build uses JavaScript eval internally (its generated bindings). The
// window forbids eval through its Content Security Policy; this worker is a separate script
// with its own policy, so the window keeps the strict policy and long STEP jobs do not freeze
// the interface. Only this app's own bundled code runs here.

import Manifold from "manifold-3d/manifold";
import manifoldWasm from "manifold-3d/manifold.wasm?url";
import occt from "replicad-opencascadejs";
import occtWasm from "replicad-opencascadejs/wasm?url";
import { initCsg } from "../../core/cad/csg";
import type { ExportPart } from "../../core/cad/exporting";
import type { CadObject } from "../../core/cad/model";
import { initStep, readStep, writeStep } from "../../core/cad/step";

export type StepRequest =
  | { id: number; type: "read"; bytes: Uint8Array }
  | { id: number; type: "write"; parts: ExportPart[]; objects: CadObject[] };

export type StepResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

const quiet = () => {};
const ready = Promise.all([
  initCsg(() => Manifold({ locateFile: () => manifoldWasm })),
  initStep(() => occt({ locateFile: () => occtWasm, print: quiet, printErr: quiet } as never)),
]);

const post = (message: StepResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = async (event: MessageEvent<StepRequest>) => {
  const request = event.data;
  try {
    await ready;
    if (request.type === "read") {
      const result = readStep(request.bytes);
      const transfer = result.solids.flatMap((s) => [s.mesh.positions.buffer, s.mesh.indices.buffer]);
      post({ id: request.id, ok: true, value: result }, transfer);
    } else {
      const result = await writeStep(request.parts, request.objects);
      post({ id: request.id, ok: true, value: result }, [result.bytes.buffer]);
    }
  } catch (error) {
    post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
