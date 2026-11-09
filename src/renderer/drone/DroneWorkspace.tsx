// Drone Studio: is the design going to fly (weight, balance, thrust, flight time from the 3D
// Studio frame and the parts), and then fly it in the simulator.

import { useEffect, useMemo, useState } from "react";
import { cadObjects } from "../../core/cad/commands";
import type { CadObject } from "../../core/cad/model";
import { analyseDrone, type DroneReport } from "../../core/drone/analysis";
import { droneOf, guessMotors, newDroneDesign, setDrone } from "../../core/drone/commands";
import { FIVE_INCH, MICRO, quadX, type Drone } from "../../core/drone/model";
import { projectStore, useProject, useUi } from "../state";
import { run, useCad } from "../cad/cadState";
import { DroneFlight } from "./DroneFlight";
import { DRONE_BOARDS, droneCodeProject, newWifiPassword, type ImuFacing } from "../../core/drone/firmware";
import { droneCircuit } from "../../core/circuit/fromDrone";
import { addMany } from "../../core/circuit/commands";
import { partLayout } from "../../core/circuit/layout";
import { newId } from "../../shared/format";

const fmt = (n: number, d = 1) => (Number.isFinite(n) ? (Math.round(n * 10 ** d) / 10 ** d).toString() : "–");

function Num({ label, value, unit, onCommit, min, max, step, note, testid }: { label: string; value: number; unit?: string; onCommit(v: number): void; min?: number; max?: number; step?: number; note?: string; testid?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.trim().replace(",", "."));
    if (!Number.isFinite(n) || text.trim() === "" || (min !== undefined && n < min) || (max !== undefined && n > max)) { setText(String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="drone-num">
      <span>{label}{note && <span className="estimate" title={note}> est.</span>}</span>
      <span className="drone-num-input">
        <input value={text} inputMode="decimal" step={step} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(String(value)); (e.target as HTMLInputElement).blur(); } }} data-testid={testid} />
        {unit && <span className="muted small">{unit}</span>}
      </span>
    </label>
  );
}

const WEIGH = "Typical value for a 1S micro drone: weigh your part (a 0.1 g kitchen scale) and enter it.";

function DesignPanel({ drone, objects }: { drone: Drone; objects: CadObject[] }) {
  const set = (patch: Partial<Drone>, label: string, merge?: string) => run(setDrone({ drone: { ...drone, ...patch }, label, merge }));
  const roots = objects.filter((o) => o.parentId === null && o.visible);
  const [diagonal, setDiagonal] = useState(() => Math.round(Math.hypot(drone.motors[0]!.position[0] - drone.motors[2]!.position[0], drone.motors[0]!.position[1] - drone.motors[2]!.position[1])) || 120);
  const toggleFrame = (id: string) => {
    const all = drone.frame.length ? drone.frame : roots.map((o) => o.id);
    const next = all.includes(id) ? all.filter((x) => x !== id) : [...all, id];
    set({ frame: next.length === roots.length ? [] : next }, "Choose frame parts");
  };
  const inFrame = (id: string) => !drone.frame.length || drone.frame.includes(id);
  return (
    <aside className="drone-design" data-testid="drone-design">
      <section>
        <h4>Frame (from 3D Studio)</h4>
        {roots.length === 0 ? <p className="muted small">No 3D objects yet: design the frame in 3D Studio.</p> : (
          <ul className="drone-frame-list">
            {roots.map((o) => (
              <li key={o.id}><label><input type="checkbox" checked={inFrame(o.id)} onChange={() => toggleFrame(o.id)} /> {o.name}</label></li>
            ))}
          </ul>
        )}
        <Num label="Material density" value={drone.density} unit="g/cm³" min={0.1} max={10} note="PLA is about 1.24 g/cm³ (check your filament's datasheet)" onCommit={(v) => set({ density: v }, "Change material density")} />
        <Num label="Fill (100 = solid)" value={drone.fill} unit="%" min={5} max={100} onCommit={(v) => set({ fill: v }, "Change print fill")} />
      </section>
      <section>
        <h4>Motors ({drone.motors.length})</h4>
        <table className="drone-motors" data-testid="drone-motors">
          <thead><tr><th>#</th><th>X</th><th>Y</th><th>Z</th><th>Spin</th></tr></thead>
          <tbody>
            {drone.motors.map((m, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {[0, 1, 2].map((k) => (
                  <td key={k}><Num label="" value={Math.round(m.position[k]! * 10) / 10} onCommit={(v) => set({ motors: drone.motors.map((x, j) => (j === i ? { ...x, position: x.position.map((p, q) => (q === k ? v : p)) as [number, number, number] } : x)) }, "Move motor")} /></td>
                ))}
                <td><button className="btn plain small" title="Propeller spin seen from above" onClick={() => set({ motors: drone.motors.map((x, j) => (j === i ? { ...x, spin: (x.spin === 1 ? -1 : 1) as 1 | -1 } : x)) }, "Change propeller spin")}>{m.spin === 1 ? "↺ CCW" : "↻ CW"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="drone-row">
          <button className="btn plain small" onClick={() => { const g = guessMotors(objects); set({ motors: g.motors }, "Find motor mounts"); useUi.getState().notify("info", `Motors placed from ${g.from}.`); }} data-testid="drone-find-motors">Find motor mounts</button>
          <span className="muted small">or X quad, diagonal</span>
          <input className="drone-small" value={diagonal} onChange={(e) => setDiagonal(Number(e.target.value) || 0)} />
          <button className="btn plain small" onClick={() => { if (diagonal >= 40) { const c = drone.motors.reduce((s, m) => [s[0]! + m.position[0] / drone.motors.length, s[1]! + m.position[1] / drone.motors.length], [0, 0]); set({ motors: quadX(diagonal, [c[0]!, c[1]!], drone.motors[0]!.position[2]) }, "Place motors as an X quad"); } }}>Place</button>
        </div>
        <p className="muted small">X / Y / Z in mm, 3D Studio coordinates; front is −Y. Diagonal motors spin the same way.</p>
      </section>
      <section>
        <h4>Motor and propeller</h4>
        <label className="drone-num"><span>Motor type</span>
          <select value={drone.motorType ?? "brushed"} onChange={(e) => set({ motorType: e.target.value as "brushed" | "esc" }, "Change motor type")} data-testid="drone-motor-type">
            <option value="brushed">Brushed (MOSFET), micro</option>
            <option value="esc">Brushless (ESC), bigger</option>
          </select>
        </label>
        <div className="drone-row">
          <span className="muted small">Start from typical values:</span>
          <button className="btn plain small" onClick={() => set({ ...MICRO }, "Use micro drone values")} title="1S, 8520 brushed motors, 55 mm propellers (estimates)">Micro 1S</button>
          <button className="btn plain small" onClick={() => { set({ ...FIVE_INCH }, "Use 5-inch brushless values"); useUi.getState().notify("info", "5-inch brushless values set (estimates: check your motor's thrust table and weigh your parts). Brushless propellers are dangerous: bench tests with the propellers off."); }} title="4S, 2207 brushless motors, 5-inch propellers (estimates)" data-testid="drone-preset-5inch">5-inch brushless</button>
        </div>
        <Num label="Motor mass" value={drone.motorMass} unit="g" min={0} max={500} note={WEIGH} onCommit={(v) => set({ motorMass: v }, "Change motor mass", "motorMass")} testid="drone-motor-mass" />
        <Num label="Max thrust per motor" value={drone.maxThrust} unit="g" min={1} max={5000} note="Typical for an 8520 motor with a 55-65 mm propeller on 1S. Measure yours: motor on a kitchen scale, full throttle, propeller pushing down." onCommit={(v) => set({ maxThrust: v }, "Change motor thrust", "maxThrust")} testid="drone-thrust" />
        <Num label="Propeller diameter" value={drone.propDiameter} unit="mm" min={10} max={500} onCommit={(v) => set({ propDiameter: v }, "Change propeller size")} />
        <Num label="Propeller mass" value={drone.propMass} unit="g" min={0} max={200} note={WEIGH} onCommit={(v) => set({ propMass: v }, "Change propeller mass")} />
        <Num label="Thrust per watt" value={drone.efficiency} unit="g/W" min={0.5} max={20} note="Typical for small brushed motors; only used for the flight time estimate." onCommit={(v) => set({ efficiency: v }, "Change efficiency")} />
      </section>
      <section>
        <h4>Battery</h4>
        <Num label="Cells (S)" value={drone.battery.cells} min={1} max={6} onCommit={(v) => set({ battery: { ...drone.battery, cells: Math.round(v) } }, "Change battery")} />
        <Num label="Capacity" value={drone.battery.capacity} unit="mAh" min={20} max={20000} onCommit={(v) => set({ battery: { ...drone.battery, capacity: v } }, "Change battery")} />
        <Num label="Mass" value={drone.battery.mass} unit="g" min={0} max={5000} note={WEIGH} onCommit={(v) => set({ battery: { ...drone.battery, mass: v } }, "Change battery")} testid="drone-battery-mass" />
      </section>
      <section>
        <h4>Other parts</h4>
        {drone.extras.map((e, i) => (
          <div key={i} className="drone-extra">
            <input value={e.name} onChange={(ev) => set({ extras: drone.extras.map((x, j) => (j === i ? { ...x, name: ev.target.value || x.name } : x)) }, "Rename part", `extra-name-${i}`)} />
            <Num label="" value={e.mass} unit="g" min={0} max={5000} note={WEIGH} onCommit={(v) => set({ extras: drone.extras.map((x, j) => (j === i ? { ...x, mass: v } : x)) }, "Change part mass")} />
            <button className="link-btn small" onClick={() => set({ extras: drone.extras.filter((_, j) => j !== i) }, "Remove part")} title="Remove">✕</button>
          </div>
        ))}
        <button className="btn plain small" disabled={drone.extras.length >= 30} onClick={() => set({ extras: [...drone.extras, { name: "Part", mass: 1, position: null }] }, "Add part")}>Add part</button>
        <p className="muted small">Parts without a place sit in the middle of the motors. "est." = typical value: weigh yours.</p>
      </section>
    </aside>
  );
}

const VERDICT_ICON = { good: "✓", warning: "!", danger: "✕" } as const;

function TopView({ drone, report }: { drone: Drone; report: DroneReport }) {
  const pts = drone.motors.map((m) => m.position);
  const r = drone.propDiameter / 2;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - r - 10, maxX = Math.max(...xs) + r + 10, minY = Math.min(...ys) - r - 10, maxY = Math.max(...ys) + r + 10;
  const c = report.total.centre;
  const mc = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
  return (
    <svg className="drone-topview" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} data-testid="drone-topview">
      <text x={(minX + maxX) / 2} y={minY + 7} fontSize={6} textAnchor="middle" fill="var(--text-muted)">front</text>
      {pts.map((p, i) => <line key={`a${i}`} x1={mc[0]} y1={mc[1]} x2={p[0]} y2={p[1]} stroke="var(--border)" strokeWidth={2} />)}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={r} fill={drone.motors[i]!.spin === 1 ? "rgba(47,214,163,.12)" : "rgba(34,184,201,.12)"} stroke={drone.motors[i]!.spin === 1 ? "#2fd6a3" : "#22b8c9"} strokeWidth={0.8} />
          <circle cx={p[0]} cy={p[1]} r={3} fill="#9aa5ae" />
          <text x={p[0]} y={p[1] - r * 0.45} fontSize={7} textAnchor="middle" fill="var(--text)">{i + 1} {drone.motors[i]!.spin === 1 ? "↺" : "↻"}</text>
        </g>
      ))}
      <circle cx={mc[0]} cy={mc[1]} r={2.2} fill="none" stroke="var(--text-muted)" strokeWidth={0.8} />
      <circle cx={c[0]} cy={c[1]} r={3} fill="#f2b84b" data-testid="drone-cog" />
      <text x={c[0] + 5} y={c[1] + 2} fontSize={5.5} fill="#f2b84b">centre of mass</text>
    </svg>
  );
}

function Report({ drone, report }: { drone: Drone; report: DroneReport }) {
  return (
    <div className="drone-report" data-testid="drone-report">
      <div className="drone-stats">
        <div><b data-testid="drone-total-mass">{fmt(report.total.mass)} g</b><span>total weight</span></div>
        <div><b data-testid="drone-twr">{fmt(report.thrustToWeight, 2)}</b><span>thrust-to-weight</span></div>
        <div><b>{fmt(report.hoverThrottle * 100, 0)} %</b><span>hover throttle</span></div>
        <div><b>{fmt(report.flightMinutes)} min</b><span>hover time (estimate)</span></div>
      </div>
      <ul className="drone-findings">
        {report.findings.map((f, i) => (
          <li key={i} className={`drone-finding ${f.verdict}`} data-testid={`drone-finding-${f.verdict}`}>
            <span className="drone-verdict">{VERDICT_ICON[f.verdict]}</span>
            <div><b>{f.title}</b><div className="muted small">{f.detail}</div></div>
          </li>
        ))}
      </ul>
      <div className="drone-report-row">
        <TopView drone={drone} report={report} />
        <table className="drone-mass-table">
          <thead><tr><th>Part</th><th>Mass</th></tr></thead>
          <tbody>
            {report.parts.map((p, i) => <tr key={i}><td>{p.name}{p.estimated && <span className="estimate"> est.</span>}</td><td>{fmt(p.mass)} g</td></tr>)}
            <tr className="total"><td>Total</td><td>{fmt(report.total.mass)} g</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">Estimates from your 3D design and the part values on the left. The frame weight is exact for the solid you designed (× density × fill); "est." values are typical until you weigh your parts. A rule of thumb, not a guarantee: test-hover low and slow.</p>
    </div>
  );
}

export function DroneWorkspace() {
  const project = useProject((s) => s.project);
  const drone = droneOf(project);
  const objects = cadObjects(project);
  const csgReady = useCad((s) => s.csgReady);
  const [tab, setTab] = useState<"check" | "fly" | "code">("check");
  const report = useMemo(() => (drone && csgReady ? analyseDrone(drone, objects) : null), [drone, objects, csgReady]);

  if (!drone) {
    return (
      <div className="page drone-start" data-testid="drone-start">
        <h1>Drone Studio</h1>
        <p className="tagline">Will your drone fly? MakerStudio weighs the frame you designed in 3D Studio, adds the motors, battery and electronics, and checks thrust, balance, propeller room and flight time. Then you can fly it in the simulator.</p>
        <button className="btn primary" onClick={() => { const n = newDroneDesign(objects); if (run(setDrone({ drone: n.drone, label: "Start drone design" }))) useUi.getState().notify("success", `Drone design started; motors placed from ${n.from}. Check their positions on the left.`); }} data-testid="drone-new">Start a drone design</button>
        <p className="muted small">Tip: Projects → Practice → "Flix" starts a mini quad frame you can use right away.</p>
      </div>
    );
  }
  return (
    <div className="drone-workspace" data-testid="drone-workspace">
      <DesignPanel drone={drone} objects={objects} />
      <main className="drone-main">
        <div className="seg drone-tabs">
          <button className={tab === "check" ? "on" : ""} onClick={() => setTab("check")} data-testid="drone-tab-check">Will it fly?</button>
          <button className={tab === "fly" ? "on" : ""} onClick={() => setTab("fly")} data-testid="drone-tab-fly">Fly it</button>
          <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")} data-testid="drone-tab-code">Drone code</button>
        </div>
        {!report ? <p className="muted">Loading the solid geometry engine…</p>
          : tab === "check" ? <Report drone={drone} report={report} /> : tab === "fly" ? <DroneFlight drone={drone} objects={objects} report={report} /> : <CodePanel drone={drone} objects={objects} report={report} />}
      </main>
    </div>
  );
}


function CodePanel({ drone, objects, report }: { drone: Drone; objects: CadObject[]; report: DroneReport }) {
  const [boardId, setBoardId] = useState(DRONE_BOARDS[0]!.id);
  const board = DRONE_BOARDS.find((b) => b.id === boardId)!;
  const [pins, setPins] = useState<number[]>(() => drone.motors.map((_, i) => board.motorPins[i] ?? 10 + i));
  const [imuX, setImuX] = useState<ImuFacing>("front");
  const [imuUp, setImuUp] = useState(true);
  const [battery, setBattery] = useState<number | null>(board.batteryPin);
  const [heightSensor, setHeightSensor] = useState(false);
  const [wifiName, setWifiName] = useState("MakerStudio-Drone");
  const [wifiPassword, setWifiPassword] = useState(() => newWifiPassword());
  useEffect(() => { setPins(drone.motors.map((_, i) => board.motorPins[i] ?? 10 + i)); setBattery(board.batteryPin); }, [boardId, drone.motors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportNow = async () => {
    const notify = useUi.getState().notify;
    let project;
    try {
      project = droneCodeProject(drone, objects, { boardId, motorPins: pins, imuX, imuUp, batteryPin: battery, batteryDivider: 2, heightSensor, wifiName, wifiPassword });
    } catch (error) {
      return notify("error", error instanceof Error ? error.message : String(error));
    }
    const result = await window.makerstudio.exportCodeProject(project.name, project.files);
    if (!result.ok) return notify("error", result.error);
    if (!result.value) return;
    notify(project.notes.length ? "info" : "success", [`Drone code saved in ${result.value}. Read its README first: safety checks with the propellers off.`, ...project.notes].join(" "));
  };
  const wireIt = () => {
    const notify = useUi.getState().notify;
    const existing = projectStore.getState().project.document.workspaces.circuit.components;
    const right = existing.reduce((m, c) => Math.max(m, c.x + partLayout(c.type).w), 0);
    let wiring;
    try {
      wiring = droneCircuit(drone, boardId, pins, newId, [existing.length ? right + 12 : 4, 4], heightSensor);
    } catch (error) {
      return notify("error", error instanceof Error ? error.message : String(error));
    }
    if (!run(addMany({ components: wiring.components, wires: wiring.wires, label: "Wire my drone" }))) return;
    useUi.getState().setWorkspace("circuit");
    notify("success", [`Wired the drone: ${wiring.components.length} parts, ${wiring.wires.length} wires (one undo step).`, ...wiring.notes].join(" "));
  };
  const danger = report.findings.some((f) => f.verdict === "danger");
  return (
    <div className="drone-code" data-testid="drone-code">
      <div className="drone-real-warning">
        <b>Code for a real drone.</b> It uses the same flight controller as the simulator (checked by a test that compiles both), an MPU-6050 and brushed motors on MOSFETs, and is flown from Fly it → Real drone over Wi-Fi. It has <b>not been tested on a real drone yet</b>: the README has the propeller-off checks to do first.
      </div>
      {danger && <p className="danger-text">"Will it fly?" still shows a red problem: fix it before building.</p>}
      <div className="drone-code-grid">
        <section className="card">
          <h4>Board</h4>
          <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-testid="drone-board">
            {DRONE_BOARDS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <p className="muted small">{board.powerNote}</p>
          <p className="muted small">IMU on I²C: SDA GPIO{board.sda}, SCL GPIO{board.scl}.</p>
        </section>
        <section className="card">
          <h4>Motor pins (to each MOSFET gate)</h4>
          {drone.motors.map((m, i) => (
            <label key={i} className="drone-num"><span>Motor {i + 1} ({m.spin === 1 ? "↺" : "↻"})</span>
              <span className="drone-num-input">GPIO <input value={pins[i] ?? ""} onChange={(e) => setPins(pins.map((p, j) => (j === i ? Number(e.target.value) || 0 : p)))} data-testid={`drone-pin-${i}`} /></span>
            </label>
          ))}
          <p className="muted small">Motor numbers as in the top view on "Will it fly?".</p>
        </section>
        <section className="card">
          <h4>IMU direction</h4>
          <label className="drone-num"><span>The X arrow on the IMU points</span>
            <select value={imuX} onChange={(e) => setImuX(e.target.value as ImuFacing)}>{(["front", "back", "left", "right"] as const).map((d) => <option key={d}>{d}</option>)}</select>
          </label>
          <label className="small"><input type="checkbox" checked={imuUp} onChange={(e) => setImuUp(e.target.checked)} /> Chip side up</label>
        </section>
        <section className="card">
          <h4>Battery voltage (optional)</h4>
          <label className="small"><input type="checkbox" checked={battery !== null} onChange={(e) => setBattery(e.target.checked ? board.batteryPin ?? 1 : null)} /> Measure it (two equal resistors as a divider)</label>
          {battery !== null && <label className="drone-num"><span>ADC pin</span><span className="drone-num-input">GPIO <input value={battery} onChange={(e) => setBattery(Number(e.target.value) || 0)} /></span></label>}
        </section>
        <section className="card">
          <h4>Height hold (optional)</h4>
          <label className="small"><input type="checkbox" checked={heightSensor} onChange={(e) => setHeightSensor(e.target.checked)} data-testid="drone-height-sensor" /> VL53L1X distance sensor looking down, on the same I²C pins</label>
          <p className="muted small">Then H in Fly it → Real drone holds the height, as in the simulator. Without it the real drone flies in stabilize only.</p>
        </section>
        <section className="card">
          <h4>Drone Wi-Fi</h4>
          <label className="drone-num"><span>Name</span><input className="drone-wide" value={wifiName} onChange={(e) => setWifiName(e.target.value)} /></label>
          <label className="drone-num"><span>Password</span><input className="drone-wide" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} /></label>
          <button className="btn plain small" onClick={() => setWifiPassword(newWifiPassword())}>New password</button>
        </section>
      </div>
      <div className="drone-row">
        <button className="btn primary" onClick={() => void exportNow()} data-testid="drone-export">Export drone code…</button>
        <button className="btn plain" onClick={wireIt} data-testid="drone-wire">Wire it in Circuit Studio</button>
      </div>
    </div>
  );
}
