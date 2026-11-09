// Proposals: what the AI wants to change, waiting for the owner (AI_ARCHITECTURE.md §3-4).
//
// Change tool calls are tried on a COPY of the project (the real one is untouched); later calls
// in the same proposal see the result of earlier ones. The circuit checks run before and after,
// and new Danger / Warning findings travel with the proposal. Approving re-checks against the
// current project and applies everything as one undo step labelled "AI: ...".

import { produce } from "immer";
import { DocumentSchema } from "../../shared/format";
import { readableError } from "../document/store";
import { checkCircuit, type Finding } from "../circuit/checks";
import { circuitOf } from "../circuit/commands";
import { defineCommand, getCommand, type Command, type EditableState } from "../document/commands";
import { toolByName, type ToolEnv } from "./tools";

export type Mode = "observe" | "assist" | "create";
export const MODE_INFO: Record<Mode, string> = {
  observe: "Reads the project and answers questions. Cannot propose changes.",
  assist: "Explains, diagnoses and suggests. Cannot propose changes.",
  create: "Can propose changes. Nothing is applied until you approve it.",
};

export interface ProposalCall { tool: string; params: unknown; summary: string; destructive: boolean }

export interface Proposal {
  id: string;
  source: string;            // "chat", "claude-code", ...
  calls: ProposalCall[];
  commands: Command[];
  warnings: Finding[];
  status: "pending" | "approved" | "rejected" | "failed";
  error?: string;
  createdAt: string;
}

/** Applies commands to a copy of the editable state (throws if one is invalid). */
export function previewState(state: EditableState, commands: Command[]): EditableState {
  const next = produce(state, (draft) => {
    for (const c of commands) getCommand(c.type).apply(draft, c.params);
  });
  // The same check the project store makes on Approve, so the AI hears about it now.
  const valid = DocumentSchema.safeParse(next.document);
  if (!valid.success) {
    const issue = valid.error.issues[0];
    throw new Error(`That change would damage the project (${issue?.path.join(".") || "document"}: ${issue?.message ?? "invalid"}).`);
  }
  return next;
}

const key = (f: Finding) => `${f.rule}|${f.message}`;

/** New Danger / Warning circuit findings caused by the change. */
export function newWarnings(before: EditableState, after: EditableState): Finding[] {
  const b = circuitOf(before), a = circuitOf(after);
  const old = new Set(checkCircuit(b.components, b.wires).findings.map(key));
  return checkCircuit(a.components, a.wires).findings.filter((f) => f.severity !== "info" && !old.has(key(f)));
}

export type ToolCallResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Runs one tool call. Read tools return data from the current project plus the open proposal
 * (so the AI sees its own proposed objects). Change tools extend the open proposal.
 */
export function callTool(
  args: { name: string; params: unknown; mode: Mode; source: string; state: EditableState; proposal: Proposal | null; env: Omit<ToolEnv, "state"> },
): { result: ToolCallResult; proposal: Proposal | null } {
  const tool = toolByName(args.name);
  if (!tool) return { result: { ok: false, error: `Unknown tool "${args.name}".` }, proposal: args.proposal };
  const parsed = tool.schema.safeParse(args.params ?? {});
  if (!parsed.success) return { result: { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` }, proposal: args.proposal };
  const base = args.proposal && args.proposal.status === "pending" ? args.proposal : null;
  let current: EditableState;
  try {
    current = base ? previewState(args.state, base.commands) : args.state;
  } catch (error) {
    return { result: { ok: false, error: `The open proposal no longer fits the project: ${error instanceof Error ? error.message : String(error)}` }, proposal: args.proposal };
  }
  if (tool.kind === "change" && args.mode !== "create") {
    return { result: { ok: false, error: `Changes are not allowed in ${args.mode} mode. The owner can switch to Create mode in the AI panel.` }, proposal: args.proposal };
  }
  try {
    const out = tool.run({ ...args.env, state: current }, parsed.data);
    if (out.kind === "read") return { result: { ok: true, data: out.data }, proposal: args.proposal };
    const after = previewState(current, out.commands); // validates the change
    const proposal: Proposal = base ?? {
      id: args.env.newId(), source: args.source, calls: [], commands: [], warnings: [], status: "pending", createdAt: new Date().toISOString(),
    };
    const next: Proposal = {
      ...proposal,
      calls: [...proposal.calls, { tool: tool.name, params: parsed.data, summary: out.summary, destructive: Boolean(tool.destructive) }],
      commands: [...proposal.commands, ...out.commands],
      warnings: newWarnings(args.state, after),
    };
    return {
      result: {
        ok: true,
        data: {
          proposed: out.summary, ...(out.created ? { created: out.created } : {}),
          proposal: next.id, changes_waiting: next.calls.length,
          note: "Not applied yet: the owner must approve this proposal in MakerStudio.",
          ...(next.warnings.length ? { safety_warnings: next.warnings.map((w) => `${w.severity}: ${w.message}`) } : {}),
        },
      },
      proposal: next,
    };
  } catch (caught) {
    const error = readableError(caught);
    return { result: { ok: false, error: error instanceof Error ? error.message : String(error) }, proposal: args.proposal };
  }
}

export function proposalTitle(p: Proposal): string {
  const first = p.calls[0]?.summary ?? "Change";
  return p.calls.length > 1 ? `${first} (+${p.calls.length - 1} more)` : first;
}

/** All of a proposal's commands as one undoable step. */
export const aiApply = defineCommand<{ title: string; commands: Command[] }>({
  type: "ai.apply",
  label: ({ title }) => `AI: ${title}`,
  apply(draft, { commands }) {
    for (const c of commands) {
      if (c.type === "ai.apply") throw new Error("Nested AI changes are not allowed.");
      getCommand(c.type).apply(draft, c.params);
    }
  },
});
