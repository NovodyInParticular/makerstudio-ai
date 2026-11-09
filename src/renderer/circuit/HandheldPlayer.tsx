// Play the Doom handheld inside MakerStudio (a PREVIEW): your PC runs an open-source Doom engine
// (downloaded on first use) and shows it on the handheld's 320 × 240 TFT. Only the buttons your
// circuit wires the way retro-go expects respond, like on the real device. No sound (the engine
// used here has none; the real handheld does).

import { useEffect, useRef, useState } from "react";
import type { DoomButton, DoomWiring } from "../../core/practice/doom";
import { drawPanel } from "../display/panel";
import type { DisplaySpec } from "../../core/display/catalog";

const SCREEN: DisplaySpec = { id: "handheld", name: "2.8\" TFT", controller: "ILI9341", width: 320, height: 240, color: "rgb565", bus: "SPI", notes: "", source: "" };
const ZOOM = 3;

/** Handheld button → Doom key (a preview mapping; retro-go's in-game menu shows the device's). */
const KEYMAP: Record<DoomButton, string> = { up: "KEY_UPARROW", down: "KEY_DOWNARROW", left: "KEY_LEFTARROW", right: "KEY_RIGHTARROW", A: "KEY_FIRE", B: "KEY_USE", START: "KEY_ENTER", SELECT: "KEY_TAB", MENU: "KEY_ESCAPE", OPTION: "KEY_SHIFT" };
/** Keyboard → handheld button. */
const KEYBOARD: Record<string, DoomButton> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Control: "A", z: "A", " ": "B", x: "B", Enter: "START", Tab: "SELECT", Escape: "MENU", Shift: "OPTION" };
const LABEL: Record<DoomButton, string> = { up: "▲", down: "▼", left: "◀", right: "▶", A: "A", B: "B", START: "Start", SELECT: "Select", MENU: "Menu", OPTION: "Option" };
const ROLE: Record<DoomButton, string> = { up: "forward", down: "back", left: "turn left", right: "turn right", A: "fire", B: "use / open doors", START: "confirm (Enter)", SELECT: "map (Tab)", MENU: "menu (Esc)", OPTION: "run (hold)" };

type Game = "shareware" | "freedoom" | { name: string; bytes: Uint8Array };

export function HandheldPlayer({ wiring, onClose }: { wiring: DoomWiring; onClose(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("");
  const [game, setGame] = useState<Game | null>(null);
  const [pressed, setPressed] = useState<Set<DoomButton>>(new Set());
  const press = useRef<(b: DoomButton, down: boolean) => void>(() => undefined);
  const canBoot = wiring.screen && wiring.sd;

  useEffect(() => {
    if (!game || !canBoot) return;
    let stop = false, timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      setStatus("Loading the Doom engine (first time: downloading about 4.6 MB)…");
      const eng = await window.makerstudio.doomEngine();
      if (!eng.ok) { setStatus(eng.error); return; }
      let wad: Uint8Array | null = null;
      if (game === "freedoom") {
        setStatus("Loading Freedoom (first time: downloading about 24 MB)…");
        const f = await window.makerstudio.doomFreedoom();
        if (!f.ok) { setStatus(f.error); return; }
        wad = f.value;
      } else if (game !== "shareware") wad = game.bytes;
      if (stop) return;
      let mem: WebAssembly.Memory | null = null;
      let width = 320, height = 200;
      const frame = new Uint8ClampedArray(SCREEN.width * SCREEN.height * 4);
      for (let a = 3; a < frame.length; a += 4) frame[a] = 255; // opaque black letterbox
      const ctx = canvas.current!.getContext("2d")!;
      const imports = {
        loading: {
          onGameInit: (w: number, h: number) => { width = w; height = h; },
          wadSizes: (countPtr: number, bytesPtr: number) => {
            if (!wad) return;
            const v = new DataView(mem!.buffer);
            v.setInt32(countPtr, 1, true);
            v.setUint32(bytesPtr, wad.length, true);
          },
          readWads: (dest: number, lengths: number) => {
            new Uint8Array(mem!.buffer, dest, wad!.length).set(wad!);
            new DataView(mem!.buffer).setInt32(lengths, wad!.length, true);
          },
        },
        ui: {
          drawFrame: (ptr: number) => {
            // The engine draws 640 × 400 (BGRA). The handheld shows Doom at 320 × 200: average each
            // block of source pixels, convert to RGBA, letterbox into the 320 × 240 screen.
            const src = new Uint8Array(mem!.buffer, ptr, width * height * 4);
            const scale = Math.min(SCREEN.width / width, SCREEN.height / height);
            const ow = Math.round(width * scale), oh = Math.round(height * scale);
            const left = Math.floor((SCREEN.width - ow) / 2), top = Math.floor((SCREEN.height - oh) / 2);
            const fx = width / ow, fy = height / oh;
            for (let y = 0; y < oh; y++) {
              const sy0 = Math.floor(y * fy), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * fy));
              for (let x = 0; x < ow; x++) {
                const sx0 = Math.floor(x * fx), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * fx));
                let r = 0, g = 0, bl = 0, n = 0;
                for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { const s4 = (yy * width + xx) * 4; r += src[s4 + 2]!; g += src[s4 + 1]!; bl += src[s4]!; n++; }
                const d = ((y + top) * SCREEN.width + x + left) * 4;
                frame[d] = r / n; frame[d + 1] = g / n; frame[d + 2] = bl / n;
              }
            }
            drawPanel(ctx, frame, SCREEN, ZOOM, "white");
          },
        },
        runtimeControl: { timeInMilliseconds: () => BigInt(Math.trunc(performance.now())) },
        console: { onInfoMessage: () => undefined, onErrorMessage: (p: number, n: number) => { const msg = new TextDecoder().decode(new Uint8Array(mem!.buffer, p, n)); setStatus(`Doom: ${msg}`); } },
        gameSaving: { sizeOfSaveGame: () => 0, readSaveGame: () => 0, writeSaveGame: () => 0 },
      };
      try {
        const { instance } = (await WebAssembly.instantiate(eng.value as BufferSource, imports)) as WebAssembly.WebAssemblyInstantiatedSource;
        const ex = instance.exports as unknown as { memory: WebAssembly.Memory; initGame(): void; tickGame(): void; reportKeyDown(k: number): void; reportKeyUp(k: number): void } & Record<string, WebAssembly.Global>;
        mem = ex.memory;
        ex.initGame();
        setStatus("");
        press.current = (b, down) => {
          if (!wiring.buttons[b]) return; // not wired: does nothing, like the real device
          const key = (ex[KEYMAP[b]] as WebAssembly.Global).value as number;
          if (down) ex.reportKeyDown(key); else ex.reportKeyUp(key);
          setPressed((p) => { const n = new Set(p); if (down) n.add(b); else n.delete(b); return n; });
        };
        timer = setInterval(() => { try { ex.tickGame(); } catch (e) { setStatus(`Doom stopped: ${e instanceof Error ? e.message : String(e)}`); if (timer) clearInterval(timer); } }, 1000 / 35);
      } catch (e) {
        setStatus(`The engine could not start: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { stop = true; if (timer) clearInterval(timer); press.current = () => undefined; };
  }, [game, canBoot, wiring]);

  useEffect(() => {
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === "Escape" && !game) { onClose(); return; }
      const b = KEYBOARD[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!b || !game) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat || !down) press.current(b, down);
    };
    const kd = key(true), ku = key(false);
    window.addEventListener("keydown", kd, true);
    window.addEventListener("keyup", ku, true);
    return () => { window.removeEventListener("keydown", kd, true); window.removeEventListener("keyup", ku, true); };
  }, [game, onClose]);

  const Btn = ({ b, className }: { b: DoomButton; className: string }) => (
    <button className={`hh-btn ${className} ${wiring.buttons[b] ? "" : "dead"} ${pressed.has(b) ? "down" : ""}`} title={wiring.buttons[b] ? `${LABEL[b]}: ${ROLE[b]}` : `${LABEL[b]} is not wired like retro-go's, so it does nothing`}
      onPointerDown={(e) => { e.preventDefault(); press.current(b, true); }} onPointerUp={() => press.current(b, false)} onPointerLeave={() => pressed.has(b) && press.current(b, false)} data-testid={`hh-${b}`}>{LABEL[b]}</button>
  );

  return (
    <div className="hh-overlay" data-testid="handheld-player">
      <div className="hh-top">
        <span className="sim-badge">Preview: your PC runs Doom; the real handheld runs retro-go on the ESP32-S3. No sound here.</span>
        <button className="btn plain small" onClick={onClose} data-testid="hh-close">Close (Esc)</button>
      </div>
      <div className="hh-body">
        <div className="hh-left">
          <div className="hh-dpad"><Btn b="up" className="up" /><Btn b="left" className="left" /><Btn b="right" className="right" /><Btn b="down" className="down" /></div>
          <div className="hh-small"><Btn b="MENU" className="pill" /><Btn b="OPTION" className="pill" /></div>
        </div>
        <div className="hh-screen-wrap">
          <canvas ref={canvas} width={SCREEN.width * ZOOM} height={SCREEN.height * ZOOM} className="hh-screen" data-testid="hh-screen" style={{ width: SCREEN.width * 2, height: SCREEN.height * 2 }} />
          {(!game || !canBoot || status) && (
            <div className="hh-screen-msg" data-testid="hh-msg">
              {!canBoot ? (
                <>
                  <b>{!wiring.screen ? "The screen stays dark." : "No game card."}</b>
                  {wiring.problems.filter((p) => p.startsWith("Screen") || p.startsWith("microSD")).map((p, i) => <div key={i} className="small">{p}</div>)}
                  <div className="small muted">Fix the wiring in Circuit Studio, like you would on the breadboard.</div>
                </>
              ) : !game ? (
                <>
                  <b>retro-go · DOOM</b>
                  <div className="small">Pick the game data on the SD card:</div>
                  <div className="button-row">
                    <button className="btn primary small" onClick={() => setGame("shareware")} data-testid="hh-shareware">DOOM shareware (Episode 1)</button>
                    <button className="btn plain small" onClick={() => setGame("freedoom")} data-testid="hh-freedoom">Freedoom (free download)</button>
                    <button className="btn plain small" onClick={async () => { const r = await window.makerstudio.doomPickWad(); if (r.ok && r.value) setGame(r.value); else if (!r.ok) setStatus(r.error); }}>My WAD…</button>
                  </div>
                </>
              ) : <span>{status}</span>}
            </div>
          )}
        </div>
        <div className="hh-right">
          <div className="hh-ab"><Btn b="B" className="round b" /><Btn b="A" className="round a" /></div>
          <div className="hh-small"><Btn b="SELECT" className="pill" /><Btn b="START" className="pill" /></div>
        </div>
      </div>
      <div className="hh-help small">
        Keys: arrows = D-pad · Ctrl or Z = A (fire) · Space or X = B (use/open) · Enter = Start · Tab = Select (map) · Esc = Menu · Shift = Option (run).
        {!wiring.sound && " · Sound would be silent on your build too: the amplifier is not wired like retro-go's."}
        <div className="muted">Engine: doom.wasm v0.1.0 (GPL-2.0, from id Software's released source) and Freedoom 0.13.0 (BSD-style), downloaded on first use and checksum-verified; not part of MakerStudio.</div>
      </div>
    </div>
  );
}
