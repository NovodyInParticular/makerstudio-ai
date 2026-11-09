import { useEffect, useState } from "react";
import type { McpStatus, SecureStorageStatus, Settings } from "../../shared/ipc";
import { useUi } from "../state";

type Info = Awaited<ReturnType<typeof window.makerstudio.appInfo>>;

function NumberField(props: { label: string; value: number; step?: number; min: number; max: number; unit: string; onCommit(v: number): void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= props.min && v <= props.max) props.onCommit(v);
    else {
      useUi.getState().notify("error", `${props.label} must be between ${props.min} and ${props.max} ${props.unit}.`);
      setText(String(props.value));
    }
  };
  return (
    <label className="field inline">
      <span>{props.label}</span>
      <input type="number" step={props.step ?? 1} min={props.min} max={props.max} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <span className="unit">{props.unit}</span>
    </label>
  );
}

function TextField({ label, value, placeholder, onCommit, testId }: { label: string; value: string; placeholder?: string; onCommit(v: string): void; testId?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={v} placeholder={placeholder} data-testid={testId} onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v.trim())} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function KeyField({ provider, stored, onChange }: { provider: "openai" | "anthropic"; stored: boolean; onChange(): void }) {
  const [v, setV] = useState("");
  const save = async (key: string | null) => {
    const r = await window.makerstudio.aiSetKey(provider, key);
    if (r.ok) { setV(""); onChange(); useUi.getState().notify("success", key ? "API key saved in the system keyring." : "API key removed."); }
    else useUi.getState().notify("error", r.error);
  };
  return (
    <div className="field">
      <span>API key {stored ? <span className="ok">(saved)</span> : <span className="muted">(none)</span>}</span>
      <div className="button-row">
        <input type="password" value={v} placeholder={stored ? "Paste a new key to replace it" : "Paste your API key"} onChange={(e) => setV(e.target.value)} data-testid={`key-${provider}`} autoComplete="off" />
        <button className="btn plain small" disabled={!v.trim()} onClick={() => void save(v)}>Save</button>
        {stored && <button className="btn plain small" onClick={() => void save(null)}>Remove</button>}
      </div>
    </div>
  );
}

function ProvidersCard({ settings, update, secureNote }: { settings: Settings; update(patch: Partial<Settings>): Promise<void>; secureNote: React.ReactNode }) {
  const ai = settings.ai;
  const set = (patch: Partial<Settings["ai"]>) => void update({ ai: { ...ai, ...patch } });
  const [keys, setKeys] = useState<{ openai: boolean; anthropic: boolean } | null>(null);
  const [models, setModels] = useState<{ list: string[] } | { error: string } | null>(null);
  const refreshKeys = () => void window.makerstudio.aiKeyStatus().then(setKeys);
  const refreshModels = () => void window.makerstudio.ollamaModels().then((r) => setModels(r.ok ? { list: r.value } : { error: r.error }));
  useEffect(refreshKeys, []);
  useEffect(() => { if (ai.provider === "ollama") refreshModels(); }, [ai.provider, ai.ollamaUrl]);
  return (
    <section className="card" data-testid="providers-card">
      <h2>AI providers (built-in chat)</h2>
      <p className="muted small">The chat in the AI panel (Ctrl+J) uses one of these. Its changes are proposals you approve, like Claude Code's.</p>
      <label className="field">
        <span>Provider</span>
        <select value={ai.provider} onChange={(e) => set({ provider: e.target.value as Settings["ai"]["provider"] })} data-testid="ai-provider">
          <option value="claude-code">Claude Code: your Claude login (recommended, best designs)</option>
          <option value="ollama">Ollama: local models on this computer (free, private)</option>
          <option value="anthropic">Claude: Anthropic API key (paid per use)</option>
          <option value="openai">OpenAI-compatible: API key + address</option>
        </select>
      </label>
      {ai.provider === "claude-code" && (
        <p className="muted small" data-testid="claude-code-note">
          Runs the <code>claude</code> command installed on this computer with your own login (uses your Claude plan, no API key).
          It only gets MakerStudio's tools (no files, no shell), and the Claude Code connection below is switched on automatically.
          If it says it is not logged in, run <code>claude</code> once in a terminal and log in.
        </p>
      )}
      {ai.provider === "ollama" && (
        <>
          <TextField label="Ollama address" value={ai.ollamaUrl} onCommit={(v) => set({ ollamaUrl: v })} />
          <label className="field">
            <span>Model</span>
            <div className="button-row">
              <select value={ai.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} data-testid="ollama-model">
                {models && "list" in models && !models.list.includes(ai.ollamaModel) && <option value={ai.ollamaModel}>{ai.ollamaModel} (not installed)</option>}
                {(models && "list" in models ? models.list : [ai.ollamaModel]).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button className="btn plain small" onClick={refreshModels}>Refresh</button>
            </div>
          </label>
          <p className="small" data-testid="ollama-status">
            {models === null ? "Checking Ollama…" : "error" in models ? <span className="warn">{models.error} Start it with <code>ollama serve</code>.</span>
              : <span className="ok">Ollama is running · {models.list.length} model{models.list.length === 1 ? "" : "s"} installed</span>}
          </p>
          <p className="muted small">Small local models make more mistakes with tools than Claude; bigger ones (e.g. 9b) do better but need more GPU memory. Nothing leaves this computer.</p>
        </>
      )}
      {ai.provider === "anthropic" && (
        <>
          <TextField label="Model" value={ai.anthropicModel} onCommit={(v) => set({ anthropicModel: v || "claude-opus-5-5" })} />
          {keys && <KeyField provider="anthropic" stored={keys.anthropic} onChange={refreshKeys} />}
          <p className="muted small">Get a key at console.anthropic.com (separate from a Claude.ai or Claude Code subscription; billed per use). The key is stored encrypted in your system keyring and never shown again.</p>
        </>
      )}
      {ai.provider === "openai" && (
        <>
          <TextField label="API address" value={ai.openaiUrl} onCommit={(v) => set({ openaiUrl: v })} />
          <TextField label="Model" value={ai.openaiModel} placeholder="model name from the provider" onCommit={(v) => set({ openaiModel: v })} />
          {keys && <KeyField provider="openai" stored={keys.openai} onChange={refreshKeys} />}
        </>
      )}
      {secureNote}
    </section>
  );
}

function ClaudeCodeCard({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): Promise<void> }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const m = settings.mcp;
  useEffect(() => {
    let alive = true;
    const poll = () => void window.makerstudio.mcpStatus().then((s) => alive && setStatus(s));
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [m.enabled, m.port, m.token]);
  const command = `claude mcp add --transport http --scope user makerstudio http://127.0.0.1:${m.port}/mcp --header "Authorization: Bearer ${m.token}"`;
  return (
    <section className="card" data-testid="claude-code-card">
      <h2>Claude Code connection</h2>
      <p className="muted small">
        Lets Claude Code (with your normal Claude Code login) read the open project and propose changes. Nothing changes until you
        approve it in the AI panel, and every approved change can be undone. Only programs on this computer that have the token can connect.
      </p>
      <label className="field inline">
        <span>Allow Claude Code to connect</span>
        <input type="checkbox" checked={m.enabled} onChange={(e) => void update({ mcp: { ...m, enabled: e.target.checked } })} data-testid="mcp-enabled" />
      </label>
      <NumberField label="Port" value={m.port} min={1024} max={65535} unit="" onCommit={(v) => void update({ mcp: { ...m, port: v } })} />
      <p className="small" data-testid="mcp-status">
        {status === null ? "Checking…" : status.running ? <span className="ok">Listening on {status.url} ({status.calls} tool calls so far)</span>
          : status.error ? <span className="warn">{status.error}</span> : <span className="muted">Off</span>}
      </p>
      {m.enabled && m.token && (
        <>
          <p className="small">Run this once in a terminal to add MakerStudio to Claude Code:</p>
          <pre className="command" data-testid="mcp-command">{command}</pre>
          <div className="button-row">
            <button className="btn plain small" onClick={() => { void navigator.clipboard.writeText(command); useUi.getState().notify("success", "Command copied."); }}>Copy command</button>
            <button className="btn plain small" onClick={() => void window.makerstudio.mcpNewToken().then((s) => useUi.getState().setSettings(s))} title="Old connections stop working; run the command again">New token</button>
          </div>
          <p className="muted small">Then ask Claude Code something like "look at my MakerStudio project". Its proposals appear in the AI panel (Ctrl+J). Set the AI mode to Create to let it propose changes.</p>
        </>
      )}
    </section>
  );
}

export function SettingsPage() {
  const settings = useUi((s) => s.settings);
  const setSettings = useUi((s) => s.setSettings);
  const [info, setInfo] = useState<Info | null>(null);
  const [secure, setSecure] = useState<SecureStorageStatus | null>(null);

  useEffect(() => {
    void window.makerstudio.appInfo().then(setInfo);
    void window.makerstudio.secureStorageStatus().then(setSecure);
  }, []);

  const update = async (patch: Partial<Settings>) => {
    try {
      setSettings(await window.makerstudio.setSettings(patch));
      useUi.getState().notify("success", "Settings saved.");
    } catch (error) {
      useUi.getState().notify("error", `Could not save settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (!settings) return <div className="page"><p className="muted">Loading settings…</p></div>;
  const p = settings.printer;
  return (
    <div className="page">
      <h1>Settings</h1>
      <div className="grid-2">
        <section className="card">
          <h2>Interface size</h2>
          <p className="muted small">Make everything bigger on a large or 4K screen. Shortcuts: Ctrl+= bigger, Ctrl+− smaller, Ctrl+Shift+0 actual size.</p>
          <label className="field inline">
            <span>Size</span>
            <select value={String(settings.uiZoom)} onChange={(e) => void update({ uiZoom: Number(e.target.value) })} data-testid="ui-zoom">
              {[...new Set([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, settings.uiZoom])].sort((a, b) => a - b).map((z) => <option key={z} value={String(z)}>{Math.round(z * 100)} %</option>)}
            </select>
          </label>
        </section>
        <section className="card">
          <h2>Modeling</h2>
          <p className="muted small">Used by the 3D Studio. All lengths are in millimetres.</p>
          <NumberField label="Grid spacing" value={settings.gridSize} step={0.1} min={0.1} max={100} unit="mm" onCommit={(v) => void update({ gridSize: v })} />
          <label className="field inline">
            <span>Snap to grid</span>
            <input type="checkbox" checked={settings.snapEnabled} onChange={(e) => void update({ snapEnabled: e.target.checked })} />
          </label>
        </section>

        <section className="card">
          <h2>3D printer</h2>
          <p className="muted small">Defaults are the Bambu Lab A1. Used for the build-volume and wall checks.</p>
          <label className="field inline">
            <span>Printer</span>
            <input key={p.name} defaultValue={p.name} maxLength={100}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) void update({ printer: { ...p, name: v } }); }} />
          </label>
          <NumberField label="Bed X" value={p.bedX} min={10} max={2000} unit="mm" onCommit={(v) => void update({ printer: { ...p, bedX: v } })} />
          <NumberField label="Bed Y" value={p.bedY} min={10} max={2000} unit="mm" onCommit={(v) => void update({ printer: { ...p, bedY: v } })} />
          <NumberField label="Height Z" value={p.bedZ} min={10} max={2000} unit="mm" onCommit={(v) => void update({ printer: { ...p, bedZ: v } })} />
          <NumberField label="Nozzle" value={p.nozzle} step={0.05} min={0.1} max={2} unit="mm" onCommit={(v) => void update({ printer: { ...p, nozzle: v } })} />
          <button className="btn plain small" onClick={() => void update({ printer: { name: "Bambu Lab A1", bedX: 256, bedY: 256, bedZ: 256, nozzle: 0.4 } })}>
            Reset to Bambu Lab A1
          </button>
        </section>
      </div>

      <div className="grid-2">
        <ClaudeCodeCard settings={settings} update={update} />
      </div>

      <div className="grid-2">
        <ProvidersCard settings={settings} update={update} secureNote={
          <>
          <p className="small">
            Secure key storage:{" "}
            {secure === null ? "checking…" : secure.available && !secure.weak ? (
              <span className="ok">available ({secure.backend})</span>
            ) : secure.weak ? (
              <span className="warn">only basic obfuscation ({secure.backend}). No system keyring is running, so API keys would not be properly encrypted.</span>
            ) : (
              <span className="warn">not available. API keys cannot be stored safely on this system.</span>
            )}
          </p>
          </>
        } />

        <section className="card">
          <h2>About</h2>
          {info && (
            <dl className="meta-list">
              <dt>Version</dt><dd>{info.version}</dd>
              <dt>Platform</dt><dd>{info.platform}</dd>
              <dt>Electron</dt><dd>{info.electron}</dd>
              <dt>Chromium</dt><dd>{info.chrome}</dd>
              <dt>Node.js</dt><dd>{info.node}</dd>
            </dl>
          )}
          <h3>Keyboard shortcuts</h3>
          <dl className="meta-list shortcuts">
            <dt>Ctrl+N / Ctrl+O</dt><dd>New / open project</dd>
            <dt>Ctrl+S / Ctrl+Shift+S</dt><dd>Save / save as</dd>
            <dt>Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y</dt><dd>Undo / redo</dd>
            <dt>Ctrl+1 … Ctrl+9, Ctrl+0</dt><dd>Switch workspace</dd>
            <dt>Ctrl+J</dt><dd>Show / hide AI panel</dd>
            <dt>Alt</dt><dd>Show the menu bar</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
