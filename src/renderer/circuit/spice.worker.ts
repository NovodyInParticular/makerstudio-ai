// Runs ngspice (eecircuit-engine, WASM) off the main thread. Started on first use.
import { Simulation } from "eecircuit-engine";

export type SpiceRequest = { id: number; netlist: string };
export type SpiceResponse = { id: number; ok: true; data: { name: string; values: number[] }[] } | { id: number; ok: false; error: string };

let sim: Simulation | null = null;
let queue: Promise<unknown> = Promise.resolve();

self.onmessage = (event: MessageEvent<SpiceRequest>) => {
  const { id, netlist } = event.data;
  // ngspice runs one circuit at a time.
  queue = queue.then(async () => {
    try {
      if (!sim) { sim = new Simulation(); await sim.start(); }
      sim.setNetList(netlist);
      const r = await sim.runSim();
      if (r.dataType !== "real" || !r.numPoints) throw new Error("The simulator returned no result (the circuit may have no solution).");
      (self as unknown as Worker).postMessage({ id, ok: true, data: r.data.map((d) => ({ name: d.name, values: d.values as number[] })) } satisfies SpiceResponse);
    } catch (error) {
      (self as unknown as Worker).postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies SpiceResponse);
    }
  });
};
