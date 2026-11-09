// Animation timeline for a face: keyframes in rows (mood, look, blink, talk), playback,
// scrubbing, dragging keyframes, and an editor for the selected keyframe.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { blinkAt, sampleAnimation, TEMPLATES, type Animation, type Keyframe } from "../../core/display/animation";
import { addAnimation, deleteAnimation, setAnimation } from "../../core/display/commands";
import { MOODS, type FaceState, type Mood, type Screen } from "../../core/display/face";
import type { Command } from "../../core/document/commands";
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

type Row = "mood" | "look" | "blink" | "talk";
const ROWS: { row: Row; label: string; has(k: Keyframe): boolean }[] = [
  { row: "mood", label: "Mood", has: (k) => k.mood !== undefined },
  { row: "look", label: "Look", has: (k) => k.lookX !== undefined || k.lookY !== undefined },
  { row: "blink", label: "Blink", has: (k) => k.blink !== undefined },
  { row: "talk", label: "Talk", has: (k) => k.talk !== undefined },
];

/** Values a new keyframe in a row starts with: what the face shows at that moment. */
function keyFor(row: Row, t: number, s: FaceState): Keyframe {
  if (row === "mood") return { t, mood: s.mood };
  if (row === "look") return { t, lookX: round2(s.lookX), lookY: round2(s.lookY) };
  if (row === "blink") return { t, blink: round2(s.blink) };
  return { t, talk: round2(s.talk) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Plays an animation: returns the playhead time (ms) and controls. */
export function usePlayback(anim: Animation | null) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  timeRef.current = time;
  useEffect(() => { setTime(0); setPlaying(false); }, [anim?.id]);
  useEffect(() => {
    if (!playing || !anim) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      let t = timeRef.current + (now - last);
      last = now;
      if (t >= anim.duration) {
        if (anim.loop) t %= anim.duration;
        else { setTime(anim.duration); setPlaying(false); return; }
      }
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, anim]);
  return {
    time, playing, setTime: (t: number) => setTime(Math.max(0, Math.min(anim?.duration ?? 0, t))),
    play: () => { if (anim && !anim.loop && timeRef.current >= anim.duration) setTime(0); setPlaying(true); },
    pause: () => setPlaying(false),
  };
}

export function Timeline({ screen, animId, onSelect, playback, state }: {
  screen: Screen;
  animId: string | null;
  onSelect(id: string | null): void;
  playback: ReturnType<typeof usePlayback>;
  state: FaceState;
}) {
  const anims = screen.animations ?? [];
  const anim = anims.find((a) => a.id === animId) ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(null), [animId]);

  const create = (template: string) => {
    const base = template === "blank"
      ? { name: "New animation", duration: 3000, loop: false, keyframes: [] as Keyframe[] }
      : TEMPLATES.find((t) => t.name === template)!.make();
    const used = new Set(anims.map((a) => a.name));
    let name = base.name;
    for (let n = 2; used.has(name); n++) name = `${base.name} ${n}`;
    const animation: Animation = { id: newId(), ...base, name };
    if (run(addAnimation({ screenId: screen.id, animation }))) onSelect(animation.id);
  };

  if (!anim) {
    return (
      <div className="timeline" data-testid="timeline">
        <div className="timeline-bar">
          <select value="" onChange={(e) => onSelect(e.target.value || null)} data-testid="anim-select">
            <option value="">No animation (idle life)</option>
            {anims.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <span className="muted small">New animation:</span>
          {["blank", ...TEMPLATES.map((t) => t.name)].map((t) => (
            <button key={t} className="btn plain small" onClick={() => create(t)} data-testid={`anim-new-${t}`}>{t === "blank" ? "Blank" : t}</button>
          ))}
        </div>
      </div>
    );
  }

  const frames = [...anim.keyframes].sort((a, b) => a.t - b.t);
  const pct = (t: number) => `${(t / anim.duration) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    let f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    if (f > 0.985) f = 1; // easy to reach the very end and start
    if (f < 0.015) f = 0;
    return Math.round((f * anim.duration) / 10) * 10;
  };
  const save = (keyframes: Keyframe[], extra: { merge?: string; label?: string } = {}) =>
    run(setAnimation({ screenId: screen.id, animId: anim.id, keyframes, ...extra }));

  const addKey = (row: Row, t: number) => {
    const sample = sampleAnimation(anim, t, state);
    const k = keyFor(row, t, sample);
    const existing = frames.findIndex((f) => f.t === t);
    const next = existing >= 0 ? frames.map((f, i) => (i === existing ? { ...f, ...k } : f)) : [...frames, k];
    if (save(next, { label: `Add ${row} keyframe` })) setSelected(next.sort((a, b) => a.t - b.t).findIndex((f) => f.t === t));
  };

  const dragKey = (index: number, e: ReactPointerEvent) => {
    e.stopPropagation();
    setSelected(index);
    const merge = `drag-${anim.id}-${Math.random()}`;
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      const t = timeAt(ev.clientX);
      const current = [...((projectStore.getState().project.document.workspaces.displays.screens as Screen[])
        .find((s) => s.id === screen.id)?.animations?.find((a) => a.id === anim.id)?.keyframes ?? [])].sort((a, b) => a.t - b.t);
      const key = current[index];
      if (!key || key.t === t || current.some((f, i) => i !== index && f.t === t)) return;
      const next = current.map((f, i) => (i === index ? { ...f, t } : f)).sort((a, b) => a.t - b.t);
      if (save(next, { merge, label: "Move keyframe" })) {
        index = next.findIndex((f) => f.t === t);
        setSelected(index);
      }
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const key = selected !== null ? frames[selected] : undefined;
  const editKey = (patch: Partial<Keyframe> | null, removeChannels: (keyof Keyframe)[] = [], merge?: string) => {
    if (selected === null || !key) return;
    const updated: Keyframe = { ...key, ...(patch ?? {}) };
    for (const c of removeChannels) delete updated[c];
    const next = frames.map((f, i) => (i === selected ? updated : f));
    save(next, { merge, label: "Edit keyframe" });
  };

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-bar">
        <select value={anim.id} onChange={(e) => onSelect(e.target.value || null)} data-testid="anim-select">
          <option value="">No animation (idle life)</option>
          {anims.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="btn primary small" onClick={playback.playing ? playback.pause : playback.play} data-testid="anim-play">{playback.playing ? "Pause" : "Play"}</button>
        <button className="btn plain small" onClick={() => { playback.pause(); playback.setTime(0); }} title="Back to the start">Rewind</button>
        <span className="mono small" data-testid="anim-time">{(playback.time / 1000).toFixed(2)} / {(anim.duration / 1000).toFixed(1)} s</span>
        <label className="small">Length <input type="number" min={0.1} max={60} step={0.1} defaultValue={anim.duration / 1000} key={anim.id + anim.duration}
          onBlur={(e) => { const v = Math.round(Number(e.target.value) * 1000); if (v !== anim.duration) run(setAnimation({ screenId: screen.id, animId: anim.id, duration: v })); }} className="num" /> s</label>
        <label className="small"><input type="checkbox" checked={anim.loop} onChange={(e) => run(setAnimation({ screenId: screen.id, animId: anim.id, loop: e.target.checked }))} data-testid="anim-loop" /> Loop</label>
        <input className="anim-name" defaultValue={anim.name} key={anim.id + anim.name} maxLength={80} aria-label="Animation name"
          onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== anim.name) run(setAnimation({ screenId: screen.id, animId: anim.id, name: e.target.value })); }} />
        <button className="btn plain small" onClick={() => save([...frames.filter((f) => f.blink === undefined || f.t < playback.time || f.t > playback.time + 180), ...blinkAt(Math.round(playback.time / 10) * 10)].filter((f) => f.t <= anim.duration), { label: "Add blink" })} title="Add a quick blink at the playhead">+ Blink here</button>
        <button className="btn plain small danger-text" onClick={() => { if (run(deleteAnimation({ screenId: screen.id, animId: anim.id }))) onSelect(null); }}>Delete</button>
      </div>

      <div className="timeline-grid">
        <div className="timeline-labels">
          <div className="timeline-ruler-label" />
          {ROWS.map((r) => <div key={r.row} className="timeline-label">{r.label}</div>)}
        </div>
        <div className="timeline-track" ref={track}
          onPointerDown={(e) => { if (e.button === 0) { playback.pause(); playback.setTime(timeAt(e.clientX)); } }}
          data-testid="anim-track">
          <div className="timeline-ruler">
            {Array.from({ length: Math.floor(anim.duration / 500) + 1 }, (_, i) => (
              <span key={i} className={`tick ${i % 2 === 0 ? "major" : ""}`} style={{ left: pct(i * 500) }}>{i % 2 === 0 ? `${i / 2}s` : ""}</span>
            ))}
          </div>
          {ROWS.map((r) => (
            <div key={r.row} className="timeline-row" onDoubleClick={(e) => addKey(r.row, timeAt(e.clientX))} title={`Double-click to add a ${r.label.toLowerCase()} keyframe`} data-testid={`anim-row-${r.row}`}>
              {frames.map((f, i) => r.has(f) && (
                <button key={`${f.t}-${i}`} className={`keyframe ${selected === i ? "on" : ""}`} style={{ left: pct(f.t) }}
                  onPointerDown={(e) => dragKey(i, e)} onDoubleClick={(e) => e.stopPropagation()}
                  title={`${(f.t / 1000).toFixed(2)} s`} aria-label={`${r.label} keyframe at ${(f.t / 1000).toFixed(2)} seconds`} data-testid="keyframe" />
              ))}
            </div>
          ))}
          <div className="playhead" style={{ left: pct(playback.time) }} />
        </div>
      </div>

      {key && selected !== null && (
        <div className="key-editor" data-testid="key-editor">
          <b>Keyframe at</b>
          <input type="number" className="num" min={0} max={anim.duration / 1000} step={0.01} defaultValue={key.t / 1000} key={`${selected}-${key.t}`}
            onBlur={(e) => {
              const t = Math.round(Number(e.target.value) * 100) * 10;
              if (t !== key.t && !frames.some((f) => f.t === t)) { editKey({ t }); setSelected(null); }
            }} /> s
          <label><input type="checkbox" checked={key.mood !== undefined} onChange={(e) => editKey(e.target.checked ? { mood: state.mood } : null, e.target.checked ? [] : ["mood"])} /> Mood</label>
          {key.mood !== undefined && (
            <select value={key.mood} onChange={(e) => editKey({ mood: e.target.value as Mood })} data-testid="key-mood">
              {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          <label><input type="checkbox" checked={key.lookX !== undefined} onChange={(e) => editKey(e.target.checked ? { lookX: 0, lookY: 0 } : null, e.target.checked ? [] : ["lookX", "lookY"])} /> Look</label>
          {key.lookX !== undefined && (
            <>
              <input type="range" min={-1} max={1} step={0.05} value={key.lookX} onChange={(e) => editKey({ lookX: Number(e.target.value) }, [], `kx-${selected}`)} title="Left / right" />
              <input type="range" min={-1} max={1} step={0.05} value={key.lookY ?? 0} onChange={(e) => editKey({ lookY: Number(e.target.value) }, [], `ky-${selected}`)} title="Up / down" />
            </>
          )}
          <label><input type="checkbox" checked={key.blink !== undefined} onChange={(e) => editKey(e.target.checked ? { blink: 0 } : null, e.target.checked ? [] : ["blink"])} /> Blink</label>
          {key.blink !== undefined && <input type="range" min={0} max={1} step={0.05} value={key.blink} onChange={(e) => editKey({ blink: Number(e.target.value) }, [], `kb-${selected}`)} />}
          <label><input type="checkbox" checked={key.talk !== undefined} onChange={(e) => editKey(e.target.checked ? { talk: 0 } : null, e.target.checked ? [] : ["talk"])} /> Talk</label>
          {key.talk !== undefined && <input type="range" min={0} max={1} step={0.05} value={key.talk} onChange={(e) => editKey({ talk: Number(e.target.value) }, [], `kt-${selected}`)} />}
          <button className="btn plain small danger-text" onClick={() => { save(frames.filter((_, i) => i !== selected), { label: "Delete keyframe" }); setSelected(null); }} data-testid="key-delete">Delete keyframe</button>
        </div>
      )}
    </div>
  );
}
