// Practice projects: real open-source builds on GitHub, picked for learning.
//
// Every fact here was checked against the project's GitHub page and the GitHub API on the
// date in VERIFIED_ON. Nothing is copied from the projects: entries only describe them and
// link to them. The starter 3D shapes are simple original practice exercises with
// placeholder sizes (the notes say so), not models of the projects' parts.

import type { Project } from "../../shared/format";
import { createEmptyProject, newId } from "../../shared/format";
import { DEFAULT_PARAMS, IDENTITY, type CadObject, type PrimitiveKind } from "../cad/model";
import { doomCircuit, RETRO_GO } from "./doom";
import type { CircuitComponent, Wire } from "../circuit/schema";

export const VERIFIED_ON = "2026-11-08";

export type Difficulty = "Starter" | "Intermediate" | "Advanced";

export interface PracticeProject {
  id: string;
  title: string;
  /** owner/name on GitHub (most projects). */
  repo?: string;
  /** Projects that live elsewhere (MakerWorld, Printables). */
  link?: { url: string; label: string };
  /** A project in a folder on this computer. */
  localPath?: string;
  /** Model files on this computer loaded into 3D Studio when the project starts (keys of LOCAL_MODELS). */
  localModels?: string[];
  /** Where the facts came from, when not simply the GitHub page. */
  factsSource?: string;
  license: string;
  difficulty: Difficulty;
  kind: string;
  summary: string;
  /** Short facts from the project page: brain, motion, power, print files, software, cost. */
  facts: [string, string][];
  learn: string[];
  /** Things to know before starting (old software, kit-only hardware, cost...). */
  caveats: string[];
  /** Ordered build plan for the project notes. */
  steps: string[];
  /** Original practice exercises for the 3D Studio. */
  exercises: string[];
  starter: (newId: () => string) => CadObject[];
  /** A ready-wired circuit for Circuit Studio (optional). */
  circuit?: (newId: () => string) => { components: CircuitComponent[]; wires: Wire[] };
}

// --- helpers for the starter shapes --------------------------------------------------

function shape(
  newId: () => string, kind: PrimitiveKind, name: string, params: Record<string, number>,
  position: [number, number, number] = [0, 0, 0], extra: Partial<CadObject> = {},
): CadObject {
  return {
    id: newId(), name, kind, params: { ...DEFAULT_PARAMS[kind], ...params },
    transform: { ...IDENTITY, position },
    ...(kind === "text" ? { text: "PRACTICE" } : {}),
    hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra,
  };
}

function group(newId: () => string, name: string, children: CadObject[], position: [number, number, number] = [0, 0, 0]): CadObject[] {
  const g: CadObject = {
    id: newId(), name, kind: "group", params: {}, transform: { ...IDENTITY, position },
    hole: false, color: children[0]?.color ?? "#2fd6a3", parentId: null, visible: true, locked: false,
  };
  return [g, ...children.map((c) => ({ ...c, parentId: g.id }))];
}

function nameplate(newId: () => string, text: string, y = -45): CadObject[] {
  const width = Math.max(40, text.length * 7 + 12);
  return group(newId, "Nameplate (practice)", [
    shape(newId, "box", "Plate", { width, depth: 14, height: 2 }, [0, 0, 0], { color: "#22b8c9" }),
    shape(newId, "text", "Label", { size: 7, depth: 1.2 }, [0, 0, 2], { text, color: "#e3e8ec" }),
  ], [0, y, 0]);
}

const PLACEHOLDER = "(placeholder size)";

// --- the catalog -------------------------------------------------------------------

const ROBOTS: PracticeProject[] = [
  {
    id: "roboeyes",
    title: "Animated robot eyes (FluxGarage RoboEyes)",
    repo: "FluxGarage/RoboEyes",
    license: "GPL-3.0",
    difficulty: "Starter",
    kind: "Display / robot face",
    summary: "An Arduino library that draws smoothly animated robot eyes on a small OLED screen: moods (happy, tired, angry), blinking, idle looking around, laughing and confused animations. A great first build and the face for a later robot.",
    facts: [
      ["Brain", "Arduino Uno or Nano (listed by the project)"],
      ["Screen", "OLED display, e.g. SSD1306"],
      ["Software", "Arduino IDE, install from the Library Manager; needs Adafruit GFX"],
      ["Print files", "None, it is a library: you design the enclosure (exercise below)"],
    ],
    learn: ["Wiring an I²C display", "Installing Arduino libraries and running examples", "Designing an enclosure with a screen window"],
    caveats: ["Check whether your OLED module runs on 3.3 V or 5 V and which I²C address it uses before wiring."],
    steps: [
      "Install the Arduino IDE, then install \"FluxGarage RoboEyes\" and \"Adafruit GFX\" (and your display's driver library) from the Library Manager.",
      "Wire the OLED to the Arduino (I²C: SDA, SCL, power, ground) following the example's comments.",
      "Upload File → Examples → FluxGarage RoboEyes, and try the moods and animations.",
      "Measure your OLED module with calipers and update the Face box in 3D Studio.",
      "Run Check for printing, then send it to Bambu Studio.",
    ],
    exercises: [
      "Resize the Face box and its screen window to your OLED module (measure the board and the visible glass area).",
      "Add mounting posts inside the box for the module's screw holes.",
      "Add a slot in the back wall for the USB cable.",
    ],
    starter: (id) => [
      ...group(id, `Face box ${PLACEHOLDER}`, [
        shape(id, "box", "Shell", { width: 40, depth: 24, height: 32 }),
        shape(id, "box", "Cavity", { width: 36, depth: 20, height: 32 }, [0, 0, 2], { hole: true }),
        shape(id, "box", "Screen window", { width: 26, depth: 6, height: 14 }, [0, -11, 12], { hole: true }),
      ]),
      ...nameplate(id, "ROBO EYES"),
    ],
  },
  {
    id: "simplefoc",
    title: "Brushless motor control (SimpleFOC)",
    repo: "simplefoc/Arduino-FOC",
    license: "MIT",
    difficulty: "Starter",
    kind: "Motor control (other stuff)",
    summary: "A library for smooth, precise control of brushless (BLDC) and stepper motors with Field Oriented Control, used in robot joints, gimbals and haptic knobs. Its first example spins a BLDC motor at a set speed using an encoder.",
    facts: [
      ["Boards", "Arduino (Uno, Nano, Mega, R4…), ESP32 family, STM32, Raspberry Pi Pico (RP2040/RP2350)"],
      ["Motors", "BLDC and stepper motors"],
      ["Needs", "A motor driver board, a position sensor (encoder) and a 12 V supply in the example"],
      ["Software", "Arduino IDE or PlatformIO; SimpleFOC Studio for live tuning"],
    ],
    learn: ["What FOC is and why it makes motors smooth", "Position sensors (encoders)", "Tuning a control loop"],
    caveats: ["Brushless motors can get hot and spin fast: start with low voltage and current limits, and clamp the motor down."],
    steps: [
      "Read the library's getting-started docs and pick a driver board that matches your motor's voltage and current.",
      "Mount the motor and encoder (exercise below: a knob and a base).",
      "Run the velocity-control example, then try position (angle) control.",
      "Open SimpleFOC Studio and tune the controller while it runs.",
    ],
    exercises: [
      "Fit the knob's shaft hole to your motor (measure the shaft; add 0.2 mm clearance for printing).",
      "Design a base plate with holes matching your motor's mounting pattern.",
      "Add grip ridges around the knob with a ring of small boxes, grouped and combined.",
    ],
    starter: (id) => [
      ...group(id, `Knob ${PLACEHOLDER}`, [
        shape(id, "cylinder", "Knob body", { radius: 20, height: 12, segments: 64 }),
        shape(id, "cylinder", "Shaft hole", { radius: 2.6, height: 10, segments: 32 }, [0, 0, -1], { hole: true }),
      ]),
      ...nameplate(id, "FOC KNOB"),
    ],
  },
  {
    id: "sesame",
    title: "Sesame mini quadruped",
    repo: "dorianborian/sesame-robot",
    license: "Apache-2.0",
    difficulty: "Intermediate",
    kind: "Walking robot (4 legs)",
    summary: "An affordable little four-legged walking robot with an OLED face, controlled over Wi-Fi. Designed entirely for 3D printing in PLA, with a full bill of materials and printing guide in the repo.",
    facts: [
      ["Brain", "ESP32 board (Lolin S2 Mini recommended for DIY builds)"],
      ["Motion", "8 × MG90 180° servos (2 per leg)"],
      ["Face", "128 × 64 OLED"],
      ["Print files", "STL and CAD files in the repo (hardware/printing), PLA"],
      ["Software", "Arduino IDE"],
      ["Cost", "$50–60 in parts (project's estimate)"],
    ],
    learn: ["Servo walking gaits", "ESP32 Wi-Fi control", "Printing and assembling small mechanical parts", "Basic soldering"],
    caveats: ["Needs basic soldering. Small servo parts: print a test piece first and check the servo fit."],
    steps: [
      "Read hardware/bom/README.md and order the parts.",
      "Download the STL files from the repo (hardware/printing) and import them here (Files → Import STL / OBJ / STEP).",
      "Run Check for printing and Orient on each part, then send them to Bambu Studio.",
      "Flash the firmware with the Arduino IDE, centre the servos, then assemble.",
      "Connect over Wi-Fi and try the walking moves.",
    ],
    exercises: [
      "Measure an MG90 servo and fix the Servo bracket's pocket to fit it with 0.2 mm clearance.",
      "Make a matching leg segment with a hole for the servo horn screw.",
      "Design a small display holder for the OLED that bolts onto the body.",
    ],
    starter: (id) => [
      ...group(id, `Servo bracket ${PLACEHOLDER}`, [
        shape(id, "box", "Frame", { width: 30, depth: 18, height: 14 }),
        shape(id, "box", "Servo pocket", { width: 23, depth: 12.5, height: 14 }, [0, 0, 2], { hole: true }),
        shape(id, "cylinder", "Screw hole L", { radius: 1, height: 16, segments: 16 }, [-13.5, 0, -1], { hole: true }),
        shape(id, "cylinder", "Screw hole R", { radius: 1, height: 16, segments: 16 }, [13.5, 0, -1], { hole: true }),
      ]),
      ...nameplate(id, "SESAME"),
    ],
  },
  {
    id: "stack-chan",
    title: "Stack-chan desk robot (M5Stack)",
    repo: "stack-chan/stack-chan",
    license: "Apache-2.0",
    difficulty: "Intermediate",
    kind: "Desk robot with a screen face",
    summary: "An open-source, \"super-kawaii\" little desk robot built on an M5Stack: the screen is its face (eyes and mouth you can design), servos let it look around, and you program its behaviour in JavaScript or with a block editor.",
    facts: [
      ["Brain + screen", "M5Stack CoreS3 (standard), also M5Stack Core2 and the original M5Stack; a Core2 + SG90 servo build is supported from source"],
      ["Print files", "Case models for 3D printing in the repo's case folder, with a parts and assembly guide (case/README.md)"],
      ["Electronics", "Schematics and board layouts in the schematics folder"],
      ["Software", "JavaScript firmware with MODs (your own apps), a Blockly block editor and a face editor; flashing does not need the Moddable SDK. An Arduino library also exists (stack-chan/stackchan-arduino, MIT)"],
    ],
    learn: ["Giving a robot a face and personality", "Servo motion that looks alive", "Programming behaviours in JavaScript or blocks"],
    caveats: ["Check the case guide for which servos and board your version needs before ordering parts."],
    steps: [
      "Read case/README.md and the firmware guide; pick your M5Stack model.",
      "Download the case files and import them here; run Check for printing and Orient.",
      "Print and assemble, flash the firmware, then make a face in the face editor.",
      "Write your first MOD (or use the block editor) to make it react.",
    ],
    exercises: [
      "Design your own desk robot body: resize the head so your screen module fits (measure it).",
      "Add a servo pocket in the base for a pan (look left and right) movement.",
      "Make ears or antennas and attach them to the head with the Workplane tool.",
    ],
    starter: (id) => [
      ...group(id, `Head ${PLACEHOLDER}`, [
        shape(id, "box", "Head shell", { width: 58, depth: 30, height: 58 }, [0, 0, 0], { color: "#f2b84b" }),
        shape(id, "box", "Screen opening", { width: 50, depth: 8, height: 40 }, [0, -12, 9], { hole: true }),
        shape(id, "box", "Inside", { width: 54, depth: 22, height: 54 }, [0, 1, 2], { hole: true }),
      ]),
      ...group(id, `Base ${PLACEHOLDER}`, [
        shape(id, "cylinder", "Base", { radius: 32, height: 24, segments: 64 }, [0, 0, 0], { color: "#22b8c9" }),
        shape(id, "box", "Servo pocket", { width: 23, depth: 12.5, height: 22 }, [0, 0, 4], { hole: true }),
      ], [0, 70, 0]),
      ...nameplate(id, "MY DESK BOT"),
    ],
  },
  {
    id: "openbot",
    title: "OpenBot (smartphone-brained robot car)",
    repo: "ob-f/OpenBot",
    license: "MIT",
    difficulty: "Intermediate",
    kind: "Driving robot",
    summary: "A small electric car body that uses an Android phone as its brain: the phone does the vision and driving AI, a small Arduino-based board drives the motors. Includes an app, a programming playground and tools for training a driving policy.",
    facts: [
      ["Brain", "Android smartphone"],
      ["Body", "Arduino-based electronics with its own firmware"],
      ["Cost", "About $50 for the body (project's estimate)"],
      ["Body build", "Build guide in the repo; check it for the printable body files"],
    ],
    learn: ["Robot car basics (motors, drivers, batteries)", "Phone ↔ microcontroller communication", "AI driving and data collection"],
    caveats: ["Needs an Android phone to use as the brain."],
    steps: [
      "Read the Robot Body build guide in the repo and choose a body version.",
      "Print or build the body; import any print files here to check and orient them.",
      "Flash the Arduino firmware, then install the OpenBot app on the phone.",
      "Drive it manually, then try the autonomous modes.",
    ],
    exercises: ["Design a phone clamp that fits your phone's width (measure it, add 1 mm).", "Add a cable channel to the clamp's base."],
    starter: (id) => [
      ...group(id, `Phone clamp ${PLACEHOLDER}`, [
        shape(id, "box", "Base", { width: 80, depth: 20, height: 6 }),
        shape(id, "box", "Left jaw", { width: 6, depth: 20, height: 18 }, [-37, 0, 6]),
        shape(id, "box", "Right jaw", { width: 6, depth: 20, height: 18 }, [37, 0, 6]),
      ]),
      ...nameplate(id, "OPENBOT"),
    ],
  },
  {
    id: "opencat",
    title: "OpenCat quadruped framework (Petoi)",
    repo: "PetoiCamp/OpenCat-Quadruped-Robot",
    license: "MIT",
    difficulty: "Intermediate",
    kind: "Walking robot software",
    summary: "The open-source software behind Petoi's Bittle robot dog and Nybble robot cat: gaits, servo control, balance with an IMU, a skill library, and Python / block / app control.",
    facts: [
      ["Brain", "NyBoard (ATmega328P, up to 12 servos) in this repo; ESP32 BiBoard users go to the OpenCatESP32 repo"],
      ["Hardware", "Mainly Petoi kits (Bittle, Nybble, Bittle X); community DIY builds exist"],
      ["Print files", "Not in this repo"],
      ["Software", "Arduino IDE (C/C++), Python API, block coding, app; ROS compatible"],
    ],
    learn: ["How walking gaits are stored and played", "IMU balance", "Controlling a robot from Python"],
    caveats: ["The setup assumes Petoi's boards and servos. Read Petoi's docs before trying it on your own hardware."],
    steps: [
      "Decide: Petoi kit, or your own build (then read the docs on porting).",
      "Upload the firmware with the Arduino IDE and open the Serial Monitor at 115200 baud.",
      "Try the built-in skills, then send commands from Python.",
      "Design accessories here (exercise below).",
    ],
    exercises: ["Design a sensor mount or a name tag for your robot's back.", "Practise the Workplane tool: build a mount on the angled face of a wedge."],
    starter: (id) => [
      shape(id, "wedge", `Accessory base ${PLACEHOLDER}`, { width: 30, depth: 20, height: 12 }),
      ...nameplate(id, "OPENCAT"),
    ],
  },
  {
    id: "so-arm",
    title: "SO-101 / SO-100 robot arm (LeRobot)",
    repo: "TheRobotStudio/SO-ARM100",
    license: "Apache-2.0",
    difficulty: "Intermediate",
    kind: "Robot arm",
    summary: "A 3D-printed six-servo robot arm made by RobotStudio with Hugging Face, built as a leader arm (you move it) and a follower arm (it copies you), so you can record demonstrations and train AI policies with LeRobot. SO-101 is the current version; SO-100 is deprecated.",
    facts: [
      ["Motion", "STS3215 serial bus servos, 6 per arm (7.4 V version; a 12 V version needs a 12 V 5 A+ supply)"],
      ["Controller", "Waveshare-type motor control board, one per arm"],
      ["Print files", "STL and STEP in the repo; one-file plates for 220 × 220 and 205 × 250 mm beds (both fit the A1's 256 × 256 bed)"],
      ["Printing", "PLA+, 0.4 mm nozzle at 0.2 mm layers, 15 % infill, supports (project's settings)"],
      ["Software", "Hugging Face LeRobot"],
      ["Cost", "About $122 per follower arm, $230 for the pair (parts, project's estimate)"],
    ],
    learn: ["Serial bus servos and IDs", "Arm kinematics", "Teleoperation and recording data", "Training robot AI with LeRobot"],
    caveats: ["Use the SO-101 files (SO-100 is deprecated). Print the gauge files first to check your printer's accuracy."],
    steps: [
      "Read the SO-101 section of the repo and order the servos and boards.",
      "Download the STEP files and import them here (STEP keeps exact shapes), or the STL plates.",
      "Check for printing and Orient each part; send them to Bambu Studio.",
      "Configure the servo IDs with LeRobot, assemble, calibrate.",
      "Teleoperate the follower with the leader arm, then record and train.",
    ],
    exercises: ["Import a STEP part from the repo and measure its servo pocket with the Measure tool.", "Design a phone or camera holder that mounts on the arm's base."],
    starter: (id) => [
      ...group(id, `Camera mount ${PLACEHOLDER}`, [
        shape(id, "box", "Foot", { width: 40, depth: 40, height: 4 }),
        shape(id, "cylinder", "Post", { radius: 5, height: 40, segments: 48 }, [0, 0, 4]),
        shape(id, "cylinder", "Screw hole", { radius: 1.7, height: 12, segments: 24 }, [0, 0, 34], { hole: true }),
      ]),
      ...nameplate(id, "SO-101"),
    ],
  },
  {
    id: "moveo",
    title: "BCN3D Moveo printed robot arm",
    repo: "BCN3D/BCN3D-Moveo",
    license: "MIT",
    difficulty: "Advanced",
    kind: "Robot arm",
    summary: "An educational robot arm whose structure is fully 3D printed, made by BCN3D with the Catalan education department. Comes with STL and CAD files, a bill of materials, Marlin-based firmware and assembly manuals in English and Spanish.",
    facts: [
      ["Electronics", "Controlled from Arduino software with a Marlin-based firmware (see the BOM for the exact board)"],
      ["Print files", "STL folder and a CAD folder in the repo"],
      ["Docs", "Assembly, fine-tuning and firmware manuals (EN / ES)"],
    ],
    learn: ["Stepper motors and drivers", "Large multi-part prints", "Firmware configuration"],
    caveats: ["Last updated in 2022. Larger parts may need splitting or careful orientation for the A1's bed: run Check for printing on each."],
    steps: [
      "Read the BOM and the assembly manual.",
      "Import the STL files here; run Check for printing and Orient, and note any part that does not fit.",
      "Print, assemble, and flash the firmware following the manuals.",
    ],
    exercises: ["Import one large part and use Check for printing to see if it fits the A1; if not, cut it in two with a hole box."],
    starter: (id) => nameplate(id, "MOVEO", 0),
  },
  {
    id: "spotmicro",
    title: "Spot Micro quadruped (ROS)",
    repo: "mike4192/spotMicro",
    license: "MIT",
    difficulty: "Advanced",
    kind: "Walking robot (4 legs)",
    summary: "Software for a 12-servo printed quadruped: sit, stand, angle and walk, plus lidar mapping (SLAM). The frame is the Spot Micro frame by KDY0523 on Thingiverse (thing:3445283) with extra printed mounts.",
    facts: [
      ["Brain", "Raspberry Pi 3B"],
      ["Motion", "12 × PDI-HV5523MG servos via a PCA9685 servo driver (I²C)"],
      ["Print files", "Frame from Thingiverse thing:3445283 (by KDY0523), not in this repo"],
      ["Software", "ROS Kinetic on Ubuntu 16.04, C++ and Python"],
    ],
    learn: ["ROS basics", "Inverse kinematics for legs", "Lidar mapping"],
    caveats: ["The software targets ROS Kinetic / Ubuntu 16.04, which are long out of support; the page says it may not build elsewhere. Expect porting work."],
    steps: [
      "Read the repo README fully, including the hardware and software setup notes.",
      "Get the frame files from Thingiverse; import and check them here.",
      "Set up the Pi (the README's swap and ROS steps), wire the PCA9685 and servos, calibrate.",
    ],
    exercises: ["Design a mount for a PCA9685 board (measure your board's hole spacing)."],
    starter: (id) => [
      ...group(id, `Driver board mount ${PLACEHOLDER}`, [
        shape(id, "box", "Plate", { width: 70, depth: 30, height: 3 }),
        ...[-30, 30].flatMap((x) => [-11, 11].map((y) => shape(id, "cylinder", "Standoff", { radius: 3, height: 6, segments: 24 }, [x, y, 3]))),
      ]),
      ...nameplate(id, "SPOT MICRO"),
    ],
  },
  {
    id: "sawppy",
    title: "Sawppy the Mars rover",
    repo: "Roger-random/Sawppy_Rover",
    license: "MIT",
    difficulty: "Advanced",
    kind: "Rover (6 wheels)",
    summary: "A motorized model of the Curiosity and Perseverance Mars rovers with a real rocker-bogie suspension, built from aluminium extrusion joined by 3D-printed parts.",
    facts: [
      ["Motion", "Serial bus servos drive the wheels (the project names the LX-16A)"],
      ["Brain", "Several options: Arduino, an HTML-based wireless stack, or Raspberry Pi R/C"],
      ["Structure", "Misumi HFS3 aluminium extrusion + printed parts (STL folder in the repo)"],
      ["Cost", "Under $500 in parts (project's estimate)"],
    ],
    learn: ["Rocker-bogie suspension", "Building with aluminium extrusion", "Coordinating many servos"],
    caveats: ["A big build aimed at adult hobbyists and older students; a smaller Micro Sawppy is in development."],
    steps: [
      "Read the build docs and the price breakdown linked from the repo.",
      "Import the STL parts here; check and orient them.",
      "Cut the extrusions, print, assemble the suspension, then wire the servos.",
    ],
    exercises: ["Design a rover wheel: a cylinder with a hub hole and grooves made from thin hole boxes."],
    starter: (id) => [
      ...group(id, `Wheel ${PLACEHOLDER}`, [
        shape(id, "cylinder", "Tyre", { radius: 30, height: 20, segments: 64 }),
        shape(id, "cylinder", "Hub hole", { radius: 3, height: 22, segments: 24 }, [0, 0, -1], { hole: true }),
      ]),
      ...nameplate(id, "SAWPPY"),
    ],
  },
  {
    id: "jpl-rover",
    title: "NASA JPL Open Source Rover",
    repo: "nasa-jpl/open-source-rover",
    license: "Apache-2.0",
    difficulty: "Advanced",
    kind: "Rover (6 wheels)",
    summary: "A build-it-yourself six-wheel rover from NASA's Jet Propulsion Laboratory, modelled on the Mars rovers: rocker-bogie suspension, differential pivot and six-wheel steering. Made from off-the-shelf parts, mostly goBILDA aluminium, with no machining needed.",
    facts: [
      ["Brain", "Raspberry Pi"],
      ["Motion", "10 motors"],
      ["Structure", "Off-the-shelf aluminium parts (mostly goBILDA); 3D printer and laser cutter optional"],
      ["Software", "osr-rover-code repo (Linux, ROS, Python)"],
      ["Cost / time", "About $1,600 in parts, 100+ hours (project's estimates)"],
    ],
    learn: ["A full robot system end to end", "Motor controllers and power", "ROS on a Raspberry Pi"],
    caveats: ["The most expensive project here. Good as a team or long-term build."],
    steps: [
      "Read the build guide and parts list; budget the parts.",
      "Assemble the chassis and suspension, then the electronics.",
      "Install the rover software on the Pi and drive it.",
      "Design custom add-ons here (exercise below).",
    ],
    exercises: ["Design a printed sensor or camera mast mount for the rover's top deck."],
    starter: (id) => nameplate(id, "JPL ROVER", 0),
  },
];


// --- Dummy 13 (owner request 2026-11-08) ----------------------------------------------------
const DUMMY13_FACTS = "MakerWorld and Printables block automated reading; facts from their listings as shown in search results";

function pegTest(id: () => string): CadObject[] {
  // A fit test: holes with 0.1 / 0.2 / 0.3 mm extra clearance around a 5 mm peg.
  return [
    ...group(id, `Fit test plate ${PLACEHOLDER}`, [
      shape(id, "box", "Plate", { width: 36, depth: 14, height: 4 }, [0, 0, 0], { color: "#22b8c9" }),
      ...[0.1, 0.2, 0.3].map((c, i) => shape(id, "cylinder", `Hole +${c} mm`, { radius: 2.5 + c, height: 6, segments: 48 }, [-11 + i * 11, 0, -1], { hole: true })),
    ]),
    shape(id, "cylinder", `Peg 5 mm ${PLACEHOLDER}`, { radius: 2.5, height: 8, segments: 48 }, [0, 22, 0], { color: "#f2b84b" }),
  ];
}

const DUMMY13: PracticeProject[] = [
  {
    id: "dummy13",
    title: "Dummy 13 printable jointed figure (original)",
    link: { url: "https://makerworld.com/en/models/638587-dummy-13-version-1-0", label: "makerworld.com · Dummy 13 version 1.0" },
    license: "CC-BY-4.0",
    factsSource: DUMMY13_FACTS,
    difficulty: "Intermediate",
    kind: "Printable jointed figure",
    summary: "The free, poseable 3D-printed figure by Lucky 13 Toys (soozafone): an inner frame with snap joints, covered by outer armour parts. Beta files went up on Printables in 2023; version 1.0 followed in September 2024 on MakerWorld and Printables.",
    facts: [
      ["Designer", "Lucky 13 Toys (soozafone)"],
      ["Files", "MakerWorld (version 1.0) and Printables (beta files: printables.com/model/593185)"],
      ["Build", "Inner frame with ball and snap joints, plus an outer armour layer"],
      ["License", "CC BY 4.0: remix and sell prints, as long as you credit the creator"],
    ],
    learn: ["Printing small parts that must fit and move", "Tolerances: how tight a joint should be", "Remixing a design (new heads, armour, weapons)"],
    caveats: ["Many small parts and tight joints: print a few frame joints first to check your printer's fit.", "Credit the creator (CC BY 4.0) when you share remixes or sell prints."],
    steps: [
      "Download version 1.0 from MakerWorld (or Printables) and read the creator's print notes.",
      "Print one joint pair first; use the fit-test exercise below to tune your printer.",
      "Import the parts here (Files → Import STL) and use Check for printing and Orient; small parts are where thin walls and overhangs show up.",
      "Print the frame, then the armour; assemble following the creator's guide (or the assembly guide project in this catalog).",
    ],
    exercises: ["Print the fit-test plate and peg; note which clearance gives a snug, movable fit on your printer.", "Design an accessory (a shield, a backpack) that clips onto an armour part: import that part first and build on it with the Workplane tool."],
    starter: (id) => [...pegTest(id), ...nameplate(id, "DUMMY 13", -30)],
  },
  {
    id: "dummy13-pla",
    title: "Dummy 13 PLA print solution",
    repo: "flight-commander/dummy_13",
    license: "CC-BY-4.0",
    factsSource: "license as stated in the repo's README (no license file)",
    difficulty: "Starter",
    kind: "Printing guide for Dummy 13",
    summary: "One maker's fixes for printing Dummy 13 in PLA: print settings for Cura, scaled frame files, alternative right hands, a PDF with sizes for all frame parts, and a YouTube walkthrough.",
    facts: [
      ["Material", "PLA (frame parts)"],
      ["Settings", "0.15 mm layers, 0.2 mm first layer, 10 % infill, no supports, brim as needed, external perimeters first"],
      ["Files", "Dummy_13.pdf (sizes for all frame parts), scaled files and right hands as ZIP files"],
      ["Slicer", "Cura (the settings carry over to Bambu Studio by name)"],
    ],
    learn: ["Why PLA joints need different clearances", "Reading and copying slicer settings"],
    caveats: ["The repo has no license file; its README states a Creative Commons 4.0 Attribution license."],
    steps: [
      "Read the README and watch the linked video.",
      "Download the ZIP files and import the frame parts here; run Check for printing.",
      "Copy the layer, infill and perimeter settings into Bambu Studio, then print.",
    ],
    exercises: ["Print the fit-test plate: compare 0.1, 0.2 and 0.3 mm clearance in your PLA."],
    starter: (id) => pegTest(id),
  },
  {
    id: "dummy13-assembly",
    title: "Dummy 13 assembly guide",
    repo: "allcapsjoe/dummy-13",
    license: "unspecified",
    difficulty: "Starter",
    kind: "Assembly guide for Dummy 13",
    summary: "A step-by-step picture guide (and PDF) for putting Dummy 13 version 1.0 together, linking to the MakerWorld model.",
    facts: [
      ["Contents", "Five illustrated assembly steps and a PDF assembly guide"],
      ["Model", "Dummy 13 version 1.0 (MakerWorld 638587)"],
    ],
    learn: ["Assembling a jointed figure in the right order"],
    caveats: ["No license is stated in the repo: use it as a guide, do not re-share its pictures."],
    steps: ["Print the Dummy 13 parts (see the original Dummy 13 entry).", "Follow the guide's steps in order; keep the PDF open next to the parts."],
    exercises: ["Design a small stand that holds the figure upright by one foot peg (measure the foot first)."],
    starter: (id) => [
      ...group(id, `Display stand ${PLACEHOLDER}`, [
        shape(id, "cylinder", "Base", { radius: 25, height: 4, segments: 64 }, [0, 0, 0], { color: "#22b8c9" }),
        shape(id, "cylinder", "Foot peg", { radius: 2, height: 5, segments: 32 }, [6, 0, 4]),
      ]),
    ],
  },
  {
    id: "dummy13scad",
    title: "Dummy 13 frame library for OpenSCAD",
    repo: "fluo10/dummy13scad",
    license: "MIT",
    difficulty: "Advanced",
    kind: "Parametric Dummy 13 frame (OpenSCAD)",
    summary: "A configurable Dummy 13 frame written in OpenSCAD: separate files for the chest, abdomen, hips, limbs and shared modules, plus examples. Change numbers, render, and print a frame of your own proportions.",
    facts: [
      ["Language", "OpenSCAD (installed on this computer)"],
      ["Files", "chest, abdomen, hips, upper and lower limb, limb root, modules, examples"],
      ["Status", "Small personal project, last updated January 2025"],
    ],
    learn: ["Parametric design in code", "How the Dummy 13 frame joints are built"],
    caveats: ["Young, small project without documentation beyond the code: expect to read the .scad files."],
    steps: [
      "Clone or download the repo and open an example in OpenSCAD.",
      "Change a dimension, render (F6) and export STL.",
      "Import the STL here and check it for printing.",
    ],
    exercises: ["Export one limb at two different lengths and compare them here with the Measure tool."],
    starter: (id) => nameplate(id, "DUMMY 13 SCAD", 0),
  },
];


// --- Fan-made "The Prototype" figures (Poppy Playtime), owner request 2026-11-08 --------------
// Fan designs of a character owned by MOB Entertainment, on MakerWorld. Only links: no files
// or designs from them are copied. Facts come from the listings as shown in search results
// (MakerWorld blocks automated reading).
const FAN_FACTS = "from the MakerWorld listing as shown in search results; open the page to confirm";
const FAN_CAVEATS = [
  "Fan art of a character owned by MOB Entertainment (Poppy Playtime): print it for yourself; do not sell prints or share the files.",
  "Not confirmed to be built on the Dummy 13 frame.",
];
const fanStand = (id: () => string) => [
  ...group(id, `Display stand ${PLACEHOLDER}`, [
    shape(id, "cylinder", "Base", { radius: 30, height: 4, segments: 64 }, [0, 0, 0], { color: "#e2725b" }),
    shape(id, "cylinder", "Foot peg", { radius: 2, height: 5, segments: 32 }, [7, 0, 4]),
  ]),
];

const PROTOTYPE_FAN: PracticeProject[] = [
  {
    id: "fan-prototype-articulated-v2",
    title: "Articulated Prototype V.2.0 (fan-made)",
    link: { url: "https://makerworld.com/en/models/2502778-articulated-prototype-v-2-0", label: "makerworld.com · Articulated Prototype V.2.0 by FIR23" },
    license: "MakerWorld Exclusive",
    factsSource: FAN_FACTS,
    difficulty: "Intermediate",
    kind: "Fan-made articulated figure (Poppy Playtime)",
    summary: "An articulated fan figure of The Prototype by FIR23, built from parts of Mr. Printer's Stick-Bot V2 with hands from a model by Rionyx.",
    facts: [["Creator", "FIR23"], ["Based on", "Mr. Printer's Stick-Bot V2 (parts), hands from a model by Rionyx"], ["License", "MakerWorld Exclusive License (personal use)"]],
    learn: ["Printing an articulated figure", "How remixes reuse joints from other designs"],
    caveats: FAN_CAVEATS,
    steps: ["Open the MakerWorld page and read the creator's print notes.", "Print a fit test first (starter shapes), then the joints.", "Import the parts here and use Check for printing on the thin parts (hands)."],
    exercises: ["Print the fit-test plate to tune your joint clearance.", "Design your own original display stand with a name plate."],
    starter: (id) => [...pegTest(id), ...fanStand(id).map((o) => o.parentId === null ? { ...o, transform: { ...o.transform, position: [60, 0, 0] as [number, number, number] } } : o)],
  },
];


// --- XIAO ESP32-S3 Sense ------------------------------------------------------------------

const XIAO_WIKI = { url: "https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/", label: "wiki.seeedstudio.com · XIAO ESP32S3 getting started" };
const XIAO_FACTS = "Seeed wiki pin map and specs; arduino-esp32 core on this computer (CameraWebServer example, ESP_I2S PDM, SD/SD_MMC libraries)";
const XIAO_LICENSE = "Own project";
const XIAO_COMMON: [string, string][] = [["Board", "Seeed XIAO ESP32-S3 Sense (21 × 17.8 mm; about 15 mm thick with the camera board)"], ["Software", "PlatformIO (board seeed_xiao_esp32s3) or Arduino IDE"]];
const XIAO_CAVEATS = [
  "The Sense camera board can get warm when the camera streams for a long time: give it air in a case.",
  "The microSD card shares the SPI pins D8-D10; its chip select is GPIO21, which is also the user LED.",
  "3.3 V logic: 5 V sensor signals (for example an HC-SR04 Echo) need a voltage divider.",
];
/** A practice case for the board: real outer size from the Seeed wiki, wall and cut-outs to tune. */
function xiaoCase(newId: () => string, lens = true): CadObject[] {
  return group(newId, "XIAO Sense case (practice)", [
    shape(newId, "box", "Shell", { width: 25, depth: 22, height: 19 }, [0, 0, 0], { color: "#2fd6a3" }),
    shape(newId, "box", "Board pocket", { width: 21.4, depth: 18.2, height: 17 }, [0, 0, 2], { hole: true }),
    shape(newId, "box", "USB-C opening", { width: 10, depth: 6, height: 4.5 }, [0, 10.5, 4], { hole: true }),
    ...(lens ? [shape(newId, "cylinder", "Lens hole", { radius: 4, height: 6 }, [0, 0, 15], { hole: true })] : []),
  ]);
}
const XIAO: PracticeProject[] = [
  {
    id: "xiao-hello", title: "XIAO Sense: hello, blink and serial", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Starter", kind: "First steps (XIAO ESP32-S3 Sense)",
    summary: "Get the board talking: upload code, blink the user LED and print messages over USB. The first thing to do with a new board.",
    facts: [...XIAO_COMMON, ["Parts", "Just the board and a USB-C data cable"], ["LED", "User LED on GPIO21, on when the pin is LOW (Seeed wiki)"]],
    learn: ["Installing the board in PlatformIO / Arduino", "Uploading code (BOOT button if the port does not show up)", "digitalWrite and Serial.println"],
    caveats: ["Some USB-C cables only charge: use one that carries data."],
    steps: ["Create a PlatformIO project for board seeed_xiao_esp32s3.", "Blink LED_BUILTIN (GPIO21): LOW turns it on, HIGH off.", "Print a counter with Serial.println and open the serial monitor.", "If upload fails, hold BOOT while plugging in, then upload again."],
    exercises: ["Print the practice case and check the board drops in.", "Add your name to the lid with Text."],
    starter: (id) => [...xiaoCase(id, false), ...nameplate(id, "XIAO S3", -30)],
  },
  {
    id: "xiao-webcam", title: "XIAO Sense: Wi-Fi camera in your browser", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Starter", kind: "Camera (XIAO ESP32-S3 Sense)",
    summary: "Stream the Sense camera to any browser on your Wi-Fi with the CameraWebServer example that ships with the ESP32 Arduino core.",
    facts: [...XIAO_COMMON, ["Code", "ESP32 core example Camera/CameraWebServer; enable CAMERA_MODEL_XIAO_ESP32S3 in board_config.h"], ["Needs", "PSRAM enabled (the board has 8 MB)"]],
    learn: ["Connecting to Wi-Fi", "Camera resolution vs frame rate", "Finding the board's IP address"],
    caveats: XIAO_CAVEATS,
    steps: ["Open the CameraWebServer example; in board_config.h uncomment CAMERA_MODEL_XIAO_ESP32S3.", "Enter your Wi-Fi name and password in the sketch.", "Enable PSRAM (PlatformIO: board_build.arduino.memory_type / Arduino IDE: PSRAM OPI).", "Upload, open the serial monitor, and visit the IP address it prints.", "Try lower resolutions for a smoother stream."],
    exercises: ["Print the case with the lens hole and check the lens lines up.", "Design a small tilting stand for the case."],
    starter: (id) => xiaoCase(id),
  },
  {
    id: "xiao-timelapse", title: "XIAO Sense: time-lapse camera to microSD", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Intermediate", kind: "Camera + storage (XIAO ESP32-S3 Sense)",
    summary: "Take a photo every few seconds and save it to the microSD card: plants growing, a print finishing, clouds moving.",
    facts: [...XIAO_COMMON, ["Storage", "microSD (FAT32, up to 32 GB per Seeed) on SPI with CS GPIO21"], ["Code", "camera setup from CameraWebServer + the SD library"]],
    learn: ["Saving JPEG frames to files", "Naming files with a counter", "Deep sleep between photos to save power"],
    caveats: XIAO_CAVEATS,
    steps: ["Format a microSD card as FAT32 and insert it in the Sense board.", "Start the camera with the XIAO pins (copy them from camera_pins.h).", "SD.begin(21) and write each frame as photo_0001.jpg, photo_0002.jpg...", "Add a delay or deep sleep between photos.", "Turn the photos into a video on your PC."],
    exercises: ["Print the case and a clip that holds it on a shelf edge.", "Measure your shelf and change the clip size."],
    starter: (id) => [...xiaoCase(id), ...group(id, "Shelf clip (practice)", [shape(id, "box", "Clip back", { width: 25, depth: 3, height: 30 }, [0, 0, 0]), shape(id, "box", "Clip hook", { width: 25, depth: 20, height: 3 }, [0, 8.5, 27])], [45, 0, 0])],
  },
  {
    id: "xiao-oled-face", title: "XIAO Sense: OLED robot face", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Starter", kind: "Screen (XIAO ESP32-S3 Sense)",
    summary: "A blinking, looking-around robot face on a 0.96\" OLED, designed in Display Studio and exported as ready-to-upload code.",
    facts: [...XIAO_COMMON, ["Screen", "SSD1306 or SH1106 128 × 64 I²C OLED"], ["Wiring", "VCC 3V3, GND, SDA D4, SCL D5 (Seeed wiki)"]],
    learn: ["I²C wiring", "Designing a face and moods in Display Studio", "Exporting and uploading the face code"],
    caveats: ["Some OLED modules have the pins in a different order: follow the labels on yours."],
    steps: ["Wire the OLED: VCC → 3V3, GND → GND, SDA → D4, SCL → D5.", "In Display Studio add a face for 'SSD1306 OLED 128 × 64' and style it.", "Under 'Put it on your robot' choose 'Seeed XIAO ESP32-S3 (Sense)' and export the code.", "Open the exported folder and run pio run -t upload.", "Type 0-9 in the serial monitor to play animations."],
    exercises: ["Model a small head that holds the OLED in front and the XIAO behind it.", "Check the OLED window lines up with the screen area."],
    starter: (id) => [...xiaoCase(id, false), ...group(id, "OLED frame (practice)", [shape(id, "box", "Frame", { width: 30, depth: 4, height: 30 }), shape(id, "box", "Window", { width: 23, depth: 6, height: 12 }, [0, 0, 12], { hole: true })], [45, 0, 0])],
  },
  {
    id: "xiao-round-eye", title: "XIAO Sense: round robot eye (GC9A01)", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Intermediate", kind: "Screen (XIAO ESP32-S3 Sense)",
    summary: "A big animated eye on a round 240 × 240 colour screen, the classic look for desk robots and props.",
    facts: [...XIAO_COMMON, ["Screen", "GC9A01 round 240 × 240 SPI TFT"], ["Wiring", "SCK D8, MOSI (SDA) D10, CS D0, DC D1, RST D2, VCC 3V3, GND (the export uses these)"]],
    learn: ["SPI wiring with chip select, data/command and reset", "Colour faces in Display Studio", "Sharing SPI with the SD card (different CS pins)"],
    caveats: ["Round modules label MOSI as 'SDA' even though it is SPI."],
    steps: ["Wire the screen as listed (MakerStudio's Circuit Studio can check it).", "Design a round face in Display Studio for 'GC9A01 round 240 × 240'.", "Export for 'Seeed XIAO ESP32-S3 (Sense)', upload, and watch it blink."],
    exercises: ["Model an eyeball shell that holds the round screen.", "Add a stand with a channel for the wires."],
    starter: (id) => [...xiaoCase(id, false), ...group(id, "Eye shell (practice)", [shape(id, "cylinder", "Shell", { radius: 22, height: 8 }), shape(id, "cylinder", "Screen hole", { radius: 18, height: 10 }, [0, 0, 2], { hole: true })], [55, 0, 0])],
  },
  {
    id: "xiao-sound-face", title: "XIAO Sense: face that reacts to sound", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Intermediate", kind: "Microphone + screen (XIAO ESP32-S3 Sense)",
    summary: "Read the Sense's built-in microphone and make an OLED face open its mouth and look surprised when it hears a sound.",
    facts: [...XIAO_COMMON, ["Microphone", "Digital PDM mic: clock GPIO42, data GPIO41 (Seeed wiki)"], ["Code", "ESP_I2S library: setPinsPdmRx(42, 41), begin(I2S_MODE_PDM_RX, 16000, ...)"], ["Screen", "128 × 64 I²C OLED on D4/D5"]],
    learn: ["Reading audio samples", "Turning samples into a loudness level", "Driving face moods from a sensor"],
    caveats: ["The microphone is on the Sense board: the plain XIAO ESP32S3 does not have it."],
    steps: ["Start with the ESP_I2S examples to read the PDM mic.", "Compute loudness (average of absolute sample values) every 50 ms.", "Export an OLED face from Display Studio for the XIAO and call its 'talk' / mood code when it is loud.", "Tune the threshold so speech moves the mouth but background noise does not."],
    exercises: ["Model a head with small holes in front of the microphone.", "Make the face window and the mic holes line up with the case."],
    starter: (id) => [...xiaoCase(id), ...nameplate(id, "LISTEN", -30)],
  },
  {
    id: "xiao-motion-cam", title: "XIAO Sense: motion-triggered camera", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Intermediate", kind: "Camera + sensor (XIAO ESP32-S3 Sense)",
    summary: "A PIR motion sensor wakes the board and it snaps a photo to the SD card: a pet cam or a 'who opened my door' cam.",
    facts: [...XIAO_COMMON, ["Sensor", "HC-SR501 PIR: VCC 5V pad, OUT to D0 (about 3.3 V output, fine for the XIAO), GND"], ["Storage", "microSD on the Sense board"]],
    learn: ["Reading a digital sensor", "Waking from deep sleep on a pin", "Combining camera and storage code"],
    caveats: [...XIAO_CAVEATS, "The PIR needs up to a minute to settle after power-up."],
    steps: ["Wire the PIR (Circuit Studio has it: check the wiring there).", "Test: print a message when D0 goes HIGH.", "Take and save a photo on each trigger (from the time-lapse project).", "Optional: deep sleep and wake on D0 to run from a battery."],
    exercises: ["Model a box that holds both the case and the PIR dome.", "Add a hole for the USB cable."],
    starter: (id) => [...xiaoCase(id), ...group(id, "PIR holder (practice)", [shape(id, "box", "Holder", { width: 36, depth: 30, height: 6 }), shape(id, "cylinder", "Dome hole", { radius: 12, height: 8 }, [0, 0, -1], { hole: true })], [50, 0, 0])],
  },
  {
    id: "xiao-desk-buddy", title: "XIAO Sense: tiny desk buddy robot", link: XIAO_WIKI, license: XIAO_LICENSE, factsSource: XIAO_FACTS,
    difficulty: "Advanced", kind: "Desk robot (XIAO ESP32-S3 Sense)",
    summary: "A palm-sized robot: OLED eyes, one servo to nod its head, and the camera to notice you. Built with all of MakerStudio's studios.",
    facts: [...XIAO_COMMON, ["Parts", "128 × 64 OLED (D4/D5), SG90-class micro servo (signal D3), separate 5 V for the servo"], ["Studios", "3D Studio (body), Display Studio (face), Robotics Studio (nod joint), Circuit Studio (wiring + checks)"]],
    learn: ["Planning a robot across mechanics, wiring and code", "Powering a servo safely (not from 3V3)", "Using the auto-wiring and current-budget check"],
    caveats: ["Power the servo from the 5V pad or its own 5 V supply, never from 3V3, and join the grounds.", ...XIAO_CAVEATS],
    steps: ["Model the body and head in 3D Studio; print a test.", "Add a nod joint in Robotics Studio with the servo.", "Design the face in Display Studio for the OLED.", "In Circuit Studio use 'Wire my robot' with the XIAO and read the checks.", "Export the robot code for the XIAO and upload."],
    exercises: ["Model the body: a box with a pocket for the case and a servo slot.", "Model a head that holds the OLED and fits on the servo horn."],
    starter: (id) => [...xiaoCase(id, false), ...group(id, "Body (practice)", [shape(id, "box", "Body", { width: 40, depth: 34, height: 30 }), shape(id, "box", "Servo slot", { width: 23, depth: 12.5, height: 24 }, [0, 0, 8], { hole: true })], [55, 0, 0])],
  },
];


// --- games ------------------------------------------------------------------------------------

const RG_URL = `https://github.com/${RETRO_GO.repo}`;
function handheldCase(newId: () => string): CadObject[] {
  // Placeholder sizes: measure your screen module, buttons and board, then adjust.
  const top = group(newId, "Front shell (practice)", [
    shape(newId, "box", "Shell", { width: 160, depth: 78, height: 6 }, [0, 0, 0], { color: "#8f7cf0" }),
    shape(newId, "box", "Screen window", { width: 60, depth: 45, height: 8 }, [0, 4, -1], { hole: true }),
    shape(newId, "box", "D-pad up/down", { width: 9, depth: 27, height: 8 }, [-55, 4, -1], { hole: true }),
    shape(newId, "box", "D-pad left/right", { width: 27, depth: 9, height: 8 }, [-55, 4, -1], { hole: true }),
    shape(newId, "cylinder", "A button", { radius: 5, height: 8 }, [58, 10, -1], { hole: true }),
    shape(newId, "cylinder", "B button", { radius: 5, height: 8 }, [46, -2, -1], { hole: true }),
    shape(newId, "box", "Start", { width: 10, depth: 4, height: 8 }, [8, -30, -1], { hole: true }),
    shape(newId, "box", "Select", { width: 10, depth: 4, height: 8 }, [-8, -30, -1], { hole: true }),
    ...[0, 1, 2, 3, 4, 5].map((i) => shape(newId, "cylinder", `Speaker hole ${i + 1}`, { radius: 1.2, height: 8 }, [44 + (i % 3) * 5, -26 + Math.floor(i / 3) * 5, -1], { hole: true })),
  ], [0, -44, 0]);
  const back = group(newId, "Back shell (practice)", [
    shape(newId, "box", "Tray", { width: 160, depth: 78, height: 22 }, [0, 0, 0], { color: "#22b8c9" }),
    shape(newId, "box", "Inside", { width: 152, depth: 70, height: 22 }, [0, 0, 2.5], { hole: true }),
    shape(newId, "box", "USB opening", { width: 12, depth: 10, height: 7 }, [0, -38, 6], { hole: true }),
    shape(newId, "box", "microSD slot", { width: 16, depth: 10, height: 4 }, [60, 38, 8], { hole: true }),
  ], [0, 44, 0]);
  // Both shells side by side on a 256 mm bed (A1).
  return [...top, ...back];
}

const GAMES: PracticeProject[] = [
  {
    id: "doom-handheld", title: "Doom handheld (retro-go on ESP32-S3)", repo: RETRO_GO.repo, license: "GPL-2.0",
    factsSource: `retro-go ${RETRO_GO.release} release and ${RETRO_GO.config}`,
    difficulty: "Advanced", kind: "Game console (ESP32-S3)",
    summary: "Build a handheld that plays DOOM (and NES, Game Boy and more) with retro-go's prebuilt firmware. The circuit opens already wired exactly like retro-go's ESP32-S3 DevKit target, so the firmware runs without changes.",
    facts: [
      ["Firmware", `retro-go ${RETRO_GO.release}, prebuilt image ${RETRO_GO.image} (DOOM is a PrBoom 2.5.0 port)`],
      ["Board", "ESP32-S3-DevKitC-1 N16R8 (16 MB flash + 8 MB PSRAM: retro-go needs PSRAM, and this target is set up for 16 MB flash). Prefer board v1.1 (on v1.0 the RGB LED sits on GPIO48, which this wiring uses for the screen clock)"],
      ["Screen", "2.8\" ILI9341 SPI TFT, 320 × 240: MOSI GPIO12, SCK GPIO48, DC GPIO47, RESET GPIO3, backlight GPIO39, CS tied to GND"],
      ["Storage", "microSD module on its own SPI: MISO GPIO9, MOSI GPIO11, CLK GPIO13, CS GPIO10 (FAT32)"],
      ["Sound", "MAX98357A I²S amplifier: BCLK GPIO41, LRC GPIO42, DIN GPIO40, Vin 5V + a small 4-8 Ω speaker"],
      ["Controls", "A GPIO15, B GPIO5, Start GPIO17, Select GPIO16, Menu GPIO18, Option GPIO8 (to GND); D-pad on GPIO6 (up/down) and GPIO7 (left/right) as voltage levels"],
      ["Game files", "WADs go on the SD card in /roms/doom/. The shareware DOOM1.WAD may be shared freely; full DOOM/DOOM II need your own copy. Freedoom works too."],
    ],
    learn: ["Flashing a prebuilt firmware image (esptool, address 0x0)", "Two SPI buses (screen and SD card)", "I²S digital audio", "Reading many buttons with few pins (voltage levels on an analog pin)", "Designing a handheld case"],
    caveats: [
      "The amplifier at full volume can draw more than a USB port's 500 mA: if the board resets during loud sounds, lower the volume or use a stronger supply.",
      "Pin order on screen and SD modules differs between sellers: wire by the labels, and check in Circuit Studio.",
      "retro-go is GPL-2.0; Doom game data (WADs) has its own license.",
    ],
    steps: [
      "Check the wiring in Circuit Studio (it opens ready-wired from retro-go's config.h) and press Power on to see the D-pad voltages.",
      "Build it on two breadboards first: board, screen, SD module, amplifier, buttons.",
      `Download ${RETRO_GO.image} from the retro-go releases page (Assets).`,
      "Flash it: MakerStudio's Upload page → Flash firmware image, address 0x0 (or esptool write-flash 0x0 the .img). Hold BOOT while plugging in if the port does not appear.",
      "Format the microSD as FAT32, create /roms/doom/ and copy DOOM1.WAD into it.",
      "Power up: the retro-go launcher appears; open DOOM and pick the WAD.",
      "When it works, print the case and move the parts inside.",
    ],
    exercises: ["Measure your screen module and set the window and shell sizes.", "Measure your buttons and set the hole sizes (leave 0.3 mm clearance).", "Add screw posts that line up with the screen module's holes."],
    starter: (id) => handheldCase(id),
    circuit: (id) => doomCircuit(id),
  },
];

// --- drones (owner request 2026-11-09; checked on GitHub that day) -----------------------

const DRONE_CHECKED = "the project's README and repository files on GitHub, checked 2026-11-09";
const DRONE_SAFETY = [
  "Spinning propellers cut fingers: take the propellers off whenever you test motors on the bench, and only fit them for real flights.",
  "LiPo batteries can catch fire if punctured, shorted or over-charged: use a LiPo charger, never charge unattended, and store them in a fire-safe bag.",
  "Check your local rules before flying (where you may fly, height limits, registration). Fly indoors or in an open space away from people first.",
];

/** A small X quad frame: centre plate, two crossing arms and four rings for 8.5 mm brushed motors (practice sizes). */
function miniQuadFrame(newId: () => string): CadObject[] {
  const reach = 31.8; // arm end, 45 mm from the centre along the diagonal
  const rings = [[1, 1], [-1, 1], [-1, -1], [1, -1]].flatMap(([sx, sy]) => [
    shape(newId, "cylinder", "Motor ring", { radius: 6.5, height: 8, segments: 48 }, [sx! * reach, sy! * reach, 0]),
    shape(newId, "cylinder", "Motor hole (8.6 mm)", { radius: 4.3, height: 8, segments: 48 }, [sx! * reach, sy! * reach, 0], { hole: true }),
  ]);
  return [
    ...group(newId, `Mini quad frame ${PLACEHOLDER}`, [
      shape(newId, "box", "Centre plate", { width: 40, depth: 40, height: 3 }),
      shape(newId, "box", "Arm", { width: 96, depth: 6, height: 3 }, [0, 0, 0], { transform: { ...IDENTITY, rotation: [0, 0, 45] } }),
      shape(newId, "box", "Arm", { width: 96, depth: 6, height: 3 }, [0, 0, 0], { transform: { ...IDENTITY, rotation: [0, 0, -45] } }),
      ...rings,
    ]),
    ...nameplate(newId, "MINI QUAD", -60),
  ];
}

/** A guard ring for one propeller with a clip tab (practice sizes). */
function propGuard(newId: () => string): CadObject[] {
  return [
    ...group(newId, `Propeller guard ${PLACEHOLDER}`, [
      shape(newId, "cylinder", "Guard", { radius: 36, height: 6, segments: 96 }),
      shape(newId, "cylinder", "Guard opening", { radius: 34, height: 6, segments: 96 }, [0, 0, 0], { hole: true }),
      shape(newId, "box", "Clip tab", { width: 14, depth: 10, height: 6 }, [-40, 0, 0]),
      shape(newId, "box", "Clip slot", { width: 8, depth: 4, height: 6 }, [-41, 0, 0], { hole: true }),
    ]),
    ...nameplate(newId, "PROP GUARD", -55),
  ];
}

/** A display stand with a 1S battery holder (practice sizes). */
function droneStand(newId: () => string): CadObject[] {
  const posts = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([sx, sy]) =>
    shape(newId, "cylinder", "Post", { radius: 4, height: 15, segments: 32 }, [sx! * 30, sy! * 30, 0]));
  return [
    ...group(newId, `Stand ${PLACEHOLDER}`, [shape(newId, "box", "Base", { width: 80, depth: 80, height: 3 }), ...posts]),
    ...group(newId, `1S battery holder ${PLACEHOLDER}`, [
      shape(newId, "box", "Holder", { width: 36, depth: 18, height: 12 }),
      shape(newId, "box", "Battery space", { width: 32, depth: 14, height: 10 }, [0, 0, 2], { hole: true }),
    ], [70, 0, 0]),
    ...nameplate(newId, "LITEWING", -60),
  ];
}

const DRONES: PracticeProject[] = [
  {
    id: "flix",
    title: "Flix: an ESP32 quadcopter made from scratch",
    repo: "okalachev/flix",
    license: "unspecified",
    factsSource: DRONE_CHECKED,
    difficulty: "Intermediate",
    kind: "Drone (quadcopter)",
    summary: "A small quadcopter built from general-purpose parts and a 3D-printed frame, made for learning how flight control works. The firmware is about 2,000 lines of Arduino code, and there is a simulator, a Python library and a textbook in progress.",
    facts: [
      ["Brain", "ESP32 Mini; ESP32-S3 and ESP32-C3 boards are also supported (README)"],
      ["Sensors", "IMU board: GY-91 / MPU-9250 / MPU-6500, ICM-20948, or GY-521 (MPU-6050)"],
      ["Motors", "4 × 8520 3.7 V brushed motors, each switched by a MOSFET (UMW 100N03A), 55 or 65 mm propellers"],
      ["Power", "3.7 V (1S) Li-Po, 25C and 1000 mAh or more recommended; optional 5 V boost converter"],
      ["Print files", "Frame and ESP32 holder as STL and STEP in the repo (layer 0.2 mm, infill 100% recommended)"],
      ["Control", "MAVLink over Wi-Fi or ESP-NOW: USB gamepad, RC transmitter (SBUS receiver) or smartphone"],
      ["Software", "Arduino; Gazebo simulation; Python library for scripted flights"],
    ],
    learn: ["How a flight controller keeps a quadcopter level (IMU, PID)", "Switching brushed motors with MOSFETs", "Soldering small wires and LiPo safety", "Testing in a simulator before flying"],
    caveats: [
      "The repository has no license file: build it for yourself, but do not share or sell copies of its code or frame. The README invites you to modify it and share your results with the author.",
      "The README warns that only the exact 3.7 V motors and the UMW 100N03A MOSFET are known to work.",
      ...DRONE_SAFETY,
    ],
    steps: [
      "Read the assembly and usage guides in the repo's docs folder, and buy the parts from its component table.",
      "Print the frame and ESP32 holder from the repo's STL files (100% infill as recommended).",
      "Try the Gazebo simulator first to learn the controls without risking the drone.",
      "Solder the MOSFETs, motors and IMU, and check every connection with a multimeter before connecting the battery.",
      "Upload the firmware (Arduino), calibrate the IMU, and test the motors WITHOUT propellers.",
      "Fit the propellers and make the first hover in an open space, low and slow.",
    ],
    exercises: [
      "Measure your motors and set the motor hole size (the practice frame uses 8.6 mm for 8.5 mm motors).",
      "Change the arm length and see how the frame size changes (the propellers must not touch).",
      "Add mounting holes in the centre plate for your IMU board.",
    ],
    starter: (id) => miniQuadFrame(id),
  },
  {
    id: "esp-drone",
    title: "ESP-Drone: Espressif's open mini drone",
    repo: "espressif/esp-drone",
    license: "GPL-3.0",
    factsSource: DRONE_CHECKED,
    difficulty: "Intermediate",
    kind: "Drone (quadcopter)",
    summary: "Espressif's open-source mini drone firmware, based on the Crazyflie flight code. It flies on Wi-Fi with a phone app or a gamepad, has stabilize mode, and height and position hold with extension boards. The firmware builds for the ESP32, ESP32-S2 and ESP32-S3.",
    facts: [
      ["Brain", "Firmware targets include ESP32-S3 (build configuration in the repo); documented boards: ESP32-S2-Drone V1.2 (ESP32-S2-WROVER) and ESPlane-FC-V1 (ESP32-WROOM-32D)"],
      ["Sensors", "MPU6050 IMU on the main board; extension boards add height / position hold"],
      ["Motors", "4 × 716 brushed coreless motors (720 optional) on the ESP32-S2-Drone V1.2"],
      ["Power", "1S LiPo, 300 mAh (350 mAh optional) on the ESP32-S2-Drone V1.2"],
      ["Control", "ESP-Drone app (iOS / Android), cfclient, or an ESP-BOX-3 joystick over ESP-NOW"],
      ["Software", "ESP-IDF (release/v5.5 or v6.1)"],
      ["Print files", "None: the main board is the frame; design add-ons yourself (exercise below)"],
    ],
    learn: ["Building ESP-IDF projects", "How Crazyflie-style flight code is organised", "Wi-Fi control from a phone app", "Configuring firmware with menuconfig"],
    caveats: [
      "Espressif offers limited support since December 2022 (pull requests still welcome).",
      "The documented hardware is ESP32-S2 / ESP32 boards; for an ESP32-S3 you need a board with the same sensor and motor wiring (set the pins in menuconfig).",
      ...DRONE_SAFETY,
    ],
    steps: [
      "Read Getting Started and Hardware in the ESP-Drone documentation (linked from the README).",
      "Install ESP-IDF (release/v5.5), set the target (idf.py set-target esp32s3 for an ESP32-S3) and build the firmware.",
      "Flash it, then connect the phone app over the drone's Wi-Fi.",
      "Test the motors WITHOUT propellers, and check the motor type in menuconfig (716 or 720).",
      "Fit the propellers and hover low in an open space.",
    ],
    exercises: [
      "Measure your propellers and size the guard ring to them (a few mm of clearance all round).",
      "Design a clip that fits your drone's arm, using the clip tab and slot as a start.",
      "Make four guards and a nameplate as one print plate, then check them for printing.",
    ],
    starter: (id) => propGuard(id),
  },
  {
    id: "litewing",
    title: "LiteWing: a compact ESP32-S3 Wi-Fi drone",
    repo: "jobitjoseph/LiteWing",
    license: "CC BY-NC-SA",
    factsSource: DRONE_CHECKED,
    difficulty: "Starter",
    kind: "Drone (quadcopter)",
    summary: "A compact Wi-Fi controlled drone whose circuit board is also its frame, built around an ESP32-S3. The repo has the KiCad board design, ready-made firmware files, Arduino versions, an ESP-NOW joystick, a browser ground station and Python scripts.",
    facts: [
      ["Brain", "ESP32-S3 (ESP32-S3-WROOM-1 module on the board)"],
      ["Sensors", "MPU6050 (on the board design)"],
      ["Hardware files", "KiCad PCB design (LiteWing V2.6.C) in the hardware folder"],
      ["Software", "Ready-made firmware files, an ESP-IDF build, Arduino sketches, an ESP-NOW joystick sketch, a browser ground station and Python scripts"],
      ["Extras", "Height hold and positioning add-ons are shown in the repo's documents"],
      ["Print files", "None: the board is the frame; print a stand or battery holder (exercise below)"],
    ],
    learn: ["Flashing ready-made firmware to an ESP32-S3", "Reading a KiCad board design", "Controlling a drone from a browser or Python", "Making a joystick with ESP-NOW"],
    caveats: [
      "License CC BY-NC-SA 4.0: build it for yourself; no commercial use; share changes under the same license.",
      "The board is a custom PCB: you either order it made (from the KiCad files) or buy the kit from the makers.",
      ...DRONE_SAFETY,
    ],
    steps: [
      "Read the README and the documents folder; decide whether to order the board from the KiCad files or buy the kit.",
      "Flash the ready-made firmware files to the ESP32-S3 as the project's instructions describe: the bootloader, partition table and LiteWing.bin each go to their own flash address, so follow their addresses exactly.",
      "Connect to the drone's Wi-Fi and try the browser ground station, propellers OFF.",
      "Optional: build the ESP-NOW joystick sketch on a second ESP32 board.",
      "Fit the propellers and hover low in an open space.",
    ],
    exercises: [
      "Measure your battery and set the holder's battery space (leave 0.5 mm clearance).",
      "Size the stand posts so the drone rests on the board, not on the motors.",
      "Add a slot to the holder for the battery wires.",
    ],
    starter: (id) => droneStand(id),
  },
];

export const PRACTICE_PROJECTS: PracticeProject[] = [...ROBOTS, ...XIAO, ...GAMES, ...DUMMY13, ...PROTOTYPE_FAN, ...DRONES];

/** Where to find the project: GitHub, another site, or a folder on this computer. */
export function projectLocation(p: PracticeProject): { url: string | null; label: string } {
  if (p.repo) return { url: `https://github.com/${p.repo}`, label: `github.com/${p.repo}` };
  if (p.link) return { url: p.link.url, label: p.link.label };
  return { url: null, label: p.localPath ?? "" };
}

/** Notes (Markdown) for a new practice project. */
export function practiceNotes(p: PracticeProject): string {
  const where = projectLocation(p);
  const url = where.url ?? `${where.label} (on this computer)`;
  const lines = [
    `# ${p.title}`,
    "",
    p.summary,
    "",
    `- Project: ${url}`,
    `- License: ${p.license} (the project's own; check it before sharing remixes)`,
    `- Difficulty: ${p.difficulty}`,
    `- Facts checked on ${VERIFIED_ON}${p.factsSource ? ` (${p.factsSource})` : ""}; the project's own page is the up-to-date source.`,
    "",
    "## What it uses",
    ...p.facts.map(([k, v]) => `- **${k}:** ${v}`),
    "",
    "## What you will learn",
    ...p.learn.map((l) => `- ${l}`),
    ...(p.caveats.length ? ["", "## Before you start", ...p.caveats.map((c) => `- ${c}`)] : []),
    "",
    "## Build plan",
    ...p.steps.map((s) => `- [ ] ${s}`),
    "",
    "## Practice in 3D Studio",
    "The starter shapes are simple practice exercises with placeholder sizes, not the project's parts. Measure your real parts with calipers and change the sizes.",
    ...p.exercises.map((e) => `- [ ] ${e}`),
    "",
    "## My notes",
    "",
  ];
  return lines.join("\n");
}

/** A new, unsaved project for a practice build: notes, description and starter shapes. */
export function createPracticeProject(p: PracticeProject, appVersion: string, makeId: () => string = newId): Project {
  const project = createEmptyProject(`Practice: ${p.title}`.slice(0, 200), appVersion);
  project.document.description = `${p.summary} Source: ${projectLocation(p).url ?? projectLocation(p).label}`.slice(0, 5000);
  project.document.workspaces.cad.objects = p.starter(makeId);
  if (p.circuit) {
    const c = p.circuit(makeId);
    project.document.workspaces.circuit.components = c.components;
    project.document.workspaces.circuit.wires = c.wires;
  }
  project.notes = practiceNotes(p);
  return project;
}
