// Live: Claude Code reads an attached picture (Read allowed only in the private folder).
// CC_IMAGE_LIVE=1 npx vitest run tests/live/claude-image --config vitest.live.config.ts
import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { chatTurn } from "../../src/main/chat";

it.runIf(process.env.CC_IMAGE_LIVE === "1")("claude code sees the picture", async () => {
  const dir = process.env.CC_DIR!;
  writeFileSync(`${dir}/mcp.json`, JSON.stringify({ mcpServers: {} }));
  let text = "", err = "";
  await chatTurn(`img-${Date.now()}`, process.env.CC_PROMPT ?? "In at most six words: what object is drawn?", "assist",
    { provider: "claude-code", ollamaUrl: "", ollamaModel: "", openaiUrl: "", openaiModel: "", anthropicModel: "" } as never,
    { key: async () => null, specs: async () => [], callTool: async () => ({ ok: false, error: "none" }), emit: (e) => { if (e.type === "text") text += e.delta; if (e.type === "error") err = e.message; }, claudeCodeSetup: async () => ({ mcpConfig: `${dir}/mcp.json`, cwd: dir }) },
    { path: "mug.png", mime: "image/png", data: readFileSync(process.env.CC_IMG!).toString("base64") });
  console.log("ANSWER:", text, err);
  expect(err).toBe("");
  if (!process.env.CC_PROMPT) expect(text.toLowerCase()).toMatch(/mug|cup/);
}, 180000);
