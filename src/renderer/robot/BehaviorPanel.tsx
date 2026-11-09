// Behaviour editor: a list of steps (with repeats inside), run live on the 3D robot.

import { useEffect, useRef, useState } from "react";
import type { Animation } from "../../core/display/animation";
import { MOODS, type Mood, type Screen } from "../../core/display/face";
import type { Command } from "../../core/document/commands";
import { BehaviorRunner, behaviorTemplates, MAX_NESTING, type Behavior, type RobotOutput, type Step } from "../../core/robot/behavior";
import { addBehavior, deleteBehavior, setBehavior } from "../../core/robot/commands";
import type { Robot } from "../../core/robot/model";
import { newId } from "../../shared/format";
import { projectStore, useUi } from "../state";

function run(command: Command): boolean {
  try {
    projectStore.getState().execute(command);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

const KIND_LABEL: Record<Step["kind"], string> = {
  mood: "Mood", look: "Look", move: "Move joint", animation: "Face animation", talk: "Talk", blink: "Blink", wait: "Wait", repeat: "Repeat",
};

function newStep(kind: Step["kind"], robot: Robot | null, screens: Screen[]): Step | null {
  switch (kind) {
    case "mood": return { kind, mood: "happy" };
    case "look": return { kind, x: 0, y: 0, ms: 400, wait: true };
    case "move": {
      const j = robot?.joints[0];
      return j ? { kind, joint: j.id, angle: Math.round(j.max / 2), ms: 600, wait: true } : null;
    }
    case "animation": {
      const s = screens.find((x) => x.animations?.length);
      return s ? { kind, screen: s.id, animation: s.animations![0]!.id, wait: true } : null;
    }
    case "talk": return { kind, ms: 1000, wait: true };
    case "blink": return { kind };
    case "wait": return { kind, ms: 500 };
    case "repeat": return { kind, times: 2, steps: [] };
  }
}

function Ms({ value, onChange, label = "for" }: { value: number; onChange(v: number): void; label?: string }) {
  return (
    <label className="step-field">{label}
      <input type="number" min={0} max={60} step={0.1} defaultValue={value / 1000} key={value}
        onBlur={(e) => { const v = Math.round(Math.max(0, Math.min(60, Number(e.target.value))) * 1000); if (v !== value) onChange(v); }} /> s
    </label>
  );
}

function Continue({ wait, onChange }: { wait: boolean; onChange(v: boolean): void }) {
  return (
    <label className="step-field" title="Start this and go straight on to the next step (they happen together)">
      <input type="checkbox" checked={!wait} onChange={(e) => onChange(!e.target.checked)} /> and go on
    </label>
  );
}

function StepList({ steps, depth, robot, screens, onChange }: {
  steps: Step[]; depth: number; robot: Robot | null; screens: Screen[]; onChange(steps: Step[]): void;
}) {
  const update = (i: number, step: Step) => onChange(steps.map((s, k) => (k === i ? step : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const animations = screens.flatMap((s) => (s.animations ?? []).map((a) => ({ value: `${s.id}/${a.id}`, label: screens.length > 1 ? `${s.name}: ${a.name}` : a.name })));
  const kinds = (Object.keys(KIND_LABEL) as Step["kind"][]).filter((k) => !(k === "repeat" && depth >= MAX_NESTING));
  return (
    <ol className="step-list">
      {steps.map((step, i) => (
        <li key={i} className={`step step-${step.kind}`} data-testid="step">
          <div className="step-row">
            <b>{KIND_LABEL[step.kind]}</b>
            {step.kind === "mood" && (
              <select value={step.mood} onChange={(e) => update(i, { ...step, mood: e.target.value as Mood })}>
                {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {step.kind === "look" && (
              <>
                <label className="step-field">left / right <input type="range" min={-1} max={1} step={0.1} value={step.x} onChange={(e) => update(i, { ...step, x: Number(e.target.value) })} /></label>
                <label className="step-field">up / down <input type="range" min={-1} max={1} step={0.1} value={step.y} onChange={(e) => update(i, { ...step, y: Number(e.target.value) })} /></label>
                <Ms value={step.ms} label="over" onChange={(ms) => update(i, { ...step, ms })} />
                <Continue wait={step.wait} onChange={(wait) => update(i, { ...step, wait })} />
              </>
            )}
            {step.kind === "move" && (
              <>
                <select value={step.joint} onChange={(e) => update(i, { ...step, joint: e.target.value })}>
                  {!robot?.joints.some((j) => j.id === step.joint) && <option value={step.joint}>(deleted joint)</option>}
                  {robot?.joints.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
                <label className="step-field">to
                  <input type="number" min={-180} max={180} step={1} defaultValue={step.angle} key={step.angle}
                    onBlur={(e) => { const v = Math.max(-180, Math.min(180, Math.round(Number(e.target.value)))); if (v !== step.angle) update(i, { ...step, angle: v }); }} data-testid="step-angle" />°
                </label>
                <Ms value={step.ms} label="over" onChange={(ms) => update(i, { ...step, ms })} />
                <Continue wait={step.wait} onChange={(wait) => update(i, { ...step, wait })} />
              </>
            )}
            {step.kind === "animation" && (
              <>
                <select value={`${step.screen}/${step.animation}`} onChange={(e) => { const [screen, animation] = e.target.value.split("/"); update(i, { ...step, screen: screen!, animation: animation! }); }}>
                  {!animations.some((a) => a.value === `${step.screen}/${step.animation}`) && <option value={`${step.screen}/${step.animation}`}>(deleted animation)</option>}
                  {animations.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                <Continue wait={step.wait} onChange={(wait) => update(i, { ...step, wait })} />
              </>
            )}
            {step.kind === "talk" && (<><Ms value={step.ms} onChange={(ms) => update(i, { ...step, ms })} /><Continue wait={step.wait} onChange={(wait) => update(i, { ...step, wait })} /></>)}
            {step.kind === "wait" && <Ms value={step.ms} onChange={(ms) => update(i, { ...step, ms })} />}
            {step.kind === "repeat" && (
              <label className="step-field">
                <input type="number" min={0} max={1000} defaultValue={step.times} key={step.times} className="times"
                  onBlur={(e) => { const v = Math.max(0, Math.min(1000, Math.round(Number(e.target.value)))); if (v !== step.times) update(i, { ...step, times: v }); }} />
                times {step.times === 0 && <span className="muted">(forever)</span>}
              </label>
            )}
            <span className="step-tools">
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move step up">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down" aria-label="Move step down">▼</button>
              <button onClick={() => onChange(steps.filter((_, k) => k !== i))} title="Delete step" aria-label="Delete step" data-testid="step-delete">✕</button>
            </span>
          </div>
          {step.kind === "repeat" && (
            <StepList steps={step.steps} depth={depth + 1} robot={robot} screens={screens} onChange={(inner) => update(i, { ...step, steps: inner })} />
          )}
        </li>
      ))}
      <li className="step-add">
        <select value="" onChange={(e) => {
          const s = newStep(e.target.value as Step["kind"], robot, screens);
          if (s) onChange([...steps, s]);
          else useUi.getState().notify("info", e.target.value === "move" ? "Add a joint first (select a part, then Add joint to part)." : "Make a face animation in Display Studio first.");
        }} data-testid={`add-step-${depth}`}>
          <option value="">+ Add step…</option>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </li>
    </ol>
  );
}

export function BehaviorPanel({ robot, screens, onRun }: { robot: Robot | null; screens: Screen[]; onRun(output: RobotOutput | null): void }) {
  const behaviors = robot?.behaviors ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const behavior = behaviors.find((b) => b.id === selected) ?? behaviors[0] ?? null;
  const [running, setRunning] = useState(false);
  const runner = useRef<BehaviorRunner | null>(null);

  useEffect(() => {
    if (!running || !behavior) return;
    const find = (screenId: string, animId: string): Animation | undefined => screens.find((s) => s.id === screenId)?.animations?.find((a) => a.id === animId);
    runner.current = new BehaviorRunner(behavior, robot, find);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const r = runner.current!;
      r.advanceTo(now - start);
      const out = r.output();
      onRun(out);
      if (out.done) { setRunning(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, behavior?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!running) onRun(null); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = (template: string) => {
    const base = template === "blank" ? { name: "New behaviour", idle: true, steps: [] as Step[] } : behaviorTemplates(robot).find((t) => t.name === template)!.make();
    const used = new Set(behaviors.map((b) => b.name));
    let name = base.name;
    for (let n = 2; used.has(name); n++) name = `${base.name} ${n}`;
    const b: Behavior = { id: newId(), ...base, name };
    if (run(addBehavior({ behavior: b }))) { setSelected(b.id); setRunning(false); }
  };
  const change = (changes: Partial<Behavior>, label?: string) => behavior && run(setBehavior({ id: behavior.id, changes, label }));

  return (
    <div className="behavior-panel" data-testid="behavior-panel">
      <div className="timeline-bar">
        <b className="small">Behaviour</b>
        {behaviors.length > 0 && (
          <select value={behavior?.id ?? ""} onChange={(e) => { setRunning(false); setSelected(e.target.value); }} data-testid="behavior-select">
            {behaviors.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {behavior && (
          <>
            <button className="btn primary small" onClick={() => setRunning(!running)} data-testid="behavior-run">{running ? "Stop" : "Run"}</button>
            <input className="anim-name" defaultValue={behavior.name} key={behavior.id + behavior.name} maxLength={80} aria-label="Behaviour name"
              onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== behavior.name) change({ name: e.target.value.trim() }); }} />
            <label className="small" title="Blink and glance around on its own between steps"><input type="checkbox" checked={behavior.idle} onChange={(e) => change({ idle: e.target.checked })} /> Idle life</label>
            <button className="btn plain small danger-text" onClick={() => { setRunning(false); run(deleteBehavior({ id: behavior.id })); setSelected(null); }}>Delete</button>
          </>
        )}
        <span className="muted small">New:</span>
        {["blank", ...behaviorTemplates(robot).map((t) => t.name)].map((t) => (
          <button key={t} className="btn plain small" onClick={() => create(t)} data-testid={`behavior-new-${t}`}>{t === "blank" ? "Blank" : t}</button>
        ))}
      </div>
      {behavior ? (
        <StepList steps={behavior.steps} depth={0} robot={robot} screens={screens} onChange={(steps) => { setRunning(false); change({ steps }, "Edit steps"); }} />
      ) : (
        <p className="muted small">A behaviour is a list of steps your robot follows: change mood, look somewhere, move a joint, play a face animation, talk, wait, repeat. Start with a ready-made one above.</p>
      )}
    </div>
  );
}
