// "Wire my drone": the circuit for a Drone Studio design, as the drone code's README describes it.
// Each motor: LiPo + -> motor +; motor - -> MOSFET drain; source -> ground; gate -> its GPIO,
// with a 10 kΩ pull-down from gate to ground and a flyback diode across the motor (band to +).
// IMU on 3V3 and the board's I²C pins. Ordinary parts and wires, so every check runs on them.

import type { Drone } from "../drone/model";
import { componentDef } from "./catalog";
import type { CircuitComponent, Wire } from "./schema";

/** Drone code boards → Circuit Studio board parts. */
export const DRONE_BOARD_PART: Record<string, string> = { esp32s3: "esp32-s3-devkitc-1", "xiao-esp32s3": "xiao-esp32s3-sense" };

export function droneCircuit(drone: Drone, boardId: string, motorPins: number[], makeId: () => string, origin: [number, number] = [4, 4], heightSensor = false): { components: CircuitComponent[]; wires: Wire[]; notes: string[] } {
  const board = componentDef(DRONE_BOARD_PART[boardId] ?? "");
  if (!board || !board.gpio || !board.i2c || !board.logicSupply) throw new Error("That board cannot be wired automatically.");
  const notes: string[] = [];
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  const [ox, oy] = origin;
  const part = (type: string, label: string, x: number, y: number, props: CircuitComponent["props"] = {}): CircuitComponent => {
    const def = componentDef(type)!;
    const c: CircuitComponent = { id: makeId(), type, label: label.slice(0, 60), x: ox + x, y: oy + y, rotation: 0, props: { ...Object.fromEntries(def.props.map((p) => [p.key, p.default])), ...props } };
    components.push(c);
    return c;
  };
  const wire = (a: CircuitComponent, ap: string, b: CircuitComponent, bp: string, color: string) =>
    wires.push({ id: makeId(), from: { component: a.id, pin: ap }, to: { component: b.id, pin: bp }, color });
  const gnd = board.electrical.kind === "board" ? board.electrical.internalGround[0]! : "GND";
  const RED = "#ff5d73", GREY = "#8b97a5", SIGNAL = ["#f2b84b", "#22b8c9", "#8f7cf0", "#2fd6a3"];

  const b = part(board.id, board.name, 0, 8);
  const imu = part("imu-mpu6050", "IMU", 0, -12);
  wire(b, board.logicSupply, imu, "VCC", RED);
  wire(b, gnd, imu, "GND", GREY);
  wire(b, board.i2c.sda, imu, "SDA", "#22b8c9");
  wire(b, board.i2c.scl, imu, "SCL", "#f2b84b");
  if (heightSensor) {
    const tof = part("tof-vl53l1x", "Height sensor", 18, -12);
    wire(b, board.logicSupply, tof, "VIN", RED);
    wire(b, gnd, tof, "GND", GREY);
    wire(b, board.i2c.sda, tof, "SDA", "#22b8c9");
    wire(b, board.i2c.scl, tof, "SCL", "#f2b84b");
  }

  const esc = drone.motorType === "esc";
  const bat = esc
    ? part("battery", `LiPo ${drone.battery.cells}S ${drone.battery.capacity} mAh`, 34, -12, { volts: Math.round(3.7 * drone.battery.cells * 10) / 10, chemistry: "lipo" })
    : part("lipo-1s", `LiPo ${drone.battery.cells}S ${drone.battery.capacity} mAh`, 34, -12, { volts: 3.7 * drone.battery.cells, capacity: drone.battery.capacity });
  wire(bat, "-", b, gnd, GREY); // common ground
  if (esc) {
    drone.motors.forEach((m, i) => {
      const pin = board.gpio!(motorPins[i] ?? -1);
      const y = i * 20;
      const e = part("esc", `ESC ${i + 1}`, 52, y);
      const motor = part("brushless-motor", `Motor ${i + 1} (${m.spin === 1 ? "CCW" : "CW"})`, 76, y);
      wire(bat, "+", e, "BAT+", RED);
      wire(bat, "-", e, "BAT-", GREY);
      wire(e, "GND", b, gnd, GREY);
      for (const ph of ["A", "B", "C"]) wire(e, ph, motor, ph, "#c9a227");
      if (pin) wire(b, pin, e, "SIG", SIGNAL[i % 4]!);
      else notes.push(`Motor ${i + 1}: GPIO${motorPins[i]} is not a pin of the ${board.name}; its signal wire is left out.`);
    });
    notes.push("Power the board from the ESCs' 5 V (BEC) or a separate 5 V regulator (not drawn); in these checks the board runs on USB.");
    notes.push("Brushless propellers are dangerous: bench tests with the propellers off.");
    return { components, wires, notes };
  }

  drone.motors.forEach((m, i) => {
    const pin = board.gpio!(motorPins[i] ?? -1);
    // One row per motor: pull-down, MOSFET, motor, diode in their own columns.
    const y = i * 20;
    const pull = part("resistor", `R${i + 1} 10k`, 48, y + 2, { ohms: 10000 });
    const fet = part("mosfet", `Q${i + 1}`, 58, y);
    const motor = part("coreless-motor", `Motor ${i + 1} (${m.spin === 1 ? "CCW" : "CW"})`, 70, y + 2);
    const diode = part("diode", `D${i + 1}`, 86, y + 2);
    wire(bat, "+", motor, "+", RED);
    wire(motor, "-", fet, "D", GREY);
    wire(fet, "S", bat, "-", GREY);
    wire(diode, "K", motor, "+", RED);
    wire(diode, "A", motor, "-", GREY);
    wire(pull, "1", fet, "G", SIGNAL[i % 4]!);
    wire(pull, "2", bat, "-", GREY);
    if (pin) wire(b, pin, fet, "G", SIGNAL[i % 4]!);
    else notes.push(`Motor ${i + 1}: GPIO${motorPins[i]} is not a pin of the ${board.name}; its gate wire is left out.`);
  });
  notes.push(boardId === "esp32s3"
    ? "Power the DevKitC-1 from the LiPo through a 5 V boost converter into its 5V pin (not in the parts library yet); in these checks the board runs on USB."
    : "Solder the LiPo to the XIAO's BAT+ / BAT− pads (not drawn here); in these checks the board runs on USB.");
  notes.push("Use logic-level MOSFETs that switch fully at 3.3 V (Flix uses UMW 100N03A); the checks do not analyse MOSFETs yet.");
  return { components, wires, notes };
}
