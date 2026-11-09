// The flight controller and attitude estimator, shared by the simulator (sim.ts) and the drone
// code export: src/core/drone/firmware/flight_core.h is a line-by-line C++ copy, and the parity
// test compiles it and compares outputs. ANY CHANGE HERE MUST BE MADE THERE TOO.
//
// Units: motor outputs are a share of one motor's full thrust (0..1). Body frame: x right,
// y back, z up; quaternions are (w, x, y, z), body → world.

import type { Pid } from "./model";

export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export interface FlightConfig {
  /** Mixer: rows = motors, columns = (Fz, τx, τy, τz) → thrust of that motor (N per N / N·m). */
  mixer: number[][];
  /** Inertia about the centre of mass, kg·m², row-major 3×3. */
  inertia: number[];
  /** Full thrust of one motor on a full battery, N. */
  maxThrust: number;
  rollPitch: Pid;
  yaw: Pid;
  maxTilt: number; // rad
  maxYawRate: number; // rad/s
}

// --- quaternion helpers (mirrored in C++) --------------------------------------------------
export const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q: Q): Q => [q[0], -q[1], -q[2], -q[3]];
export const qnorm = (q: Q): Q => { const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };
export const rotate = (q: Q, v: V3): V3 => { const p = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q)); return [p[1], p[2], p[3]]; };
export const axisAngle = (axis: V3, a: number): Q => [Math.cos(a / 2), axis[0] * Math.sin(a / 2), axis[1] * Math.sin(a / 2), axis[2] * Math.sin(a / 2)];
/** Rotation vector (axis × angle) of a unit quaternion, the short way round. */
export function rotVec(q: Q): V3 {
  const s = q[0] < 0 ? -1 : 1;
  const w = Math.min(1, Math.abs(q[0]));
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalf < 1e-9) return [2 * s * q[1], 2 * s * q[2], 2 * s * q[3]];
  const k = (s * 2 * Math.acos(w)) / sinHalf;
  return [q[1] * k, q[2] * k, q[3] * k];
}
/** Heading (rad): +a is a counter-clockwise turn seen from above; 0 = facing -Y. */
export function yawOf(q: Q): number { const f = rotate(q, [0, -1, 0]); return Math.atan2(f[0], -f[1]); }

export class FlightController {
  readonly c: FlightConfig;
  integ: V3 = [0, 0, 0];
  lastOmega: V3 = [0, 0, 0];

  constructor(config: FlightConfig) { this.c = config; }

  reset() { this.integ = [0, 0, 0]; this.lastOmega = [0, 0, 0]; }

  /**
   * One control step. Sticks -1..1 (roll right, pitch forward, yaw right); `collective` is the
   * wanted total thrust as a share of one motor's full thrust (0..motors). `airborne` lets the
   * integral term build up (never on the ground). Returns each motor's share of full thrust.
   */
  update(q: Q, omega: V3, roll: number, pitch: number, yaw: number, collective: number, dt: number, airborne: boolean): number[] {
    const c = this.c;
    const want = qmul(qmul(axisAngle([0, 0, 1], yawOf(q)), axisAngle([1, 0, 0], pitch * c.maxTilt)), axisAngle([0, 1, 0], roll * c.maxTilt));
    const err = rotVec(qmul(qconj(q), want));
    const wantRate: V3 = [c.rollPitch.angleP * err[0], c.rollPitch.angleP * err[1], c.yaw.angleP * err[2] - yaw * c.maxYawRate];
    const gains = [c.rollPitch, c.rollPitch, c.yaw];
    const accel: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const e = wantRate[k]! - omega[k]!;
      if (airborne) this.integ[k] = Math.max(-2, Math.min(2, this.integ[k]! + e * dt));
      accel[k] = gains[k]!.rateP * e + gains[k]!.rateI * this.integ[k]! - (gains[k]!.rateD * (omega[k]! - this.lastOmega[k]!)) / dt;
    }
    this.lastOmega = [omega[0], omega[1], omega[2]];
    const J = c.inertia;
    const tau: V3 = [
      J[0]! * accel[0] + J[1]! * accel[1] + J[2]! * accel[2],
      J[3]! * accel[0] + J[4]! * accel[1] + J[5]! * accel[2],
      J[6]! * accel[0] + J[7]! * accel[1] + J[8]! * accel[2],
    ];
    const n = c.mixer.length;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = c.mixer[i]!;
      out.push((m[0]! * collective * c.maxThrust + m[1]! * tau[0] + m[2]! * tau[1] + m[3]! * tau[2]) / c.maxThrust);
    }
    // Keep steering when a motor would saturate: shift the whole set (attitude first).
    let hi = out[0]!, lo = out[0]!;
    for (const v of out) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
    if (hi > 1) { for (let i = 0; i < n; i++) out[i]! -= hi - 1; lo -= hi - 1; hi = 1; }
    if (lo < 0 && hi - lo <= 1) for (let i = 0; i < n; i++) out[i]! -= lo;
    return out.map((v) => Math.max(0, Math.min(1, v)));
  }
}

/**
 * Attitude from the IMU (complementary filter): integrate the gyro, and pull slowly towards the
 * gravity direction the accelerometer measures. The real drone uses this; the simulator knows
 * its true attitude, so it only runs in the parity test and on hardware.
 */
export class AttitudeEstimator {
  q: Q = [1, 0, 0, 0];
  /** How strongly the accelerometer corrects the gyro (1/s). */
  constructor(public gain = 2) {}

  update(gyro: V3, accel: V3, dt: number) {
    const an = Math.sqrt(accel[0] * accel[0] + accel[1] * accel[1] + accel[2] * accel[2]);
    let w: V3 = [gyro[0], gyro[1], gyro[2]];
    // Trust the accelerometer only near 1 g (not while accelerating hard).
    if (an > 0.5 * 9.80665 && an < 1.5 * 9.80665) {
      const a: V3 = [accel[0] / an, accel[1] / an, accel[2] / an];
      const up = rotate(qconj(this.q), [0, 0, 1]); // where "up" should be, in the body frame
      const e: V3 = [a[1] * up[2] - a[2] * up[1], a[2] * up[0] - a[0] * up[2], a[0] * up[1] - a[1] * up[0]];
      w = [w[0] + this.gain * e[0], w[1] + this.gain * e[1], w[2] + this.gain * e[2]];
    }
    this.q = qnorm(qmul(this.q, [1, (w[0] * dt) / 2, (w[1] * dt) / 2, (w[2] * dt) / 2]));
    return this.q;
  }
}

const G = 9.80665;

/**
 * Height hold (needs the height: the simulator knows it, a real drone measures it with a
 * VL53L1X distance sensor). Stick away from the middle = climb / sink speed; let go = hold the
 * height it had then. Returns the collective (share of one motor's full thrust, 0..motors).
 */
export class HeightHold {
  hold: number | null = null;
  constructor(public mass: number, public maxThrust: number, public motors: number, public maxClimb = 1.5) {}

  reset() { this.hold = null; }

  update(climb: number, vz: number, height: number, up: number): number {
    let wantVz: number;
    if (Math.abs(climb) > 0.05) {
      wantVz = Math.max(-1, Math.min(1, climb)) * this.maxClimb;
      this.hold = null;
    } else if (this.hold === null && Math.abs(vz) > 0.3) {
      wantVz = 0; // brake first, then hold the height where it stopped (no overshoot)
    } else {
      if (this.hold === null) this.hold = height;
      wantVz = Math.max(-this.maxClimb, Math.min(this.maxClimb, 1.5 * (this.hold - height)));
    }
    const u = Math.max(0.5, up);
    return Math.max(0, Math.min(this.motors, (this.mass * (G + 4 * (wantVz - vz))) / u / this.maxThrust));
  }
}
