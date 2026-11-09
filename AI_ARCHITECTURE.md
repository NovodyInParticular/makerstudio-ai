# AI Architecture

Status: design only (Phase 4 builds it).

## 1. Provider abstraction

```ts
interface AIProvider {
  id: string;                         // "anthropic" | "openai-compatible" | "ollama"
  capabilities(model: string): { vision: boolean; tools: boolean; maxContext: number };
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>; // streamed text + tool calls
}
```

- Implementations live in `src/core/ai/providers/`, one file per provider. The rest of the app only sees `AIProvider`.
- **Anthropic**: official `@anthropic-ai/sdk`, native tool use and image input. Default model chosen from the current Claude lineup at implementation time.
- **OpenAI-compatible**: official `openai` SDK with configurable base URL (works with many hosted and local servers).
- **Ollama**: its OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1`. Installed now: qwen3.5:2b/4b/9b (text). A vision model would need to be pulled for screenshot/image features.
- Calls run in the Electron **main process**. API keys are stored with Electron `safeStorage` (OS keychain) and never sent to the renderer or written to project files.
- If a model lacks vision, image features are disabled with an explanation instead of failing silently.

## 2. Context engine (Observe)

Builds a compact, structured snapshot of what the user is doing:

```jsonc
{
  "workspace": "3d-studio",
  "units": "mm",
  "selection": ["obj_12"],
  "objects": [{ "id": "obj_12", "type": "box", "params": {"x":40,"y":30,"z":10}, "transform": {...}, "hole": false, "bbox": {...} }],
  "circuit": { "components": [...], "nets": [...], "validation": [...] },
  "simulation": { "status": "error", "message": "..." },
  "printer": { "model": "Bambu Lab A1", "volume": [256,256,256], "nozzle": 0.4 }
}
```

- Large scenes are summarised (counts, selected items in full, others as bounding boxes).
- Screenshots of the app window are only taken after an explicit per-session permission toggle, and are shown in the chat so the user sees what was sent.

## 3. Modes

| Mode | AI may | AI may not |
|---|---|---|
| Observe | Read context, answer questions | Propose or apply changes |
| Assist | Explain, diagnose, suggest, highlight objects/nets | Change the document |
| Create | Propose changes through tools | Apply anything without user approval |

## 4. Tool interface (Create)

- Each tool is defined once with a zod schema, e.g. `cad.createPrimitive`, `cad.boolean`, `cad.addMountingHoles`, `cad.transform`, `circuit.addComponent`, `circuit.connect`, `robot.placePart`, `parts.search`, `print.check`.
- A tool call is validated, then turned into **commands** (same ones the UI uses) applied to a **copy** of the document → the user sees a ghosted preview and a readable change list.
- Approve → patches committed as one undo step labelled "AI: …" in history. Reject → discarded.
- Destructive tools (delete, replace, large edits) are flagged and always need explicit approval even inside a batch.
- After every proposed change, the safety engine (`SAFETY_REQUIREMENTS.md`) runs and its warnings are shown alongside the preview.
- Read-only tools (`parts.search`, `scene.inspect`, `sim.measure`) run without approval.

## 5. Honesty rules for the AI

- System prompt requires: cite parts-library sources, say "unknown" when a spec is missing, never call a design safe, label image-derived geometry as approximate.
- Part specs come from the catalog via tools, not from model memory.

## 6. Storage

- Conversations saved per project in `ai/conversations/`, with the tool calls and approval decisions.
- No telemetry. Only the chosen provider receives data, and the settings page says what is sent.

## 7. Using Claude Code with MakerStudio (owner request, 2026-11-08)

The owner already uses Claude Code. Planned for Phase 4, two ways:

1. **Claude Code as the engineer, through an MCP server (recommended for the owner's own use).**
   MakerStudio runs a local MCP server (localhost only, off by default, toggled in Settings) that exposes the same
   read tools and change tools as the in-app assistant. Claude Code connects to it like any other MCP server.
   Change tools still create *proposals*: they appear in MakerStudio's approval panel and only apply when the owner
   clicks Approve, and they are undoable. This uses the owner's existing Claude Code login normally.
2. **In-app chat panel**: API key (Anthropic or OpenAI-compatible) or local Ollama, as in §1.

Licensing/terms note: Anthropic's Agent SDK documentation says third-party developers may not offer claude.ai
login or subscription rate limits in their products unless approved. So MakerStudio will **not** ship a "log in with
your Claude subscription" feature inside the app. Option 1 keeps Claude Code as the owner's own tool talking to the app.
Source: https://code.claude.com/docs/en/agent-sdk/overview
