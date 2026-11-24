// Reads sliced G-code into preview paths off the interface thread (big prints have
// millions of moves). The result's arrays are transferred, not copied.

import { parseToolpaths, type ToolpathPreview } from "../../core/print/gcode";

export type GcodeRequest = { id: number; bytes: Uint8Array };
export type GcodeResponse = { id: number; ok: true; preview: ToolpathPreview } | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<GcodeRequest>) => {
  const { id, bytes } = event.data;
  try {
    const preview = parseToolpaths(new TextDecoder().decode(bytes));
    const transfer: Transferable[] = [preview.layerZ.buffer, ...preview.features.flatMap((f) => [f.positions.buffer, f.layerEnds.buffer])];
    (self as unknown as Worker).postMessage({ id, ok: true, preview } satisfies GcodeResponse, transfer);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies GcodeResponse);
  }
};
