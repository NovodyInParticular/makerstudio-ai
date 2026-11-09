// "Fly it": the drone design in the flight simulator, with keyboard or gamepad.
//
// Throttle stick centre = hover thrust (beginner friendly); stabilize mode: let go of the
// right stick and it levels itself. There is no height hold: the throttle still matters.

import { Grid } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, CircleGeometry, DoubleSide, Group, Mesh, Quaternion, Vector3 } from "three";
import { collectParts } from "../../core/cad/exporting";
import type { CadObject } from "../../core/cad/model";
import type { DroneReport } from "../../core/drone/analysis";
import { setDrone } from "../../core/drone/commands";
import type { Drone } from "../../core/drone/model";
import { DroneSim, simParams, type Sticks } from "../../core/drone/sim";
import { run } from "../cad/cadState";
import { useUi } from "../state";

interface Hud { mode: string; status: string; alt: number; speed: number; tilt: number; volts: number; battery: number; throttle: number; motors: number[]; time: number; pad: string; armed: boolean; crash: string }

const keysDown = new Set<string>();
/** Keys tapped since the last frame (a quick tap can start and end between two frames). */
const taps = new Set<string>();
const DEAD = 0.08;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

function readSticks(hover: number, edges: { arm: boolean; reset: boolean; knock: boolean }): { sticks: Sticks; pad: string } {
  const k = (code: string) => keysDown.has(code);
  let thr = (k("KeyW") ? 1 : 0) - (k("KeyS") ? 1 : 0);
  let yaw = (k("KeyD") ? 1 : 0) - (k("KeyA") ? 1 : 0);
  let pitch = (k("ArrowUp") ? 1 : 0) - (k("ArrowDown") ? 1 : 0);
  let roll = (k("ArrowRight") ? 1 : 0) - (k("ArrowLeft") ? 1 : 0);
  let pad = "";
  const gp = (navigator.getGamepads?.() ?? []).find((g) => g && g.connected);
  if (gp) {
    pad = gp.id.slice(0, 40);
    // Mode 2: left stick = throttle (up) / yaw, right stick = pitch (up = forward) / roll.
    const a = gp.axes;
    if (Math.abs(dz(a[1] ?? 0)) > 0) thr = -dz(a[1]!);
    if (Math.abs(dz(a[0] ?? 0)) > 0) yaw = dz(a[0]!);
    if (Math.abs(dz(a[3] ?? 0)) > 0) pitch = -dz(a[3]!);
    if (Math.abs(dz(a[2] ?? 0)) > 0) roll = dz(a[2]!);
    const pressed = (i: number) => !!gp.buttons[i]?.pressed;
    edges.arm = pressed(0); edges.reset = pressed(1); edges.knock = pressed(3);
  }
  const throttle = thr >= 0 ? hover + thr * (1 - hover) : hover * (1 + thr);
  return { sticks: { throttle, roll, pitch, yaw, climb: thr }, pad };
}

function frameGeometry(drone: Drone, objects: CadObject[], report: DroneReport): BufferGeometry[] {
  if (!report.frame.ids.length) return [];
  const c = report.total.centre;
  return collectParts(report.frame.ids, objects).parts.map((p) => {
    const pos = new Float32Array(p.positions.length);
    for (let i = 0; i < pos.length; i += 3) { pos[i] = (p.positions[i]! - c[0]) / 1000; pos[i + 1] = (p.positions[i + 1]! - c[1]) / 1000; pos[i + 2] = (p.positions[i + 2]! - c[2]) / 1000; }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setIndex(new BufferAttribute(p.indices, 1));
    g.computeVertexNormals();
    return g;
  });
}

function Flyer({ sim, drone, geometries, hover, onHud }: { sim: DroneSim; drone: Drone; geometries: BufferGeometry[]; hover: number; onHud(h: Hud): void }) {
  const body = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const props = useRef<(Mesh | null)[]>([]);
  const { camera } = useThree();
  const last = useRef({ arm: false, reset: false, knock: false, hud: 0 });
  // Camera distance from the drone's size (a 12 cm quad is seen from about half a metre).
  const span = Math.max(0.08, Math.max(...sim.p.motors.map((m) => Math.hypot(m.r[0], m.r[1]))) * 2 + drone.propDiameter / 1000);
  const camPos = useRef(new Vector3(0, 1.2, 0.6));
  const prop = useMemo(() => new CircleGeometry(drone.propDiameter / 2000, 24), [drone.propDiameter]);
  useEffect(() => () => prop.dispose(), [prop]);

  useFrame((_, delta) => {
    const edges = { arm: false, reset: false, knock: false };
    const { sticks, pad } = readSticks(hover, edges);
    const l = last.current;
    // Keyboard taps (as events) and gamepad buttons (on press).
    if (taps.has("Space") || (edges.arm && !l.arm)) sim.arm(!sim.armed);
    if (taps.has("KeyR") || (edges.reset && !l.reset)) sim.reset();
    if (taps.has("KeyK") || (edges.knock && !l.knock)) sim.omega[1] += 4;
    if (taps.has("KeyH")) sim.mode = sim.mode === "stabilize" ? "height-hold" : "stabilize";
    taps.clear();
    l.arm = edges.arm; l.reset = edges.reset; l.knock = edges.knock;

    sim.step(Math.min(0.05, delta), sticks);
    const [x, y, z] = sim.pos;
    const [w, qx, qy, qz] = sim.attitude;
    if (body.current) { body.current.position.set(x, y, z); body.current.quaternion.copy(new Quaternion(qx, qy, qz, w)); }
    if (shadow.current) { shadow.current.position.set(x, y, 0.001); const s = Math.max(0.3, 1 - sim.altitude / 6); shadow.current.scale.set(s, s, s); }
    props.current.forEach((m, i) => { if (m) m.rotation.z += (drone.motors[i]?.spin ?? 1) * sim.thrust[i]! * 120 * delta; });

    // Chase camera: behind (+Y is behind) and above, turning with the drone's heading.
    const yaw = sim.yaw;
    // Forward is (sin a, -cos a); behind is the opposite.
    const back = span * 2.6, rise = span * 1.0;
    const behind = new Vector3(-Math.sin(yaw) * back, Math.cos(yaw) * back, rise).add(new Vector3(x, y, z));
    camPos.current.lerp(behind, Math.min(1, delta * 10)); // follows closely, still smooth
    camera.position.copy(camPos.current);
    camera.up.set(0, 0, 1);
    camera.lookAt(x, y, z);

    l.hud += delta;
    if (l.hud > 0.1) {
      l.hud = 0;
      onHud({
        mode: sim.mode, status: sim.status, alt: sim.altitude, speed: Math.hypot(...sim.vel), tilt: (sim.tilt * 180) / Math.PI, volts: sim.voltage, battery: sim.batteryLeft,
        throttle: sim.thrust.reduce((a, t) => a + t, 0) / (sim.p.maxThrust * sim.thrust.length), motors: sim.thrust.map((t) => t / sim.p.maxThrust), time: sim.time, pad, armed: sim.armed, crash: sim.crashReason,
      });
    }
  });

  return (
    <>
      <group ref={body}>
        {geometries.map((g, i) => (
          <mesh key={i} geometry={g} castShadow><meshStandardMaterial color="#2fd6a3" roughness={0.6} metalness={0.05} /></mesh>
        ))}
        {sim.p.motors.map((m, i) => (
          <mesh key={`p${i}`} ref={(el) => { props.current[i] = el; }} geometry={prop} position={[m.r[0], m.r[1], m.r[2] + 0.004]}>
            <meshBasicMaterial color={m.spin === 1 ? "#9dffe4" : "#7fd8ff"} transparent opacity={0.35} side={DoubleSide} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <mesh ref={shadow} position={[0, 0, 0.001]}>
        <circleGeometry args={[Math.max(0.05, drone.propDiameter / 1000), 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
    </>
  );
}

const PID_FIELDS: [keyof Drone["pid"]["rollPitch"], string][] = [["angleP", "Angle P"], ["rateP", "Rate P"], ["rateI", "Rate I"], ["rateD", "Rate D"]];

export function DroneFlight({ drone, objects, report }: { drone: Drone; objects: CadObject[]; report: DroneReport }) {
  const sim = useMemo(() => new DroneSim(simParams(drone, objects, report)), [drone, objects, report]);
  const geometries = useMemo(() => frameGeometry(drone, objects, report), [drone, objects, report]);
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  const [hud, setHud] = useState<Hud | null>(null);
  const [tuning, setTuning] = useState(false);
  const [where, setWhere] = useState<"sim" | "real">("sim");
  const hover = Math.min(0.95, report.hoverThrottle);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (["KeyW", "KeyS", "KeyA", "KeyD", "KeyR", "KeyK", "KeyH", "KeyX", "Escape", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
        keysDown.add(e.code);
        if (!e.repeat) taps.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => keysDown.delete(e.code);
    const blur = () => keysDown.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); keysDown.clear(); taps.clear(); };
  }, []);

  const flyable = report.thrustToWeight >= 1 && report.findings.every((f) => !/Motors cannot steer/.test(f.title));
  const setPid = (axis: "rollPitch" | "yaw", key: keyof Drone["pid"]["rollPitch"], v: number) =>
    run(setDrone({ drone: { ...drone, pid: { ...drone.pid, [axis]: { ...drone.pid[axis], [key]: v } } }, label: "Tune flight controller", merge: `pid-${axis}-${key}` }));

  if (where === "real") return <RealDrone onBack={() => setWhere("sim")} />;
  return (
    <div className="drone-flight" data-testid="drone-flight">
      <div className="drone-canvas">
        <Canvas camera={{ position: [0, 1.2, 0.6], fov: 55, near: 0.01, far: 200, up: [0, 0, 1] }} onPointerDown={(e) => (e.currentTarget as HTMLElement).focus()}>
          <color attach="background" args={["#24323d"]} />
          <fog attach="fog" args={["#24323d", 8, 60]} />
          <mesh position={[0, 0, -0.002]}><planeGeometry args={[400, 400]} /><meshStandardMaterial color="#141b20" /></mesh>
          <hemisphereLight args={["#dfe9f3", "#1b2026", 0.8]} />
          <directionalLight position={[3, -4, 8]} intensity={1.4} />
          <Grid args={[60, 60]} rotation={[Math.PI / 2, 0, 0]} cellSize={0.25} sectionSize={1} cellColor="#22303a" sectionColor="#2fd6a3" fadeDistance={30} infiniteGrid />
          <Flyer sim={sim} drone={drone} geometries={geometries} hover={hover} onHud={setHud} />
        </Canvas>
        {hud && (
          <div className="drone-hud" data-testid="drone-hud">
            <div className={`drone-status ${hud.status}`} data-testid="drone-status">
              {hud.status === "crashed" ? `Crashed: ${hud.crash}. Press R to reset.` : hud.status === "battery-empty" ? "Battery empty. Press R to reset." : hud.armed ? (hud.status === "flying" ? "Flying" : "Armed: throttle up (W) to take off") : "Disarmed: press Space to arm"}
            </div>
            <div className="drone-hud-grid">
              <span>Mode</span><b data-testid="drone-mode">{hud.mode === "height-hold" ? "Height hold" : "Stabilize"}</b>
              <span>Height</span><b data-testid="drone-alt">{hud.alt.toFixed(2)} m</b>
              <span>Speed</span><b>{hud.speed.toFixed(1)} m/s</b>
              <span>Tilt</span><b>{hud.tilt.toFixed(0)}°</b>
              <span>Battery</span><b>{hud.volts.toFixed(2)} V · {Math.round(hud.battery * 100)} %</b>
              <span>Thrust</span><b>{Math.round(hud.throttle * 100)} %</b>
              <span>Time</span><b>{hud.time.toFixed(0)} s</b>
            </div>
            <div className="drone-motor-bars">{hud.motors.map((m, i) => <div key={i} title={`Motor ${i + 1}`}><i style={{ height: `${Math.min(100, m * 100)}%` }} /></div>)}</div>
          </div>
        )}
        {!flyable && <div className="drone-overlay">This design cannot fly yet: see "Will it fly?".</div>}
      </div>
      <aside className="drone-flight-side">
        <div className="seg drone-where">
          <button className="on">Simulator</button>
          <button onClick={() => setWhere("real")} data-testid="drone-real">Real drone</button>
        </div>
        <h4>Controls</h4>
        <table className="drone-keys">
          <tbody>
            <tr><td><kbd>Space</kbd></td><td>Arm / disarm</td></tr>
            <tr><td><kbd>W</kbd> <kbd>S</kbd></td><td>Throttle up / down (let go = hover thrust)</td></tr>
            <tr><td><kbd>A</kbd> <kbd>D</kbd></td><td>Turn left / right</td></tr>
            <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Fly forward / back</td></tr>
            <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Fly left / right</td></tr>
            <tr><td><kbd>H</kbd></td><td>Mode: stabilize / height hold</td></tr>
            <tr><td><kbd>K</kbd></td><td>Knock it (test that it levels itself)</td></tr>
            <tr><td><kbd>R</kbd></td><td>Reset</td></tr>
          </tbody>
        </table>
        <p className="muted small">Gamepad (mode 2): left stick throttle and turn, right stick fly; A / ✕ arms, B / ○ resets. {hud?.pad ? <b>Connected: {hud.pad}</b> : "None connected (press a button on it)."}</p>
        <p className="muted small"><b>Stabilize</b>: let go and it levels itself, but it does not hold its height (like ESP-Drone's stabilize mode). <b>Height hold</b> (H): the throttle stick sets climb speed and centred holds the height; a real drone needs a height sensor for this (ESP-Drone's extension boards). Physics are an estimate (no propeller wash, ground effect or frame flex).</p>
        <button className="btn plain small" onClick={() => setTuning(!tuning)} data-testid="drone-tuning">{tuning ? "Hide tuning" : "Tune the flight controller"}</button>
        {tuning && (
          <div className="drone-pid">
            {(["rollPitch", "yaw"] as const).map((axis) => (
              <section key={axis}>
                <h5>{axis === "rollPitch" ? "Roll and pitch" : "Yaw"}</h5>
                {PID_FIELDS.filter(([k]) => axis === "rollPitch" || k !== "angleP").map(([k, label]) => (
                  <label key={k} className="drone-num"><span>{label}</span>
                    <input type="number" step={k === "rateD" ? 0.1 : 1} value={drone.pid[axis][k]} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) setPid(axis, k, v); }} />
                  </label>
                ))}
              </section>
            ))}
            <p className="muted small">Too high: it shakes. Too low: it wobbles slowly or drifts. Changes restart the flight.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

// --- flying the real drone over Wi-Fi ------------------------------------------------------

type Telemetry = Parameters<Parameters<typeof window.makerstudio.onDroneTelemetry>[0]>[0];

function RealDrone({ onBack }: { onBack(): void }) {
  const [host, setHost] = useState("192.168.4.1");
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);
  const [tele, setTele] = useState<Telemetry | null>(null);
  const [view, setView] = useState({ throttle: 0, arm: false, pad: "", hold: false });
  const state = useRef({ throttle: 0, arm: false, ready: false, hold: false, lastPad: { arm: false } });
  state.current.ready = ready;

  useEffect(() => window.makerstudio.onDroneTelemetry(setTele), []);
  // Disconnecting (or leaving this view) sends a final "disarmed" packet.
  useEffect(() => () => { void window.makerstudio.droneDisconnect(); }, []);

  useEffect(() => {
    if (!connected) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      const st = state.current;
      const edges = { arm: false, reset: false, knock: false };
      const { sticks, pad } = readSticks(0, edges);
      if (taps.has("KeyH")) st.hold = !st.hold;
      // Keyboard throttle is a lever: W raises it, S lowers it (starts at 0 so the drone can arm).
      // In height hold, W / S are the climb stick instead and the lever stays where it is (the fallback).
      const climb = (keysDown.has("KeyW") ? 1 : 0) - (keysDown.has("KeyS") ? 1 : 0);
      if (!st.hold && keysDown.has("KeyW")) st.throttle = Math.min(1, st.throttle + 0.35 * dt);
      if (!st.hold && keysDown.has("KeyS")) st.throttle = Math.max(0, st.throttle - 0.8 * dt);
      const gp = (navigator.getGamepads?.() ?? []).find((g) => g && g.connected);
      if (gp) st.throttle = Math.max(0, -dz(gp.axes[1] ?? 0)); // lower half of the stick = 0
      if (taps.has("KeyX") || taps.has("Escape")) { st.arm = false; st.throttle = 0; }
      if ((taps.has("Space") || (edges.arm && !st.lastPad.arm))) st.arm = st.arm ? false : st.ready;
      st.lastPad.arm = edges.arm;
      taps.clear();
      if (!st.ready) st.arm = false;
      window.makerstudio.droneSticks({ throttle: st.throttle, roll: sticks.roll, pitch: sticks.pitch, yaw: sticks.yaw, arm: st.arm, hold: st.hold, climb: gp ? sticks.climb ?? 0 : climb });
      setView({ throttle: st.throttle, arm: st.arm, pad, hold: st.hold });
    }, 20);
    return () => clearInterval(timer);
  }, [connected]);

  const connect = async () => {
    const r = await window.makerstudio.droneConnect(host.trim(), 4210);
    if (!r.ok) return useUi.getState().notify("error", r.error);
    state.current.throttle = 0; state.current.arm = false;
    setConnected(true);
  };
  const disconnect = async () => { state.current.arm = false; setConnected(false); await window.makerstudio.droneDisconnect(); };
  const age = tele ? (Date.now() - tele.at) / 1000 : Infinity;

  return (
    <div className="drone-real" data-testid="drone-real-panel">
      <div className="seg drone-where">
        <button onClick={() => { void disconnect(); onBack(); }}>Simulator</button>
        <button className="on">Real drone</button>
      </div>
      <div className="drone-real-warning">
        <b>Real drone: this flies real propellers.</b> The drone code has not been tested on a real drone yet. Do the
        README checks with the propellers off first. Fly low, in an open space, away from people and animals.
      </div>
      <div className="drone-real-grid">
        <section className="card">
          <h4>1. Connect</h4>
          <p className="muted small">Join the drone's Wi-Fi ("MakerStudio-Drone" unless you changed it) on this computer, then connect.</p>
          <div className="drone-row">
            <input value={host} onChange={(e) => setHost(e.target.value)} disabled={connected} className="drone-host" />
            {connected ? <button className="btn plain small" onClick={() => void disconnect()}>Disconnect</button> : <button className="btn primary small" onClick={() => void connect()} data-testid="drone-connect">Connect</button>}
          </div>
          <p className="small">{tele && age < 1.5 ? <>Drone answering · loop {Math.round(tele.loopHz)} Hz · {tele.calibrated ? "calibrated" : <b>not calibrated: keep it still and restart it</b>}</> : connected ? "Sending… no answer from the drone yet (are you on its Wi-Fi?)" : "Not connected."}</p>
        </section>
        <section className="card">
          <h4>2. Before arming</h4>
          <label className="small"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} data-testid="drone-ready" /> Propellers checked (right ones, tight), area clear, I am ready to cut the motors with <kbd>X</kbd>.</label>
        </section>
        <section className="card" data-testid="drone-real-status">
          <h4>3. Fly</h4>
          <div className="drone-hud-grid">
            <span>Armed</span><b className={view.arm ? "danger-text" : ""}>{view.arm ? "ARMED" : "no"}{tele ? ` (drone: ${tele.armed ? "armed" : "disarmed"})` : ""}</b>
            <span>Throttle</span><b>{Math.round(view.throttle * 100)} %</b>
            <span>Roll / pitch</span><b>{tele ? `${tele.roll.toFixed(0)}° / ${tele.pitch.toFixed(0)}°` : "–"}</b>
            <span>Battery</span><b>{tele && tele.volts > 0 ? `${tele.volts.toFixed(2)} V` : "not measured"}</b>
            <span>Mode</span><b data-testid="drone-real-mode">{view.hold ? (tele?.holding ? "Height hold" : "Height hold asked (needs throttle up and a height reading)") : "Stabilize"}</b>
            <span>Height</span><b>{tele && tele.height !== null ? `${tele.height.toFixed(2)} m` : "no height sensor reading"}</b>
          </div>
          <table className="drone-keys"><tbody>
            <tr><td><kbd>X</kbd> <kbd>Esc</kbd></td><td><b>Cut motors now</b></td></tr>
            <tr><td><kbd>Space</kbd></td><td>Arm / disarm (only with the box ticked and throttle at 0)</td></tr>
            <tr><td><kbd>W</kbd> <kbd>S</kbd></td><td>Throttle lever up / down (in height hold: climb / sink)</td></tr>
            <tr><td><kbd>H</kbd></td><td>Height hold on / off (drone with a VL53L1X)</td></tr>
            <tr><td><kbd>A</kbd> <kbd>D</kbd> · arrows</td><td>Turn · fly</td></tr>
          </tbody></table>
          <p className="muted small">{view.pad ? `Gamepad: ${view.pad} (left stick up = throttle; A / ✕ arms)` : "Gamepad works too (mode 2)."} The drone stops its motors 0.5 s after the last packet, so closing this view or losing Wi-Fi stops it.</p>
        </section>
      </div>
    </div>
  );
}
