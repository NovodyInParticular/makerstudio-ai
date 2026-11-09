import { beforeAll, describe, expect, it } from "vitest";
import { initCsg } from "../../src/core/cad/csg";
import { DEFAULT_PARAMS, IDENTITY, type CadObject } from "../../src/core/cad/model";
import { analyseDrone, combine, frameMass, mixer } from "../../src/core/drone/analysis";
import { defaultDrone, quadX, type Drone } from "../../src/core/drone/model";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

const box = (id: string, w: number, d: number, h: number, position: [number, number, number] = [0, 0, 0], extra: Partial<CadObject> = {}): CadObject => ({
  id, name: id, kind: "box", params: { ...DEFAULT_PARAMS.box, width: w, depth: d, height: h }, transform: { ...IDENTITY, position },
  hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra,
});
const drone = (patch: Partial<Drone> = {}): Drone => ({ ...defaultDrone(quadX(120, [0, 0], 5)), ...patch });

describe("drone: mass properties", () => {
  it("a solid box has the textbook mass, centre and inertia", () => {
    // 10 × 20 × 30 mm, density 1 g/cm³ → 6 g; I = m/12 (b² + c²) about the centre.
    const f = frameMass(drone({ density: 1, fill: 100 }), [box("b", 10, 20, 30, [5, 0, 0])]);
    expect(f.mass).toBeCloseTo(6, 6);
    expect(f.centre[0]).toBeCloseTo(5, 6);
    expect(f.centre[2]).toBeCloseTo(15, 6);
    expect(f.inertia[0]).toBeCloseTo((6 / 12) * (20 ** 2 + 30 ** 2), 4); // Ixx
    expect(f.inertia[4]).toBeCloseTo((6 / 12) * (10 ** 2 + 30 ** 2), 4); // Iyy
    expect(f.inertia[8]).toBeCloseTo((6 / 12) * (10 ** 2 + 20 ** 2), 4); // Izz
    expect(Math.abs(f.inertia[1])).toBeLessThan(1e-6);
  });

  it("fill and density scale the mass; a hole is taken out", () => {
    expect(frameMass(drone({ density: 1.24, fill: 50 }), [box("b", 10, 10, 10)]).mass).toBeCloseTo(0.62, 6);
    const g: CadObject = { ...box("g", 1, 1, 1), kind: "group", params: {} };
    const withHole = [g, box("s", 20, 20, 10, [0, 0, 0], { parentId: "g" }), box("h", 10, 10, 10, [0, 0, 0], { parentId: "g", hole: true })];
    expect(frameMass(drone({ density: 1, fill: 100 }), withHole).mass).toBeCloseTo(3, 4); // (400 - 100) mm² × 10 mm
  });

  it("combining point masses uses the parallel axis rule", () => {
    const c = combine([{ mass: 1, centre: [-10, 0, 0], inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, { mass: 1, centre: [10, 0, 0], inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
    expect(c.centre).toEqual([0, 0, 0]);
    expect(c.inertia[4]).toBeCloseTo(200); // Iyy = 2 × 1 × 10²
    expect(c.inertia[0]).toBeCloseTo(0);
  });
});

describe("drone: mixer", () => {
  const motors = quadX(0.2).map((m) => ({ x: m.position[0], y: m.position[1], spin: m.spin }));
  const mix = mixer(motors)!;
  it("collective thrust is shared equally by a symmetric quad", () => {
    for (const t of mix([4, 0, 0, 0])) expect(t).toBeCloseTo(1, 9);
  });
  it("a roll torque (about +Y: right side down) speeds up the left motors", () => {
    const t = mix([4, 0, 0.01, 0]);
    motors.forEach((m, i) => (m.x < 0 ? expect(t[i]).toBeGreaterThan(1) : expect(t[i]).toBeLessThan(1)));
  });
  it("a yaw torque speeds up the motors spinning the other way", () => {
    const t = mix([4, 0, 0, 0.001]); // +z torque comes from the clockwise (spin -1) propellers
    motors.forEach((m, i) => (m.spin < 0 ? expect(t[i]).toBeGreaterThan(1) : expect(t[i]).toBeLessThan(1)));
  });
  it("motors in a line, or all spinning one way, cannot steer", () => {
    expect(mixer([0, 1, 2, 3].map((i) => ({ x: i * 0.05, y: 0, spin: i % 2 ? 1 : -1 })))).toBeNull();
    expect(mixer(motors.map((m) => ({ ...m, spin: 1 })))).toBeNull();
  });
});

describe("drone: will it fly?", () => {
  it("a light frame flies with margin; findings name the thrust-to-weight and balance", () => {
    const r = analyseDrone(drone(), [box("frame", 40, 40, 3)]);
    expect(r.thrustToWeight).toBeGreaterThan(2);
    expect(r.hoverThrottle).toBeCloseTo(1 / r.thrustToWeight, 9);
    expect(r.findings.find((f) => /thrust-to-weight/.test(f.title))!.verdict).toBe("good");
    expect(r.findings.find((f) => /Balanced/.test(f.title))!.verdict).toBe("good");
    expect(r.hoverLoads.every((l) => Math.abs(l - r.hoverThrottle) < 1e-6)).toBe(true);
    expect(r.flightMinutes).toBeGreaterThan(0);
  });

  it("too heavy: danger", () => {
    const r = analyseDrone(drone({ maxThrust: 5 }), [box("frame", 40, 40, 3)]);
    expect(r.findings.some((f) => f.verdict === "danger" && /Too heavy/.test(f.title))).toBe(true);
  });

  it("a battery far off to one side cannot be balanced", () => {
    const d = drone({ battery: { cells: 1, capacity: 1000, mass: 25 }, extras: [{ name: "Heavy camera", mass: 60, position: [80, 0, 5] }] });
    const r = analyseDrone(d, [box("frame", 40, 40, 3)]);
    expect(r.findings.some((f) => f.verdict === "danger" && /Cannot hover level/.test(f.title))).toBe(true);
  });

  it("propellers that overlap are found", () => {
    const r = analyseDrone(drone({ motors: quadX(70, [0, 0], 5), propDiameter: 55 }), [box("frame", 40, 40, 3)]);
    expect(r.findings.some((f) => f.verdict === "danger" && /overlap/.test(f.title))).toBe(true);
  });
});

describe("drone: flight simulation", async () => {
  const { DroneSim, simParams } = await import("../../src/core/drone/sim");
  const frame = [box("frame", 40, 40, 3), box("arm1", 120, 6, 3), box("arm2", 6, 120, 3)];
  const make = (patch: Partial<Drone> = {}) => {
    const d = drone(patch);
    const r = analyseDrone(d, frame);
    return { sim: new DroneSim(simParams(d, frame, r)), r };
  };
  const idle = { throttle: 0, roll: 0, pitch: 0, yaw: 0 };
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const takeOff = (sim: InstanceType<typeof DroneSim>, hover: number) => {
    sim.arm(true);
    sim.step(1.0, { ...idle, throttle: Math.min(1, hover * 1.4) });
    sim.step(1.5, { ...idle, throttle: hover });
  };

  it("stays on the ground until armed, then climbs and hovers at about 1/thrust-to-weight", () => {
    const { sim, r } = make();
    sim.step(1, { ...idle, throttle: 1 });
    expect(sim.status).toBe("landed");
    takeOff(sim, r.hoverThrottle);
    expect(sim.status).toBe("flying");
    expect(sim.altitude).toBeGreaterThan(0.2);
    // At hover throttle the thrust carries the weight; stabilize mode does not hold height, so the
    // climb left from take-off only fades through air drag (it does not speed up).
    const v0 = sim.vel[2];
    sim.step(1, { ...idle, throttle: r.hoverThrottle });
    const thrust = sim.thrust.reduce((a, b) => a + b, 0);
    expect(Math.abs(thrust / (sim.p.mass * 9.80665) - 1)).toBeLessThan(0.01);
    expect(sim.vel[2]).toBeLessThan(v0);
    expect(sim.vel[2]).toBeGreaterThan(0);
    expect(deg(sim.tilt)).toBeLessThan(1);
  });

  it("levels itself after being knocked (stabilize mode), without growing wobbles", () => {
    const { sim, r } = make();
    takeOff(sim, r.hoverThrottle);
    sim.omega[1] = 4; // knocked: spinning about Y at 4 rad/s
    let peak = 0;
    for (let t = 0; t < 40; t++) { sim.step(0.025, { ...idle, throttle: r.hoverThrottle }); peak = Math.max(peak, deg(sim.tilt)); }
    expect(peak).toBeGreaterThan(3); // the knock did tip it
    sim.step(1.5, { ...idle, throttle: r.hoverThrottle });
    expect(deg(sim.tilt)).toBeLessThan(1);
    expect(Math.hypot(...sim.omega)).toBeLessThan(0.05);
  });

  it("sticks: pitch forward tilts and flies to -Y (front), roll right flies to +X, yaw right turns clockwise", () => {
    let { sim, r } = make();
    takeOff(sim, r.hoverThrottle);
    sim.step(1, { ...idle, throttle: r.hoverThrottle * 1.1, pitch: 0.5 });
    expect(deg(sim.tilt)).toBeGreaterThan(10);
    expect(sim.vel[1]).toBeLessThan(-0.3);
    ({ sim, r } = make());
    takeOff(sim, r.hoverThrottle);
    sim.step(1, { ...idle, throttle: r.hoverThrottle * 1.1, roll: 0.5 });
    expect(sim.vel[0]).toBeGreaterThan(0.3);
    ({ sim, r } = make());
    takeOff(sim, r.hoverThrottle);
    const y0 = sim.yaw;
    sim.step(0.5, { ...idle, throttle: r.hoverThrottle, yaw: 0.5 });
    expect(sim.yaw - y0).toBeLessThan(-0.2);
  });

  it("an off-centre weight is held level by the controller (motors work unevenly)", () => {
    const { sim, r } = make({ extras: [{ name: "camera", mass: 6, position: [25, 0, 5] }] });
    expect(r.findings.some((f) => /Cannot hover/.test(f.title))).toBe(false);
    takeOff(sim, r.hoverThrottle);
    sim.step(2, { ...idle, throttle: r.hoverThrottle });
    expect(deg(sim.tilt)).toBeLessThan(2);
    expect(Math.max(...sim.thrust) - Math.min(...sim.thrust)).toBeGreaterThan(0.01);
  });

  it("too heavy: full throttle does not lift it", () => {
    const { sim } = make({ maxThrust: 8 });
    sim.arm(true);
    sim.step(2, { ...idle, throttle: 1 });
    expect(sim.altitude).toBeLessThan(0.01);
  });

  it("cutting the motors high up ends in a crash; reset puts it back", () => {
    const { sim, r } = make();
    takeOff(sim, r.hoverThrottle);
    sim.step(1.5, { ...idle, throttle: Math.min(1, r.hoverThrottle * 1.6) });
    expect(sim.altitude).toBeGreaterThan(1.5);
    sim.arm(false);
    sim.step(3, idle);
    expect(sim.status).toBe("crashed");
    expect(sim.crashReason).toMatch(/hit the ground/);
    sim.reset();
    expect(sim.status).toBe("landed");
  });

  it("the battery runs down and the drone comes down when it is empty", () => {
    const { sim, r } = make({ battery: { cells: 1, capacity: 20, mass: 25 } });
    takeOff(sim, r.hoverThrottle);
    for (let i = 0; i < 120 && sim.status !== "battery-empty"; i++) sim.step(1, { ...idle, throttle: r.hoverThrottle * 1.05 });
    expect(sim.status).toBe("battery-empty");
    expect(sim.voltage).toBeLessThan(3.1);
  });

  it("height hold: stick centred keeps the height; up climbs, down descends", () => {
    const { sim } = make();
    sim.mode = "height-hold";
    sim.arm(true);
    sim.step(1, { ...idle, climb: 0 });
    expect(sim.altitude).toBeLessThan(0.01); // stays on the ground until told to climb
    sim.step(1.5, { ...idle, climb: 1 });
    expect(sim.vel[2]).toBeGreaterThan(1.2);
    sim.step(2, { ...idle, climb: 0 });
    const h = sim.altitude;
    sim.step(2, { ...idle, climb: 0 });
    expect(Math.abs(sim.altitude - h)).toBeLessThan(0.05);
    expect(Math.abs(sim.vel[2])).toBeLessThan(0.05);
    sim.step(1, { ...idle, climb: -1, pitch: 0.4 });
    expect(sim.vel[2]).toBeLessThan(-1);
  });

  it("height hold: letting go during a fast climb brakes and holds where it stopped (no overshoot and return)", () => {
    const { sim } = make();
    sim.mode = "height-hold";
    sim.arm(true);
    sim.step(2, { ...idle, climb: 1 });
    let peak = 0;
    for (let i = 0; i < 120; i++) { sim.step(0.05, { ...idle, climb: 0 }); peak = Math.max(peak, sim.altitude); }
    expect(peak - sim.altitude).toBeLessThan(0.08);
    expect(Math.abs(sim.vel[2])).toBeLessThan(0.05);
  });
});

