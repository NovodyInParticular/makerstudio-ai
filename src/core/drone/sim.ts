// Flight simulation of a Drone Studio design: rigid-body physics (6 degrees of freedom), motors
// with spin-up lag, a battery that sags as it empties, air drag, the ground, and a "stabilize"
// flight controller like ESP-Drone's (stick = wanted tilt; it holds level when you let go).
//
// Axes: MakerStudio world, Z up, front = -Y. Body frame: x right, y back, z up.
// Units: SI (m, kg, N, s). It is an estimate: no propeller wash, ground effect, frame flex
// or vibration. Good for "does it fly and can it be controlled", not a replacement for a test hover.

import type { Drone } from "./model";
import { analyseDrone, mixerMatrix, TORQUE_PER_THRUST, type DroneReport } from "./analysis";
import { axisAngle, FlightController, HeightHold, qmul, qnorm, rotate, yawOf } from "./flight";
import type { CadObject } from "../cad/model";

const G = 9.80665;
type V3 = [number, number, number];
type Q = [number, number, number, number]; // w, x, y, z

/**
 * throttle 0..1 (share of full thrust), roll / pitch / yaw -1..1. In height-hold mode `climb`
 * (-1..1, 0 = stay at this height) is used instead of throttle.
 */
export interface Sticks { throttle: number; roll: number; pitch: number; yaw: number; climb?: number }
export type FlightMode = "stabilize" | "height-hold";

export interface SimParams {
  mass: number; // kg
  inertia: number[]; // 3×3 row-major, kg·m², about the centre of mass
  motors: { r: V3; spin: number }[]; // positions from the centre of mass (m, body)
  maxThrust: number; // N per motor on a full battery
  cells: number;
  capacity: number; // mAh
  efficiency: number; // g/W
  /** Height of the centre of mass above the lowest point of the frame (m). */
  standHeight: number;
  pid: Drone["pid"];
}

export const LIMITS = { maxClimb: 1.5, maxTilt: (30 * Math.PI) / 180, maxYawRate: Math.PI, motorLag: 0.025, crashSpeed: 3, crashTilt: (70 * Math.PI) / 180 };

/** Physics parameters of a design, from the Will-it-fly analysis. */
export function simParams(drone: Drone, objects: CadObject[], report: DroneReport = analyseDrone(drone, objects)): SimParams {
  const c = report.total.centre;
  return {
    mass: report.total.mass / 1000,
    inertia: report.total.inertia.map((v) => v * 1e-9), // g·mm² → kg·m²
    motors: drone.motors.map((m) => ({ r: [(m.position[0] - c[0]) / 1000, (m.position[1] - c[1]) / 1000, (m.position[2] - c[2]) / 1000] as V3, spin: m.spin })),
    maxThrust: (drone.maxThrust / 1000) * G,
    cells: drone.battery.cells,
    capacity: drone.battery.capacity,
    efficiency: drone.efficiency,
    standHeight: Math.max(0.002, (c[2] - Math.min(report.frame.bottom, ...drone.motors.map((m) => m.position[2]))) / 1000),
    pid: drone.pid,
  };
}

// --- small vector / quaternion helpers ------------------------------------------------------
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mul3 = (m: number[], v: V3): V3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export type Status = "landed" | "flying" | "crashed" | "battery-empty";

export class DroneSim {
  readonly p: SimParams;
  private Jinv: number[];
  private fc: FlightController | null;
  private hh: HeightHold;
  pos: V3 = [0, 0, 0];
  vel: V3 = [0, 0, 0];
  q: Q = [1, 0, 0, 0];
  omega: V3 = [0, 0, 0]; // body rates
  thrust: number[]; // actual thrust per motor, N
  armed = false;
  status: Status = "landed";
  usedMah = 0;
  time = 0;
  crashReason = "";
  /** Stabilize: throttle is thrust. Height hold: the stick sets climb speed (needs a height sensor on the real drone). */
  mode: FlightMode = "stabilize";
  /** Extra force (world, N) for a moment, e.g. a gust. */
  private push: { force: V3; until: number } | null = null;

  constructor(params: SimParams) {
    this.p = params;
    this.Jinv = invert3(params.inertia);
    const mix = mixerMatrix(params.motors.map((m) => ({ x: m.r[0], y: m.r[1], spin: m.spin })));
    this.fc = mix ? new FlightController({ mixer: mix, inertia: params.inertia, maxThrust: params.maxThrust, rollPitch: params.pid.rollPitch, yaw: params.pid.yaw, maxTilt: LIMITS.maxTilt, maxYawRate: LIMITS.maxYawRate }) : null;
    this.hh = new HeightHold(params.mass, params.maxThrust, params.motors.length, LIMITS.maxClimb);
    this.thrust = params.motors.map(() => 0);
    this.pos = [0, 0, params.standHeight];
  }

  get voltage() { return this.p.cells * Math.max(3.0, 4.2 - 1.2 * Math.min(1, this.usedMah / this.p.capacity)); }
  get batteryLeft() { return Math.max(0, 1 - this.usedMah / this.p.capacity); }
  get altitude() { return this.pos[2] - this.p.standHeight; }
  get tilt() { const up = rotate(this.q, [0, 0, 1]); return Math.acos(Math.max(-1, Math.min(1, up[2]))); }
  /** Heading (rad, 0 = facing -Y, positive turning left / counter-clockwise from above). */
  get yaw() { return yawOf(this.q); }

  arm(on: boolean) {
    if (this.status === "crashed") return;
    this.armed = on;
    this.fc?.reset();
  }

  reset() {
    this.pos = [0, 0, this.p.standHeight]; this.vel = [0, 0, 0]; this.q = [1, 0, 0, 0]; this.omega = [0, 0, 0];
    this.thrust = this.thrust.map(() => 0); this.armed = false; this.status = "landed"; this.usedMah = 0; this.time = 0; this.crashReason = ""; this.fc?.reset();
  }

  gust(force: V3, seconds = 0.3) { this.push = { force, until: this.time + seconds }; }

  /** Flight controller (shared with the drone code): wanted motor thrusts (N) for these sticks. */
  private control(s: Sticks, dt: number): number[] {
    const n = this.p.motors.length;
    if (!this.armed || !this.fc) return this.p.motors.map(() => 0);
    let collective = Math.max(0, Math.min(1, s.throttle)) * n; // share of one motor's full thrust
    if (this.mode === "height-hold") {
      // The shared height hold (as on a drone with a height sensor); it stays down until told to climb.
      const climb = s.climb ?? 0;
      collective = this.hh.update(climb, this.vel[2], this.altitude, rotate(this.q, [0, 0, 1])[2]);
      if (this.status !== "flying" && climb <= 0.05) { collective = Math.min(collective, (this.p.mass * G * 0.9) / this.p.maxThrust); this.hh.reset(); }
    } else this.hh.reset();
    const share = this.fc.update(this.q, this.omega, s.roll, s.pitch, s.yaw, collective, dt, this.status === "flying");
    const sag = (this.voltage / (4.2 * this.p.cells)) ** 2;
    return share.map((f) => f * this.p.maxThrust * sag);
  }


  /** Advance the simulation; uses 1 ms internal steps. */
  step(seconds: number, sticks: Sticks) {
    const dt = 0.001;
    for (let k = 0, n = Math.max(1, Math.round(seconds / dt)); k < n; k++) this.tick(dt, sticks);
  }

  private tick(dt: number, sticks: Sticks) {
    this.time += dt;
    if (this.status === "crashed") return;
    const wanted = this.status === "battery-empty" ? this.thrust.map(() => 0) : this.control(sticks, dt);
    const a = dt / (LIMITS.motorLag + dt);
    this.thrust = this.thrust.map((t, i) => t + (wanted[i]! - t) * a);

    // Battery: power from thrust per watt.
    const grams = this.thrust.reduce((s, t) => s + (t / G) * 1000, 0);
    const amps = grams / this.p.efficiency / this.voltage;
    this.usedMah += (amps * dt * 1000) / 3600;
    if (this.usedMah >= this.p.capacity && this.status !== "battery-empty") { this.status = "battery-empty"; this.armed = false; }

    // Forces (world) and torques (body).
    const total = this.thrust.reduce((s, t) => s + t, 0);
    let force: V3 = rotate(this.q, [0, 0, total]);
    force = add(force, [0, 0, -this.p.mass * G]);
    const speed = Math.hypot(...this.vel);
    force = add(force, scale(this.vel, -0.02 - 0.01 * speed)); // air drag (estimate)
    if (this.push && this.time < this.push.until) force = add(force, this.push.force);
    let torque: V3 = [0, 0, 0];
    this.p.motors.forEach((m, i) => {
      torque = add(torque, cross(m.r, [0, 0, this.thrust[i]!]));
      torque[2] += -m.spin * TORQUE_PER_THRUST * this.thrust[i]!;
    });
    torque = add(torque, scale(this.omega, -2e-5)); // rotational drag (estimate)
    const Jw = mul3(this.p.inertia, this.omega);
    const alpha = mul3(this.Jinv, add(torque, scale(cross(this.omega, Jw), -1)));

    this.vel = add(this.vel, scale(force, dt / this.p.mass));
    this.omega = add(this.omega, scale(alpha, dt));
    this.pos = add(this.pos, scale(this.vel, dt));
    const w = this.omega;
    this.q = qnorm(qmul(this.q, [1, (w[0] * dt) / 2, (w[1] * dt) / 2, (w[2] * dt) / 2]));

    // Ground.
    if (this.pos[2] <= this.p.standHeight) {
      const impact = -this.vel[2];
      if (this.status === "flying" && (impact > LIMITS.crashSpeed || this.tilt > LIMITS.crashTilt)) {
        this.status = "crashed";
        this.armed = false;
        this.crashReason = impact > LIMITS.crashSpeed ? `hit the ground at ${impact.toFixed(1)} m/s` : `touched down tilted ${Math.round((this.tilt * 180) / Math.PI)}°`;
        this.thrust = this.thrust.map(() => 0);
      }
      this.pos[2] = this.p.standHeight;
      if (this.vel[2] < 0) this.vel[2] = 0;
      // Friction and the ground holding it level while resting.
      this.vel[0] *= 0.9; this.vel[1] *= 0.9;
      const up = total < this.p.mass * G * 0.98;
      if (up) {
        this.omega = scale(this.omega, 0.8);
        const yawOnly = axisAngle([0, 0, 1], this.yaw);
        this.q = qnorm([this.q[0] * 0.9 + yawOnly[0] * 0.1, this.q[1] * 0.9 + yawOnly[1] * 0.1, this.q[2] * 0.9 + yawOnly[2] * 0.1, this.q[3] * 0.9 + yawOnly[3] * 0.1]);
        if (this.status === "flying") this.status = "landed";
      }
    } else if (this.status === "landed" && this.altitude > 0.01) this.status = "flying";
  }

  /** Orientation as a quaternion (w, x, y, z) for drawing. */
  get attitude(): Q { return this.q; }
}
