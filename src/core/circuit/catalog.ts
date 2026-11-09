// Circuit components and boards.
//
// Every number used by a safety check carries a status: "verified" (read from the named
// manufacturer document) or "estimated" (a typical value; the checks report anything that
// relies on it as Info, never as passed). Board pin names come from manufacturer documents.

export type SpecStatus = "verified" | "estimated";
export interface Spec { value: number; status: SpecStatus; source: string }
const verified = (value: number, source: string): Spec => ({ value, status: "verified", source });
const estimated = (value: number, source = "typical value, check your part's datasheet"): Spec => ({ value, status: "estimated", source });

export type PinRole =
  | { kind: "ground" }
  | { kind: "supply"; volts: Spec; maxCurrent?: Spec } // a power output (board 5V/3V3 pin)
  | { kind: "power-in"; min: Spec; max: Spec } // a module's supply input
  | { kind: "gpio"; logic: Spec; maxCurrent: Spec; note?: string }
  | { kind: "signal-in"; note?: string } // a module input driven by a GPIO (servo signal, I2C)
  | { kind: "signal-out"; volts: Spec; note?: string } // a module output that drives a board input
  | { kind: "passive" }
  | { kind: "other"; note: string };

export interface PinDef { id: string; name: string; role: PinRole }

export type Electrical =
  | { kind: "battery" }
  | { kind: "resistor" }
  | { kind: "led" }
  | { kind: "diode" }
  | { kind: "capacitor"; polarized: boolean }
  | { kind: "switch" }
  | { kind: "transistor" }
  | { kind: "servo" }
  | { kind: "motor" }
  | { kind: "module" }
  | { kind: "board"; internalGround: string[] }
  /** LEDs sharing one common cathode (RGB LED, 7-segment display). */
  | { kind: "led-array"; common: string; channels: { pin: string; color: string }[] }
  | { kind: "potentiometer" }
  /** Holes joined inside the breadboard (each strip is one connection). */
  | { kind: "breadboard"; strips: string[][]; columns: number };

export interface PropDef { key: string; label: string; unit?: string; kind: "number" | "choice" | "boolean"; default: number | string | boolean; choices?: string[]; min?: number; max?: number }

export interface ComponentDef {
  id: string;
  name: string;
  category: "Prototyping" | "Power" | "Passive" | "Light" | "Input" | "Sensor" | "Semiconductor" | "Motion" | "Display" | "Board";
  electrical: Electrical;
  pins: PinDef[];
  props: PropDef[];
  notes: string;
  source?: string;
  /** Boards: which pin a GPIO number is, and the default I²C pins of its Arduino core. */
  gpio?: (n: number) => string | null;
  i2c?: { sda: string; scl: string; source: string };
  /** Boards: the supply pin a 3.3 V module (e.g. an OLED) should use. */
  logicSupply?: string;
}

// --- LED forward voltages: typical values, colour dependent (estimated) -----------------------
export const LED_COLORS = ["red", "yellow", "green", "blue", "white"] as const;
export const LED_VF: Record<(typeof LED_COLORS)[number], Spec> = {
  red: estimated(2.0, "typical red LED forward voltage"),
  yellow: estimated(2.1, "typical yellow LED forward voltage"),
  green: estimated(2.2, "typical green LED forward voltage (pure/true green LEDs are nearer 3 V)"),
  blue: estimated(3.0, "typical blue LED forward voltage"),
  white: estimated(3.0, "typical white LED forward voltage"),
};
export const LED_MAX_CURRENT = estimated(0.02, "typical 5 mm / 3 mm indicator LED rating (20 mA)");

// --- boards -----------------------------------------------------------------------------------

const UNO_SRC = "Arduino UNO R3 datasheet (A000066), sections 5.1 JANALOG and 5.2 JDIGITAL";
const unoLogic = verified(5, "Arduino UNO R3 datasheet: IOREF 'connected to 5V'");
const unoPinCurrent = estimated(0.02, "commonly recommended 20 mA per pin (ATmega328P absolute maximum is higher; not read from a document here)");
const unoGpio = (id: string, name: string, note?: string): PinDef => ({ id, name, role: { kind: "gpio", logic: unoLogic, maxCurrent: unoPinCurrent, note } });

const UNO: ComponentDef = {
  id: "arduino-uno-r3",
  name: "Arduino UNO R3",
  category: "Board",
  electrical: { kind: "board", internalGround: ["GND1", "GND2", "GND3"] },
  pins: [
    { id: "IOREF", name: "IOREF", role: { kind: "other", note: "Reference for digital logic voltage, connected to 5V" } },
    { id: "RESET", name: "RESET", role: { kind: "other", note: "Reset" } },
    { id: "3V3", name: "3.3V", role: { kind: "supply", volts: verified(3.3, UNO_SRC), maxCurrent: estimated(0.05, "commonly quoted 50 mA for the UNO R3 3.3 V pin") } },
    { id: "5V", name: "5V", role: { kind: "supply", volts: verified(5, UNO_SRC), maxCurrent: estimated(0.5, "USB-powered: limited by the USB port (often 500 mA)") } },
    { id: "GND1", name: "GND", role: { kind: "ground" } },
    { id: "GND2", name: "GND", role: { kind: "ground" } },
    { id: "VIN", name: "VIN", role: { kind: "power-in", min: verified(6, "Arduino UNO R3 datasheet 2.1: VIN 6-20 V"), max: verified(20, "Arduino UNO R3 datasheet 2.1: VIN 6-20 V") } },
    ...["A0", "A1", "A2", "A3"].map((p) => unoGpio(p, p, "analog input / GPIO")),
    unoGpio("A4", "A4/SDA", "I2C data"),
    unoGpio("A5", "A5/SCL", "I2C clock"),
    ...Array.from({ length: 10 }, (_, i) => unoGpio(`D${i}`, `D${i}`, i <= 1 ? "also used by USB serial (D0 RX, D1 TX)" : undefined)),
    unoGpio("D10", "D10/SS", "SPI chip select"),
    unoGpio("D11", "D11/MOSI", "SPI"),
    unoGpio("D12", "D12/MISO", "SPI"),
    unoGpio("D13", "D13/SCK", "SPI clock"),
    { id: "GND3", name: "GND", role: { kind: "ground" } },
    { id: "AREF", name: "AREF", role: { kind: "other", note: "Analog reference voltage" } },
  ],
  props: [],
  notes: "5 V logic (ATmega328P). Powered over USB in these checks.",
  source: UNO_SRC,
  gpio: (n) => (n >= 0 && n <= 13 ? `D${n}` : n >= 14 && n <= 19 ? `A${n - 14}` : null),
  i2c: { sda: "A4", scl: "A5", source: "Arduino UNO R3 datasheet: A4/SDA, A5/SCL" },
  logicSupply: "5V",
};

const PICO_SRC = "Raspberry Pi Pico datasheet (RP-008307-DS), section 'Pinout' and 'Powerchain'";
const picoLogic = verified(3.3, "Raspberry Pi Pico datasheet: 'Pico IO voltage is fixed at 3.3 V'");
const picoPinCurrent = estimated(0.012, "RP2040 GPIO drive strength is selectable, up to 12 mA (not read from a document here)");
const PICO_GP = [0, 1, "G", 2, 3, 4, 5, "G", 6, 7, 8, 9, "G", 10, 11, 12, 13, "G", 14, 15, 16, 17, "G", 18, 19, 20, 21, "G", 22];
let picoGnd = 0;
const PICO: ComponentDef = {
  id: "raspberry-pi-pico",
  name: "Raspberry Pi Pico",
  category: "Board",
  electrical: { kind: "board", internalGround: ["GND1", "GND2", "GND3", "GND4", "GND5", "GND6", "GND7", "AGND"] },
  pins: [
    ...PICO_GP.map((p): PinDef => (p === "G"
      ? { id: `GND${++picoGnd}`, name: "GND", role: { kind: "ground" } }
      : { id: `GP${p}`, name: `GP${p}`, role: { kind: "gpio", logic: picoLogic, maxCurrent: picoPinCurrent } })),
    { id: "RUN", name: "RUN", role: { kind: "other", note: "RP2040 enable / reset (pull low to reset)" } },
    { id: "GP26", name: "GP26/ADC0", role: { kind: "gpio", logic: picoLogic, maxCurrent: picoPinCurrent } },
    { id: "GP27", name: "GP27/ADC1", role: { kind: "gpio", logic: picoLogic, maxCurrent: picoPinCurrent } },
    { id: "AGND", name: "AGND", role: { kind: "ground" } },
    { id: "GP28", name: "GP28/ADC2", role: { kind: "gpio", logic: picoLogic, maxCurrent: picoPinCurrent } },
    { id: "ADC_VREF", name: "ADC_VREF", role: { kind: "other", note: "ADC reference" } },
    { id: "3V3", name: "3V3(OUT)", role: { kind: "supply", volts: verified(3.3, PICO_SRC), maxCurrent: verified(0.3, "Pico datasheet: 'recommended to keep the load on this pin less than 300 mA'") } },
    { id: "3V3_EN", name: "3V3_EN", role: { kind: "other", note: "Pull low to switch the 3.3 V supply (and the Pico) off" } },
    { id: "GND7", name: "GND", role: { kind: "ground" } },
    { id: "VSYS", name: "VSYS", role: { kind: "power-in", min: verified(1.8, "Pico datasheet: VSYS 1.8 V to 5.5 V"), max: verified(5.5, "Pico datasheet: VSYS 1.8 V to 5.5 V") } },
    { id: "VBUS", name: "VBUS", role: { kind: "supply", volts: verified(5, "Pico datasheet: VBUS is the micro-USB input voltage, nominally 5 V"), maxCurrent: estimated(0.5, "limited by the USB port (often 500 mA)") } },
  ],
  props: [],
  notes: "3.3 V logic: GPIO pins are not for 5 V signals. Powered over USB in these checks. Pin positions follow the Pico pinout diagram.",
  source: PICO_SRC,
  gpio: (n) => (n >= 0 && n <= 22) || (n >= 26 && n <= 28) ? `GP${n}` : null,
  i2c: { sda: "GP4", scl: "GP5", source: "ArduinoCore-mbed, variants/RASPBERRY_PI_PICO/pins_arduino.h: PIN_WIRE_SDA 4, PIN_WIRE_SCL 5" },
  logicSupply: "3V3",
};

const S3_SRC = "Espressif ESP32-S3-DevKitC-1 v1.1 user guide, headers J1 and J3";
const s3Logic = verified(3.3, "ESP32-S3-DevKitC-1 user guide: GPIO powered from the 3.3 V LDO");
const s3PinCurrent = estimated(0.02, "conservative per-pin value (not read from the ESP32-S3 datasheet here)");
const S3_J1: (string | number)[] = ["3V3", "3V3", "RST", 4, 5, 6, 7, 15, 16, 17, 18, 8, 3, 46, 9, 10, 11, 12, 13, 14, "5V", "G"];
const S3_J3: (string | number)[] = ["G", "TX", "RX", 1, 2, 42, 41, 40, 39, 38, 37, 36, 35, 0, 45, 48, 47, 21, 20, 19, "G", "G"];
const s3Pins = (): PinDef[] => {
  const pins: PinDef[] = [];
  const seen = new Map<string, number>();
  const uniq = (base: string) => { const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return n === 1 ? base : `${base}_${n}`; };
  for (const p of [...S3_J1, ...S3_J3]) {
    if (p === "3V3") pins.push({ id: uniq("3V3"), name: "3V3", role: { kind: "supply", volts: verified(3.3, S3_SRC), maxCurrent: estimated(0.5, "depends on the board's LDO; not stated in the user guide") } });
    else if (p === "5V") pins.push({ id: "5V", name: "5V", role: { kind: "supply", volts: verified(5, S3_SRC + " (from USB)"), maxCurrent: estimated(0.5, "limited by the USB port (often 500 mA)") } });
    else if (p === "G") pins.push({ id: uniq("GND"), name: "GND", role: { kind: "ground" } });
    else if (p === "RST") pins.push({ id: "RST", name: "RST (EN)", role: { kind: "other", note: "Reset / enable" } });
    else if (p === "TX") pins.push({ id: "GPIO43", name: "TX (GPIO43)", role: { kind: "gpio", logic: s3Logic, maxCurrent: s3PinCurrent, note: "USB-serial TX" } });
    else if (p === "RX") pins.push({ id: "GPIO44", name: "RX (GPIO44)", role: { kind: "gpio", logic: s3Logic, maxCurrent: s3PinCurrent, note: "USB-serial RX" } });
    else {
      const note = p === 35 || p === 36 || p === 37 ? "used by Octal flash/PSRAM on some module versions: not available there"
        : p === 19 || p === 20 ? "USB D-/D+" : p === 38 ? "on-board RGB LED" : p === 0 || p === 45 || p === 46 ? "strapping pin (affects boot)" : undefined;
      pins.push({ id: `GPIO${p}`, name: `GPIO${p}`, role: { kind: "gpio", logic: s3Logic, maxCurrent: s3PinCurrent, note } });
    }
  }
  return pins;
};
const S3_PINS = s3Pins();
const S3: ComponentDef = {
  id: "esp32-s3-devkitc-1",
  name: "ESP32-S3-DevKitC-1",
  category: "Board",
  electrical: { kind: "board", internalGround: S3_PINS.filter((p) => p.role.kind === "ground").map((p) => p.id) },
  pins: S3_PINS,
  props: [],
  notes: "3.3 V logic: GPIO pins are not for 5 V signals. Powered over USB in these checks.",
  source: S3_SRC,
  gpio: (n) => (S3_PINS.some((p) => p.id === `GPIO${n}`) ? `GPIO${n}` : null),
  i2c: { sda: "GPIO8", scl: "GPIO9", source: "arduino-esp32, variants/esp32s3/pins_arduino.h: SDA 8, SCL 9" },
  logicSupply: "3V3",
};


const XIAO_SRC = "Seeed wiki 'Getting Started with Seeed Studio XIAO ESP32S3 Series' pin map + arduino-esp32 variants/XIAO_ESP32S3/pins_arduino.h (both checked 2026-11-08)";
const xiaoLogic = estimated(3.3, "ESP32-S3 GPIO run at 3.3 V; the XIAO page does not state it");
const xiaoPinCurrent = estimated(0.02, "conservative per-pin value (not stated on the XIAO page)");
const XIAO_D: [number, number, string?][] = [[0, 1, "A0"], [1, 2, "A1"], [2, 3, "A2"], [3, 4, "A3"], [4, 5, "SDA (I²C)"], [5, 6, "SCL (I²C)"], [6, 43, "TX"], [7, 44, "RX"], [8, 7, "SCK (SPI, shared with the Sense's SD card)"], [9, 8, "MISO (SPI, shared with the Sense's SD card)"], [10, 9, "MOSI (SPI, shared with the Sense's SD card)"]];
const xd = (d: number): PinDef => { const [, g, note] = XIAO_D[d]!; return { id: `D${d}`, name: `D${d} (GPIO${g})`, role: { kind: "gpio", logic: xiaoLogic, maxCurrent: xiaoPinCurrent, ...(note ? { note } : {}) } }; };
const XIAO: ComponentDef = {
  id: "xiao-esp32s3-sense",
  name: "Seeed XIAO ESP32-S3 Sense",
  category: "Board",
  electrical: { kind: "board", internalGround: ["GND"] },
  // Physical order, USB-C at the top: D0-D6 down the left, 5V GND 3V3 D10 D9 D8 D7 down the right.
  pins: [
    xd(0), xd(1), xd(2), xd(3), xd(4), xd(5), xd(6),
    { id: "5V", name: "5V (VBUS)", role: { kind: "supply", volts: verified(5, XIAO_SRC + ": 5V = VBUS, from USB-C"), maxCurrent: estimated(0.5, "limited by the USB port (often 500 mA)") } },
    { id: "GND", name: "GND", role: { kind: "ground" } },
    { id: "3V3", name: "3V3", role: { kind: "supply", volts: verified(3.3, XIAO_SRC), maxCurrent: verified(0.7, "Seeed wiki: 'You can draw 700mA' from the 3V3 output") } },
    xd(10), xd(9), xd(8), xd(7),
  ],
  props: [],
  notes: "21 × 17.8 mm (Seeed wiki); with the Sense camera board about 15 mm thick. ESP32-S3R8, 8 MB flash, 8 MB PSRAM. The Sense board adds a camera (OV5640 now, OV2640/OV3660 on older units), a digital PDM microphone (GPIO42 clock, GPIO41 data) and a microSD slot (CS GPIO21, SPI on D8-D10). User LED on GPIO21, on when LOW. 3.3 V logic. Powered over USB in these checks.",
  source: XIAO_SRC,
  gpio: (n) => { const d = XIAO_D.findIndex(([, g]) => g === n); return d >= 0 ? `D${d}` : null; },
  i2c: { sda: "D4", scl: "D5", source: "pins_arduino.h: SDA 5 (D4), SCL 6 (D5)" },
  logicSupply: "3V3",
};

const CORES3_SRC = "M5Stack CoreS3 documentation, PinMap (HY2.0-4P ports)";
const coreS3Logic = verified(3.3, "same ESP32-S3 chip as the DevKitC-1 (Espressif user guide: GPIO powered from 3.3 V)");
const coreS3PinCurrent = estimated(0.02, "conservative per-pin value (not stated on the CoreS3 page)");
const port = (name: string, yellow: number, white: number, yNote: string, wNote: string): PinDef[] => [
  { id: `P${name}_GND`, name: `Port ${name} GND`, role: { kind: "ground" } },
  { id: `P${name}_5V`, name: `Port ${name} 5V`, role: { kind: "supply", volts: verified(5, CORES3_SRC + ": red wire 5V"), maxCurrent: estimated(0.5, "not stated on the CoreS3 page") } },
  { id: `G${yellow}`, name: `Port ${name} G${yellow}`, role: { kind: "gpio", logic: coreS3Logic, maxCurrent: coreS3PinCurrent, note: yNote } },
  { id: `G${white}`, name: `Port ${name} G${white}`, role: { kind: "gpio", logic: coreS3Logic, maxCurrent: coreS3PinCurrent, note: wNote } },
];
const CORES3: ComponentDef = {
  id: "m5stack-cores3",
  name: "M5Stack CoreS3 (ports)",
  category: "Board",
  electrical: { kind: "board", internalGround: ["PA_GND", "PB_GND", "PC_GND"] },
  pins: [...port("A", 2, 1, "Port A SDA (I²C)", "Port A SCL (I²C)"), ...port("B", 9, 8, "Port B out", "Port B in"), ...port("C", 17, 18, "Port C TX", "Port C RX")],
  props: [],
  notes: "The three Grove-style ports of the CoreS3 (black GND, red 5V, yellow and white signals). The screen is built in. Powered over USB in these checks.",
  source: CORES3_SRC,
  gpio: (n) => ([1, 2, 8, 9, 17, 18].includes(n) ? `G${n}` : null),
};

// --- breadboards ----------------------------------------------------------------------------------

/** Rail hole columns: groups of 5 with a gap, as on common breadboards. */
export function railColumns(columns: number): number[] {
  const out: number[] = [];
  for (let col = 1; col <= columns; col++) if ((col - 1) % 6 !== 5) out.push(col);
  // Half-size (30 columns): 25 holes per rail; full-size (63 columns): 50.
  return out.slice(0, Math.floor((columns + 1) / 6) * 5);
}

function breadboard(id: string, name: string, columns: number): ComponentDef {
  const pins: PinDef[] = [];
  const strips: string[][] = [];
  const rails = railColumns(columns);
  const rail = (key: string, label: string) => {
    const ids = rails.map((_, i) => `${key}${i + 1}`);
    for (const pid of ids) pins.push({ id: pid, name: `${label} rail`, role: { kind: "passive" } });
    strips.push(ids);
  };
  rail("T+", "Top +");
  rail("T-", "Top −");
  for (let col = 1; col <= columns; col++) {
    for (const half of ["abcde", "fghij"]) {
      const ids = [...half].map((r) => `${r}${col}`);
      for (const pid of ids) pins.push({ id: pid, name: `Row ${pid[0]}, column ${col} (joined to ${ids[0]}-${ids[4]})`, role: { kind: "passive" } });
      strips.push(ids);
    }
  }
  rail("B-", "Bottom −");
  rail("B+", "Bottom +");
  return {
    id, name, category: "Prototyping", electrical: { kind: "breadboard", strips, columns },
    pins, props: [],
    notes: `${pins.length} holes. Each group of 5 holes in a column (a-e, f-j) is joined inside; the long rails along the edges are joined end to end. Drop parts so their legs sit in the holes, or wire a hole to a board pin. On some full-size boards the rails are split in the middle: check yours with a multimeter.`,
  };
}

const passive = (id: string, name: string) => ({ id, name, role: { kind: "passive" as const } });
const vin = (id: string, name: string, min: number, max: number, why: string): PinDef => ({ id, name, role: { kind: "power-in", min: estimated(min, why), max: estimated(max, why) } });
const gnd = (id = "GND", name = "GND"): PinDef => ({ id, name, role: { kind: "ground" } });
const sin = (id: string, name: string, note?: string): PinDef => ({ id, name, role: { kind: "signal-in", ...(note ? { note } : {}) } });
const sout = (id: string, name: string, volts: number, why: string, note?: string): PinDef => ({ id, name, role: { kind: "signal-out", volts: estimated(volts, why), ...(note ? { note } : {}) } });
const other = (id: string, name: string, note: string): PinDef => ({ id, name, role: { kind: "other", note } });

// --- parts --------------------------------------------------------------------------------------

export const COMPONENTS: ComponentDef[] = [
  breadboard("breadboard-half", "Breadboard (half, 400 holes)", 30),
  breadboard("breadboard-full", "Breadboard (full, 830 holes)", 63),
  {
    id: "battery", name: "Battery / power supply", category: "Power", electrical: { kind: "battery" },
    pins: [{ id: "+", name: "+", role: { kind: "supply", volts: estimated(9, "set the voltage in the part's settings") } }, { id: "-", name: "−", role: { kind: "ground" } }],
    props: [
      { key: "volts", label: "Voltage", unit: "V", kind: "number", default: 9, min: 0.5, max: 48 },
      { key: "chemistry", label: "Type", kind: "choice", default: "alkaline", choices: ["alkaline", "nimh", "lipo", "bench-supply"] },
    ],
    notes: "Battery pack or bench supply. LiPo cells need protection and a proper charger.",
  },
  {
    id: "resistor", name: "Resistor", category: "Passive", electrical: { kind: "resistor" },
    pins: [{ id: "1", name: "1", role: { kind: "passive" } }, { id: "2", name: "2", role: { kind: "passive" } }],
    props: [{ key: "ohms", label: "Resistance", unit: "Ω", kind: "number", default: 220, min: 0.1, max: 1e8 }],
    notes: "",
  },
  {
    id: "led", name: "LED", category: "Light", electrical: { kind: "led" },
    pins: [{ id: "A", name: "Anode (+, long leg)", role: { kind: "passive" } }, { id: "K", name: "Cathode (−, short leg)", role: { kind: "passive" } }],
    props: [{ key: "color", label: "Colour", kind: "choice", default: "red", choices: [...LED_COLORS] }],
    notes: "Needs a series resistor. Forward voltage and current rating are typical values.",
  },
  {
    id: "diode", name: "Diode (signal / rectifier)", category: "Semiconductor", electrical: { kind: "diode" },
    pins: [{ id: "A", name: "Anode", role: { kind: "passive" } }, { id: "K", name: "Cathode (band)", role: { kind: "passive" } }],
    props: [], notes: "",
  },
  {
    id: "capacitor", name: "Capacitor (ceramic)", category: "Passive", electrical: { kind: "capacitor", polarized: false },
    pins: [{ id: "1", name: "1", role: { kind: "passive" } }, { id: "2", name: "2", role: { kind: "passive" } }],
    props: [{ key: "microfarads", label: "Capacitance", unit: "µF", kind: "number", default: 0.1, min: 0.000001, max: 100000 }, { key: "ratedVolts", label: "Rated voltage", unit: "V", kind: "number", default: 50, min: 1, max: 1000 }],
    notes: "",
  },
  {
    id: "electrolytic", name: "Capacitor (electrolytic)", category: "Passive", electrical: { kind: "capacitor", polarized: true },
    pins: [{ id: "+", name: "+", role: { kind: "passive" } }, { id: "-", name: "− (stripe)", role: { kind: "passive" } }],
    props: [{ key: "microfarads", label: "Capacitance", unit: "µF", kind: "number", default: 100, min: 0.1, max: 100000 }, { key: "ratedVolts", label: "Rated voltage", unit: "V", kind: "number", default: 16, min: 1, max: 500 }],
    notes: "Polarized: the − leg (stripe) goes to the lower voltage.",
  },
  {
    id: "button", name: "Push button", category: "Input", electrical: { kind: "switch" },
    pins: [{ id: "1", name: "1", role: { kind: "passive" } }, { id: "2", name: "2", role: { kind: "passive" } }],
    props: [{ key: "closed", label: "Pressed", kind: "boolean", default: false }],
    notes: "Two-pin view of a push button.",
  },
  {
    id: "switch", name: "Switch (on/off)", category: "Input", electrical: { kind: "switch" },
    pins: [{ id: "1", name: "1", role: { kind: "passive" } }, { id: "2", name: "2", role: { kind: "passive" } }],
    props: [{ key: "closed", label: "On", kind: "boolean", default: false }],
    notes: "",
  },
  {
    id: "npn", name: "NPN transistor", category: "Semiconductor", electrical: { kind: "transistor" },
    pins: [{ id: "B", name: "Base", role: { kind: "passive" } }, { id: "C", name: "Collector", role: { kind: "passive" } }, { id: "E", name: "Emitter", role: { kind: "passive" } }],
    props: [], notes: "Transistor circuits are not analysed by the checks yet.",
  },
  {
    id: "servo", name: "Hobby servo (PWM)", category: "Motion", electrical: { kind: "servo" },
    pins: [
      { id: "GND", name: "GND (brown/black)", role: { kind: "ground" } },
      { id: "V", name: "V+ (red)", role: { kind: "power-in", min: estimated(4.8, "typical small hobby servo range (check yours)"), max: estimated(6, "typical small hobby servo range (check yours)") } },
      { id: "SIG", name: "Signal (orange/yellow)", role: { kind: "signal-in" } },
    ],
    props: [], notes: "Wire colours are the common convention; check your servo.",
  },
  {
    id: "motor", name: "DC motor", category: "Motion", electrical: { kind: "motor" },
    pins: [{ id: "1", name: "1", role: { kind: "passive" } }, { id: "2", name: "2", role: { kind: "passive" } }],
    props: [{ key: "volts", label: "Rated voltage", unit: "V", kind: "number", default: 6, min: 0.5, max: 48 }],
    notes: "Needs a motor driver; never power a motor from a GPIO pin.",
  },
  {
    id: "oled-i2c", name: "OLED display module (I²C)", category: "Display", electrical: { kind: "module" },
    pins: [
      { id: "GND", name: "GND", role: { kind: "ground" } },
      { id: "VCC", name: "VCC", role: { kind: "power-in", min: estimated(3.3, "many SSD1306 modules accept 3.3-5 V; some are 3.3 V only (check yours)"), max: estimated(5, "many SSD1306 modules accept 3.3-5 V; some are 3.3 V only (check yours)") } },
      { id: "SCL", name: "SCL", role: { kind: "signal-in", note: "I2C clock" } },
      { id: "SDA", name: "SDA", role: { kind: "signal-in", note: "I2C data" } },
    ],
    props: [], notes: "Typical 4-pin SSD1306 / SH1106 module. Pin order differs between modules: follow the labels on yours.",
  },
  {
    id: "battery-aa", name: "AA battery pack (4 × AA)", category: "Power", electrical: { kind: "battery" },
    pins: [{ id: "+", name: "+ (red)", role: { kind: "supply", volts: estimated(6, "4 fresh alkaline AA cells, about 1.5 V each") } }, { id: "-", name: "− (black)", role: { kind: "ground" } }],
    props: [
      { key: "volts", label: "Voltage", unit: "V", kind: "number", default: 6, min: 0.5, max: 48 },
      { key: "chemistry", label: "Type", kind: "choice", default: "alkaline", choices: ["alkaline", "nimh", "lipo", "bench-supply"] },
    ],
    notes: "4 × AA: about 6 V with alkaline cells, about 4.8 V with NiMH rechargeables.",
  },
  {
    id: "coin-cell", name: "Coin cell (CR2032)", category: "Power", electrical: { kind: "battery" },
    pins: [{ id: "+", name: "+", role: { kind: "supply", volts: estimated(3, "CR2032 lithium coin cell, nominal 3 V") } }, { id: "-", name: "−", role: { kind: "ground" } }],
    props: [
      { key: "volts", label: "Voltage", unit: "V", kind: "number", default: 3, min: 0.5, max: 48 },
      { key: "chemistry", label: "Type", kind: "choice", default: "alkaline", choices: ["alkaline", "nimh", "lipo", "bench-supply"] },
    ],
    notes: "Small current only (a few mA continuous). Fine for an LED or a sensor, not for motors.",
  },
  {
    id: "potentiometer", name: "Potentiometer (knob)", category: "Input", electrical: { kind: "potentiometer" },
    pins: [passive("1", "End 1"), passive("W", "Wiper (middle)"), passive("2", "End 2")],
    props: [
      { key: "ohms", label: "Total resistance", unit: "Ω", kind: "number", default: 10000, min: 10, max: 1e7 },
      { key: "position", label: "Knob position (0-1)", kind: "number", default: 0.5, min: 0, max: 1 },
    ],
    notes: "The middle pin (wiper) gives a voltage between the two ends: ends to 3V3/5V and GND, wiper to an analog pin.",
  },
  {
    id: "photoresistor", name: "Photoresistor (LDR)", category: "Sensor", electrical: { kind: "resistor" },
    pins: [passive("1", "1"), passive("2", "2")],
    props: [{ key: "ohms", label: "Resistance now (bright ≈ 1 kΩ, dark ≈ 100 kΩ+)", unit: "Ω", kind: "number", default: 10000, min: 10, max: 1e8 }],
    notes: "Resistance falls as light rises (typical values; varies a lot by part). Use it with a fixed resistor as a voltage divider into an analog pin.",
  },
  {
    id: "buzzer", name: "Piezo buzzer", category: "Passive", electrical: { kind: "module" },
    pins: [passive("+", "+ (long leg)"), passive("-", "−")],
    props: [], notes: "A passive piezo: drive it from a GPIO pin with tone(). Active buzzer modules (with their own oscillator) just need power.",
  },
  {
    id: "tilt-switch", name: "Tilt switch", category: "Input", electrical: { kind: "switch" },
    pins: [passive("1", "1"), passive("2", "2")],
    props: [{ key: "closed", label: "Upright (closed)", kind: "boolean", default: true }],
    notes: "A ball inside closes the contacts when upright. Use it like a button with a pull-up.",
  },
  {
    id: "rgb-led", name: "RGB LED (common cathode)", category: "Light",
    electrical: { kind: "led-array", common: "K", channels: [{ pin: "R", color: "red" }, { pin: "G", color: "green" }, { pin: "B", color: "blue" }] },
    pins: [passive("R", "Red"), passive("K", "Common cathode (−, longest leg)"), passive("G", "Green"), passive("B", "Blue")],
    props: [], notes: "Each colour needs its own resistor. Common-anode RGB LEDs exist too: check yours (pin order also varies).",
  },
  {
    id: "seven-segment", name: "7-segment display (common cathode)", category: "Display",
    electrical: { kind: "led-array", common: "COM", channels: ["a", "b", "c", "d", "e", "f", "g", "DP"].map((pin) => ({ pin, color: "red" })) },
    pins: [...["a", "b", "c", "d", "e", "f", "g", "DP"].map((x) => passive(x, `Segment ${x}`)), passive("COM", "Common cathode (−)")],
    props: [], notes: "Each segment is an LED and needs its own resistor. Pin positions differ between displays: follow its datasheet.",
  },
  {
    id: "neopixel-ring", name: "NeoPixel ring (12 × WS2812B)", category: "Light", electrical: { kind: "module" },
    pins: [vin("5V", "5V", 4.5, 5.5, "WS2812B LEDs are 5 V parts (typical range)"), gnd(), sin("DIN", "Data in")],
    props: [], notes: "Addressable RGB LEDs. A resistor (about 300-500 Ω) in the data line and a big capacitor across 5V/GND are commonly recommended.",
  },
  {
    id: "lcd-i2c", name: "LCD 16×2 with I²C backpack", category: "Display", electrical: { kind: "module" },
    pins: [gnd(), vin("VCC", "VCC", 4.5, 5.5, "typical 5 V character LCD with PCF8574 backpack"), sin("SDA", "SDA", "I2C data"), sin("SCL", "SCL", "I2C clock")],
    props: [], notes: "Common I²C address 0x27 or 0x3F. Turn the contrast screw on the back if you see nothing.",
  },
  {
    id: "ultrasonic", name: "Ultrasonic distance sensor (HC-SR04)", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 4.5, 5.5, "HC-SR04 is a 5 V module (typical)"), sin("TRIG", "Trig"), sout("ECHO", "Echo", 5, "HC-SR04 echo output swings to its 5 V supply (typical)"), gnd()],
    props: [], notes: "Measures about 2-400 cm (typical). On 3.3 V boards the 5 V Echo signal needs a voltage divider.",
  },
  {
    id: "pir", name: "PIR motion sensor (HC-SR501)", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 4.5, 20, "HC-SR501 typical supply range"), sout("OUT", "OUT", 3.3, "HC-SR501 output is about 3.3 V when motion is seen (typical)"), gnd()],
    props: [], notes: "Two screws set sensitivity and on-time. Takes up to a minute to settle after power-up.",
  },
  {
    id: "tmp36", name: "Temperature sensor (TMP36)", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VS", "+Vs", 2.7, 5.5, "TMP36 supply range as commonly quoted (check the datasheet)"), other("VOUT", "Vout", "Analog voltage: about 10 mV per °C, 750 mV at 25 °C"), gnd()],
    props: [], notes: "Flat side facing you: +Vs, Vout, GND (left to right). Read Vout on an analog pin.",
  },
  {
    id: "dht11", name: "Temperature + humidity sensor (DHT11)", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 3.3, 5.5, "DHT11 typical supply range"), other("DATA", "Data", "One-wire data; needs a pull-up (often on the module)"), gnd()],
    props: [], notes: "Slow sensor: read it at most about once a second.",
  },
  {
    id: "soil-moisture", name: "Soil moisture sensor", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 3.3, 5, "typical capacitive/resistive soil sensor modules"), other("AO", "AO", "Analog output: wetter soil changes the voltage"), gnd()],
    props: [], notes: "Resistive probes corrode if powered all the time: power them only while reading.",
  },
  {
    id: "ir-receiver", name: "IR receiver (38 kHz)", category: "Sensor", electrical: { kind: "module" },
    pins: [other("OUT", "OUT", "Goes LOW while it sees a 38 kHz IR signal"), gnd(), vin("VS", "VS", 2.7, 5.5, "typical VS1838B-class receiver")],
    props: [], notes: "For TV-style remotes. Pin order varies between parts: check yours.",
  },
  {
    id: "gas-sensor", name: "Gas sensor module (MQ-2)", category: "Sensor", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 4.8, 5.2, "MQ-series heaters are specified around 5 V (typical)"), gnd(), other("DO", "DO", "Digital: threshold set by the screw"), other("AO", "AO", "Analog output")],
    props: [], notes: "The heater gets hot and draws a lot of current; it needs a warm-up before readings mean anything.",
  },
  {
    id: "joystick", name: "Joystick module (2-axis)", category: "Input", electrical: { kind: "module" },
    pins: [gnd(), vin("VCC", "+5V", 3.3, 5, "two potentiometers: works from 3.3 or 5 V"), other("VRX", "VRx", "Analog X"), other("VRY", "VRy", "Analog Y"), other("SW", "SW", "Push switch to GND: use INPUT_PULLUP")],
    props: [], notes: "Power it from the same voltage as the board's analog reference.",
  },
  {
    id: "keypad", name: "Keypad 4×4 (membrane)", category: "Input", electrical: { kind: "module" },
    pins: ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"].map((x) => passive(x, x[0] === "R" ? `Row ${x[1]}` : `Column ${x[1]}`)),
    props: [], notes: "Plain switches in a grid: 8 GPIO pins, scanned with the Keypad library. Not analysed by the checks.",
  },
  {
    id: "relay", name: "Relay module (1 channel, 5 V)", category: "Motion", electrical: { kind: "module" },
    pins: [vin("VCC", "VCC", 4.5, 5.5, "typical 5 V relay module"), gnd(), sin("IN", "IN"), other("COM", "COM", "Switched side: isolated from the low-voltage side"), other("NO", "NO", "Normally open"), other("NC", "NC", "Normally closed")],
    props: [], notes: "Switching mains voltage is dangerous: keep to low-voltage loads unless you are qualified. Some modules switch on when IN is LOW.",
  },
  {
    id: "motor-driver", name: "Motor driver (L298N module)", category: "Motion", electrical: { kind: "module" },
    pins: [
      vin("VM", "+12V (motor supply)", 5, 35, "L298N module motor supply as commonly quoted"), gnd(), other("5V", "5V", "Regulator output or logic input, depending on the jumper"),
      sin("ENA", "ENA"), sin("IN1", "IN1"), sin("IN2", "IN2"), sin("IN3", "IN3"), sin("IN4", "IN4"), sin("ENB", "ENB"),
      other("OUT1", "OUT1", "Motor A"), other("OUT2", "OUT2", "Motor A"), other("OUT3", "OUT3", "Motor B"), other("OUT4", "OUT4", "Motor B"),
    ],
    props: [], notes: "Drives two DC motors. The L298N loses about 2 V or more, so motors get less than the supply voltage. Join its GND to the board's GND.",
  },
  {
    id: "tof-vl53l1x", name: "Distance sensor VL53L1X (I²C)", category: "Sensor", electrical: { kind: "module" },
    pins: [
      { id: "VIN", name: "VIN", role: { kind: "power-in", min: estimated(2.6, "carrier boards with a regulator (e.g. Pololu's) take about 2.6-5.5 V; check yours"), max: estimated(5.5, "carrier boards with a regulator (e.g. Pololu's) take about 2.6-5.5 V; check yours") } },
      { id: "GND", name: "GND", role: { kind: "ground" } },
      { id: "SDA", name: "SDA", role: { kind: "signal-in", note: "I2C data (address 0x29)" } },
      { id: "SCL", name: "SCL", role: { kind: "signal-in", note: "I2C clock" } },
      { id: "XSHUT", name: "XSHUT", role: { kind: "other", note: "shutdown; leave unconnected (pulled up on carrier boards)" } },
      { id: "GPIO1", name: "GPIO1", role: { kind: "other", note: "data-ready interrupt; optional" } },
    ],
    props: [],
    notes: "Laser time-of-flight distance sensor (ST VL53L1X), up to about 4 m indoors. On a drone it looks straight down for height hold (LiteWing has a pad for one).",
  },
  {
    id: "esc", name: "Brushless ESC (PWM signal)", category: "Motion", electrical: { kind: "module" },
    pins: [
      { id: "BAT+", name: "BAT+ (red, battery)", role: { kind: "power-in", min: estimated(7, "typical 2S-6S ESC; check yours"), max: estimated(25.2, "typical 2S-6S ESC: 6S full is 25.2 V; check yours") } },
      { id: "BAT-", name: "BAT− (black)", role: { kind: "ground" } },
      { id: "SIG", name: "Signal", role: { kind: "signal-in", note: "PWM throttle: 1000 µs = stop, 2000 µs = full (common hobby convention)" } },
      { id: "GND", name: "Signal GND", role: { kind: "ground" } },
      { id: "A", name: "Motor A", role: { kind: "other", note: "to the brushless motor (swap any two wires to reverse it)" } },
      { id: "B", name: "Motor B", role: { kind: "other", note: "to the brushless motor" } },
      { id: "C", name: "Motor C", role: { kind: "other", note: "to the brushless motor" } },
    ],
    props: [{ key: "amps", label: "Rated current", unit: "A", kind: "number", default: 30, min: 1, max: 200 }],
    notes: "Electronic speed controller for one brushless motor. Takes the battery's full power: keep the propellers off on the bench, and calibrate its throttle range as its manual says. A signal pin only gives the throttle pulse.",
  },
  {
    id: "brushless-motor", name: "Brushless motor (3 wires)", category: "Motion", electrical: { kind: "module" },
    pins: [
      { id: "A", name: "A", role: { kind: "other", note: "to the ESC" } },
      { id: "B", name: "B", role: { kind: "other", note: "to the ESC" } },
      { id: "C", name: "C", role: { kind: "other", note: "to the ESC" } },
    ],
    props: [{ key: "kv", label: "KV", unit: "rpm/V", kind: "number", default: 2400, min: 100, max: 20000 }],
    notes: "Brushless outrunner (e.g. 2207 size for a 5-inch quad). Only through an ESC. The size code is stator diameter and height in mm.",
  },
  // --- drone parts (2026-11-09): what ESP-Drone and Flix are built from ---
  {
    id: "coreless-motor", name: "Brushed coreless motor (micro drone)", category: "Motion", electrical: { kind: "motor" },
    pins: [{ id: "+", name: "+ (red)", role: { kind: "passive" } }, { id: "-", name: "− (black / blue)", role: { kind: "passive" } }],
    props: [
      { key: "size", label: "Size (mm: diameter, length)", kind: "choice", default: "8520", choices: ["716", "720", "8520"] },
      { key: "volts", label: "Rated voltage", unit: "V", kind: "number", default: 3.7, min: 0.5, max: 12 },
    ],
    notes: "Tiny brushed motor for 1S micro drones (ESP-Drone uses 716 / 720, Flix uses 8520). Switch it with a logic-level N-channel MOSFET (with a pull-down on the gate and a flyback diode), never straight from a GPIO pin. Propeller direction: two clockwise, two counter-clockwise.",
  },
  {
    id: "lipo-1s", name: "LiPo battery, 1 cell (1S, 3.7 V)", category: "Power", electrical: { kind: "battery" },
    pins: [
      { id: "+", name: "+ (red)", role: { kind: "supply", volts: estimated(3.7, "lithium-polymer cell: 3.7 V nominal, 4.2 V full, about 3.0 V empty (check your cell)") } },
      { id: "-", name: "− (black)", role: { kind: "ground" } },
    ],
    props: [
      { key: "volts", label: "Voltage", unit: "V", kind: "number", default: 3.7, min: 3, max: 4.2 },
      { key: "chemistry", label: "Type", kind: "choice", default: "lipo", choices: ["lipo"] },
      { key: "capacity", label: "Capacity", unit: "mAh", kind: "number", default: 300, min: 50, max: 5000 },
      { key: "crating", label: "Discharge rating", unit: "C", kind: "number", default: 25, min: 1, max: 150 },
    ],
    notes: "One lithium-polymer cell: 3.7 V nominal, 4.2 V when full. Charge only with a LiPo charger, never unattended; do not discharge below about 3.0 V; store and charge in a fire-safe bag. Max current is roughly capacity × C (e.g. 300 mAh × 25C = 7.5 A).",
  },
  {
    id: "imu-mpu6050", name: "IMU module MPU-6050 (GY-521, I²C)", category: "Sensor", electrical: { kind: "module" },
    pins: [
      { id: "VCC", name: "VCC", role: { kind: "power-in", min: estimated(3.3, "GY-521-style modules have a 3.3 V regulator and are sold for 3-5 V (check yours)"), max: estimated(5, "GY-521-style modules have a 3.3 V regulator and are sold for 3-5 V (check yours)") } },
      { id: "GND", name: "GND", role: { kind: "ground" } },
      { id: "SCL", name: "SCL", role: { kind: "signal-in", note: "I2C clock" } },
      { id: "SDA", name: "SDA", role: { kind: "signal-in", note: "I2C data" } },
      { id: "XDA", name: "XDA", role: { kind: "other", note: "auxiliary I2C data (for an extra sensor); usually not connected" } },
      { id: "XCL", name: "XCL", role: { kind: "other", note: "auxiliary I2C clock; usually not connected" } },
      { id: "AD0", name: "AD0", role: { kind: "signal-in", note: "I2C address: low = 0x68, high = 0x69" } },
      { id: "INT", name: "INT", role: { kind: "signal-out", volts: estimated(3.3, "interrupt output at the chip's logic level (3.3 V on GY-521-style modules)"), note: "data-ready interrupt (ESP-Drone uses it)" } },
    ],
    props: [],
    notes: "6-axis motion sensor (3-axis gyroscope + 3-axis accelerometer) used by ESP-Drone and Flix. The chip itself runs on 2.375-3.46 V (TDK InvenSense MPU-6000/6050 Product Specification); breakout boards add a regulator. Mount it flat and centred on the frame, on soft tape to damp vibration.",
    source: "TDK InvenSense MPU-6000/MPU-6050 Product Specification (chip supply range, I2C addresses 0x68 / 0x69)",
  },
  {
    id: "vibration-motor", name: "Vibration motor (coin)", category: "Motion", electrical: { kind: "motor" },
    pins: [passive("1", "+ (red)"), passive("2", "− (blue/black)")],
    props: [{ key: "volts", label: "Rated voltage", unit: "V", kind: "number", default: 3, min: 0.5, max: 12 }],
    notes: "Still a motor: drive it through a transistor with a diode across it, not straight from a pin.",
  },
  {
    id: "pnp", name: "PNP transistor", category: "Semiconductor", electrical: { kind: "transistor" },
    pins: [{ id: "E", name: "Emitter", role: { kind: "passive" } }, { id: "B", name: "Base", role: { kind: "passive" } }, { id: "C", name: "Collector", role: { kind: "passive" } }],
    props: [], notes: "Pin order varies by part number: check the datasheet. Transistor circuits are not analysed by the checks yet.",
  },
  {
    id: "mosfet", name: "N-channel MOSFET", category: "Semiconductor", electrical: { kind: "transistor" },
    pins: [{ id: "G", name: "Gate", role: { kind: "passive" } }, { id: "D", name: "Drain", role: { kind: "passive" } }, { id: "S", name: "Source", role: { kind: "passive" } }],
    props: [], notes: "Pick a 'logic-level' MOSFET for 3.3/5 V boards. Pin order varies: check the datasheet. Not analysed by the checks yet.",
  },
  {
    id: "tft-ili9341", name: "TFT 2.8\" ILI9341 SPI module (320 × 240)", category: "Display", electrical: { kind: "module" },
    pins: [
      vin("VCC", "VCC", 3.3, 5, "red 2.8\" SPI modules usually have a 3.3 V regulator for VCC (typical listings; check yours)"), gnd(),
      sin("CS", "CS", "Chip select (tie to GND if the code does not use it)"), sin("RESET", "RESET"), sin("DC", "DC (data/command)"),
      sin("SDI", "SDI (MOSI)"), sin("SCK", "SCK"), sin("LED", "LED (backlight)", "Some modules power the backlight straight from this pin (tens of mA): if it is dim or the pin gets warm, drive it through a transistor"),
      other("SDO", "SDO (MISO)", "Only needed to read from the screen"),
      other("T_CLK", "T_CLK", "Touch controller (optional)"), other("T_CS", "T_CS", "Touch controller (optional)"), other("T_DIN", "T_DIN", "Touch controller (optional)"), other("T_DO", "T_DO", "Touch controller (optional)"), other("T_IRQ", "T_IRQ", "Touch controller (optional)"),
    ],
    props: [], notes: "Signal pins are 3.3 V logic on most of these modules: drive them from a 3.3 V board. Pin order differs between sellers: follow the labels on yours.",
  },
  {
    id: "sd-module", name: "microSD card module (SPI, 3.3 V)", category: "Prototyping", electrical: { kind: "module" },
    pins: [vin("3V3", "3V3", 3.0, 3.6, "plain microSD modules (no regulator) run the card at 3.3 V"), sin("CS", "CS"), sin("MOSI", "MOSI"), sin("CLK", "CLK"), other("MISO", "MISO", "Data from the card"), gnd()],
    props: [], notes: "Format the card as FAT32. Modules with a 5 V regulator and level shifter exist too; this is the plain 3.3 V kind.",
  },
  {
    id: "i2s-amp", name: "I²S amplifier (MAX98357A)", category: "Motion", electrical: { kind: "module" },
    pins: [sin("LRC", "LRC (word select)"), sin("BCLK", "BCLK"), sin("DIN", "DIN (data)"), other("GAIN", "GAIN", "Leave open for the default gain"), other("SD", "SD", "Shutdown / channel select; leave open for (L+R)/2"), gnd(), vin("VIN", "Vin", 2.5, 5.5, "MAX98357A supply range as commonly quoted from the datasheet"), other("SPK+", "Speaker +", "To the speaker"), other("SPK-", "Speaker −", "To the speaker (not ground!)")],
    props: [], notes: "Digital audio in, speaker out (class D). The speaker connects between SPK+ and SPK−; neither side goes to ground.",
  },
  {
    id: "speaker", name: "Speaker (small, 4-8 Ω)", category: "Passive", electrical: { kind: "module" },
    pins: [passive("+", "+"), passive("-", "−")],
    props: [], notes: "Drive it from an amplifier, never straight from a GPIO pin.",
  },
  UNO,
  PICO,
  S3,
  XIAO,
  CORES3,
];

/** Typical peak current a part can draw from its supply (all estimated). */
export const LOAD_PEAK: Record<string, Spec> = {
  servo: estimated(0.65, "typical small hobby servo (SG90 class) stall current; bigger servos draw more"),
  motor: estimated(0.5, "small DC motor stall current varies widely; check yours"),
  "oled-i2c": estimated(0.03, "typical small OLED module with many pixels lit"),
  "vibration-motor": estimated(0.1, "small coin vibration motor (typical)"),
  "neopixel-ring": estimated(0.72, "12 LEDs × about 60 mA each at full white (commonly quoted)"),
  "lcd-i2c": estimated(0.03, "typical 16×2 LCD with backlight"),
  ultrasonic: estimated(0.015, "HC-SR04 typical working current"),
  pir: estimated(0.001, "HC-SR501 typical"),
  relay: estimated(0.08, "typical 5 V relay coil plus LED"),
  "tft-ili9341": estimated(0.1, "typical 2.8\" TFT module with backlight on"),
  "sd-module": estimated(0.1, "microSD cards can draw about 100 mA while writing (typical)"),
  "i2s-amp": estimated(0.6, "MAX98357A at full volume into 4 Ω from 5 V (typical)"),
  "gas-sensor": estimated(0.16, "MQ-2 heater current (typical)"),
};

export function componentDef(id: string): ComponentDef | undefined {
  return COMPONENTS.find((c) => c.id === id);
}
