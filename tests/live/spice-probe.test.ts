import { it } from "vitest";
import { Simulation } from "eecircuit-engine";
it("probe", async () => {
  const sim = new Simulation();
  const t0 = Date.now();
  await sim.start();
  console.log("start ms", Date.now() - t0);
  sim.setNetList(`probe
V1 a 0 9
R1 a b 1k
R2 b 0 2k
V2 c 0 5
R3 c d 220
VS d e 0
D1 e 0 LEDR
.model LEDR D(IS=1e-19 N=1.8 RS=5)
.op
.end`);
  const t1 = Date.now();
  const r = await sim.runSim();
  console.log("run ms", Date.now() - t1, JSON.stringify({ names: r.variableNames, n: r.numPoints, data: r.data.map((d) => [d.name, d.type, d.values]) }));
  console.log("errors", sim.getError?.(), "info", String(sim.getInfo?.() ?? "").slice(0, 300));
}, 120000);
