// In-app AI chat (AI_ARCHITECTURE.md §1). Runs in the main process so API keys never reach the
// window. Each conversation keeps its exact provider message history, append-only (assistant
// turns, including thinking blocks, are passed back unchanged). Tool calls go to the window,
// where they become proposals the owner approves, exactly like Claude Code's.

import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatEvent, ChatSettings } from "../shared/ipc";

export interface ChatImage { path: string; mime: string; data: string }

export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }

export interface ChatDeps {
  key(provider: "openai" | "anthropic"): Promise<string | null>;
  specs(readOnly: boolean): Promise<ToolSpec[]>;
  callTool(name: string, params: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  emit(event: ChatEvent): void;
  /** Claude Code provider: makes sure the MCP server runs; returns a private MCP config file and a work folder. */
  claudeCodeSetup?(): Promise<{ mcpConfig: string; cwd: string }>;
}

const MAX_ROUNDS = 12;

export function systemPrompt(mode: string): string {
  return [
    "You are the AI engineer inside MakerStudio AI, the owner's app for 3D printing design (Bambu Lab A1), circuits, robot faces and robotics.",
    "Use the tools to read the open project before answering questions about it. Sizes are millimetres.",
    mode === "create"
      ? "Change tools only PROPOSE changes: the owner reviews each proposal in the AI panel and approves or rejects it. Never say a change was made; say it is waiting for approval."
      : `You are in ${mode} mode: you can read and explain, but you cannot propose changes. If the owner wants changes, tell them to switch the AI panel to Create mode.`,
    "Take part and board specs from list_catalog, not from memory, and say 'unknown' when a spec is missing.",
    "When asked to make an object, design it properly, not as a single box: think of the real thing, break it into its main parts (body, legs, handle, eyes, holes...), give each a realistic size in mm, work out positions so parts touch or overlap slightly, then build everything with ONE cad_build call. A recognisable object usually needs 5-30 parts. Afterwards say in one or two lines what you built and its overall size.",
    "Never call a circuit or design safe. Report the checks' findings as they are; the best result is 'no problems detected', which is not a guarantee.",
    "When the owner sends a picture or sketch of something to make: describe what you see in one line, then build an APPROXIMATE editable model with cad_build (name it '... (approximate)'). A picture has no scale: ask for one real measurement, or say which size you assumed. Prefer simple parts the owner can adjust.",
    "When designing or changing a robot (3D parts, joints, circuit, screens), finish by running check_design and report its findings honestly.",
    "Keep answers short and practical; the owner is learning.",
  ].join("\n");
}

type History = { provider: string; claudeSession?: string; anthropic?: Anthropic.Beta.BetaMessageParam[]; openai?: OpenAI.Chat.ChatCompletionMessageParam[] };
const histories = new Map<string, History>();
const aborts = new Map<string, AbortController>();

export function cancelChat(chatId: string) {
  aborts.get(chatId)?.abort();
}

export function forgetChat(chatId: string) {
  aborts.get(chatId)?.abort();
  histories.delete(chatId);
}

async function runTools(chatId: string, deps: ChatDeps, calls: { id: string; name: string; input: unknown }[]) {
  const results: { id: string; ok: boolean; text: string }[] = [];
  for (const c of calls) {
    const r = await deps.callTool(c.name, c.input);
    deps.emit({ chatId, type: "tool", name: c.name, ok: r.ok, detail: r.ok ? summarize(r.data) : r.error });
    results.push({ id: c.id, ok: r.ok, text: r.ok ? JSON.stringify(r.data) : r.error });
  }
  return results;
}

function summarize(data: unknown): string {
  const d = data as { proposed?: string } | null;
  return d && typeof d === "object" && "proposed" in d && d.proposed ? `Proposed: ${d.proposed}` : "Read";
}

// --- Anthropic -----------------------------------------------------------------------------

async function anthropicTurn(chatId: string, text: string, mode: string, s: ChatSettings, deps: ChatDeps, signal: AbortSignal, image?: ChatImage) {
  const apiKey = await deps.key("anthropic");
  if (!apiKey) throw new Error("No Claude API key yet: add one in Settings → AI providers.");
  const client = new Anthropic({ apiKey });
  const h = histories.get(chatId)!;
  const messages = (h.anthropic ??= []);
  messages.push({ role: "user", content: image
    ? [{ type: "image", source: { type: "base64", media_type: image.mime as "image/png", data: image.data } }, { type: "text", text }]
    : text });
  const specs = await deps.specs(mode !== "create");
  const tools: Anthropic.Beta.BetaTool[] = specs.map((t) => ({
    name: t.name, description: t.description, eager_input_streaming: true,
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }));
  let jsonRetries = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: s.anthropicModel,
      max_tokens: 16000,
      system: systemPrompt(mode),
      tools,
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // Server-side refusal fallback (default routing): a declined request is retried on a
      // suitable fallback model instead of simply stopping.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    }, { signal });
    stream.on("text", (delta) => deps.emit({ chatId, type: "text", delta }));
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      // Only unparseable tool-input JSON is retried; API errors (auth, rate limit...) go up.
      if (error instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw error;
      continue;
    }
    if (message.stop_reason === "refusal") {
      deps.emit({ chatId, type: "text", delta: "\n(The model declined this request.)" });
      messages.push({ role: "assistant", content: message.content });
      return "refusal";
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: message.content });
    if (uses.length === 0) return message.stop_reason ?? "end_turn";
    if (message.stop_reason === "max_tokens") throw new Error("The answer was cut off (too long). Try asking for less at once.");
    // Inputs are validated against each tool's schema before they run (in the window).
    const results = await runTools(chatId, deps, uses.map((u) => ({ id: u.id, name: u.name, input: u.input })));
    messages.push({ role: "user", content: results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.text, ...(r.ok ? {} : { is_error: true }) })) });
  }
  return "max_rounds";
}

// --- OpenAI-compatible (also Ollama) ----------------------------------------------------------

async function openaiTurn(chatId: string, text: string, mode: string, s: ChatSettings, deps: ChatDeps, signal: AbortSignal, image?: ChatImage) {
  const ollama = s.provider === "ollama";
  const apiKey = ollama ? "ollama" : await deps.key("openai");
  if (!apiKey) throw new Error("No API key for the OpenAI-compatible service yet: add one in Settings → AI providers.");
  const client = new OpenAI({ apiKey, baseURL: ollama ? `${s.ollamaUrl.replace(/\/+$/, "")}/v1` : s.openaiUrl });
  const model = ollama ? s.ollamaModel : s.openaiModel;
  const h = histories.get(chatId)!;
  const messages = (h.openai ??= [{ role: "system", content: systemPrompt(mode) }]);
  messages.push({ role: "user", content: image ? [{ type: "text", text }, { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }] : text });
  const specs = await deps.specs(mode !== "create");
  const tools: OpenAI.Chat.ChatCompletionTool[] = specs.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.chat.completions.stream({ model, messages, tools }, { signal });
    stream.on("content.delta", (e) => deps.emit({ chatId, type: "text", delta: e.delta }));
    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];
    if (!choice) throw new Error("The model returned no answer.");
    const msg = choice.message;
    messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
    if (calls.length === 0) return choice.finish_reason ?? "stop";
    if (choice.finish_reason === "length") throw new Error("The answer was cut off (too long). Try asking for less at once.");
    const parsed = calls.map((c) => {
      let input: unknown = {};
      try { input = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { INVALID_JSON: c.function.arguments }; }
      return { id: c.id, name: c.function.name, input };
    });
    const results = await runTools(chatId, deps, parsed);
    for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.text });
  }
  return "max_rounds";
}

// --- Claude Code (the owner's installed `claude`, their own login) --------------------------------

let claudePath: string | null = null;
async function findClaude(): Promise<string> {
  if (claudePath && existsSync(claudePath)) return claudePath;
  const home = homedir();
  const candidates = [path.join(home, ".local/bin/claude"), path.join(home, ".claude/local/claude"), path.join(home, ".local/share/mise/command-wrappers/bin/claude"), "/usr/local/bin/claude", "/usr/bin/claude"];
  for (const c of (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "claude")).concat(candidates)) {
    if (existsSync(c)) return (claudePath = c);
  }
  // Apps started from the desktop may not see the shell's PATH: ask a login shell.
  const viaShell = await new Promise<string>((resolve) => execFile("bash", ["-lc", "command -v claude"], { timeout: 5000 }, (_e, out) => resolve(String(out ?? "").trim())));
  if (viaShell && existsSync(viaShell)) return (claudePath = viaShell);
  throw new Error("Claude Code (the `claude` command) was not found. Install it from claude.com/claude-code, log in once in a terminal, then try again.");
}

async function claudeCodeTurn(chatId: string, text: string, mode: string, deps: ChatDeps, signal: AbortSignal, image?: ChatImage) {
  if (!deps.claudeCodeSetup) throw new Error("Claude Code is not available here.");
  const [bin, setup] = await Promise.all([findClaude(), deps.claudeCodeSetup()]);
  const h = histories.get(chatId)!;
  let prompt = text;
  let fileTools: string[] = ["--tools", ""];
  if (image) {
    // The picture is copied into MakerStudio's private chat folder; Read is allowed there only.
    const { promises: fsp } = await import("node:fs");
    const dest = path.join(setup.cwd, `image-${Date.now()}.${image.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`);
    await fsp.writeFile(dest, Buffer.from(image.data, "base64"), { mode: 0o600 });
    prompt = `The owner attached a picture: ${dest}\nOpen it with the Read tool.\n\n${text}`;
    fileTools = ["--tools", "Read", "--allowedTools", `Read(/${setup.cwd}/**)`];
  }
  const args = [
    "-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    // Only MakerStudio's tools (plus Read in the private folder for a picture): no shell, no other files, no other MCP servers, no hooks.
    ...fileTools, "--strict-mcp-config", "--mcp-config", setup.mcpConfig, "--allowedTools", "mcp__makerstudio",
    "--setting-sources", "", "--append-system-prompt", systemPrompt(mode),
    ...(h.claudeSession ? ["--resume", h.claudeSession] : []),
  ];
  const child = spawn(bin, args, { cwd: setup.cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  const toolNames = new Map<string, string>();
  let buf = "", stderr = "", result: { is_error?: boolean; result?: string; subtype?: string } | null = null;
  const handle = (line: string) => {
    let d: Record<string, unknown>;
    try { d = JSON.parse(line); } catch { return; }
    if (typeof d.session_id === "string") h.claudeSession = d.session_id;
    if (d.type === "stream_event") {
      const ev = d.event as { type?: string; delta?: { type?: string; text?: string } };
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) deps.emit({ chatId, type: "text", delta: ev.delta.text });
    } else if (d.type === "assistant") {
      for (const b of ((d.message as { content?: { type: string; id?: string; name?: string }[] })?.content ?? [])) if (b.type === "tool_use" && b.id) toolNames.set(b.id, (b.name ?? "").replace(/^mcp__makerstudio__/, ""));
    } else if (d.type === "user") {
      for (const b of ((d.message as { content?: unknown })?.content as { type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }[] | undefined) ?? []) {
        if (b?.type !== "tool_result" || !b.tool_use_id) continue;
        const raw = typeof b.content === "string" ? b.content
          : Array.isArray(b.content) ? (b.content as { type?: string; text?: string }[]).map((x) => x.text ?? "").join("") : "";
        let proposed: string | undefined;
        try { proposed = (JSON.parse(raw) as { proposed?: string }).proposed; } catch { /* not JSON: a read result or an error text */ }
        deps.emit({ chatId, type: "tool", name: toolNames.get(b.tool_use_id) ?? "tool", ok: !b.is_error, detail: b.is_error ? raw.slice(0, 200) : proposed ? `Proposed: ${proposed}` : "Read" });
      }
    } else if (d.type === "result") {
      result = d as typeof result;
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  child.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString("utf8")).slice(-2000); });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  if (buf.trim()) handle(buf);
  if (signal.aborted) throw new Error("Stopped.");
  const r = result as { is_error?: boolean; result?: string; subtype?: string } | null;
  if (r?.is_error || (code !== 0 && !r)) {
    const why = (r?.result ?? stderr).trim();
    if (/log ?in|auth|credential|api key/i.test(why)) throw new Error("Claude Code is not logged in. Run `claude` once in a terminal and log in, then try again.");
    throw new Error(`Claude Code stopped: ${why.slice(0, 300) || `exit code ${code}`}`);
  }
  return r?.subtype ?? "end_turn";
}

// --- scripted provider for tests (only when MAKERSTUDIO_MOCK_AI=1) ------------------------------

async function mockTurn(chatId: string, text: string, mode: string, deps: ChatDeps) {
  const say = (t: string) => deps.emit({ chatId, type: "text", delta: t });
  const lower = text.toLowerCase();
  if (lower.startsWith("[image]")) {
    say("(mock) I can see the picture you attached.");
    return "end_turn";
  }
  if (lower.includes("box")) {
    const [r] = await runTools(chatId, deps, [{ id: "m1", name: "cad_add_shape", input: { kind: "box", name: "Chat box", params: { width: 25, depth: 25, height: 8 } } }]);
    say(r!.ok ? "I proposed a 25 × 25 × 8 mm box. It is waiting for your approval in the AI panel." : `I could not propose it: ${r!.text}`);
  } else {
    const [r] = await runTools(chatId, deps, [{ id: "m2", name: "get_project", input: {} }]);
    const count = r!.ok ? (JSON.parse(r!.text) as { cad: { count: number } }).cad.count : 0;
    say(`(mock, ${mode} mode) The project has ${count} 3D objects.`);
  }
  return "end_turn";
}

/** One user message: runs the model (and its tool calls) until it answers. */
export async function chatTurn(chatId: string, text: string, mode: string, s: ChatSettings, deps: ChatDeps, image?: ChatImage): Promise<void> {
  const provider = process.env.MAKERSTUDIO_MOCK_AI === "1" ? "mock" : s.provider;
  let h = histories.get(chatId);
  if (!h || h.provider !== provider) { h = { provider }; histories.set(chatId, h); }
  const controller = new AbortController();
  aborts.set(chatId, controller);
  try {
    const stop = provider === "mock" ? await mockTurn(chatId, image ? `[image] ${text}` : text, mode, deps)
      : provider === "claude-code" ? await claudeCodeTurn(chatId, text, mode, deps, controller.signal, image)
      : provider === "anthropic" ? await anthropicTurn(chatId, text, mode, s, deps, controller.signal, image)
        : await openaiTurn(chatId, text, mode, s, deps, controller.signal, image);
    deps.emit({ chatId, type: "done", stop });
  } catch (error) {
    deps.emit({ chatId, type: "error", message: controller.signal.aborted ? "Stopped." : describe(error, provider, s) });
  } finally {
    aborts.delete(chatId);
  }
}

function describe(error: unknown, provider: string, s: ChatSettings): string {
  if (error instanceof Anthropic.AuthenticationError) return "The Claude API key was not accepted. Check it in Settings → AI providers.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Wait a moment and try again.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ""}: ${error.message}`;
  if (error instanceof OpenAI.AuthenticationError) return "The API key was not accepted. Check it in Settings → AI providers.";
  if (error instanceof OpenAI.APIConnectionError) {
    return provider === "ollama" ? `Could not reach Ollama at ${s.ollamaUrl}. Is it running? (\`ollama serve\`)` : `Could not reach ${s.openaiUrl}.`;
  }
  if (error instanceof OpenAI.NotFoundError && provider === "ollama") return `Ollama has no model "${s.ollamaModel}". Pull it (\`ollama pull ${s.ollamaModel}\`) or choose another in Settings.`;
  if (error instanceof OpenAI.APIError) return `API error ${error.status ?? ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
