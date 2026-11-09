// Display Studio: design robot faces for small screens and watch them come alive.

import { useEffect, useMemo, useRef, useState } from "react";
import { DISPLAYS, displayById, type DisplaySpec } from "../../core/display/catalog";
import { addScreen, deleteScreen, setFace, setScreen } from "../../core/display/commands";
import { DEFAULT_FACE, faceOps, MOODS, NEUTRAL, rasterize, type FaceSpec, type FaceState, type Mood, type Screen } from "../../core/display/face";
import type { Command } from "../../core/document/commands";
import { sampleAnimation } from "../../core/display/animation";
import { newId } from "../../shared/format";
import { projectStore, useProject, useUi } from "../state";
import { ExportPanel } from "./ExportPanel";
import { useAlive } from "./useAlive";
import { Timeline, usePlayback } from "./Timeline";
import { DeviceFrame } from "./DeviceFrame";
import { drawPanel, OLED_TINTS, type OledTint } from "./panel";

function run(command: Command): boolean {
  try {
    projectStore.getState().execute(command);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Original starting points for a face.
const PRESETS: { name: string; face: Partial<FaceSpec> }[] = [
  { name: "Friendly", face: {} },
  { name: "Robot", face: { eyeShape: "rounded", eyeWidth: 0.16, eyeHeight: 0.3, eyeRound: 0.35, eyeSpacing: 0.4, eyeY: 0.45, mouth: "none", foreground: "#2fd6a3" } },
  { name: "Big eyes", face: { eyeShape: "round", eyeWidth: 0.2, eyeHeight: 0.34, eyeSpacing: 0.46, eyeY: 0.42, pupil: 0.45, mouth: "smile", mouthWidth: 0.14, mouthY: 0.78, foreground: "#f4f6f8", cheeks: "#e86fa5" } },
  { name: "Pixel pal", face: { eyeShape: "rect", eyeWidth: 0.08, eyeHeight: 0.2, eyeSpacing: 0.36, eyeY: 0.4, mouth: "smile", mouthWidth: 0.22, mouthThickness: 0.035, foreground: "#f2b84b" } },
];

const MOOD_LABEL: Record<Mood, string> = { neutral: "Neutral", happy: "Happy", sad: "Sad", angry: "Angry", sleepy: "Sleepy", surprised: "Surprised" };

// --- preview -----------------------------------------------------------------------

function Preview({ screen, display, state }: { screen: Screen; display: DisplaySpec; state: FaceState }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [grid, setGrid] = useState(false);
  const [look, setLook] = useState<"real" | "pixels">(() => { try { return localStorage.getItem("ms-display-look") === "pixels" ? "pixels" : "real"; } catch { return "real"; } });
  const [tint, setTint] = useState<OledTint>(() => { try { return (localStorage.getItem("ms-oled-tint") as OledTint) || "white"; } catch { return "white"; } });
  useEffect(() => { try { localStorage.setItem("ms-display-look", look); localStorage.setItem("ms-oled-tint", tint); } catch { /* preference only */ } }, [look, tint]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const real = look === "real";
  // Room for the module around the screen in the realistic view.
  const fx = real ? 1.45 : 1, fy = real ? 1.9 : 1;
  // Whole-number zoom keeps every display pixel the same size (pixel-accurate).
  const zoom = Math.max(1, Math.floor(Math.min((size.w - 48) / (display.width * fx), (size.h - 64) / (display.height * fy))));
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const px = rasterize(faceOps(screen.face, display, state), display);
    const ctx = c.getContext("2d")!;
    if (real) {
      drawPanel(ctx, px, display, zoom, tint);
      return;
    }
    const native = new OffscreenCanvas(display.width, display.height);
    native.getContext("2d")!.putImageData(new ImageData(px, display.width, display.height), 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(native, 0, 0, display.width * zoom, display.height * zoom);
    if (grid && zoom >= 4) {
      ctx.strokeStyle = "rgba(128,128,128,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < display.width; x++) { ctx.moveTo(x * zoom + 0.5, 0); ctx.lineTo(x * zoom + 0.5, display.height * zoom); }
      for (let y = 1; y < display.height; y++) { ctx.moveTo(0, y * zoom + 0.5); ctx.lineTo(display.width * zoom, y * zoom + 0.5); }
      ctx.stroke();
    }
  }, [screen.face, display, state, zoom, grid, real, tint]);
  const W = display.width * zoom, H = display.height * zoom;
  const cv = <canvas ref={canvas} width={W} height={H} data-testid="face-canvas" style={display.round ? { borderRadius: "50%" } : undefined} />;
  return (
    <div className="face-stage" ref={box}>
      {real ? <DeviceFrame display={display} width={W} height={H}>{cv}</DeviceFrame> : <div className={`face-bezel ${display.round ? "round" : ""}`}>{cv}</div>}
      <div className="face-stage-info muted small">
        <div className="seg" role="group" aria-label="Preview look">
          <button className={real ? "on" : ""} onClick={() => setLook("real")} data-testid="look-real" title="How it looks on the real part">Realistic</button>
          <button className={!real ? "on" : ""} onClick={() => setLook("pixels")} data-testid="look-pixels" title="Exact pixels, for editing">Pixels</button>
        </div>
        <span>{display.width} × {display.height} px · {display.color === "mono" ? "monochrome OLED" : "colour"} · shown at {zoom}×</span>
        {real && display.color === "mono" && (
          <select value={tint} onChange={(e) => setTint(e.target.value as OledTint)} data-testid="oled-tint" title="Panel colour (single-colour OLED modules come in several colours)">
            {OLED_TINTS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        )}
        {!real && zoom >= 4 && <label className="grid-toggle"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> pixel grid</label>}
      </div>
      {real && <div className="muted small face-note">Typical look of the module; boards differ between sellers. Pixels mode shows the exact image the code draws.</div>}
    </div>
  );
}

// --- inspector controls ---------------------------------------------------------------

function Slider({ screen, field, label, min, max, step = 0.005, unit = "%", scale = 100 }: {
  screen: Screen; field: keyof FaceSpec; label: string; min: number; max: number; step?: number; unit?: string; scale?: number;
}) {
  const value = screen.face[field] as number;
  const [drag] = useState(() => `${field}-${Math.random()}`);
  return (
    <label className="slider-row">
      <span>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => run(setFace({ id: screen.id, face: { [field]: Number(e.target.value) }, merge: `${screen.id}-${drag}` }))}
        data-testid={`face-${field}`}
      />
      <span className="mono small">{Math.round(value * scale)}{unit}</span>
    </label>
  );
}

function Inspector({ screen, display }: { screen: Screen; display: DisplaySpec }) {
  const f = screen.face;
  const set = (face: Partial<FaceSpec>) => run(setFace({ id: screen.id, face }));
  return (
    <aside className="inspector display-inspector" data-testid="face-inspector">
      <section>
        <h4>Screen</h4>
        <label className="field">
          <span>Name</span>
          <input defaultValue={screen.name} key={screen.id + screen.name} maxLength={120}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== screen.name) run(setScreen({ id: screen.id, name: e.target.value })); }} />
        </label>
        <label className="field">
          <span>Display</span>
          <select value={screen.display} onChange={(e) => run(setScreen({ id: screen.id, display: e.target.value }))} data-testid="face-display">
            {DISPLAYS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <p className="muted small">{display.controller} · {display.bus}. {display.notes} <i>Source: {display.source}.</i></p>
      </section>
      <section>
        <h4>Start from</h4>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button key={p.name} className="btn plain small" onClick={() => set({ ...DEFAULT_FACE, ...p.face })}>{p.name}</button>
          ))}
        </div>
      </section>
      <section>
        <h4>Eyes</h4>
        <div className="seg">
          {(["round", "rounded", "rect"] as const).map((s) => (
            <button key={s} className={f.eyeShape === s ? "on" : ""} onClick={() => set({ eyeShape: s })}>{s === "rect" ? "Square" : s === "round" ? "Round" : "Rounded"}</button>
          ))}
        </div>
        <Slider screen={screen} field="eyeWidth" label="Width" min={0.03} max={0.45} />
        <Slider screen={screen} field="eyeHeight" label="Height" min={0.03} max={0.9} />
        {f.eyeShape === "rounded" && <Slider screen={screen} field="eyeRound" label="Corners" min={0} max={1} step={0.05} />}
        <Slider screen={screen} field="eyeSpacing" label="Apart" min={0.05} max={0.9} />
        <Slider screen={screen} field="eyeY" label="Height on face" min={0.1} max={0.9} />
        <Slider screen={screen} field="pupil" label="Pupils" min={0} max={0.9} step={0.05} />
      </section>
      <section>
        <h4>Mouth</h4>
        <div className="seg">
          {(["none", "line", "smile", "open"] as const).map((m) => (
            <button key={m} className={f.mouth === m ? "on" : ""} onClick={() => set({ mouth: m })}>{m[0]!.toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        {f.mouth !== "none" && (
          <>
            <Slider screen={screen} field="mouthWidth" label="Width" min={0.03} max={0.8} />
            <Slider screen={screen} field="mouthY" label="Height on face" min={0.1} max={0.98} />
            <Slider screen={screen} field="mouthThickness" label="Thickness" min={0.005} max={0.15} />
          </>
        )}
      </section>
      <section>
        <h4>Colours</h4>
        {display.color === "mono" ? (
          <p className="muted small">This display is monochrome: lit pixels and dark pixels only.</p>
        ) : (
          <div className="colour-row">
            <label>Face <input type="color" value={f.foreground} onChange={(e) => set({ foreground: e.target.value })} /></label>
            <label>Background <input type="color" value={f.background} onChange={(e) => set({ background: e.target.value })} /></label>
            <label>Cheeks <input type="checkbox" checked={f.cheeks !== ""} onChange={(e) => set({ cheeks: e.target.checked ? "#e86fa5" : "" })} />
              {f.cheeks && <input type="color" value={f.cheeks} onChange={(e) => set({ cheeks: e.target.value })} />}</label>
          </div>
        )}
      </section>
      <ExportPanel screen={screen} />
    </aside>
  );
}

// --- workspace -----------------------------------------------------------------------

export function DisplayWorkspace() {
  const list = useProject((s) => s.project.document.workspaces.displays.screens as Screen[]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>("neutral");
  const [alive, setAlive] = useState(true);
  const [talking, setTalking] = useState(false);
  const [newDisplay, setNewDisplay] = useState("m5stack-cores3");
  const screen = list.find((s) => s.id === selected) ?? list[0] ?? null;
  const display = useMemo(() => (screen ? displayById(screen.display) ?? DISPLAYS[0]! : DISPLAYS[0]!), [screen]);
  const [animId, setAnimId] = useState<string | null>(null);
  const anim = screen?.animations?.find((a) => a.id === animId) ?? null;
  const playback = usePlayback(anim);
  const idle = useAlive(alive && screen !== null && !anim, talking, mood);
  const state = anim ? sampleAnimation(anim, playback.time) : idle;
  useEffect(() => setAnimId(null), [screen?.id]);

  const create = () => {
    const d = displayById(newDisplay)!;
    const used = new Set(list.map((s) => s.name));
    let n = 1;
    while (used.has(`Face ${n}`)) n++;
    const s: Screen = { id: newId(), name: `Face ${n}`, display: d.id, face: { ...DEFAULT_FACE } };
    if (run(addScreen({ screen: s }))) setSelected(s.id);
  };

  return (
    <div className="display-workspace" data-testid="display-workspace">
      <div className="cad-left">
        <section className="cad-section">
          <h4>New face</h4>
          <label className="field">
            <span>Display</span>
            <select value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} data-testid="new-face-display">
              {DISPLAYS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button className="btn primary small" onClick={create} data-testid="new-face">Add face</button>
        </section>
        <section className="cad-section grow">
          <h4>Screens <span className="muted">({list.length})</span></h4>
          {list.length === 0 ? <p className="muted small">No faces yet. Pick a display and add one.</p> : (
            <ul className="tree" data-testid="screen-list">
              {list.map((s) => (
                <li key={s.id} className={`tree-row ${screen?.id === s.id ? "selected" : ""}`} onClick={() => setSelected(s.id)} data-testid="screen-row">
                  <span className="tree-name">{s.name}</span>
                  <span className="muted small">{displayById(s.display)?.width}×{displayById(s.display)?.height}</span>
                  <button className="eye" title="Delete" aria-label={`Delete ${s.name}`} onClick={(e) => { e.stopPropagation(); run(deleteScreen({ id: s.id })); }}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="cad-center">
        {screen ? (
          <>
            {!anim && (
              <div className="viewport-toolbar">
                <div className="seg" role="group" aria-label="Mood">
                  {MOODS.map((m) => (
                    <button key={m} className={mood === m ? "on" : ""} onClick={() => setMood(m)} data-testid={`mood-${m}`}>{MOOD_LABEL[m]}</button>
                  ))}
                </div>
                <div className="seg">
                  <button className={alive ? "on" : ""} onClick={() => setAlive(!alive)} title="Blink and look around on its own" data-testid="face-alive">Alive</button>
                  <button className={talking ? "on" : ""} onClick={() => setTalking(!talking)} title="Move the mouth as if talking" data-testid="face-talk">Talk</button>
                </div>
              </div>
            )}
            <Preview screen={screen} display={display} state={state} />
            <Timeline screen={screen} animId={anim?.id ?? null} onSelect={setAnimId} playback={playback} state={state} />
          </>
        ) : (
          <div className="empty-state">
            <h3>Give your robot a face</h3>
            <p className="muted">Pick the display your robot uses on the left (for a Stack-chan style robot: M5Stack CoreS3), then Add face.</p>
          </div>
        )}
      </div>
      {screen && <Inspector screen={screen} display={display} />}
    </div>
  );
}
