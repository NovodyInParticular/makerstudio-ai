// "Will it fly?": mass, balance, thrust and flight time of a drone design, from the 3D Studio
// frame (exact solid volumes) and the parts listed in the Drone Studio.
//
// Mass properties of a closed mesh use the signed tetrahedra from the origin (divergence
// theorem). Everything is in millimetres and grams here; physicsOf() converts to SI.

import { collectParts } from "../cad/exporting";
import type { CadObject } from "../cad/model";
import type { Drone } from "./model";

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

const G = 9.80665;
/** Reaction torque per newton of thrust for small propellers (m). Typical estimate. */
export const TORQUE_PER_THRUST = 0.012;

export interface MassProps { mass: number; centre: Vec3; inertia: Mat3 } // g, mm, g·mm² about centre

/** Volume (mm³), centroid and second moment (about the origin) of a closed triangle mesh. */
export function meshMoments(positions: Float32Array, indices: Uint32Array) {
  let vol = 0;
  const c = [0, 0, 0];
  // Covariance-style second moments ∫ x_i x_j dV
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, d = indices[t + 2]! * 3;
    const A = [positions[a]!, positions[a + 1]!, positions[a + 2]!];
    const B = [positions[b]!, positions[b + 1]!, positions[b + 2]!];
    const C = [positions[d]!, positions[d + 1]!, positions[d + 2]!];
    const v = (A[0]! * (B[1]! * C[2]! - B[2]! * C[1]!) - A[1]! * (B[0]! * C[2]! - B[2]! * C[0]!) + A[2]! * (B[0]! * C[1]! - B[1]! * C[0]!)) / 6;
    vol += v;
    for (let i = 0; i < 3; i++) c[i]! += (v * (A[i]! + B[i]! + C[i]!)) / 4;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      // ∫ over the tetra (0, A, B, C) of x_i x_j = v/20 · (Σ P_i P_j + (ΣP)_i (ΣP)_j)
      const sum = A[i]! * A[j]! + B[i]! * B[j]! + C[i]! * C[j]!;
      S[i * 3 + j]! += (v / 20) * (sum + (A[i]! + B[i]! + C[i]!) * (A[j]! + B[j]! + C[j]!));
    }
  }
  return { volume: vol, centroid: (vol !== 0 ? c.map((x) => x / vol) : [0, 0, 0]) as Vec3, second: S };
}

/** Combine point masses / bodies into one (mass, centre, inertia about that centre). */
export function combine(bodies: MassProps[]): MassProps {
  const mass = bodies.reduce((s, b) => s + b.mass, 0);
  if (mass <= 0) return { mass: 0, centre: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const centre = [0, 1, 2].map((k) => bodies.reduce((s, b) => s + b.mass * b.centre[k]!, 0) / mass) as Vec3;
  const I: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const b of bodies) {
    const d = [b.centre[0] - centre[0], b.centre[1] - centre[1], b.centre[2] - centre[2]];
    const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      I[i * 3 + j]! += b.inertia[i * 3 + j]! + b.mass * ((i === j ? dd : 0) - d[i]! * d[j]!); // parallel axis
    }
  }
  return { mass, centre, inertia: I };
}

const point = (mass: number, centre: Vec3): MassProps => ({ mass, centre, inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] });

export interface FrameMass extends MassProps { volume: number; open: string[]; bottom: number; ids: string[] }

/** The printed frame: solid volume × density × fill, with its centre and inertia. */
export function frameMass(drone: Drone, objects: CadObject[]): FrameMass {
  const roots = objects.filter((o) => o.parentId === null && o.visible);
  const ids = drone.frame.length ? drone.frame.filter((id) => roots.some((o) => o.id === id)) : roots.map((o) => o.id);
  const { parts } = ids.length ? collectParts(ids, objects) : { parts: [] };
  const open: string[] = [];
  const bodies: MassProps[] = [];
  let volume = 0, bottom = Infinity;
  const gPerMm3 = (drone.density / 1000) * (drone.fill / 100);
  for (const part of parts) {
    for (let i = 2; i < part.positions.length; i += 3) bottom = Math.min(bottom, part.positions[i]!);
    if (!part.watertight) { open.push(part.name); continue; }
    const m = meshMoments(part.positions, part.indices);
    if (m.volume <= 0) continue;
    volume += m.volume;
    const mass = m.volume * gPerMm3;
    // Inertia about the origin from the second moments, then moved to the part's centroid.
    const S = m.second.map((x) => x * gPerMm3);
    const tr = S[0]! + S[4]! + S[8]!;
    const Io = S.map((x, k) => (k % 4 === 0 ? tr - x : -x)) as Mat3;
    const c = m.centroid, cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    const Ic = Io.map((x, k) => { const i = Math.floor(k / 3), j = k % 3; return x - mass * ((i === j ? cc : 0) - c[i]! * c[j]!); }) as Mat3;
    bodies.push({ mass, centre: c, inertia: Ic });
  }
  const all = combine(bodies);
  return { ...all, volume, open, bottom: Number.isFinite(bottom) ? bottom : 0, ids };
}

export type Verdict = "good" | "warning" | "danger";
export interface Finding { verdict: Verdict; title: string; detail: string }

export interface DroneReport {
  frame: FrameMass;
  total: MassProps;
  /** Mass breakdown, grams. */
  parts: { name: string; mass: number; estimated: boolean }[];
  thrustToWeight: number;
  hoverThrottle: number; // 0..1 of full thrust
  /** Each motor's share of the hover thrust (0..1 of its maximum); > 1 means it cannot hold the drone level. */
  hoverLoads: number[];
  balanceOffset: number; // mm, centre of mass from the motors' centre (top view)
  propClearance: number; // mm, smallest gap between neighbouring propeller discs
  flightMinutes: number;
  findings: Finding[];
}

/** Solve motor thrusts for a wanted collective force and torques (least squares; any motor layout). */
export function mixer(motors: { x: number; y: number; spin: number }[], kQ = TORQUE_PER_THRUST) {
  const P = mixerMatrix(motors, kQ);
  if (!P) return null;
  return (wanted: [number, number, number, number]) => P.map((row) => row.reduce((s, v, j) => s + v * wanted[j]!, 0));
}

/** The mixer as a matrix: rows = motors, columns = (Fz, τx, τy, τz); null when the layout cannot steer. */
export function mixerMatrix(motors: { x: number; y: number; spin: number }[], kQ = TORQUE_PER_THRUST): number[][] | null {
  // Rows: Fz, τx, τy, τz per unit thrust of each motor (body frame, metres).
  const M = [motors.map(() => 1), motors.map((m) => m.y), motors.map((m) => -m.x), motors.map((m) => -m.spin * kQ)];
  const n = motors.length;
  // pinv = Mᵀ (M Mᵀ)⁻¹
  const MMt = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => M[i]!.reduce((s, v, k) => s + v * M[j]![k]!, 0)));
  const inv = invert4(MMt);
  if (!inv) return null;
  return Array.from({ length: n }, (_, k) => Array.from({ length: 4 }, (_, j) => M.reduce((s, row, i) => s + row[k]! * inv[i]![j]!, 0)));
}

function invert4(a: number[][]): number[][] | null {
  const n = 4;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const scale = Math.max(1e-12, ...a.map((row) => Math.max(...row.map(Math.abs))));
    if (Math.abs(m[pivot]![col]!) < 1e-9 * scale) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const p = m[col]![col]!;
    for (let j = 0; j < 2 * n; j++) m[col]![j]! /= p;
    for (let r = 0; r < n; r++) if (r !== col) { const f = m[r]![col]!; for (let j = 0; j < 2 * n; j++) m[r]![j]! -= f * m[col]![j]!; }
  }
  return m.map((row) => row.slice(n));
}

export function analyseDrone(drone: Drone, objects: CadObject[]): DroneReport {
  const frame = frameMass(drone, objects);
  const n = drone.motors.length;
  const motorCentre: Vec3 = [0, 1, 2].map((k) => drone.motors.reduce((s, m) => s + m.position[k]!, 0) / n) as Vec3;
  // Parts with no place of their own sit at the motors' centre, at the frame's centre height.
  const hub: Vec3 = [motorCentre[0], motorCentre[1], frame.mass > 0 ? frame.centre[2] : motorCentre[2]];
  const bodies: MassProps[] = [
    ...(frame.mass > 0 ? [frame as MassProps] : []),
    ...drone.motors.map((m) => point(drone.motorMass + drone.propMass, m.position)),
    point(drone.battery.mass, hub),
    ...drone.extras.map((e) => point(e.mass, e.position ?? hub)),
  ];
  const total = combine(bodies);
  const parts = [
    { name: `Frame (printed, ${Math.round(frame.volume / 1000 * 10) / 10} cm³)`, mass: frame.mass, estimated: false },
    { name: `${n} motors`, mass: n * drone.motorMass, estimated: true },
    { name: `${n} propellers`, mass: n * drone.propMass, estimated: true },
    { name: `Battery ${drone.battery.cells}S ${drone.battery.capacity} mAh`, mass: drone.battery.mass, estimated: true },
    ...drone.extras.map((e) => ({ name: e.name, mass: e.mass, estimated: true })),
  ];

  const totalThrust = n * drone.maxThrust;
  const thrustToWeight = total.mass > 0 ? totalThrust / total.mass : 0;
  const hoverThrottle = thrustToWeight > 0 ? 1 / thrustToWeight : Infinity;

  // Hover: thrusts that hold the weight with no torque about the centre of mass.
  const rel = drone.motors.map((m) => ({ x: (m.position[0] - total.centre[0]) / 1000, y: (m.position[1] - total.centre[1]) / 1000, spin: m.spin }));
  const mix = mixer(rel);
  const weightN = (total.mass / 1000) * G;
  const hoverLoads = mix ? mix([weightN, 0, 0, 0]).map((t) => t / ((drone.maxThrust / 1000) * G)) : drone.motors.map(() => Infinity);

  const balanceOffset = Math.hypot(total.centre[0] - motorCentre[0], total.centre[1] - motorCentre[1]);
  let propClearance = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = drone.motors[i]!.position, b = drone.motors[j]!.position;
    propClearance = Math.min(propClearance, Math.hypot(a[0] - b[0], a[1] - b[1]) - drone.propDiameter);
  }
  // Hover power from thrust per watt; 80 % of the capacity is usable.
  const volts = 3.7 * drone.battery.cells;
  const amps = total.mass / drone.efficiency / volts;
  const flightMinutes = amps > 0 ? ((drone.battery.capacity / 1000) * 0.8 / amps) * 60 : 0;

  const findings: Finding[] = [];
  if (frame.ids.length === 0) findings.push({ verdict: "warning", title: "No frame", detail: "There are no 3D objects to weigh. Design the frame in 3D Studio (or start the Flix practice project)." });
  if (frame.open.length) findings.push({ verdict: "warning", title: "Frame parts not weighed", detail: `${frame.open.join(", ")} ${frame.open.length === 1 ? "is" : "are"} not a closed solid, so ${frame.open.length === 1 ? "its" : "their"} weight is missing.` });
  if (thrustToWeight < 1) findings.push({ verdict: "danger", title: `Too heavy to lift off (thrust-to-weight ${thrustToWeight.toFixed(2)})`, detail: `The motors give ${Math.round(totalThrust)} g of thrust at most, the drone weighs ${Math.round(total.mass)} g. Lighten the frame, use a smaller battery, or stronger motors / bigger propellers.` });
  else if (thrustToWeight < 1.5) findings.push({ verdict: "danger", title: `Barely flies (thrust-to-weight ${thrustToWeight.toFixed(2)})`, detail: "It can lift off but has almost no thrust left to steer or stop falling. Aim for 2 or more (a common rule of thumb)." });
  else if (thrustToWeight < 2) findings.push({ verdict: "warning", title: `Sluggish (thrust-to-weight ${thrustToWeight.toFixed(2)})`, detail: "It will fly, but slowly and with little reserve; 2 or more is a common rule of thumb." });
  else findings.push({ verdict: "good", title: `Enough thrust (thrust-to-weight ${thrustToWeight.toFixed(2)})`, detail: `Hovers at about ${Math.round(hoverThrottle * 100)} % of full thrust.` });

  const worst = Math.max(...hoverLoads);
  const least = Math.min(...hoverLoads);
  if (!mix) findings.push({ verdict: "danger", title: "Motors cannot steer it", detail: "With motors in these places the drone cannot control roll, pitch and yaw (for example all motors in a line, or all spinning the same way)." });
  else if (worst > 0.9 || least < 0) findings.push({ verdict: "danger", title: "Cannot hover level", detail: `To balance the weight one motor would need ${Math.round(worst * 100)} % of its thrust${least < 0 ? " and another would have to pull downwards" : ""}. Move the battery or parts so the centre of mass is under the middle of the motors.` });
  else if (worst - least > 0.15) findings.push({ verdict: "warning", title: `Off balance by ${balanceOffset.toFixed(1)} mm`, detail: `The motors must work unevenly to hover (${Math.round(least * 100)}-${Math.round(worst * 100)} % of their thrust), leaving less for steering. Move parts so the centre of mass is under the middle of the motors.` });
  else findings.push({ verdict: "good", title: `Balanced (${balanceOffset.toFixed(1)} mm from centre)`, detail: "The centre of mass is close to the middle of the motors." });

  if (propClearance < 0) findings.push({ verdict: "danger", title: "Propellers overlap", detail: `Neighbouring propeller discs overlap by ${(-propClearance).toFixed(1)} mm. Move the motors apart or use smaller propellers.` });
  else if (propClearance < 3) findings.push({ verdict: "warning", title: "Propellers almost touch", detail: `Only ${propClearance.toFixed(1)} mm between neighbouring propellers; leave a few mm.` });
  else findings.push({ verdict: "good", title: "Propellers have room", detail: `${propClearance.toFixed(1)} mm between neighbouring propellers.` });

  if (thrustToWeight >= 1) findings.push({ verdict: flightMinutes < 2 ? "warning" : "good", title: `About ${flightMinutes.toFixed(1)} minutes of hovering`, detail: `Estimate from ${drone.efficiency} g/W and 80 % of ${drone.battery.capacity} mAh; real flights are shorter.` });

  return { frame, total, parts, thrustToWeight, hoverThrottle, hoverLoads, balanceOffset, propClearance, flightMinutes, findings };
}
