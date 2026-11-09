// Live check against a real local Ollama (not part of `npm test`):
//   OLLAMA_LIVE=1 npx vitest run tests/live --config vitest.live.config.ts
import { describe, expect, it } from "vitest";
import { chatTurn } from "../../src/main/chat";
import { callTool, type Proposal } from "../../src/core/ai/proposals";
import { toolSpecs } from "../../src/core/ai/tools";
import { createProjectStore } from "../../src/core/document/store";
import type { ChatEvent, ChatSettings } from "../../src/shared/ipc";

const model = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const settings: ChatSettings = { provider: "ollama", ollamaUrl: "http://127.0.0.1:11434", ollamaModel: model, openaiUrl: "https://api.openai.com/v1", openaiModel: "", anthropicModel: "claude-opus-5-5" };

async function run(text: string, mode: "assist" | "create") {
  const store = createProjectStore();
  let proposal: Proposal | null = null;
  const events: ChatEvent[] = [];
  let n = 0;
  await chatTurn(`live-${mode}-${Date.now()}`, text, mode, settings, {
    key: async () => null,
    specs: async (readOnly) => toolSpecs(readOnly ? ["read"] : ["read", "change"]),
    callTool: async (name, params) => {
      const out = callTool({ name, params, mode, source: "chat", state: store.getState().project, proposal, env: { newId: () => `id${++n}`, extras: {} } });
      proposal = out.proposal;
      return out.result;
    },
    emit: (e) => events.push(e),
  });
  return { events, proposal: proposal as Proposal | null, text: events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("") };
}

describe.runIf(process.env.OLLAMA_LIVE === "1")(`Ollama live (${model})`, () => {
  it("answers a question using a read tool", async () => {
    const r = await run("How many 3D objects are in my project? Check with your tools.", "assist");
    console.log("ANSWER:", r.text, "\nTOOLS:", r.events.filter((e) => e.type === "tool"));
    expect(r.events.some((e) => e.type === "error")).toBe(false);
    expect(r.events.some((e) => e.type === "tool")).toBe(true);
  }, 240000);
  it("proposes a box in create mode (nothing applied)", async () => {
    const r = await run("Add a box 20 mm wide, 20 mm deep and 10 mm tall named Test cube.", "create");
    console.log("ANSWER:", r.text, "\nPROPOSAL:", JSON.stringify(r.proposal?.calls));
    expect(r.events.some((e) => e.type === "error")).toBe(false);
    expect(r.proposal?.calls.some((c) => c.tool === "cad_add_shape")).toBe(true);
  }, 240000);
});
