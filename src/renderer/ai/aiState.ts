// AI state in the window: mode, proposals waiting for approval, and the one entry point every
// AI source (in-app chat, Claude Code over MCP) uses to call tools.

import { create } from "zustand";
import { aiApply, callTool, proposalTitle, type Mode, type Proposal, type ToolCallResult } from "../../core/ai/proposals";
import { newId } from "../../shared/format";
import { liveSelection } from "../cad/cadState";
import { projectStore, useUi } from "../state";

interface AiState {
  mode: Mode;
  /** Open (pending) proposal per source, plus finished ones for the record (newest first). */
  proposals: Proposal[];
  setMode(mode: Mode): void;
}

export const useAi = create<AiState>()((set) => ({
  mode: "assist",
  proposals: [],
  setMode: (mode) => set({ mode }),
}));

function openProposal(source: string): Proposal | null {
  return useAi.getState().proposals.find((p) => p.source === source && p.status === "pending") ?? null;
}

/** Runs one AI tool call for a source and records any proposed change. */
export function runTool(source: string, name: string, params: unknown): ToolCallResult {
  const ui = useUi.getState();
  const printer = ui.settings?.printer;
  const before = openProposal(source);
  const out = callTool({
    name, params, source,
    mode: useAi.getState().mode,
    state: projectStore.getState().project,
    proposal: before,
    env: { newId, extras: { workspace: ui.workspace, selection: liveSelection(), ...(printer ? { printer } : {}) } },
  });
  if (out.proposal && out.proposal !== before) {
    const others = useAi.getState().proposals.filter((p) => p.id !== out.proposal!.id);
    useAi.setState({ proposals: [out.proposal, ...others].slice(0, 30) });
    if (!before) useUi.getState().notify("info", `${source === "chat" ? "The assistant" : sourceName(source)} proposed a change. Review it in the AI panel (Ctrl+J).`);
  }
  return out.result;
}

export function sourceName(source: string): string {
  return source === "claude-code" ? "Claude Code" : source === "chat" ? "AI chat" : source;
}

function finish(id: string, patch: Partial<Proposal>) {
  useAi.setState({ proposals: useAi.getState().proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

/** Applies a proposal as one undo step labelled "AI: ...". */
export function approve(id: string): boolean {
  const p = useAi.getState().proposals.find((x) => x.id === id);
  if (!p || p.status !== "pending") return false;
  try {
    projectStore.getState().execute(aiApply({ title: proposalTitle(p), commands: p.commands }), { author: "ai" });
    finish(id, { status: "approved" });
    useUi.getState().notify("success", `Applied: ${proposalTitle(p)}. Ctrl+Z undoes it.`);
    return true;
  } catch (error) {
    // The project changed since the proposal was made (e.g. an object was deleted).
    finish(id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    useUi.getState().notify("error", `Could not apply the proposal: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function reject(id: string) {
  finish(id, { status: "rejected" });
}
