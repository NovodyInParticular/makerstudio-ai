// Robotics Studio: joints (servos) between 3D parts, screens on the robot, live posing.

import { useEffect, useMemo, useRef, useState } from "react";
import { Matrix4, Vector3 } from "three";
import { worldBounds } from "../../core/cad/geometry";
import type { CadObject } from "../../core/cad/model";
import { displayById } from "../../core/display/catalog";
import type { Screen } from "../../core/display/face";
import type { Command } from "../../core/document/commands";
import { addJoint, addMount, deleteJoint, deleteMount, robotOf, setJoint, setMount } from "../../core/robot/commands";
import { AXES, clampAngle, poseMatrices, type Joint, type Robot } from "../../core/robot/model";
import { newId } from "../../shared/format";
import { useAlive } from "../display/useAlive";
import { projectStore, useProject, useUi } from "../state";
import type { RobotOutput } from "../../core/robot/behavior";
import { BehaviorPanel } from "./BehaviorPanel";
import { RobotExport } from "./RobotExport";
import { RobotView, type PickHit, type PickMode } from "./RobotView";

function run(command: Command): boolean {
  try {
    projectStore.getState().execute(command);
    return true;
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
    return false;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const AXIS_LABEL: Record<string, string> = { x: "X", y: "Y", z: "Z (turn)", "-x": "−X", "-y": "−Y", "-z": "−Z" };

/** Moves every joint back and forth inside its limits, to check the robot moves as intended. */
function useWiggle(on: boolean, robot: Robot | null, set: (a: Record<string, number>) => void) {
  const robotRef = useRef(robot);
  robotRef.current = robot;
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const angles: Record<string, number> = {};
      robotRef.current?.joints.forEach((j, i) => {
        const s = Math.sin(t * 1.4 + i * 1.1);
        angles[j.id] = s >= 0 ? s * j.max * 0.8 : -s * j.min * 0.8;
      });
      set(angles);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, set]);
}

function NumberField({ value, onCommit, label, testId }: { value: number; onCommit(v: number): void; label: string; testId?: string }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" step={0.5} defaultValue={value} key={value} data-testid={testId}
        onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== value) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function JointInspector({ joint, parts, angle, setAngle, pickPivot, picking }: {
  joint: Joint; parts: CadObject[]; angle: number; setAngle(v: number): void; pickPivot(): void; picking: boolean;
}) {
  const change = (changes: Partial<Joint>, merge?: string) => run(setJoint({ id: joint.id, changes, merge }));
  return (
    <section data-testid="joint-inspector">
      <h4>Joint</h4>
      <label className="field"><span>Name</span>
        <input defaultValue={joint.name} key={joint.id + joint.name} maxLength={60} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== joint.name) change({ name: e.target.value.trim() }); }} />
      </label>
      <label className="field"><span>Moves</span>
        <select value={joint.child} onChange={(e) => change({ child: e.target.value })}>
          {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Attached to</span>
        <select value={joint.parent ?? ""} onChange={(e) => change({ parent: e.target.value || null })} data-testid="joint-parent">
          <option value="">Base (fixed)</option>
          {parts.filter((p) => p.id !== joint.child).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="field"><span>Turns around</span>
        <div className="seg">
          {AXES.map((a) => <button key={a} className={joint.axis === a ? "on" : ""} onClick={() => change({ axis: a })} data-testid={`joint-axis-${a}`}>{AXIS_LABEL[a]}</button>)}
        </div>
      </div>
      <div className="field"><span>Pivot (mm, home pose)</span>
        <div className="xyz-row">
          {[0, 1, 2].map((k) => (
            <NumberField key={k} label={"XYZ"[k]!} value={joint.pivot[k]!} onCommit={(v) => { const p = [...joint.pivot] as [number, number, number]; p[k] = v; change({ pivot: p }); }} />
          ))}
        </div>
        <button className={`btn plain small ${picking ? "on" : ""}`} onClick={pickPivot} data-testid="pick-pivot">{picking ? "Click the model…" : "Pick on the model"}</button>
      </div>
      <div className="field"><span>Range (degrees from home)</span>
        <div className="xyz-row">
          <NumberField label="Min" value={joint.min} onCommit={(v) => change({ min: Math.max(-180, Math.min(0, v)) })} />
          <NumberField label="Max" value={joint.max} onCommit={(v) => change({ max: Math.max(0, Math.min(180, v)) })} />
        </div>
      </div>
      <label className="slider-row pose-row">
        <span>Try it</span>
        <input type="range" min={joint.min} max={joint.max} step={1} value={clampAngle(joint, angle)} onChange={(e) => setAngle(Number(e.target.value))} data-testid="joint-try" />
        <span className="mono small">{Math.round(clampAngle(joint, angle))}°</span>
      </label>
      <h4>Servo on the robot</h4>
      <div className="xyz-row">
        <label className="num-field"><span>Pin</span>
          <input type="number" min={0} max={64} placeholder="—" defaultValue={joint.servo.pin ?? ""} key={`${joint.id}-${joint.servo.pin}`}
            onBlur={(e) => { const v = e.target.value === "" ? null : Math.round(Number(e.target.value)); if (v !== joint.servo.pin) change({ servo: { ...joint.servo, pin: v } }); }} />
        </label>
        <NumberField label="Home °" value={joint.servo.center} onCommit={(v) => change({ servo: { ...joint.servo, center: Math.max(0, Math.min(180, v)) } })} />
        <label className="num-field"><span>Reverse</span><input type="checkbox" checked={joint.servo.reversed} onChange={(e) => change({ servo: { ...joint.servo, reversed: e.target.checked } })} /></label>
      </div>
      <p className="muted small">Pin and servo angle at the home pose are used when the robot's code is exported. Most hobby servos are centred at 90°.</p>
      <button className="btn plain small danger-text" onClick={() => run(deleteJoint({ id: joint.id }))}>Delete joint</button>
    </section>
  );
}

export function RoboticsWorkspace() {
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const screens = useProject((s) => s.project.document.workspaces.displays.screens as Screen[]);
  const robot = useProject((s) => robotOf(s.project));
  const parts = objects.filter((o) => o.parentId === null && !o.hole);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
  const [selectedMount, setSelectedMount] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [angles, setAngles] = useState<Record<string, number>>({});
  const [wiggle, setWiggle] = useState(false);
  useWiggle(wiggle, robot, setAngles);
  const [running, setRunning] = useState<RobotOutput | null>(null);
  const idleFace = useAlive(!running, false, "neutral");
  const faceState = running ? running.face : idleFace;
  const shownAngles = running ? running.angles : angles;
  const deltas = useMemo(() => (robot ? poseMatrices(robot, shownAngles) : new Map<string, Matrix4>()), [robot, shownAngles]);

  const joint = robot?.joints.find((j) => j.id === selectedJoint) ?? null;
  const mount = robot?.mounts.find((m) => m.id === selectedMount) ?? null;
  const select = (kind: "part" | "joint" | "mount", id: string | null) => {
    setSelectedPart(kind === "part" ? id : null);
    setSelectedJoint(kind === "joint" ? id : null);
    setSelectedMount(kind === "mount" ? id : null);
    setPickMode(null);
  };

  /** Map a click on the posed robot back to the home pose. */
  const toHome = (hit: PickHit) => {
    const inv = (deltas.get(hit.objectId) ?? new Matrix4()).clone().invert();
    const p = new Vector3(...hit.point).applyMatrix4(inv);
    const n = new Vector3(...hit.normal).transformDirection(inv);
    return { point: p.toArray().map(round2) as [number, number, number], normal: n.toArray().map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number] };
  };

  const onPick = (hit: PickHit) => {
    if (pickMode === "pivot" && joint) {
      run(setJoint({ id: joint.id, changes: { pivot: toHome(hit).point } }));
      setPickMode(null);
      return;
    }
    if (pickMode === "screen") {
      const screen = mount ? screens.find((s) => s.id === mount.screenId) : screens[0];
      if (!screen) return;
      const { point, normal } = toHome(hit);
      if (mount) run(setMount({ id: mount.id, changes: { objectId: hit.objectId, position: point, normal } }));
      else {
        const d = displayById(screen.display);
        const width = d?.diagonal ? round2((d.diagonal * 25.4 * d.width) / Math.hypot(d.width, d.height)) : 40;
        const m = { id: newId(), screenId: screen.id, objectId: hit.objectId, position: point, normal, width };
        if (run(addMount({ mount: m }))) select("mount", m.id);
      }
      setPickMode(null);
      return;
    }
    // Clicking a moving part selects its joint; others select the part.
    const j = robot?.joints.find((x) => x.child === hit.objectId);
    if (j) select("joint", j.id);
    else select("part", hit.objectId);
  };

  const newJoint = () => {
    const childId = selectedPart;
    if (!childId) return;
    const child = objects.find((o) => o.id === childId)!;
    const box = worldBounds([childId], objects);
    const pivot: [number, number, number] = box.isEmpty() ? [0, 0, 0] : [round2((box.min.x + box.max.x) / 2), round2((box.min.y + box.max.y) / 2), round2(box.min.z)];
    // Attach to the part right below it, if there is one; otherwise to the base.
    const below = parts
      .filter((p) => p.id !== childId)
      .map((p) => ({ p, b: worldBounds([p.id], objects) }))
      .filter(({ b }) => !b.isEmpty() && b.max.z <= box.min.z + 0.5 && b.max.z >= box.min.z - 5)
      .sort((a, b) => b.b.max.z - a.b.max.z)[0]?.p;
    const used = new Set(robot?.joints.map((j) => j.name));
    let name = `${child.name} joint`;
    for (let n = 2; used.has(name); n++) name = `${child.name} joint ${n}`;
    const j: Joint = { id: newId(), name, child: childId, parent: below?.id ?? null, pivot, axis: "z", min: -90, max: 90, servo: { pin: null, center: 90, reversed: false } };
    if (run(addJoint({ joint: j }))) select("joint", j.id);
  };

  const noSolids = parts.length === 0;
  return (
    <div className="display-workspace" data-testid="robotics-workspace">
      <div className="cad-left">
        <section className="cad-section">
          <h4>Parts</h4>
          {noSolids ? <p className="muted small">No parts yet. Build your robot's parts in 3D Studio (or start the Stack-chan practice project).</p> : (
            <ul className="tree" data-testid="robot-parts">
              {parts.map((p) => {
                const moving = robot?.joints.find((j) => j.child === p.id);
                return (
                  <li key={p.id} className={`tree-row ${selectedPart === p.id ? "selected" : ""}`} onClick={() => select("part", p.id)} data-testid="robot-part">
                    <span className="swatch" style={{ background: p.color, borderColor: p.color }} />
                    <span className="tree-name">{p.name}</span>
                    <span className="badge">{moving ? "moves" : "fixed"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button className="btn primary small" disabled={!selectedPart || !!robot?.joints.some((j) => j.child === selectedPart)} onClick={newJoint} data-testid="add-joint"
            title={selectedPart ? "Make the selected part move on a joint (servo)" : "Select the part that should move first"}>Add joint to part</button>
        </section>
        <section className="cad-section">
          <h4>Joints <span className="muted">({robot?.joints.length ?? 0})</span></h4>
          <ul className="tree" data-testid="joint-list">
            {robot?.joints.map((j) => (
              <li key={j.id} className={`tree-row ${selectedJoint === j.id ? "selected" : ""}`} onClick={() => select("joint", j.id)} data-testid="joint-row">
                <span className="tree-name">{j.name}</span>
                <span className="muted small">{Math.round(clampAngle(j, shownAngles[j.id] ?? 0))}°</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="cad-section grow">
          <h4>Screens on the robot</h4>
          <ul className="tree">
            {robot?.mounts.map((m) => (
              <li key={m.id} className={`tree-row ${selectedMount === m.id ? "selected" : ""}`} onClick={() => select("mount", m.id)} data-testid="mount-row">
                <span className="tree-name">{screens.find((s) => s.id === m.screenId)?.name ?? "(missing screen)"}</span>
                <span className="muted small">on {objects.find((o) => o.id === m.objectId)?.name ?? "?"}</span>
              </li>
            ))}
          </ul>
          {screens.length === 0 ? <p className="muted small">Design a face in Display Studio first, then mount it here.</p> : (
            <button className={`btn plain small ${pickMode === "screen" && !mount ? "on" : ""}`} onClick={() => { select("mount", null); setPickMode("screen"); }} data-testid="mount-screen">Mount a screen…</button>
          )}
        </section>
      </div>
      <div className="cad-center">
        <div className="viewport-toolbar">
          <div className="seg">
            <button className={wiggle ? "on" : ""} onClick={() => setWiggle(!wiggle)} disabled={!robot?.joints.length} title="Move every joint back and forth within its range" data-testid="wiggle">Wiggle test</button>
            <button onClick={() => { setWiggle(false); setAngles({}); }} title="All joints back to 0°">Home pose</button>
          </div>
          {pickMode && <span className="muted small" data-testid="pick-hint">{pickMode === "pivot" ? "Click where the joint should turn (Esc to cancel)." : "Click the face of a part where the screen goes."}</span>}
        </div>
        <div className="robot-canvas" onKeyDown={(e) => { if (e.key === "Escape") setPickMode(null); }} tabIndex={-1}>
          <RobotView objects={objects} robot={robot} deltas={deltas} screens={screens} faceState={faceState}
            selectedPart={selectedPart} selectedJoint={selectedJoint} selectedMount={selectedMount}
            pickMode={pickMode} onPick={onPick} onMiss={() => { if (!pickMode) select("part", null); }} />
        </div>
        <BehaviorPanel robot={robot} screens={screens} onRun={(out) => { if (out) setWiggle(false); setRunning(out); }} />
      </div>
      <aside className="inspector display-inspector">
        {joint ? (
          <JointInspector joint={joint} parts={parts} angle={angles[joint.id] ?? 0} setAngle={(v) => { setWiggle(false); setAngles((a) => ({ ...a, [joint.id]: v })); }}
            pickPivot={() => setPickMode(pickMode === "pivot" ? null : "pivot")} picking={pickMode === "pivot"} />
        ) : mount ? (
          <section data-testid="mount-inspector">
            <h4>Screen on the robot</h4>
            <label className="field"><span>Shows</span>
              <select value={mount.screenId} onChange={(e) => run(setMount({ id: mount.id, changes: { screenId: e.target.value } }))}>
                {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="slider-row"><span>Width</span>
              <input type="range" min={10} max={150} step={0.5} value={mount.width} onChange={(e) => run(setMount({ id: mount.id, changes: { width: Number(e.target.value) }, merge: `w-${mount.id}` }))} />
              <span className="mono small">{mount.width} mm</span>
            </label>
            <button className={`btn plain small ${pickMode === "screen" ? "on" : ""}`} onClick={() => setPickMode(pickMode === "screen" ? null : "screen")}>Place again on the model</button>
            <p className="muted small">Width starts at the display's real visible size where its diagonal is known.</p>
            <button className="btn plain small danger-text" onClick={() => { run(deleteMount({ id: mount.id })); select("mount", null); }}>Remove screen</button>
          </section>
        ) : (
          <section>
            <h4>Pose</h4>
            {robot?.joints.length ? robot.joints.map((j) => (
              <label key={j.id} className="slider-row pose-row">
                <span>{j.name}</span>
                <input type="range" min={j.min} max={j.max} step={1} value={clampAngle(j, angles[j.id] ?? 0)} onChange={(e) => { setWiggle(false); setAngles((a) => ({ ...a, [j.id]: Number(e.target.value) })); }} />
                <span className="mono small">{Math.round(clampAngle(j, angles[j.id] ?? 0))}°</span>
              </label>
            )) : (
              <p className="muted small">
                To make a part move: select it on the left (or click it), then <b>Add joint to part</b>. Set where it turns (the pivot) and around which axis.
                A desk robot usually has a joint that turns the body (Z) and one that nods the head (X).
              </p>
            )}
            {robot && <RobotExport robot={robot} screens={screens} />}
          </section>
        )}
      </aside>
    </div>
  );
}
