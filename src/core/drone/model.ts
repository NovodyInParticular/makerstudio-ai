// Drone Studio data (saved in the project): which 3D objects are the frame, the motors and
// where they sit, the battery, the other parts, and the flight controller's tuning.
//
// Units: millimetres and grams in the project (like the rest of MakerStudio); the physics
// works in metres, kilograms and newtons (see sim.ts).
//
// Default part values are TYPICAL ESTIMATES for a 1S micro drone, not measurements: the
// Drone Studio labels them "estimated" and asks the owner to weigh / measure their parts.

import { z } from "zod";

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const grams = z.number().finite().min(0).max(5000);

export const MotorSchema = z.object({
  /** Where the propeller's centre is (world mm, 3D Studio coordinates). */
  position: vec3,
  /** Propeller spin seen from above: 1 = counter-clockwise, -1 = clockwise. */
  spin: z.union([z.literal(1), z.literal(-1)]),
});
export type Motor = z.infer<typeof MotorSchema>;

export const PidSchema = z.object({
  /** Angle error (rad) → wanted rotation rate (rad/s). */
  angleP: z.number().min(0).max(50),
  /** Rate error (rad/s) → angular acceleration (rad/s²). */
  rateP: z.number().min(0).max(500),
  rateI: z.number().min(0).max(500),
  rateD: z.number().min(0).max(20),
});
export type Pid = z.infer<typeof PidSchema>;

export const DroneSchema = z.object({
  /** Top-level 3D objects that are the printed frame (empty: every visible top-level object). */
  frame: z.array(z.string().min(1)).max(200),
  /** Printed material density, g/cm³, and how full the print is (100 = solid). */
  density: z.number().min(0.1).max(10),
  fill: z.number().min(5).max(100),
  motors: z.array(MotorSchema).min(3).max(8),
  motorMass: grams,
  /** Most thrust one motor + propeller gives on a full battery, grams-force. */
  maxThrust: z.number().finite().min(1).max(5000),
  propDiameter: z.number().min(10).max(500),
  propMass: grams,
  battery: z.object({
    cells: z.number().int().min(1).max(6),
    capacity: z.number().min(20).max(20000), // mAh
    mass: grams,
  }),
  /** Board, IMU, wires... : mass and where it sits (null: at the frame's centre). */
  extras: z.array(z.object({ name: z.string().min(1).max(60), mass: grams, position: vec3.nullable() })).max(30),
  /** Thrust per watt of a small brushed motor + propeller, g/W (for the flight time estimate). */
  efficiency: z.number().min(0.5).max(20),
  pid: z.object({ rollPitch: PidSchema, yaw: PidSchema }),
  /** Brushed motors on MOSFETs (micro drones) or brushless motors on ESCs (bigger drones). Absent = brushed. */
  motorType: z.enum(["brushed", "esc"]).optional(),
});
export type Drone = z.infer<typeof DroneSchema>;

/** Typical values for a 1S brushed micro quad (estimates: weigh and measure your parts). */
export const DRONE_DEFAULTS = {
  density: 1.24, // PLA, g/cm³ (typical; check your filament's datasheet)
  fill: 100,
  motorMass: 4.5, // 8520 coreless motor (typical)
  maxThrust: 35, // 8520 + 55-65 mm propeller on 1S (typical)
  propDiameter: 55,
  propMass: 0.5,
  battery: { cells: 1, capacity: 1000, mass: 25 },
  extras: [
    { name: "Flight controller board", mass: 5, position: null },
    { name: "IMU board", mass: 2, position: null },
    { name: "Wires, screws, tape", mass: 4, position: null },
  ],
  efficiency: 3.5,
  pid: {
    rollPitch: { angleP: 6, rateP: 60, rateI: 20, rateD: 1.2 },
    yaw: { angleP: 0, rateP: 30, rateI: 8, rateD: 0 },
  },
} as const;

/**
 * Typical part values for a 5-inch brushless quad (estimates: check your motor's thrust table and
 * weigh your parts). Used by the Drone Studio's "5-inch brushless" starting point.
 */
export const FIVE_INCH = { motorType: "esc" as const, motorMass: 33, maxThrust: 1200, propDiameter: 127, propMass: 4.5, battery: { cells: 4, capacity: 1500, mass: 180 }, efficiency: 4,
  extras: [{ name: "Flight controller board", mass: 8, position: null }, { name: "4 ESCs", mass: 24, position: null }, { name: "IMU board", mass: 2, position: null }, { name: "Wires, screws, strap", mass: 20, position: null }] };
export const MICRO = { motorType: "brushed" as const, motorMass: DRONE_DEFAULTS.motorMass, maxThrust: DRONE_DEFAULTS.maxThrust, propDiameter: DRONE_DEFAULTS.propDiameter, propMass: DRONE_DEFAULTS.propMass, battery: { ...DRONE_DEFAULTS.battery }, efficiency: DRONE_DEFAULTS.efficiency, extras: DRONE_DEFAULTS.extras.map((e) => ({ ...e })) };

/** An X quad with the given motor-to-motor diagonal (mm), centred at `centre`, motors at height z. */
export function quadX(diagonal: number, centre: [number, number] = [0, 0], z = 10): Motor[] {
  const r = diagonal / 2 / Math.SQRT2;
  const [cx, cy] = centre;
  // Front is -Y (as in the rest of MakerStudio). Diagonal pairs spin the same way.
  return [
    { position: [cx + r, cy - r, z], spin: -1 }, // front right, clockwise
    { position: [cx - r, cy - r, z], spin: 1 }, // front left, counter-clockwise
    { position: [cx - r, cy + r, z], spin: -1 }, // back left, clockwise
    { position: [cx + r, cy + r, z], spin: 1 }, // back right, counter-clockwise
  ];
}

export function defaultDrone(motors: Motor[]): Drone {
  return DroneSchema.parse({
    frame: [],
    density: DRONE_DEFAULTS.density,
    fill: DRONE_DEFAULTS.fill,
    motors,
    motorMass: DRONE_DEFAULTS.motorMass,
    maxThrust: DRONE_DEFAULTS.maxThrust,
    propDiameter: DRONE_DEFAULTS.propDiameter,
    propMass: DRONE_DEFAULTS.propMass,
    battery: { ...DRONE_DEFAULTS.battery },
    extras: DRONE_DEFAULTS.extras.map((e) => ({ ...e })),
    efficiency: DRONE_DEFAULTS.efficiency,
    pid: { rollPitch: { ...DRONE_DEFAULTS.pid.rollPitch }, yaw: { ...DRONE_DEFAULTS.pid.yaw } },
  });
}
