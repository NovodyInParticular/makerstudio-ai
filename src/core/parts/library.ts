// Parts Library (Phase 7, PARTS_LIBRARY.md). Every spec carries a value, a unit, where it came
// from and how sure it is. Unknown stays unknown. Boards, displays and modules are built from the
// app's own sourced catalogs; hardware comes from the ISO standard that defines it.

import { z } from "zod";
import { COMPONENTS, LOAD_PEAK, type ComponentDef } from "../circuit/catalog";
import { DISPLAYS } from "../display/catalog";

export const SPEC_STATUS = ["manufacturer", "distributor", "standard", "measured", "estimated", "unknown"] as const;
export type SpecStatus = (typeof SPEC_STATUS)[number];
export const STATUS_INFO: Record<SpecStatus, string> = {
  manufacturer: "From the manufacturer's datasheet or official page",
  distributor: "From a major distributor's listing",
  standard: "Defined by the named standard (ISO/DIN)",
  measured: "Measured by you",
  estimated: "Typical value: check your part",
  unknown: "Not known yet",
};

export const SpecSchema = z.object({
  label: z.string().min(1),
  value: z.number().finite().nullable(),
  unit: z.string(),
  source: z.string().nullable(),
  status: z.enum(SPEC_STATUS),
}).refine((s) => (s.status === "unknown" ? s.value === null : s.value !== null && !!s.source && s.source.length > 5), {
  message: "a spec with a value needs a source (and an unknown one has no value)",
});
export type PartSpec = z.infer<typeof SpecSchema>;

export const CATEGORIES = ["Microcontroller", "Display", "Sensor", "Motion", "Power", "Input", "Output", "Passive", "Prototyping", "Hardware"] as const;

export const PartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  category: z.enum(CATEGORIES),
  manufacturer: z.string().nullable(),
  generic: z.boolean(),
  summary: z.string(),
  specs: z.array(SpecSchema),
  interfaces: z.array(z.string()),
  /** Where the facts come from (documents, standards). */
  sources: z.array(z.string()).min(1),
  /** Usable in Circuit Studio / Display Studio. */
  circuitType: z.string().optional(),
  displayId: z.string().optional(),
  /** Outer size for a placeholder block in 3D Studio (only when all three are known). */
  size: z.object({ x: SpecSchema, y: SpecSchema, z: SpecSchema }).optional(),
  notes: z.string().optional(),
});
export type LibraryPart = z.infer<typeof PartSchema>;

const spec = (label: string, value: number | null, unit: string, source: string | null, status: SpecStatus): PartSpec =>
  ({ label, value: status === "unknown" ? null : value, unit, source: status === "unknown" ? null : source, status });
const unknown = (label: string, unit: string) => spec(label, null, unit, null, "unknown");
const fromCatalog = (label: string, s: { value: number; status: string; source: string }, unit: string): PartSpec =>
  spec(label, s.value, unit, s.source, s.status === "verified" ? "manufacturer" : "estimated");

// --- boards, from the circuit catalog (sourced pin maps) -------------------------------------

const BOARD_EXTRA: Record<string, { manufacturer: string; interfaces: string[]; summary: string; specs?: PartSpec[]; size?: LibraryPart["size"] }> = {
  "arduino-uno-r3": { manufacturer: "Arduino", interfaces: ["UART", "I²C", "SPI", "USB-B"], summary: "The classic 5 V Arduino board (ATmega328P, 16 MHz). Runs your code in MakerStudio's simulator.", specs: [unknown("Length", "mm"), unknown("Width", "mm")] },
  "raspberry-pi-pico": {
    manufacturer: "Raspberry Pi", interfaces: ["UART", "I²C", "SPI", "PIO", "USB"], summary: "RP2040 dual-core board, 3.3 V logic. Runs your code in MakerStudio's simulator.",
    specs: [spec("Flash", 2, "MB", "raspberrypi.com Pico-series documentation (checked 2026-11-09)", "manufacturer"), spec("SRAM", 264, "kB", "raspberrypi.com Pico-series documentation (checked 2026-11-09)", "manufacturer"), unknown("Length", "mm"), unknown("Width", "mm")],
  },
  "esp32-s3-devkitc-1": { manufacturer: "Espressif", interfaces: ["Wi-Fi", "Bluetooth LE", "UART", "I²C", "SPI", "USB"], summary: "ESP32-S3 development board. Flash/PSRAM depend on the module variant (N8, N16R8 ...).", specs: [unknown("Length", "mm"), unknown("Width", "mm")] },
  "xiao-esp32s3-sense": {
    manufacturer: "Seeed Studio", interfaces: ["Wi-Fi", "Bluetooth LE", "UART", "I²C", "SPI", "USB-C", "Camera", "PDM microphone", "microSD"],
    summary: "Thumb-sized ESP32-S3 with camera, microphone and microSD on the Sense board.",
    specs: [spec("Flash", 8, "MB", "Seeed wiki XIAO ESP32S3 getting started (checked 2026-11-08)", "manufacturer"), spec("PSRAM", 8, "MB", "Seeed wiki XIAO ESP32S3 getting started (checked 2026-11-08)", "manufacturer")],
    size: {
      x: spec("Length", 21, "mm", "Seeed wiki: 21 x 17.8 mm", "manufacturer"),
      y: spec("Width", 17.8, "mm", "Seeed wiki: 21 x 17.8 mm", "manufacturer"),
      z: spec("Height (with Sense board)", 15, "mm", "Seeed wiki: Sense 21 x 17.8 x 15 mm", "manufacturer"),
    },
  },
  "m5stack-cores3": { manufacturer: "M5Stack", interfaces: ["Wi-Fi", "Bluetooth LE", "I²C ports", "USB-C", "Touch screen", "Camera"], summary: "ESP32-S3 in a case with a 2\" touch screen, camera, IMU and speaker. The standard Stack-chan brain.", specs: [unknown("Length", "mm"), unknown("Width", "mm")] },
};

function boardPart(c: ComponentDef): LibraryPart {
  const extra = BOARD_EXTRA[c.id] ?? { manufacturer: "", interfaces: [], summary: c.notes };
  const specs: PartSpec[] = [];
  const gpio = c.pins.filter((p) => p.role.kind === "gpio");
  if (gpio[0]?.role.kind === "gpio") {
    specs.push(fromCatalog("Logic voltage", gpio[0].role.logic, "V"));
    specs.push(fromCatalog("Current per GPIO pin", { ...gpio[0].role.maxCurrent, value: gpio[0].role.maxCurrent.value * 1000 }, "mA"));
  }
  specs.push(spec("GPIO pins (on the headers)", gpio.length, "", c.source ?? "MakerStudio circuit catalog", c.source ? "manufacturer" : "estimated"));
  for (const p of c.pins) {
    if (p.role.kind === "supply") {
      specs.push(fromCatalog(`${p.name} output`, p.role.volts, "V"));
      if (p.role.maxCurrent) specs.push(fromCatalog(`${p.name} max current`, { ...p.role.maxCurrent, value: p.role.maxCurrent.value * 1000 }, "mA"));
    }
    if (p.role.kind === "power-in") specs.push(fromCatalog(`${p.name} input min`, p.role.min, "V"), fromCatalog(`${p.name} input max`, p.role.max, "V"));
  }
  return {
    id: c.id, name: c.name, category: "Microcontroller", manufacturer: extra.manufacturer || null, generic: false,
    summary: extra.summary, specs: [...specs, ...(extra.specs ?? [])], interfaces: extra.interfaces,
    sources: [c.source ?? "MakerStudio circuit catalog"], circuitType: c.id, ...(extra.size ? { size: extra.size } : {}), notes: c.notes,
  };
}

// --- modules and parts from the circuit catalog (mostly generic, estimated) --------------------

const CAT_MAP: Record<string, LibraryPart["category"]> = { Prototyping: "Prototyping", Power: "Power", Passive: "Passive", Light: "Output", Input: "Input", Sensor: "Sensor", Semiconductor: "Passive", Motion: "Motion", Display: "Display", Board: "Microcontroller" };

// Extra, sourced facts for some circuit parts (drone parts, 2026-11-09).
const FLIX = "okalachev/flix README component table (checked 2026-11-09)";
const ESPDRONE = "espressif/esp-drone hardware documentation, ESP32-S2-Drone V1.2 component list (checked 2026-11-09)";
const MPU_SPEC = "TDK InvenSense MPU-6000/MPU-6050 Product Specification";
const LIPO = "lithium-polymer cell chemistry: typical values (check your cell's datasheet)";
const MODULE_EXTRA: Record<string, { summary?: string; specs: PartSpec[]; sources: string[]; interfaces?: string[] }> = {
  "coreless-motor": {
    summary: "Brushed coreless motor for 1S micro drones. The size code is diameter and length in mm: 716 = 7 × 16, 720 = 7 × 20, 8520 = 8.5 × 20. Driven by a MOSFET, not a GPIO pin.",
    specs: [
      spec("Rated voltage (8520, as used by Flix)", 3.7, "V", FLIX, "estimated"),
      spec("716 diameter", 7, "mm", "size code convention (diameter × length)", "estimated"), spec("716 length", 16, "mm", "size code convention (diameter × length)", "estimated"),
      spec("720 diameter", 7, "mm", "size code convention (diameter × length)", "estimated"), spec("720 length", 20, "mm", "size code convention (diameter × length)", "estimated"),
      spec("8520 diameter", 8.5, "mm", "size code convention (diameter × length)", "estimated"), spec("8520 length", 20, "mm", "size code convention (diameter × length)", "estimated"),
      unknown("Stall current", "A"), unknown("Shaft diameter", "mm"),
    ],
    sources: [FLIX, ESPDRONE],
  },
  "lipo-1s": {
    summary: "One-cell lithium-polymer battery, the power source of micro drones (ESP-Drone: 300 mAh; Flix: 1000 mAh 25C or more recommended).",
    specs: [
      spec("Nominal voltage", 3.7, "V", LIPO, "estimated"), spec("Full charge", 4.2, "V", LIPO, "estimated"), spec("Lowest safe voltage (about)", 3, "V", LIPO, "estimated"),
      spec("Capacity (ESP-Drone kit)", 300, "mAh", ESPDRONE, "manufacturer"), spec("Capacity (Flix, recommended minimum)", 1000, "mAh", FLIX, "estimated"),
      unknown("Size", "mm"),
    ],
    sources: [LIPO, ESPDRONE, FLIX],
    interfaces: ["JST / MX2.0 connector (varies)"],
  },
  "tof-vl53l1x": {
    summary: "ST's VL53L1X laser distance sensor on a carrier board: up to about 4 m. Looking down from a drone it gives the height for height hold.",
    specs: [spec("I²C address", 41, "", "ST VL53L1X datasheet: 0x29 (7-bit) = 41", "manufacturer"), unknown("Module size", "mm")],
    sources: ["ST VL53L1X datasheet", "Carrier boards vary (supply range, size): check yours"],
    interfaces: ["I²C (address 0x29)"],
  },
  esc: {
    summary: "Speed controller for one brushless motor (bigger drones). Throttle by a PWM pulse: 1000 µs stop, 2000 µs full, the common hobby convention (check your ESC's manual; many also take DShot or OneShot).",
    specs: [spec("Throttle pulse, stop", 1000, "µs", "common hobby RC convention (check your ESC)", "estimated"), spec("Throttle pulse, full", 2000, "µs", "common hobby RC convention (check your ESC)", "estimated"), unknown("Mass", "g")],
    sources: ["Generic part: rated current, voltage range and protocols vary by ESC (read its manual)"],
    interfaces: ["PWM throttle signal"],
  },
  "brushless-motor": {
    summary: "Brushless outrunner motor for bigger drones, driven by an ESC. The size code is stator diameter and height (2207 = 22 × 7 mm); KV is rpm per volt with no load.",
    specs: [spec("2207: stator diameter", 22, "mm", "size code convention (stator diameter × height)", "estimated"), spec("2207: stator height", 7, "mm", "size code convention (stator diameter × height)", "estimated"), unknown("Mass", "g"), unknown("Max thrust", "g")],
    sources: ["Generic part: thrust depends on KV, propeller and battery (see the maker's thrust table)"],
  },
  "imu-mpu6050": {
    specs: [
      spec("Chip supply min", 2.375, "V", MPU_SPEC, "manufacturer"), spec("Chip supply max", 3.46, "V", MPU_SPEC, "manufacturer"),
      spec("Gyroscope full scale (max)", 2000, "°/s", MPU_SPEC, "manufacturer"), spec("Accelerometer full scale (max)", 16, "g", MPU_SPEC, "manufacturer"),
      unknown("Module size", "mm"),
    ],
    sources: [MPU_SPEC, "GY-521 breakout boards: generic, sold for 3-5 V with an on-board regulator"],
    // Addresses are written in hex everywhere, so they go here rather than as (decimal) spec numbers.
    interfaces: ["I²C, address 0x68 (AD0 low) or 0x69 (AD0 high), per the MPU-6000/6050 Product Specification"],
  },
};

function modulePart(c: ComponentDef): LibraryPart {
  const specs: PartSpec[] = [];
  for (const p of c.pins) {
    if (p.role.kind === "power-in") specs.push(fromCatalog(`${p.name.split(" (")[0]} supply min`, p.role.min, "V"), fromCatalog(`${p.name.split(" (")[0]} supply max`, p.role.max, "V"));
    if (p.role.kind === "signal-out") specs.push(fromCatalog(`${p.name.split(" (")[0]} output level`, p.role.volts, "V"));
  }
  const peak = LOAD_PEAK[c.id];
  if (peak) specs.push(fromCatalog("Peak current", { ...peak, value: peak.value * 1000 }, "mA"));
  if (c.electrical.kind === "breadboard") specs.push(spec("Holes", c.pins.length, "", "counted from the standard layout (5-hole strips, split rails)", "standard"));
  const extra = MODULE_EXTRA[c.id];
  return {
    id: c.id, name: c.name, category: CAT_MAP[c.category] ?? "Passive", manufacturer: null, generic: true,
    summary: extra?.summary ?? (c.notes || `${c.name} (generic part: specs vary between makers).`), specs: [...specs, ...(extra?.specs ?? [])], interfaces: extra?.interfaces ?? [],
    sources: extra?.sources ?? ["MakerStudio circuit catalog (typical values; generic part)"], circuitType: c.id,
    ...(extra?.summary ? { notes: c.notes } : {}),
  };
}

// --- displays, from the display catalog (controller datasheets) ---------------------------------

const displayParts: LibraryPart[] = DISPLAYS.filter((d) => !d.id.startsWith("m5stack")).map((d) => ({
  id: `display-${d.id}`, name: d.name, category: "Display", manufacturer: null, generic: true,
  summary: d.notes,
  specs: [
    spec("Width", d.width, "px", d.source, "manufacturer"), spec("Height", d.height, "px", d.source, "manufacturer"),
    ...(d.diagonal ? [spec("Diagonal", d.diagonal, "in", d.source, "manufacturer")] : [unknown("Diagonal", "in")]),
    unknown("Module size", "mm"),
  ],
  interfaces: [d.bus], sources: [d.source], displayId: d.id,
  notes: `Controller: ${d.controller}. ${d.color === "mono" ? "Monochrome." : "Colour (RGB565)."}`,
}));

// --- hardware, from ISO standards -----------------------------------------------------------------

const bearing = (code: string, d: number, D: number, B: number): LibraryPart => ({
  id: `bearing-${code.toLowerCase()}`, name: `Ball bearing ${code} (${d} × ${D} × ${B} mm)`, category: "Hardware", manufacturer: null, generic: true,
  summary: `Deep groove ball bearing, series designation ${code}. Bore ${d} mm, outside ${D} mm, width ${B} mm.`,
  specs: [spec("Bore (d)", d, "mm", "ISO 15 boundary dimensions", "standard"), spec("Outside diameter (D)", D, "mm", "ISO 15 boundary dimensions", "standard"), spec("Width (B)", B, "mm", "ISO 15 boundary dimensions", "standard")],
  interfaces: [], sources: ["ISO 15 (radial bearings, boundary dimensions)"],
  size: { x: spec("Outside", D, "mm", "ISO 15", "standard"), y: spec("Outside", D, "mm", "ISO 15", "standard"), z: spec("Width", B, "mm", "ISO 15", "standard") },
  notes: "For a printed housing, design the hole 0.1-0.2 mm larger than D and test-fit (printer dependent).",
});
const screw = (m: number, dk: number, k: number, s: number): LibraryPart => ({
  id: `screw-m${String(m).replace(".", "-")}-shcs`, name: `M${m} socket head cap screw`, category: "Hardware", manufacturer: null, generic: true,
  summary: `Metric hex socket head cap screw M${m} (ISO 4762). Choose the length you need.`,
  specs: [spec("Thread diameter", m, "mm", "ISO 4762", "standard"), spec("Head diameter (dk max)", dk, "mm", "ISO 4762", "standard"), spec("Head height (k max)", k, "mm", "ISO 4762", "standard"), spec("Hex key (s)", s, "mm", "ISO 4762", "standard")],
  interfaces: [], sources: ["ISO 4762 (hexagon socket head cap screws)"],
  notes: `Clearance hole in a print: about M${m} + 0.3-0.4 mm; counterbore about ${(dk + 0.6).toFixed(1)} mm (printer dependent).`,
});
const nut = (m: number, s: number, mm: number): LibraryPart => ({
  id: `nut-m${String(m).replace(".", "-")}`, name: `M${m} hex nut`, category: "Hardware", manufacturer: null, generic: true,
  summary: `Metric hex nut M${m} (ISO 4032).`,
  specs: [spec("Thread diameter", m, "mm", "ISO 4032", "standard"), spec("Width across flats (s)", s, "mm", "ISO 4032", "standard"), spec("Height (m max)", mm, "mm", "ISO 4032", "standard")],
  interfaces: [], sources: ["ISO 4032 (hexagon regular nuts)"],
  notes: `Hex pocket in a print: about ${(s + 0.3).toFixed(1)} mm across flats (printer dependent).`,
});

const propeller = (d: number): LibraryPart => ({
  id: `propeller-${d}mm`, name: `Micro drone propeller, ${d} mm`, category: "Hardware", manufacturer: null, generic: true,
  summary: `${d} mm propeller for 8520-size brushed motors (Flix uses 55 or 65 mm). Comes in clockwise and counter-clockwise pairs: a quad needs two of each.`,
  specs: [spec("Diameter", d, "mm", FLIX, "estimated"), unknown("Shaft hole", "mm"), unknown("Pitch", "mm")],
  interfaces: [], sources: [FLIX],
  notes: "Make sure the propeller hole matches your motor shaft (Flix README). Check the frame: neighbouring propellers must not touch.",
});

const HARDWARE: LibraryPart[] = [
  propeller(55), propeller(65),
  bearing("608", 8, 22, 7), bearing("623", 3, 10, 4), bearing("625", 5, 16, 5), bearing("688", 8, 16, 5),
  screw(2, 3.8, 2, 1.5), screw(2.5, 4.5, 2.5, 2), screw(3, 5.5, 3, 2.5), screw(4, 7, 4, 3),
  nut(2, 4, 1.6), nut(2.5, 5, 2), nut(3, 5.5, 2.4), nut(4, 7, 3.2),
];

export const LIBRARY: LibraryPart[] = [
  ...COMPONENTS.filter((c) => c.electrical.kind === "board").map(boardPart),
  ...COMPONENTS.filter((c) => c.electrical.kind !== "board").map(modulePart),
  ...displayParts,
  ...HARDWARE,
];

export function searchParts(query: string, category: string | null = null): LibraryPart[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return LIBRARY.filter((p) => (!category || p.category === category) && words.every((w) => `${p.name} ${p.summary} ${p.category} ${p.manufacturer ?? ""} ${p.interfaces.join(" ")} ${p.id}`.toLowerCase().includes(w)));
}
