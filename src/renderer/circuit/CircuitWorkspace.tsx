// Circuit Studio: wire parts and boards together, with live electrical checks.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { COMPONENTS, componentDef, type ComponentDef, type PinDef } from "../../core/circuit/catalog";
import { checkCircuit, isBreadboard, pluggedPins, type Finding } from "../../core/circuit/checks";
import { addMany, addPart, addWire, deleteParts, deleteWires, updatePart } from "../../core/circuit/commands";
import { robotCircuit, robotWiringBoards } from "../../core/circuit/fromRobot";
import type { Screen } from "../../core/display/face";
import { robotOf } from "../../core/robot/commands";
import { partLayout, placedPins, wireRoute } from "../../core/circuit/layout";
import type { CircuitComponent, Wire } from "../../core/circuit/schema";
import type { Command } from "../../core/document/commands";
import { newId } from "../../shared/format";
import { ART_TOP, PartArt, PartDefs } from "./PartArt";
import { HandheldPlayer } from "./HandheldPlayer";
import { doomWiring } from "../../core/practice/doom";
import { fmtAmps, fmtVolts, runCode, setGpio, simulate, stopCode, useSim } from "./simulate";
import { setSketch, sketchOf } from "../../core/circuit/commands";
import { MODEL_NOTES } from "../../core/circuit/spice";
import { pinKey } from "../../core/circuit/checks";
import { projectStore, useProject, useUi } from "../state";

const GRID = 10; // px per grid unit (0.1 inch) at zoom 1

function run(command: Command): boolean {
  try {
    projectStore.getState().execute(command);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function roleText(pin: PinDef): string {
  const r = pin.role;
  const src = (s: { status: string; source: string }) => (s.status === "verified" ? `verified: ${s.source}` : `estimated: ${s.source}`);
  switch (r.kind) {
    case "ground": return "Ground (GND)";
    case "supply": return `Power out ${r.volts.value} V (${src(r.volts)})${r.maxCurrent ? `, up to about ${Math.round(r.maxCurrent.value * 1000)} mA (${src(r.maxCurrent)})` : ""}`;
    case "power-in": return `Power in ${r.min.value}-${r.max.value} V (${src(r.min)})`;
    case "gpio": return `GPIO, ${r.logic.value} V logic (${src(r.logic)})${r.note ? `. ${r.note}` : ""}`;
    case "signal-in": return `Signal input${r.note ? ` (${r.note})` : ""}`;
    case "other": return r.note;
    default: return "";
  }
}

const WIRE_COLORS = ["#f2b84b", "#22b8c9", "#8f7cf0", "#2fd6a3", "#e86fa5", "#ff5d73", "#e3e8ec", "#8b97a5"];
function autoColor(def: ComponentDef | undefined, pin: string, n: number): string {
  const role = def?.pins.find((p) => p.id === pin)?.role.kind;
  if (role === "supply" || (def?.electrical.kind === "battery" && pin === "+")) return "#ff5d73";
  if (role === "ground") return "#8b97a5";
  return WIRE_COLORS[n % 4]!;
}

const BLINK_PICO = `// Runs on the simulated Raspberry Pi Pico: real compiled code (Arduino), emulated RP2040 (rp2040js).
// Wire an LED (with a resistor) from GP15 to GND, press Run code and watch it blink.

void setup() {
  pinMode(15, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(15, HIGH);
  Serial.println("on");
  delay(500);
  digitalWrite(15, LOW);
  delay(500);
}
`;

const BLINK = `// Runs on the simulated Arduino Uno: real compiled code, emulated chip (avr8js).
// Wire an LED (with a resistor) from pin 13 to GND, press Run code and watch it blink.

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("Hello from the Uno!");
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

function CodePanel({ board }: { board: CircuitComponent }) {
  const sim = useSim();
  const kind = board.type === "raspberry-pi-pico" ? "pico" : "uno";
  const saved = useProject((s) => sketchOf(s.project, board.id));
  const [text, setText] = useState(saved ?? (kind === "pico" ? BLINK_PICO : BLINK));
  useEffect(() => { if (saved !== undefined) setText(saved); }, [board.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const serialRef = useRef<HTMLPreElement>(null);
  const code = sim.code?.board === board.id ? sim.code : null;
  useEffect(() => { if (serialRef.current) serialRef.current.scrollTop = serialRef.current.scrollHeight; }, [code?.serial]);
  const save = (v: string) => { setText(v); if (v !== saved) run(setSketch({ id: board.id, code: v })); };
  return (
    <section data-testid="code-panel">
      <h4>Code · {board.label}</h4>
      <textarea className="code-editor" spellCheck={false} value={text} rows={14} data-testid="code-editor"
        onChange={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Tab") { e.preventDefault(); const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd; const v = text.slice(0, a) + "  " + text.slice(b); save(v); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; }); }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); useSim.setState({ on: true }); void runCode(board.id, text, kind); }
        }} />
      <div className="button-row">
        {code && code.status !== "error"
          ? <button className="btn plain" onClick={stopCode} data-testid="code-stop">■ Stop</button>
          : <button className="btn primary" onClick={() => { useSim.setState({ on: true }); void runCode(board.id, text, kind); }} data-testid="code-run">▶ Run code</button>}
        <span className="small muted" data-testid="code-status">
          {!code ? "Ctrl+Enter runs it." : code.status === "compiling" ? "Compiling with PlatformIO…" : code.status === "running" ? `Running · ${Math.round(code.speed * 100)} % speed${code.size && code.size !== "(cached)" ? "" : ""}` : "Could not run"}
        </span>
      </div>
      {code?.status === "error" && <div className="print-issue error small" data-testid="code-errors">{code.errors.map((e, i) => <div key={i} className="mono">{e}</div>)}</div>}
      {code && code.status !== "error" && (
        <>
          <div className="small muted">Serial monitor</div>
          <pre className="serial-out" ref={serialRef} data-testid="code-serial">{code.serial || " "}</pre>
        </>
      )}
      <p className="muted small">The real compiled program runs on an emulated {kind === "pico" ? "RP2040 (rp2040js; Serial is its USB serial)" : "ATmega328P (avr8js)"}; its pins drive the SPICE circuit and read voltages back (digitalRead, analogRead). PWM is averaged; no timing below about 16 ms is shown.</p>
    </section>
  );
}

function SimSummary({ components, wires }: { components: CircuitComponent[]; wires: Wire[] }) {
  const sim = useSim();
  const r = sim.result!;
  const wiredPins = new Set(wires.flatMap((w) => [w.from, w.to]).map((e) => pinKey(e.component, e.pin)));
  const boards = components.filter((c) => componentDef(c.type)?.electrical.kind === "board");
  const leds = components.flatMap((c) => {
    const e = componentDef(c.type)?.electrical;
    if (e?.kind === "led") return [{ c, pin: undefined as string | undefined }];
    if (e?.kind === "led-array") return e.channels.map((ch) => ({ c, pin: ch.pin as string | undefined }));
    return [];
  });
  return (
    <div className="sim-readout">
      {boards.map((b) => {
        const def = componentDef(b.type)!;
        const pins = def.pins.filter((p) => p.role.kind === "gpio" && wiredPins.has(pinKey(b.id, p.id)));
        if (!pins.length) return <div key={b.id} className="muted small">{b.label}: wire a GPIO pin to control it here.</div>;
        if (sim.code?.board === b.id && sim.code.status === "running") {
          return (
            <div key={b.id}>
              <div className="small"><b>{b.label} pins (driven by your code)</b></div>
              {pins.map((p) => {
                const rep = sim.code!.pins[p.id];
                const v = r.volts(b.id, p.id);
                const what = !rep ? "?" : rep.mode !== "output" ? (rep.mode === "pullup" ? "input (pull-up)" : "input") : rep.duty >= 0.98 ? "HIGH" : rep.duty <= 0.02 ? "LOW" : `PWM ${Math.round(rep.duty * 100)} %`;
                return <div key={p.id} className="gpio-row small"><span className="mono">{p.name.split(" (")[0]}</span><b data-testid={`code-pin-${p.id}`}>{what}</b>{v !== null && <span className="muted">{fmtVolts(v)}</span>}</div>;
              })}
            </div>
          );
        }
        return (
          <div key={b.id}>
            <div className="small"><b>{b.label} pins</b></div>
            {pins.map((p) => {
              const key = pinKey(b.id, p.id), state = sim.gpio[key] ?? "input", i = r.sourceCurrent(b.id, p.id);
              return (
                <div key={p.id} className="gpio-row small">
                  <span className="mono">{p.name.split(" (")[0]}</span>
                  <span className="seg">{(["high", "low", "input"] as const).map((s) => <button key={s} className={state === s ? "on" : ""} onClick={() => setGpio(key, s)} data-testid={`gpio-${p.id}-${s}`}>{s === "input" ? "IN" : s.toUpperCase()}</button>)}</span>
                  {i !== null && Math.abs(i) > 1e-6 && <span className="muted">{fmtAmps(Math.abs(i))}</span>}
                </div>
              );
            })}
          </div>
        );
      })}
      {leds.length > 0 && <div className="small"><b>LEDs</b></div>}
      {leds.map(({ c, pin }) => {
        const i = r.ledCurrent(c.id, pin) ?? 0;
        return <div key={`${c.id}-${pin}`} className="small">{c.label}{pin ? ` ${pin}` : ""}: <b data-testid={`sim-led-${c.label}${pin ? `-${pin}` : ""}`}>{fmtAmps(i)}</b> {i > 0.0005 ? (i > 0.025 ? "· brighter than its rating" : "· lit") : "· off"}</div>;
      })}
    </div>
  );
}

function SimReadout({ c, def, wires }: { c: CircuitComponent; def: ComponentDef; wires: Wire[] }) {
  const sim = useSim();
  const r = sim.result!;
  const k = def.electrical.kind;
  const wired = new Set(wires.flatMap((w) => [w.from, w.to]).filter((e) => e.component === c.id).map((e) => e.pin));
  return (
    <div className="sim-readout" data-testid="sim-readout">
      {(k === "led" || k === "led-array") && (def.electrical.kind === "led-array" ? def.electrical.channels.map((ch) => ch.pin) : [undefined]).map((pin) => (
        <div key={pin ?? "led"} className="small">LED{pin ? ` ${pin}` : ""} current: <b data-testid="sim-led-current">{fmtAmps(r.ledCurrent(c.id, pin) ?? 0)}</b></div>
      ))}
      {k !== "board" && k !== "breadboard" && def.pins.length <= 6 && def.pins.map((p) => { const v = r.volts(c.id, p.id); return v === null ? null : <div key={p.id} className="small mono">{p.name.split(" (")[0]}: {fmtVolts(v)}</div>; })}
      {k === "battery" && <div className="small">Delivering: <b>{fmtAmps(r.sourceCurrent(c.id, "+") ?? 0)}</b></div>}
      {k === "board" && (
        <>
          <div className="small"><b>Pins (set what your code would do):</b></div>
          {def.pins.filter((p) => p.role.kind === "gpio" && wired.has(p.id)).map((p) => {
            const key = pinKey(c.id, p.id), state = sim.gpio[key] ?? "input";
            const i = r.sourceCurrent(c.id, p.id);
            return (
              <div key={p.id} className="gpio-row small">
                <span className="mono">{p.name.split(" (")[0]}</span>
                <span className="seg">{(["high", "low", "input"] as const).map((s) => <button key={s} className={state === s ? "on" : ""} onClick={() => setGpio(key, s)} data-testid={`gpio-${p.id}-${s}`}>{s === "input" ? "IN" : s.toUpperCase()}</button>)}</span>
                {i !== null && <span className="muted">{fmtAmps(i)}</span>}
              </div>
            );
          })}
          {def.pins.filter((p) => p.role.kind === "gpio" && wired.has(p.id)).length === 0 && <p className="muted small">Wire a GPIO pin to see its controls here.</p>}
          {def.pins.filter((p) => p.role.kind === "supply").map((p) => { const i = r.sourceCurrent(c.id, p.id); return i && Math.abs(i) > 1e-6 ? <div key={p.id} className="small">{p.name} delivers {fmtAmps(i)}</div> : null; })}
        </>
      )}
    </div>
  );
}

type Drag = { kind: "part"; id: string; dx: number; dy: number; merge: string } | { kind: "pan"; x: number; y: number; ox: number; oy: number };

export function CircuitWorkspace() {
  const components = useProject((s) => s.project.document.workspaces.circuit.components as CircuitComponent[]);
  const wires = useProject((s) => s.project.document.workspaces.circuit.wires as Wire[]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  const [pending, setPending] = useState<{ component: string; pin: string } | null>(null);
  const [mouse, setMouse] = useState<[number, number]>([0, 0]);
  const [view, setView] = useState({ x: 40, y: 40, zoom: 1.6 });
  const [hoverPin, setHoverPin] = useState<{ text: string; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const drag = useRef<Drag | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // While code runs, its input pins are known: output-only warnings do not apply to them.
  const codeInputs = useSim((s) => (s.code?.status === "running" ? Object.entries(s.code.pins).filter(([, r]) => r.mode !== "output").map(([p]) => `${s.code!.board}:${p}`).sort().join(",") : ""));
  const report = useMemo(() => checkCircuit(components, wires, new Set(codeInputs ? codeInputs.split(",") : [])), [components, wires, codeInputs]);
  const sim = useSim();
  const [playing, setPlaying] = useState(false);
  const doom = useMemo(() => (components.some((c) => c.type === "esp32-s3-devkitc-1") && components.some((c) => c.type === "tft-ili9341") ? doomWiring(components, wires) : null), [components, wires]);
  const [dangerOk, setDangerOk] = useState(false);
  const hasDanger = report.findings.some((f) => f.severity === "danger");
  useEffect(() => {
    if (!sim.on) return;
    const t = setTimeout(() => void simulate(components, wires), 120);
    return () => clearTimeout(t);
  }, [sim.on, components, wires, sim.gpio, sim.code?.pins, sim.code?.status]);
  const powerOn = () => {
    if (hasDanger && !dangerOk) {
      useUi.getState().setDialog({
        title: "The checks found a Danger",
        message: "For example a short circuit. The simulation will show what happens, but a real circuit wired like this could be damaged, get hot or start a fire. Simulate anyway?",
        buttons: [{ label: "Cancel", value: "cancel", variant: "plain" }, { label: "Simulate anyway", value: "go", variant: "danger" }],
        resolve: ({ button }) => { useUi.getState().setDialog(null); if (button === "go") { setDangerOk(true); useSim.setState({ on: true }); } },
      });
      return;
    }
    useSim.setState({ on: true });
  };
  // Breadboards underneath everything; parts whose legs sit in holes are plugged in.
  const drawOrder = useMemo(() => [...components].sort((a, b) => Number(isBreadboard(b.type)) - Number(isBreadboard(a.type))), [components]);
  const { plugged, liveHoles } = useMemo(() => {
    const plugs = pluggedPins(components);
    const used = new Map<string, Set<string>>();
    for (const w of wires) for (const end of [w.from, w.to]) if (isBreadboard(components.find((c) => c.id === end.component)?.type ?? "")) {
      if (!used.has(end.component)) used.set(end.component, new Set());
      used.get(end.component)!.add(end.pin);
    }
    for (const p of plugs) { if (!used.has(p.board)) used.set(p.board, new Set()); used.get(p.board)!.add(p.hole); }
    // Light up every hole in a strip that has something in it.
    const live = new Map<string, Set<string>>();
    for (const [board, holes] of used) {
      const def = componentDef(components.find((c) => c.id === board)!.type);
      if (def?.electrical.kind !== "breadboard") continue;
      const set = new Set<string>();
      for (const strip of def.electrical.strips) if (strip.some((h) => holes.has(h))) strip.forEach((h) => set.add(h));
      live.set(board, set);
    }
    return { plugged: new Set(plugs.map((p) => `${p.component}:${p.pin}`)), liveHoles: live };
  }, [components, wires]);
  const robot = useProject((s) => robotOf(s.project));
  const screens = useProject((s) => s.project.document.workspaces.displays.screens as Screen[]);
  const wiringBoards = robotWiringBoards();
  // Start on the board already in the circuit (if it can be wired automatically).
  const [robotBoard, setRobotBoard] = useState(() => components.find((c) => wiringBoards.some((b) => b.id === c.type))?.type ?? wiringBoards[0]!.id);

  /** Zooms and pans so these parts (with their labels and pin names) fill the canvas. */
  const fitTo = (parts: CircuitComponent[]) => {
    if (!parts.length || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const minX = Math.min(...parts.map((c) => c.x)) - 4, minY = Math.min(...parts.map((c) => c.y)) - 4;
    const maxX = Math.max(...parts.map((c) => c.x + partLayout(c.type).w)) + 6, maxY = Math.max(...parts.map((c) => c.y + partLayout(c.type).h)) + 4;
    const zoom = Math.max(0.4, Math.min(3, Math.min(r.width / ((maxX - minX) * GRID), r.height / ((maxY - minY) * GRID))));
    setView({ zoom, x: (r.width - (maxX - minX) * GRID * zoom) / 2 - minX * GRID * zoom, y: (r.height - (maxY - minY) * GRID * zoom) / 2 - minY * GRID * zoom });
  };

  // Show the whole circuit when a project is opened (and when coming back to this studio).
  const projectId = useProject((s) => s.project.document.id);
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitTo(components));
    return () => cancelAnimationFrame(frame);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const wireRobot = () => {
    if (!robot) return;
    // Put the new parts to the right of everything already on the canvas.
    const right = components.reduce((m, c) => Math.max(m, c.x + partLayout(c.type).w), 0);
    const top = components.length ? Math.min(...components.map((c) => c.y)) : 0;
    let result;
    try {
      result = robotCircuit(robot, screens, robotBoard, newId, [components.length ? right + 12 : 4, top + 4]);
    } catch (error) {
      useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
      return;
    }
    if (result.components.length && run(addMany({ components: result.components, wires: result.wires, label: "Wire my robot" }))) {
      fitTo(result.components);
      useUi.getState().notify("success", [`Wired ${robot.name}: ${result.components.length} parts, ${result.wires.length} wires (one undo step).`, ...result.notes].join(" "));
    }
  };
  const flagged = useMemo(() => {
    const m = new Map<string, Finding["severity"]>();
    for (const f of report.findings) for (const id of f.components) if (f.severity !== "info" && (!m.has(id) || f.severity === "danger")) m.set(id, f.severity);
    return m;
  }, [report]);

  const toGrid = (clientX: number, clientY: number): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [(clientX - r.left - view.x) / (GRID * view.zoom), (clientY - r.top - view.y) / (GRID * view.zoom)];
  };

  /** A free spot for a part that is fully visible; zooms out when nothing fits. Returns the spot and the view to use. */
  const findSpot = (type: string): { x: number; y: number; view: typeof view } => {
    const L = partLayout(type);
    const r = svg.current!.getBoundingClientRect();
    const free = (x: number, y: number) => !components.some((o) => {
      const OL = partLayout(o.type);
      return x < o.x + OL.w + 4 && x + L.w + 4 > o.x && y < o.y + OL.h + 3 && y + L.h + 3 > o.y;
    });
    let v = view;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = GRID * v.zoom;
      const left = Math.ceil(-v.x / scale + 2), top = Math.ceil(-v.y / scale + 2);
      const right = Math.floor((r.width - v.x) / scale - 2), bottom = Math.floor((r.height - v.y) / scale - 2);
      for (let y = top; y + L.h <= bottom; y += 2) {
        for (let x = left; x + L.w <= right; x += 2) if (free(x, y)) return { x, y, view: v };
      }
      // Nothing fits: zoom out around the top-left corner and try again.
      const zoom = Math.max(0.4, v.zoom / 1.35);
      if (zoom === v.zoom) break;
      v = { ...v, zoom };
    }
    return { x: Math.round(-v.x / (GRID * v.zoom) + 2), y: Math.round(-v.y / (GRID * v.zoom) + 2), view: v };
  };

  const place = (type: string, at?: [number, number]) => {
    const def = componentDef(type)!;
    const used = new Set(components.map((c) => c.label));
    const base = def.electrical.kind === "board" ? def.name : def.name.split(" (")[0]!.split(" /")[0]!;
    let label = base;
    for (let n = 2; used.has(label); n++) label = `${base} ${n}`;
    const L = partLayout(type);
    let x: number, y: number;
    if (at) {
      x = Math.round(at[0] - L.w / 2);
      y = Math.round(at[1] - L.h / 2);
    } else {
      const spot = findSpot(type);
      x = spot.x;
      y = spot.y;
      if (spot.view !== view) setView(spot.view);
    }
    const c: CircuitComponent = {
      id: newId(), type, label, rotation: 0, x, y,
      props: Object.fromEntries(def.props.map((p) => [p.key, p.default])),
    };
    if (run(addPart({ component: c }))) { setSelected(c.id); setSelectedWire(null); }
  };

  const clickPin = (component: string, pin: string) => {
    if (!pending) { setPending({ component, pin }); return; }
    if (pending.component === component && pending.pin === pin) { setPending(null); return; }
    const def = componentDef(components.find((c) => c.id === pending.component)!.type);
    const color = autoColor(def, pending.pin, wires.length);
    const other = componentDef(components.find((c) => c.id === component)!.type);
    const finalColor = color === WIRE_COLORS[wires.length % 4] ? autoColor(other, pin, wires.length) : color;
    run(addWire({ wire: { id: newId(), from: pending, to: { component, pin }, color: finalColor } }));
    setPending(null);
  };

  useEffect(() => {
    const end = () => { drag.current = null; };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") { setPending(null); setSelected(null); setSelectedWire(null); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) { run(deleteParts({ ids: [selected] })); setSelected(null); }
        else if (selectedWire) { run(deleteWires({ ids: [selectedWire] })); setSelectedWire(null); }
      }
      if ((e.key === "r" || e.key === "R") && selected && !e.ctrlKey) {
        const c = components.find((x) => x.id === selected);
        if (c) run(updatePart({ id: c.id, changes: { rotation: ((c.rotation + 90) % 360) as CircuitComponent["rotation"] } }));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, selectedWire, components]);

  const onPointerMove = (e: ReactPointerEvent) => {
    setMouse(toGrid(e.clientX, e.clientY));
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
    else {
      const [gx, gy] = toGrid(e.clientX, e.clientY);
      const c = components.find((x) => x.id === d.id);
      const nx = Math.round(gx - d.dx), ny = Math.round(gy - d.dy);
      if (c && (c.x !== nx || c.y !== ny)) run(updatePart({ id: d.id, changes: { x: nx, y: ny }, merge: d.merge }));
    }
  };

  const pins = new Map(components.map((c) => [c.id, new Map(placedPins(c).map((p) => [p.id, p]))]));
  const pendingSpot = pending ? pins.get(pending.component)?.get(pending.pin) : undefined;
  const sel = components.find((c) => c.id === selected);
  const selDef = sel ? componentDef(sel.type) : undefined;
  const categories = [...new Set(COMPONENTS.map((c) => c.category))];

  return (
    <div className="display-workspace" data-testid="circuit-workspace">
      <div className="cad-left">
        {robot && (robot.joints.length > 0 || robot.mounts.length > 0) && (
          <section className="cad-section" data-testid="wire-robot">
            <h4>Wire my robot</h4>
            <label className="field"><span>Board</span>
              <select value={robotBoard} onChange={(e) => setRobotBoard(e.target.value)} data-testid="wire-robot-board">
                {wiringBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <button className="btn primary small" onClick={wireRobot} data-testid="wire-robot-go">Add the robot's wiring</button>
            <p className="muted small">Servos from your joints (on their own 5 V supply, grounds joined) and an I²C screen, ready for the checks.</p>
          </section>
        )}
        <section className="cad-section grow">
          <h4>Parts</h4>
          {categories.map((cat) => (
            <div key={cat} className="palette-group">
              <div className="muted small">{cat}</div>
              {COMPONENTS.filter((c) => c.category === cat).map((c) => (
                <button key={c.id} className="palette-item" draggable onDragStart={(e) => e.dataTransfer.setData("application/x-makerstudio-part", c.id)}
                  onClick={() => place(c.id)} title={c.notes || c.name} data-testid={`part-${c.id}`}>{c.name}</button>
              ))}
            </div>
          ))}
        </section>
      </div>
      <div className="cad-center">
        <div className="viewport-toolbar">
          <div className="seg"><button onClick={() => fitTo(components)} title="Show all parts" data-testid="circuit-fit">Fit</button></div>
          <div className="seg">
            <button className={sim.on ? "on" : ""} onClick={() => { if (sim.on) { stopCode(); useSim.setState({ on: false, result: null }); } else powerOn(); }} data-testid="sim-power" title="Simulate the circuit with SPICE (ngspice)">
              {sim.on ? "■ Power off" : "▶ Power on"}
            </button>
          </div>
          {doom && <div className="seg"><button onClick={() => setPlaying(true)} data-testid="hh-play" title="Play the handheld (preview): only what you wired like retro-go works">🎮 Play</button></div>}
          {sim.on && <span className="sim-badge" data-testid="sim-badge">{sim.error ? "Simulation failed" : !sim.result ? "Simulating…" : sim.code?.status === "running" ? (sim.code.kind === "pico" ? "Emulated Pico (rp2040js) + SPICE" : "Emulated Uno (avr8js) + SPICE") : "Simulated (SPICE · ngspice)"}</span>}
          <span className="muted small">
            {pending ? "Now click the pin to connect to (Esc cancels)." : "Click a pin, then another pin, to connect them. Drag parts to move; R rotates; Delete removes."}
          </span>
        </div>
        <svg ref={svg} className="circuit-canvas" data-testid="circuit-canvas"
          onPointerDown={(e) => { if (e.target === svg.current) { drag.current = { kind: "pan", x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }; setSelected(null); setSelectedWire(null); } }}
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => {
            const r = svg.current!.getBoundingClientRect();
            const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            setView((v) => {
              const zoom = Math.min(6, Math.max(0.4, v.zoom * f));
              const px = e.clientX - r.left, py = e.clientY - r.top;
              return { zoom, x: px - ((px - v.x) * zoom) / v.zoom, y: py - ((py - v.y) * zoom) / v.zoom };
            });
          }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-makerstudio-part")) e.preventDefault(); }}
          onDrop={(e) => { const t = e.dataTransfer.getData("application/x-makerstudio-part"); if (t) { e.preventDefault(); place(t, toGrid(e.clientX, e.clientY)); } }}
        >
          <defs>
            <pattern id="grid" width={GRID * view.zoom} height={GRID * view.zoom} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
              <circle cx={1} cy={1} r={0.8} fill="#232a33" />
            </pattern>
            <PartDefs />
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />
          <g transform={`translate(${view.x} ${view.y}) scale(${GRID * view.zoom})`}>
            {drawOrder.map((c) => {
              const def = componentDef(c.type);
              if (!def) return null;
              const L = partLayout(c.type);
              const flag = flagged.get(c.id);
              const lit = highlight.includes(c.id);
              return (
                <g key={c.id} data-testid="circuit-part" data-part={c.label}>
                  <g transform={`rotate(${c.rotation} ${c.x + L.w / 2} ${c.y + L.h / 2}) translate(${c.x} ${c.y})`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected(c.id); setSelectedWire(null);
                      const [gx, gy] = toGrid(e.clientX, e.clientY);
                      drag.current = { kind: "part", id: c.id, dx: gx - c.x, dy: gy - c.y, merge: `move-${c.id}-${Date.now()}` };
                    }}
                    style={{ cursor: "move" }}
                  >
                    <rect x={-0.6} y={-0.6} width={L.w + 1.2} height={L.h + 1.2} rx={0.8} fill="transparent"
                      stroke={lit ? "#f2b84b" : flag === "danger" ? "#ff5d73" : flag === "warning" ? "#f2b84b" : selected === c.id ? "#2fd6a3" : "transparent"} strokeWidth={0.2} strokeDasharray={flag && !lit && selected !== c.id ? "0.6 0.4" : undefined} />
                    <PartArt c={c} def={def} glow={sim.on && sim.result ? (pin) => sim.result!.ledCurrent(c.id, pin) ?? 0 : undefined} />
                  </g>
                  <text x={c.x + L.w / 2} y={c.y - 1 - (c.rotation === 0 ? ART_TOP[c.type] ?? 0 : 0)} fontSize={1} fill="var(--text-muted)" textAnchor="middle">{c.label}</text>
                </g>
              );
            })}
            {wires.map((w) => {
              const a = pins.get(w.from.component)?.get(w.from.pin), b = pins.get(w.to.component)?.get(w.to.pin);
              if (!a || !b) return null;
              const pts = wireRoute(a, b).map(([x, y]) => `${x},${y}`).join(" ");
              return (
                <g key={w.id} onPointerDown={(e) => { e.stopPropagation(); setSelectedWire(w.id); setSelected(null); }} data-testid="wire">
                  <polyline points={pts} fill="none" stroke="transparent" strokeWidth={0.7} />
                  <polyline points={pts} fill="none" stroke={w.color} strokeWidth={selectedWire === w.id ? 0.42 : 0.28} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
            {drawOrder.map((c) => {
              const def = componentDef(c.type);
              if (!def) return null;
              const bb = def.electrical.kind === "breadboard";
              const labelled = def.electrical.kind === "board" || partLayout(c.type).pins.length > 2;
              return (
                <g key={`pins-${c.id}`}>
                  {placedPins(c).map((p) => {
                    const pinDef = def.pins.find((x) => x.id === p.id)!;
                    const isPending = pending?.component === c.id && pending.pin === p.id;
                    const hover = () => ({ onPointerEnter: (e: ReactPointerEvent) => {
                      const v = sim.on && sim.result ? sim.result.volts(c.id, p.id) : null;
                      setHoverPin({ text: `${c.label} · ${pinDef.name}${v !== null ? ` · ${fmtVolts(v)} (to GND)` : bb ? "" : `: ${roleText(pinDef)}`}`, x: e.clientX, y: e.clientY });
                    }, onPointerLeave: () => setHoverPin(null) });
                    if (bb) {
                      const live = liveHoles.get(c.id)?.has(p.id);
                      return (
                        <rect key={p.id} x={p.cx - 0.24} y={p.cy - 0.24} width={0.48} height={0.48} rx={0.06}
                          className="circuit-pin bb-hole" fill={isPending ? "#2fd6a3" : live ? "#2e9e45" : "#3a3a36"} stroke={live ? "#8fe3a8" : "none"} strokeWidth={0.06}
                          onPointerDown={(e) => { e.stopPropagation(); clickPin(c.id, p.id); }} {...hover()} data-testid={`pin-${c.label}-${p.id}`} />
                      );
                    }
                    const off = p.side === "bottom" ? [0, -0.75] : p.side === "top" ? [0, 1.25] : p.side === "left" ? [0.6, 0.3] : [-0.6, 0.3];
                    return (
                      <g key={p.id}>
                        {labelled && (
                          <text x={p.cx + off[0]!} y={p.cy + off[1]!} fontSize={p.side === "bottom" || p.side === "top" ? 0.55 : 0.8} fill="#f4f6f8" stroke="#0b0e10" strokeWidth={0.12} paintOrder="stroke"
                            textAnchor={p.side === "left" ? "start" : p.side === "right" ? "end" : "middle"} pointerEvents="none">{pinDef.name.split(" (")[0]}</text>
                        )}
                        <circle cx={p.cx} cy={p.cy} r={isPending ? 0.5 : 0.34} className="circuit-pin" fill={isPending ? "#2fd6a3" : plugged.has(`${c.id}:${p.id}`) ? "#d7dce1" : "#c9a227"} stroke="#0b0e10" strokeWidth={0.08}
                          onPointerDown={(e) => { e.stopPropagation(); clickPin(c.id, p.id); }} {...hover()}
                          data-testid={`pin-${c.label}-${p.id}`} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {pendingSpot && <line x1={pendingSpot.cx} y1={pendingSpot.cy} x2={mouse[0]} y2={mouse[1]} stroke="#2fd6a3" strokeWidth={0.2} strokeDasharray="0.6 0.4" pointerEvents="none" />}
          </g>
        </svg>
        {hoverPin && <div className="pin-tip" style={{ left: hoverPin.x + 14, top: hoverPin.y + 14 }}>{hoverPin.text}</div>}
      </div>
      <aside className="inspector display-inspector">
        {sel && selDef ? (
          <section data-testid="part-inspector">
            <h4>{selDef.name}</h4>
            <label className="field"><span>Label</span>
              <input defaultValue={sel.label} key={sel.id + sel.label} maxLength={60} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sel.label) run(updatePart({ id: sel.id, changes: { label: v } })); }} />
            </label>
            {selDef.props.map((p) => (
              <label key={p.key} className="field"><span>{p.label}{p.unit ? ` (${p.unit})` : ""}</span>
                {p.kind === "number" ? (
                  <input type="number" min={p.min} max={p.max} defaultValue={Number(sel.props[p.key])} key={`${sel.id}-${p.key}-${sel.props[p.key]}`} data-testid={`prop-${p.key}`}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== sel.props[p.key]) run(updatePart({ id: sel.id, changes: { props: { [p.key]: v } } })); }} />
                ) : p.kind === "choice" ? (
                  <select value={String(sel.props[p.key])} onChange={(e) => run(updatePart({ id: sel.id, changes: { props: { [p.key]: e.target.value } } }))} data-testid={`prop-${p.key}`}>
                    {p.choices!.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input type="checkbox" checked={Boolean(sel.props[p.key])} onChange={(e) => run(updatePart({ id: sel.id, changes: { props: { [p.key]: e.target.checked } } }))} data-testid={`prop-${p.key}`} />
                )}
              </label>
            ))}
            {sim.on && sim.result && <SimReadout c={sel} def={selDef} wires={wires} />}
            {selDef.notes && <p className="muted small">{selDef.notes}</p>}
            {selDef.source && <p className="muted small"><i>Pins from: {selDef.source}.</i></p>}
            <div className="button-row">
              <button className="btn plain small" onClick={() => run(updatePart({ id: sel.id, changes: { rotation: ((sel.rotation + 90) % 360) as CircuitComponent["rotation"] } }))}>Rotate (R)</button>
              <button className="btn plain small danger-text" onClick={() => { run(deleteParts({ ids: [sel.id] })); setSelected(null); }}>Delete</button>
            </div>
          </section>
        ) : null}
        {components.filter((c) => c.type === "arduino-uno-r3" || c.type === "raspberry-pi-pico").slice(0, 1).map((b) => <CodePanel key={b.id} board={b} />)}
        {sim.on && (
          <section data-testid="sim-panel">
            <h4>Simulation</h4>
            {sim.error ? <p className="warn small">{sim.error}</p> : <p className="small">Hover a pin to read its voltage. Set each board pin the way your code would, and watch the LEDs.</p>}
            {sim.result && <SimSummary components={components} wires={wires} />}
            {sim.build && sim.build.notModelled.length > 0 && <p className="muted small">Not simulated (no electrical model yet): {sim.build.notModelled.map((id) => components.find((c) => c.id === id)?.label).join(", ")}.</p>}
            <p className="muted small">Generic models, DC operating point only: no heat, battery drain, timing or wear. {MODEL_NOTES.board}</p>
          </section>
        )}
        <section data-testid="circuit-checks">
          <h4>Checks</h4>
          <p className={`small check-summary ${report.findings.some((f) => f.severity === "danger") ? "danger" : report.findings.some((f) => f.severity === "warning") ? "warning" : ""}`} data-testid="check-summary">{report.summary}</p>
          {report.findings.map((f, i) => (
            <div key={i} className={`print-issue ${f.severity === "danger" ? "error" : f.severity}`} data-testid={`finding-${f.rule}`}
              onPointerEnter={() => setHighlight(f.components)} onPointerLeave={() => setHighlight([])} onClick={() => f.components[0] && setSelected(f.components[0])}>
              <b>{f.severity === "danger" ? "Danger" : f.severity === "warning" ? "Warning" : "Note"}:</b> {f.message}
              <div className="muted">Fix: {f.fix}</div>
            </div>
          ))}
          <p className="muted small">These checks reduce mistakes; they cannot prove a circuit is safe.</p>
        </section>
      </aside>
      {playing && doom && <HandheldPlayer wiring={doom} onClose={() => setPlaying(false)} />}
    </div>
  );
}
