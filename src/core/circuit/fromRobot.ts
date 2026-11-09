// Builds the wiring for a robot from the Robotics Studio: its board, one servo per joint
// (on its own 5 V supply, grounds joined), and an I²C OLED if that is the robot's screen.
// The result is ordinary parts and wires in the Circuit Studio, so every check runs on it.

import { displayById } from "../display/catalog";
import type { Screen } from "../display/face";
import type { Robot } from "../robot/model";
import { COMPONENTS, componentDef } from "./catalog";
import type { CircuitComponent, Wire } from "./schema";

/** Boards the Circuit Studio can wire a robot for (board part id → name). */
export function robotWiringBoards(): { id: string; name: string }[] {
  return COMPONENTS.filter((c) => c.electrical.kind === "board" && c.gpio).map((c) => ({ id: c.id, name: c.name }));
}

export interface RobotWiring {
  components: CircuitComponent[];
  wires: Wire[];
  notes: string[];
}

export function robotCircuit(robot: Robot, screens: Screen[], boardType: string, makeId: () => string, origin: [number, number] = [0, 0]): RobotWiring {
  const board = componentDef(boardType);
  if (!board || board.electrical.kind !== "board" || !board.gpio) throw new Error("That board cannot be wired automatically yet.");
  const notes: string[] = [];
  const components: CircuitComponent[] = [];
  const wires: Wire[] = [];
  const [ox, oy] = origin;
  const part = (type: string, label: string, x: number, y: number, props: CircuitComponent["props"] = {}): CircuitComponent => {
    const def = componentDef(type)!;
    const c: CircuitComponent = { id: makeId(), type, label, x: ox + x, y: oy + y, rotation: 0, props: { ...Object.fromEntries(def.props.map((p) => [p.key, p.default])), ...props } };
    components.push(c);
    return c;
  };
  const wire = (a: CircuitComponent, ap: string, b: CircuitComponent, bp: string, color: string) =>
    wires.push({ id: makeId(), from: { component: a.id, pin: ap }, to: { component: b.id, pin: bp }, color });
  const gnd = board.electrical.internalGround[0]!;

  const b = part(board.id, board.name, 0, 0);

  // Servos: one per joint that has a pin, all on a separate 5 V supply.
  const driven = robot.joints.filter((j) => j.servo.pin !== null);
  const missing = robot.joints.filter((j) => j.servo.pin === null);
  if (missing.length) notes.push(`${missing.map((j) => `"${j.name}"`).join(", ")} ${missing.length === 1 ? "has" : "have"} no servo pin yet, so ${missing.length === 1 ? "it is" : "they are"} not wired. Set the pin in Robotics Studio.`);
  if (driven.length) {
    // Laid out with room for each part's name and the wires between them.
    const supply = part("battery", "Servo supply 5 V", 44, 4, { volts: 5, chemistry: "bench-supply" });
    wire(supply, "-", b, gnd, "#8b97a5"); // common ground with the board
    driven.forEach((j, i) => {
      const pin = board.gpio!(j.servo.pin!);
      const s = part("servo", j.name.slice(0, 60), 62, i * 18);
      wire(supply, "+", s, "V", "#ff5d73");
      wire(supply, "-", s, "GND", "#8b97a5");
      if (pin) wire(b, pin, s, "SIG", ["#f2b84b", "#22b8c9", "#8f7cf0", "#2fd6a3"][i % 4]!);
      else notes.push(`"${j.name}" uses pin ${j.servo.pin}, which ${board.name} does not have (or is not wired out in Circuit Studio). Its signal wire is left out: pick another pin.`);
    });
  }

  // Screen: the first mounted screen.
  const screen = robot.mounts.map((m) => screens.find((s) => s.id === m.screenId)).find(Boolean);
  const display = screen ? displayById(screen.display) : undefined;
  if (display) {
    if (display.controller === "SSD1306" || display.controller === "SH1106") {
      if (!board.i2c || !board.logicSupply) notes.push(`${board.name} has no default I²C pins recorded; wire the OLED by hand.`);
      else {
        const o = part("oled-i2c", screen!.name.slice(0, 60), 30, -16);
        // 3.3 V boards power the module from 3.3 V: its I²C pull-ups then cannot put 5 V on the pins.
        wire(b, board.logicSupply, o, "VCC", "#ff5d73");
        wire(b, gnd, o, "GND", "#8b97a5");
        wire(b, board.i2c.sda, o, "SDA", "#22b8c9");
        wire(b, board.i2c.scl, o, "SCL", "#f2b84b");
        notes.push(`OLED on the default I²C pins (${board.i2c.source}).`);
      }
    } else if (display.id.startsWith("m5stack")) {
      notes.push("The screen is built into the M5Stack: nothing to wire.");
    } else {
      notes.push(`The ${display.name} (SPI) is not wired automatically yet: follow the wiring in the exported robot code's README.`);
    }
  }
  if (!driven.length && !display) notes.push("The robot has no servo pins or screen to wire yet.");
  // Some parts sit above or left of the board; move the whole set so its top-left is the origin
  // (parts at negative positions start off-screen).
  if (components.length) {
    const dx = ox - Math.min(...components.map((c) => c.x)), dy = oy - Math.min(...components.map((c) => c.y));
    for (const c of components) { c.x += dx; c.y += dy; }
  }
  return { components, wires, notes };
}
