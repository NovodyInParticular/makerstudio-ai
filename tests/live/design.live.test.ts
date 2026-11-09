// Live: does a local model design multi-part objects? OLLAMA_LIVE=1 [OLLAMA_MODEL=..] npx vitest run tests/live/design --config vitest.live.config.ts
import { describe, it } from "vitest";
import { chatTurn } from "../../src/main/chat";
import { callTool, type Proposal } from "../../src/core/ai/proposals";
import { toolSpecs } from "../../src/core/ai/tools";
import { createProjectStore } from "../../src/core/document/store";
import type { ChatSettings } from "../../src/shared/ipc";

const model = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const s: ChatSettings = { provider: "ollama", ollamaUrl: "http://127.0.0.1:11434", ollamaModel: model, openaiUrl: "https://api.openai.com/v1", openaiModel: "", anthropicModel: "claude-opus-5-5" };

describe.runIf(process.env.OLLAMA_LIVE === "1")(`design (${model})`, () => {
  for (const ask of ["Make me a coffee mug.", "Make a small cute desk robot figure.", "Make a phone stand."]) {
    it(ask, async () => {
      const store = createProjectStore();
      let proposal: Proposal | null = null, n = 0, text = "";
      const t0 = Date.now();
      await chatTurn(`d-${Math.random()}`, ask, "create", s, {
        key: async () => null,
        specs: async () => toolSpecs(["read", "change"]),
        callTool: async (name, params) => { const o = callTool({ name, params, mode: "create", source: "chat", state: store.getState().project, proposal, env: { newId: () => `i${++n}`, extras: {} } }); proposal = o.proposal; return o.result; },
        emit: (e) => { if (e.type === "text") text += e.delta; if (e.type === "error") text += ` [ERROR ${e.message}]`; },
      });
      const p = proposal as Proposal | null;
      const parts = p?.calls.flatMap((c) => c.tool === "cad_build" ? ((c.params as { parts: { name?: string; kind: string }[] }).parts.map((x) => `${x.name ?? "?"}:${x.kind}`)) : c.tool === "cad_add_shape" ? [`${(c.params as { name?: string }).name}:${(c.params as { kind: string }).kind}`] : []) ?? [];
      console.log(`\n### ${model} | ${ask} | ${((Date.now() - t0) / 1000).toFixed(0)} s | tools: ${p?.calls.map((c) => c.tool).join(",") ?? "none"} | ${parts.length} parts\n  ${parts.join(", ")}\n  says: ${text.trim().slice(0, 200)}`);
    }, 300000);
  }
});
