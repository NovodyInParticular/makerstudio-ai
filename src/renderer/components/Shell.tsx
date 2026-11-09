// The window frame: top bar, left navigation, AI panel, dialogs and notifications.

import { useEffect, useRef, useState } from "react";
import { redo, saveProject, toggleAiPanel, undo } from "../actions";
import { useCad } from "../cad/cadState";
import { useProject, useUi } from "../state";
import { WORKSPACES, workspaceInfo } from "../workspaces";
import { MODE_INFO, proposalTitle, type Mode, type Proposal } from "../../core/ai/proposals";
import { approve, reject, sourceName, useAi } from "../ai/aiState";
import { newChat, sendChat, stopChat, useChat } from "../ai/chatState";
import { Icon } from "./Icon";

export function TopBar() {
  const name = useProject((s) => s.project.document.name);
  const filePath = useProject((s) => s.filePath);
  const dirty = useProject((s) => s.version !== s.savedVersion);
  const undoLabel = useProject((s) => s.undoStack[s.undoStack.length - 1]?.label);
  const redoLabel = useProject((s) => s.redoStack[s.redoStack.length - 1]?.label);
  const aiOpen = useUi((s) => s.aiPanelOpen);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">MakerStudio <b>AI</b></span>
      </div>
      <div className="project-title" title={filePath ?? "Not saved yet"}>
        <span className="project-name" data-testid="project-name">{name}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes" data-testid="dirty-indicator" />}
        <span className="project-path">{filePath ?? "Not saved yet"}</span>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={undo} disabled={!undoLabel} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!redoLabel} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"} aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button className="icon-btn" onClick={() => void saveProject(false)} title="Save (Ctrl+S)" aria-label="Save">
          <Icon name="save" />
        </button>
        <button className={`icon-btn ${aiOpen ? "active" : ""}`} onClick={() => void toggleAiPanel()} title="AI panel (Ctrl+J)" aria-label="Toggle AI panel" aria-pressed={aiOpen}>
          <Icon name="panel" />
        </button>
        <FullScreenButton />
      </div>
    </header>
  );
}

export function Sidebar() {
  const current = useUi((s) => s.workspace);
  const setWorkspace = useUi((s) => s.setWorkspace);
  return (
    <nav className="sidebar" aria-label="Workspaces">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          className={`nav-item ${current === w.id ? "active" : ""}`}
          onClick={() => setWorkspace(w.id)}
          title={w.key ? `${w.label} (Ctrl+${w.key})` : w.label}
          aria-current={current === w.id ? "page" : undefined}
          data-testid={`nav-${w.id}`}
        >
          <Icon name={w.icon} size={20} />
          <span className="nav-label">{w.label}</span>
          {w.plannedPhase && <span className="nav-phase">P{w.plannedPhase}</span>}
        </button>
      ))}
    </nav>
  );
}

function ProposalCard({ p }: { p: Proposal }) {
  const pending = p.status === "pending";
  return (
    <div className={`proposal ${p.status}`} data-testid="proposal">
      <div className="proposal-head">
        <span className="badge ai">{sourceName(p.source)}</span>
        <b>{proposalTitle(p)}</b>
      </div>
      <ol className="proposal-calls">
        {p.calls.map((c, i) => (
          <li key={i}>{c.destructive && <span className="badge danger">delete</span>} {c.summary}</li>
        ))}
      </ol>
      {p.warnings.map((w, i) => (
        <div key={i} className={`print-issue ${w.severity === "danger" ? "error" : "warning"}`} data-testid="proposal-warning">
          <b>{w.severity === "danger" ? "Danger" : "Warning"} if applied:</b> {w.message}
        </div>
      ))}
      {pending ? (
        <div className="button-row">
          <button className="btn primary small" onClick={() => approve(p.id)} data-testid="proposal-approve">Approve</button>
          <button className="btn plain small" onClick={() => reject(p.id)} data-testid="proposal-reject">Reject</button>
        </div>
      ) : (
        <div className="muted small">{p.status === "approved" ? "Approved (Ctrl+Z undoes it)." : p.status === "rejected" ? "Rejected." : `Could not be applied: ${p.error}`}</div>
      )}
    </div>
  );
}

const PROVIDER_NAME = { "claude-code": "Claude Code", ollama: "Ollama (local)", openai: "OpenAI-compatible", anthropic: "Claude API" } as const;

function ChatSection() {
  const messages = useChat((s) => s.messages);
  const busy = useChat((s) => s.busy);
  const ai = useUi((s) => s.settings?.ai);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ token: string; preview: string; name: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);
  const send = () => { if (!busy && (text.trim() || image)) { sendChat(text, image ?? undefined); setText(""); setImage(null); } };
  const pick = async () => { const r = await window.makerstudio.chatPickImage(); if (!r.ok) useUi.getState().notify("error", r.error); else if (r.value) setImage(r.value); };
  return (
    <section className="ai-section ai-chat" data-testid="ai-chat">
      <h4>
        Chat
        {messages.length > 0 && <button className="btn plain small right" onClick={newChat} disabled={busy} data-testid="chat-new">New chat</button>}
      </h4>
      {messages.length === 0 && (
        <p className="muted small">
          Ask about your project, e.g. "what is in my circuit?" or (in Create mode) "add a 20 mm cube".
          {ai && <> Using {PROVIDER_NAME[ai.provider]}{ai.provider === "ollama" ? ` · ${ai.ollamaModel}` : ai.provider === "anthropic" ? ` · ${ai.anthropicModel}` : ai.openaiModel ? ` · ${ai.openaiModel}` : ""} (change in Settings).</>}
        </p>
      )}
      <div className="chat-log">
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`} data-testid={`chat-${m.role}`}>
            {m.tools.map((t, i) => (
              <div key={i} className={`chat-tool ${t.ok ? "" : "bad"}`}>{t.ok ? "✓" : "✗"} {t.name.replace(/_/g, " ")}{t.detail && t.detail !== "Read" ? ` · ${t.detail}` : ""}</div>
            ))}
            {m.image && <img className="chat-image" src={m.image} alt="Attached picture" />}
            {m.text && <div className="chat-text">{m.text}</div>}
            {m.role === "assistant" && !m.text && !m.error && busy && <div className="muted small">Thinking…</div>}
            {m.error && <div className="chat-error warn small">{m.error}</div>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {image && <div className="chat-attach small" data-testid="chat-attached"><img src={image.preview} alt="" /> {image.name} <button className="btn plain small" onClick={() => setImage(null)}>✕</button></div>}
      <div className="chat-input">
        <button className="btn plain small" onClick={() => void pick()} disabled={busy} title="Attach a picture or sketch: the AI builds an approximate model from it" data-testid="chat-image">📎</button>
        <textarea
          value={text} rows={2} placeholder="Message the AI engineer…" data-testid="chat-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        {busy
          ? <button className="btn plain small" onClick={stopChat} data-testid="chat-stop">Stop</button>
          : <button className="btn primary small" onClick={send} disabled={!text.trim() && !image} data-testid="chat-send">Send</button>}
      </div>
    </section>
  );
}

function FullScreenButton() {
  const [on, setOn] = useState(false);
  useEffect(() => { window.makerstudio.onFullScreen(setOn); }, []);
  return (
    <button className={`icon-btn ${on ? "active" : ""}`} onClick={() => void window.makerstudio.toggleFullScreen().then(setOn)} title={on ? "Leave full screen (F11)" : "Full screen (F11)"} aria-label="Full screen" aria-pressed={on} data-testid="fullscreen">
      <Icon name={on ? "exitFullscreen" : "fullscreen"} />
    </button>
  );
}

export function AiPanel() {
  const open = useUi((s) => s.aiPanelOpen);
  const workspace = useUi((s) => s.workspace);
  // On the AI Engineer page the same assistant fills the page; no second copy at the side.
  if (!open || workspace === "ai") return null;
  return <AiEngineer variant="panel" />;
}

/** The AI assistant: the side panel (Ctrl+J) and the AI Engineer page show this same component. */
export function AiEngineer({ variant }: { variant: "panel" | "page" }) {
  const workspace = useUi((s) => s.workspace);
  const project = useProject((s) => s.project);
  const changes = useProject((s) => s.undoStack.length);
  const selected = useCad((s) => s.selection.length);
  const mode = useAi((s) => s.mode);
  const proposals = useAi((s) => s.proposals);
  const aiSettings = useUi((s) => s.settings?.ai);
  const mcpEnabled = useUi((s) => s.settings?.mcp.enabled);
  const [mcp, setMcp] = useState<{ running: boolean; calls: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => void window.makerstudio.mcpStatus().then((s) => alive && setMcp(s));
    poll();
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const info = workspaceInfo(workspace);
  const pending = proposals.filter((p) => p.status === "pending");
  const done = proposals.filter((p) => p.status !== "pending").slice(0, variant === "page" ? 12 : 5);
  const page = variant === "page";
  const status = (
    <>
      <div className="ai-status" data-testid="ai-status">
        <span className={`status-dot ${mcp?.running ? "on" : "off"}`} /> Claude Code: {mcp?.running ? `ready${mcp.calls ? ` · ${mcp.calls} calls` : ""}` : mcpEnabled ? "starting…" : "off (turn on in Settings)"}
      </div>
      <div className="ai-status"><span className="status-dot on" /> Chat: {aiSettings ? PROVIDER_NAME[aiSettings.provider] : "…"}</div>
    </>
  );
  const modeSection = (
    <section className="ai-section">
      <h4>Mode</h4>
      <div className="seg" role="group" aria-label="AI mode">
        {(["observe", "assist", "create"] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? "on" : ""} onClick={() => useAi.getState().setMode(m)} data-testid={`ai-mode-${m}`}>{m[0]!.toUpperCase() + m.slice(1)}</button>
        ))}
      </div>
      <p className="muted small">{MODE_INFO[mode]}</p>
    </section>
  );
  const approvals = (
    <section className="ai-section">
      <h4>Approval requests {pending.length > 0 && <span className="badge ai">{pending.length}</span>}</h4>
      {pending.length === 0 && <p className="muted small">None. Every AI change waits here for your approval and can be undone.</p>}
      {pending.map((p) => <ProposalCard key={p.id} p={p} />)}
      {done.length > 0 && <h4 className="ai-subhead">Recent</h4>}
      {done.map((p) => <ProposalCard key={p.id} p={p} />)}
    </section>
  );
  const context = (
    <section className="ai-section">
      <h4>Workspace context</h4>
      <p className="muted small">What an assistant can read (and nothing else):</p>
      <dl className="context-list">
        {!page && <><dt>Workspace</dt><dd>{info.label}</dd></>}
        <dt>Project</dt><dd>{project.document.name}</dd>
        <dt>3D objects</dt><dd>{project.document.workspaces.cad.objects.filter((o) => o.kind !== "group").length}</dd>
        <dt>Selected</dt><dd>{selected}</dd>
        <dt>Circuit parts</dt><dd>{project.document.workspaces.circuit.components.length}</dd>
        <dt>Screens</dt><dd>{project.document.workspaces.displays.screens.length}</dd>
        <dt>Robot joints</dt><dd>{project.document.workspaces.robotics.assemblies[0]?.joints.length ?? 0}</dd>
        <dt>Notes</dt><dd>{project.notes.length} characters</dd>
        <dt>Undo steps</dt><dd>{changes}</dd>
      </dl>
    </section>
  );

  if (page) {
    return (
      <div className="page ai-page" data-testid="ai-page">
        <header className="ai-page-head">
          <div>
            <h1>AI Engineer</h1>
            <p className="tagline">An assistant that reads your whole project and proposes changes you approve. Every change can be undone.</p>
          </div>
          <div className="ai-page-status">{status}</div>
        </header>
        <div className="ai-page-grid">
          <div className="card ai-page-chat"><ChatSection /></div>
          <div className="ai-page-side">
            <div className="card">{modeSection}{approvals}</div>
            <div className="card">
              {context}
              <section className="ai-section">
                <h4>Connections</h4>
                <p className="muted small">The chat uses {aiSettings ? PROVIDER_NAME[aiSettings.provider] : "…"}. Claude Code can also work on the open project from a terminal while MakerStudio is running. Change both in Settings.</p>
                <button className="btn plain small" onClick={() => useUi.getState().setWorkspace("settings")} data-testid="ai-open-settings">Open Settings</button>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className="ai-panel" aria-label="AI assistant" data-testid="ai-panel">
      <div className="ai-header">
        <div>
          <div className="ai-title">AI Engineer</div>
          {status}
        </div>
        <button className="icon-btn" onClick={() => void toggleAiPanel()} aria-label="Close AI panel" title="Close (Ctrl+J)">
          <Icon name="close" />
        </button>
      </div>
      <div className="ai-body">
        {modeSection}
        {approvals}
        <ChatSection />
        {context}
      </div>
    </aside>
  );
}

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    setText(dialog.input?.value ?? "");
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      } else firstButtonRef.current?.focus();
    });
  }, [dialog]);

  if (!dialog) return null;
  const primary = dialog.buttons.find((b) => b.variant === "primary") ?? dialog.buttons[dialog.buttons.length - 1]!;
  const cancel = dialog.buttons.find((b) => b.value === "cancel");
  const choose = (value: string) => dialog.resolve({ button: value, text });
  return (
    <div className="dialog-backdrop" role="presentation" onKeyDown={(e) => {
      if (e.key === "Escape" && cancel) { e.stopPropagation(); choose(cancel.value); }
    }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">{dialog.title}</h3>
        <p>{dialog.message}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (!dialog.input || text.trim()) choose(primary.value); }}>
          {dialog.input && (
            <label className="field">
              <span>{dialog.input.label}</span>
              <input ref={inputRef} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} data-testid="dialog-input" />
            </label>
          )}
          <div className="dialog-buttons">
            {dialog.buttons.map((b, i) => (
              <button
                key={b.value}
                ref={i === 0 ? firstButtonRef : undefined}
                type={b === primary ? "submit" : "button"}
                className={`btn ${b.variant ?? "plain"}`}
                disabled={b === primary && Boolean(dialog.input) && !text.trim()}
                onClick={b === primary ? undefined : () => choose(b.value)}
                data-testid={`dialog-${b.value}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          <button className="icon-btn small" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/** Keeps the window title and the "unsaved changes" flag in the desktop process up to date. */
export function useWindowSync() {
  const name = useProject((s) => s.project.document.name);
  const dirty = useProject((s) => s.version !== s.savedVersion);
  useEffect(() => {
    window.makerstudio.setTitle(`${dirty ? "● " : ""}${name} — MakerStudio AI`);
    window.makerstudio.setDirty(dirty);
  }, [name, dirty]);
}

