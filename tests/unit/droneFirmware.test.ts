// The drone code's flight controller (C++, flight_core.h) must compute exactly what the
// simulator's (flight.ts) does: compile it with the generated config and compare step by step.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initCsg } from "../../src/core/cad/csg";
import { DEFAULT_PARAMS, IDENTITY, type CadObject } from "../../src/core/cad/model";
import { analyseDrone, mixerMatrix } from "../../src/core/drone/analysis";
import { droneCodeProject, flightConfigHeader, imuToBody, newWifiPassword } from "../../src/core/drone/firmware";
import { AttitudeEstimator, FlightController, HeightHold, qnorm, type Q, type V3 } from "../../src/core/drone/flight";
import { defaultDrone, quadX } from "../../src/core/drone/model";
import { LIMITS, simParams } from "../../src/core/drone/sim";

const cxx = ["g++", "clang++"].find((c) => spawnSync(c, ["--version"]).status === 0);

beforeAll(async () => { await initCsg(async () => (await import("manifold-3d/manifold")).default()); });

const box = (id: string, w: number, d: number, h: number, position: [number, number, number] = [0, 0, 0]): CadObject => ({
  id, name: id, kind: "box", params: { ...DEFAULT_PARAMS.box, width: w, depth: d, height: h }, transform: { ...IDENTITY, position },
  hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false,
});
// An uneven design on purpose (off-centre part, uneven arms) so the mixer and inertia are not trivial.
const frame = [box("plate", 40, 36, 3), box("arm", 120, 6, 3, [4, 0, 0]), box("arm2", 6, 110, 3)];
const drone = { ...defaultDrone(quadX(118, [2, -1], 5)), extras: [{ name: "camera", mass: 3, position: [8, -10, 6] as [number, number, number] }] };

function rng(seed: number) { let s = seed; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

describe.skipIf(!cxx)("drone code: C++ flight core = simulator controller", () => {
  it("gives the same motor outputs for 400 steps of random attitudes, rates and sticks", () => {
    const report = analyseDrone(drone, frame);
    const p = simParams(drone, frame, report);
    const fc = new FlightController({ mixer: mixerMatrix(p.motors.map((m) => ({ x: m.r[0], y: m.r[1], spin: m.spin })))!, inertia: p.inertia, maxThrust: p.maxThrust, rollPitch: drone.pid.rollPitch, yaw: drone.pid.yaw, maxTilt: LIMITS.maxTilt, maxYawRate: LIMITS.maxYawRate });
    const r = rng(7);
    const steps = Array.from({ length: 400 }, () => {
      const q = qnorm([1 + r() * 0.5, r() - 0.5, r() - 0.5, (r() - 0.5) * 2] as Q);
      return { q, w: [(r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 3] as V3, roll: r() * 2 - 1, pitch: r() * 2 - 1, yaw: r() * 2 - 1, col: r() * 4, dt: 0.001 + r() * 0.004, air: r() > 0.3 };
    });
    const dir = mkdtempSync(path.join(tmpdir(), "ms-drone-"));
    writeFileSync(path.join(dir, "flight_core.h"), readFileSync("src/core/drone/firmware/flight_core.h", "utf8"));
    writeFileSync(path.join(dir, "flight_config.h"), flightConfigHeader(drone, frame, report));
    const lit = (n: number) => n.toPrecision(17);
    writeFileSync(path.join(dir, "main.cpp"), `
#include <cstdio>
#include "flight_config.h"
struct Step { double q[4]; double w[3]; double roll, pitch, yaw, col, dt; int air; };
static const Step STEPS[] = {
${steps.map((s) => `  {{${s.q.map(lit).join(",")}}, {${s.w.map(lit).join(",")}}, ${lit(s.roll)}, ${lit(s.pitch)}, ${lit(s.yaw)}, ${lit(s.col)}, ${lit(s.dt)}, ${s.air ? 1 : 0}},`).join("\n")}
};
int main() {
  FcController fc; fc.c = &FC_CONFIG;
  double out[FC_MAX_MOTORS];
  for (const Step& s : STEPS) {
    fc.update(s.q, s.w, s.roll, s.pitch, s.yaw, s.col, s.dt, s.air != 0, out);
    for (int i = 0; i < FC_CONFIG.motors; i++) printf("%.15g ", out[i]);
    printf("\\n");
  }
  FcEstimator est;
  for (int i = 0; i < 2000; i++) {
    double t = i * 0.002;
    double g[3] = {0.8 * sin(t * 3), 0.5 * cos(t * 2), 0.3};
    double a[3] = {9.80665 * sin(0.2 * sin(t)), 9.80665 * 0.1, 9.80665 * cos(0.2)};
    est.update(g, a, 0.002);
  }
  printf("%.15g %.15g %.15g %.15g\\n", est.q[0], est.q[1], est.q[2], est.q[3]);
  FcHeightHold hh; hh.mass = 0.07; hh.maxThrust = 0.34; hh.motors = 4;
  for (int i = 0; i < 300; i++) {
    double climb = (i % 50 < 20) ? 0.0 : sin(i * 0.3), vz = 0.5 * sin(i * 0.11), height = 1 + 0.4 * cos(i * 0.07), up = 0.8 + 0.2 * cos(i * 0.05);
    printf("%.15g ", hh.update(climb, vz, height, up));
  }
  printf("\\n");
}
`);
    execFileSync(cxx!, ["-std=c++17", "-O1", "-Wall", "-Werror", "-Wno-unused-function", "-o", "drone", "main.cpp", "-lm"], { cwd: dir });
    const lines = execFileSync(path.join(dir, "drone"), { encoding: "utf8" }).trim().split("\n");
    let worst = 0;
    steps.forEach((s, i) => {
      const ts = fc.update(s.q, s.w, s.roll, s.pitch, s.yaw, s.col, s.dt, s.air);
      const c = lines[i]!.trim().split(" ").map(Number);
      expect(c.length).toBe(ts.length);
      ts.forEach((v, k) => { worst = Math.max(worst, Math.abs(v - c[k]!)); });
    });
    expect(worst).toBeLessThan(1e-9);
    // Not trivial: the outputs move around and some saturate.
    expect(new Set(lines).size).toBeGreaterThan(150);

    const est = new AttitudeEstimator();
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.002;
      est.update([0.8 * Math.sin(t * 3), 0.5 * Math.cos(t * 2), 0.3], [9.80665 * Math.sin(0.2 * Math.sin(t)), 9.80665 * 0.1, 9.80665 * Math.cos(0.2)], 0.002);
    }
    const cq = lines[steps.length]!.trim().split(" ").map(Number);
    est.q.forEach((v, k) => expect(Math.abs(v - cq[k]!)).toBeLessThan(1e-9));

    const hh = new HeightHold(0.07, 0.34, 4);
    const ch = lines[steps.length + 1]!.trim().split(" ").map(Number);
    for (let i = 0; i < 300; i++) {
      const climb = i % 50 < 20 ? 0 : Math.sin(i * 0.3), vz = 0.5 * Math.sin(i * 0.11), height = 1 + 0.4 * Math.cos(i * 0.07), up = 0.8 + 0.2 * Math.cos(i * 0.05);
      expect(Math.abs(hh.update(climb, vz, height, up) - ch[i]!)).toBeLessThan(1e-9);
    }
  });
});

describe("drone code: estimator, IMU direction and project", () => {
  it("the attitude estimator finds level from gravity and follows a steady tilt", () => {
    const est = new AttitudeEstimator();
    // Tilted 20° nose down (about +X): gravity's reaction ("up") seen in the body is (0, sin, cos).
    const a = 20 * (Math.PI / 180);
    for (let i = 0; i < 3000; i++) est.update([0, 0, 0], [0, 9.80665 * Math.sin(a), 9.80665 * Math.cos(a)], 0.002);
    const q = est.q;
    const pitch = 2 * Math.atan2(q[1], q[0]);
    expect(Math.abs(pitch - a)).toBeLessThan(0.01);
  });

  it("IMU direction: X forward and chip up maps IMU X to body front (-Y) and keeps a right-handed frame", () => {
    const R = imuToBody("front", true);
    expect([R[0], R[3], R[6]]).toEqual([0, -1, 0]); // IMU x → body -y
    expect([R[2], R[5], R[8]]).toEqual([0, 0, 1]);
    const det = R[0]! * (R[4]! * R[8]! - R[5]! * R[7]!) - R[1]! * (R[3]! * R[8]! - R[5]! * R[6]!) + R[2]! * (R[3]! * R[7]! - R[4]! * R[6]!);
    expect(det).toBeCloseTo(1);
    const D = imuToBody("right", false);
    expect([D[2], D[5], D[8]]).toEqual([0, 0, -1]);
  });

  const opts = { boardId: "esp32s3", motorPins: [4, 5, 6, 7], imuX: "front" as const, imuUp: true, batteryPin: 1, batteryDivider: 2, wifiName: "MakerStudio-Drone", wifiPassword: "abcdefgh1234" };
  it("exports a full project with the design's numbers, safety notes and the Wi-Fi details", () => {
    const p = droneCodeProject(drone, frame, opts);
    expect(p.files.map((f) => f.path).sort()).toEqual(["README.md", "include/drone_config.h", "include/flight_config.h", "include/flight_core.h", "platformio.ini", "src/main.cpp"]);
    const readme = p.files.find((f) => f.path === "README.md")!.text;
    expect(readme).toMatch(/NOT been tested on a real drone/);
    expect(readme).toMatch(/Propellers OFF/i);
    expect(readme).toContain("abcdefgh1234");
    expect(p.files.find((f) => f.path === "include/drone_config.h")!.text).toContain("MOTOR_PINS[MOTOR_COUNT] = {4, 5, 6, 7}");
    expect(p.files.find((f) => f.path === "platformio.ini")!.text).toContain("board = esp32-s3-devkitc-1");
  });

  it("refuses bad pins and passwords", () => {
    expect(() => droneCodeProject(drone, frame, { ...opts, motorPins: [4, 4, 6, 7] })).toThrow(/share a pin/);
    expect(() => droneCodeProject(drone, frame, { ...opts, motorPins: [4, 5, 6, 8] })).toThrow(/IMU or the battery/);
    expect(() => droneCodeProject(drone, frame, { ...opts, motorPins: [4, 5, 6] })).toThrow(/each of the 4 motors/);
    expect(() => droneCodeProject(drone, frame, { ...opts, wifiPassword: "short" })).toThrow(/8-63/);
    expect(newWifiPassword()).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe("drone code: brushless motors on ESCs", () => {
  it("drives ESCs with 1000-2000 µs pulses at 400 Hz and explains the ESC safety steps", () => {
    const esc = { ...drone, motorType: "esc" as const };
    const p = droneCodeProject(esc, frame, { boardId: "esp32s3", motorPins: [4, 5, 6, 7], imuX: "front", imuUp: true, batteryPin: null, batteryDivider: 2, wifiName: "MakerStudio-Drone", wifiPassword: "abcdefgh1234" });
    const cfg = p.files.find((f) => f.path === "include/drone_config.h")!.text;
    expect(cfg).toContain("#define MOTOR_ESC 1");
    expect(cfg).toContain("#define PWM_FREQ 400");
    const readme = p.files.find((f) => f.path === "README.md")!.text;
    expect(readme).toMatch(/Brushless motors and ESCs/);
    expect(readme).toMatch(/calibrated once/);
    expect(readme).not.toMatch(/MOSFET drain/);
    const brushed = droneCodeProject(drone, frame, { boardId: "esp32s3", motorPins: [4, 5, 6, 7], imuX: "front", imuUp: true, batteryPin: null, batteryDivider: 2, wifiName: "MakerStudio-Drone", wifiPassword: "abcdefgh1234" });
    expect(brushed.files.find((f) => f.path === "include/drone_config.h")!.text).toContain("#define MOTOR_ESC 0");
  });
  it("wires ESCs and brushless motors with clean checks", async () => {
    const { droneCircuit } = await import("../../src/core/circuit/fromDrone");
    const { checkCircuit } = await import("../../src/core/circuit/checks");
    let k = 0;
    const c = droneCircuit({ ...drone, motorType: "esc", battery: { cells: 4, capacity: 1500, mass: 180 } }, "esp32s3", [4, 5, 6, 7], () => `e${++k}`);
    expect(c.components.filter((x) => x.type === "esc")).toHaveLength(4);
    expect(c.components.filter((x) => x.type === "brushless-motor")).toHaveLength(4);
    expect(c.components.find((x) => x.type === "battery")!.props.volts).toBe(14.8);
    expect(checkCircuit(c.components, c.wires).findings.filter((f) => f.severity === "danger")).toEqual([]);
  });
});
