# Build Status

Last updated: 2026-11-08

| Phase | Status | Tested |
|---|---|---|
| 1 Research & Architecture | Done, approved 2026-11-08 | n/a (documents) |
| 2 Desktop Foundation | Done, approved 2026-11-08 (Linux focus; Windows testing later) | 16 unit + 3 end-to-end tests pass (dev and packaged builds) |
| 3 3D Modeling | **All of 3a–3d done** (incl. STEP), awaiting owner review | 105 unit + 8 end-to-end tests (dev and packaged builds), real mouse drag test |
| 4 AI Context Engine | **complete** (4a proposals + approval, 4b built-in chat: Ollama / Claude / OpenAI-compatible, 4c Claude Code over MCP) | 8 unit + 2 end-to-end + 2 live Ollama tests |
| 5 Circuit Studio | **5a-5c done** (checks, wiring canvas, robot wiring + current budget), awaiting owner review; physical breadboard view and more boards (ESP32 DevKit, Nano, XIAO, Raspberry Pi) later | 27 unit + 1 end-to-end test (all roadmap acceptance cases) |
| 6 Simulation | **complete** (6a SPICE via ngspice WASM; 6b Uno code with avr8js; 6c Pico code with rp2040js; both drive the SPICE circuit; ESP32 not emulated: Upload page for real boards) | ngspice vs hand calculations, both emulators with real firmware, 3 end-to-end |
| 7 Parts Library | **done** (first version: sourced specs with status, search, add to studios; grows over time) | 5 acceptance unit tests + 1 end-to-end |
| 8 Display Studio | **Done** (8a face designer, 8b animation timeline, 8c robot code export), awaiting owner review | 44 unit + 1 end-to-end test; 7 PlatformIO builds; pixel parity with the device code |
| 9 Robotics Studio | **Desk-robot part done** (9a joints/posing/screens, 9b behaviours, 9c robot code export), awaiting owner review. Parts-library items (place catalog parts, chassis, BOM, wiring) wait for Phase 7 | 25 unit + 1 end-to-end test; 11 PlatformIO builds; behaviour parity with the device code |
| 10 Advanced AI | **done** (design check across studios as a page card and an AI tool; picture-to-design in the chat for every provider) | 3 unit + 1 end-to-end + 2 live Claude Code checks |
| 11 Packaging & Testing | **done on Linux; Windows built, not verified** (AppImage, .deb, Arch package, NSIS installer; INSTALL.md) | full e2e suite on the AppImage |

## What works now (Phase 3a + 3b, 2026-11-08)

- 3D Studio viewport: Bambu A1 bed outline and grid, Z-up, orbit/pan/zoom with the mouse, perspective and orthographic cameras, Home/Top/Front/Right/Fit views, axis indicator.
- Shapes: box, sphere, cylinder, cone, torus, wedge. Click to add, or drag onto the bed (lands on the grid point under the mouse).
- Select by clicking (Shift+click for several), object list with show/hide, Escape to clear.
- Move / rotate / scale handles (T / R / S) with grid snapping (1 mm, 15°), typed exact dimensions, position, rotation and scale; exact size readout of the selection.
- Duplicate (Ctrl+D), delete, group / ungroup (Ctrl+G / Ctrl+Shift+G) without anything moving, align min/centre/max on X/Y/Z, drop to bed (D), nudge with the arrow keys and PgUp/PgDn.
- Hole flag, lock, colour per object. (Holes are only marked so far; the actual cutting is Phase 3c.)
- All of it is undoable and saved in the project file.

### Phase 3c (2026-11-08, done, awaiting review)
- Solid geometry engine (manifold-3d WebAssembly): holes are really cut out of the solids they are grouped with; group sizes are the exact size of the result.
- Combine buttons when 2+ objects are selected: **Union**, **Subtract** (keeps the first object you selected, cuts away the rest), **Intersect** (keeps only the overlap). Each result is a group, so Ungroup or Ctrl+Z brings the pieces back.
- A group's inspector can switch it between Union and Intersect.
- Text shape (Noto Sans Bold, OFL 1.1) with a text field; letter height in mm is the height of a capital letter.
- Measure tool (M or toolbar): click two points on shapes or the bed for the distance and ΔX/ΔY/ΔZ.
- Workplane tool (W or toolbar): click a face, and new shapes are placed standing on it; click the bed or "Back to the bed" to return.
- Fixed: the size readout did not update when only a text shape's text changed (regression unit test added).

Tested: 54 unit tests; end-to-end test does subtract (10 × 20 × 20 mm result), intersect, union, group mode switch, undo, text edit and empty-text refusal, measure label, workplane tool toggle. Same e2e suite passes against the packaged Linux build (`release/linux-unpacked`), so the WebAssembly engine loads from file://.
Not verified automatically: clicking a real face with the workplane tool and placing a shape on it (written and works in code, but the test only toggles the tool). Owner should try it by hand.

### Phase 3d part 1 (2026-11-08): STL / OBJ import and export
- Import STL (ASCII and binary) and OBJ from the Files panel or by dragging files onto the viewport. Meshes are welded, centred, stored once in the project file (`meshes/<id>.bin`).
- Unit hints for very small or very large imports, plus "inches → mm" / "cm → mm" buttons.
- Closed (watertight) imported meshes work in Booleans; open meshes get a clear message.
- Export STL (binary) or OBJ, as one file or one STL per top-level part. Everything goes through the solid engine first, so holes are cut and groups combined.

### Phase 3d part 2 (2026-11-08): print preparation
- **Print** panel in the 3D Studio (works on the selection, or on all visible objects):
  - **Check for printing**: size against the build volume from Settings (Bambu Lab A1: 256 × 256 × 256 mm, tells you when it would fit turned or lying diagonally), off the bed, floating / below the bed, overhangs steeper than 45° from vertical, walls thinner than the nozzle (0.4 mm, the slicer leaves them out) or thinner than two lines (0.8 mm, fragile), nothing flat on the bed, tall on a small footprint, open meshes. Problem areas are highlighted in the view (overhang red, thin wall amber). Results say when the model changed since the check.
  - **Orient**: turns each part to the position with the least overhang and the most flat contact with the bed (largest flat faces and the six axis directions, also turned 45°), then puts it on the bed. One undo step.
  - **Bambu Studio**: writes one STL per part into `Documents/MakerStudio/Exports/For Bambu Studio/<project> <time>/` and opens them in Bambu Studio. The button is disabled when Bambu Studio is not installed. Only known install locations are used (Linux PATH, /opt, Flatpak; Windows Program Files).
- Wall thickness is measured by casting rays into the solid (three-mesh-bvh, MIT). Sharp tapered edges (wedge tips, chamfers) are not counted as thin walls.
- All checks are estimates from the shape; the panel says the slicer has the final say.

Tested: 14 new unit tests (sizes, bed placement, thin plates 0.3 / 0.6 / 2 mm, a wall left 0.1 mm thin by a hole, a T shape's overhang = 875 mm², sphere with no contact, wedge not flagged, orientation of T shape / tall bar / 300 mm pole, undo). End-to-end: check, orient, undo, stale notice, floating warning, opening in a stand-in slicer (verifies the STL it receives), whole-scene check with overhang highlight. Same suite passes against the packaged Linux build.
Not verified automatically: launching the real Bambu Studio (found at /usr/bin/bambu-studio on this PC). Owner should click the button once.

### Phase 3d part 3 (2026-11-08): STEP import and export
- **Export STEP…** in the Files panel (selection or all visible objects). Each top-level object is one named, coloured solid; units millimetres (AP214).
  - **Exact** solids (true circles and curved faces, real Booleans for groups and holes): boxes, wedges and text with any scale; cylinders and cones scaled evenly in X/Y; spheres (squashed ones become exact ellipsoids); tori scaled evenly; mirrored shapes.
  - **Faceted** (flat faces from the same watertight mesh as the STL, coplanar triangles merged) for imported meshes, unevenly squashed cylinders / cones / tori, and shapes skewed by scaling a rotated group. The export message names these parts. Limit 20,000 triangles per faceted part (otherwise: use STL).
- **Import** STEP / STP (button or drag and drop): every solid becomes a mesh object, kept in place relative to the others. The file's units are converted to millimetres (tested with an inch file). Curved faces are turned into fine triangles (about 1/2000 of the model size, 0.005–0.1 mm).
- Engine: replicad 1.2.1 (MIT) + replicad-opencascadejs 1.2.1 (OpenCascade, LGPL-2.1), about 22 MB of WebAssembly, loaded only when STEP is first used, in a **Web Worker**. The OCCT build uses JavaScript eval internally; the app window forbids eval (Content Security Policy) and keeps forbidding it, the worker has its own policy. Long STEP jobs do not freeze the interface.
- Packaging fix: the app package no longer contains the raw `node_modules` folders (everything is bundled into `dist/`): `app.asar` went from 254 MB to 27 MB (23 MB of that is the STEP engine).

Tested: 17 new unit tests (exact box with name, place and mm units in the file; cylinder volume within 0.2 % of π r² h and closer than the STL; sphere, ellipsoid, cones, rotated torus, stretched/mirrored wedges, text, rotated stretched box all match the solid engine's size and volume; bracket group with a cut hole within 0.2 % of the exact volume; squashed cylinder falls back to faceted; imported mesh cube becomes 6 faces; two objects become two solids; inch file → mm; non-STEP file refused). End-to-end in the real app: export bracket mesh + cylinder to STEP (file contains a true CYLINDRICAL_SURFACE), import it back as 2 solids with the right size. Same e2e suite passes against the packaged Linux build.
Not done: STEP files exported from other CAD programs (Fusion, FreeCAD, Onshape, vendor part models) have not been tried yet. Owner: try one real STEP file.

### Practice projects (2026-11-08, owner request)
- Projects workspace → **Practice projects**: 11 real open-source builds on GitHub (Starter: RoboEyes, SimpleFOC; Intermediate: Stack-chan, Sesame, OpenBot, OpenCat, SO-101 arm; Advanced: BCN3D Moveo, Spot Micro, Sawppy, NASA JPL Open Source Rover), filter by difficulty, details, link to GitHub.
- Every repo, license and fact was checked on the GitHub page / GitHub API on 2026-11-08; facts a README did not state are left out. Otto Ninja (contradictory license) and Stanford Pupper v1 (end of life) were left out.
- **Start practice project** makes a new unsaved project: description, design notes with a checklist build plan and exercises, and original practice shapes in 3D Studio (clearly marked placeholder sizes, not the projects' parts). Asks first if the current project has unsaved changes.
- Tested: every starter validates, saves and reopens, is watertight, fits the A1, sits on the bed, and has no thin walls (22 unit tests); end-to-end: filter, start, notes, starter shape size.
- Fixed while testing: notifications covered dialogs (they were on top), so a pile of messages could block a dialog's buttons. Dialogs are now on top and at most 4 notifications show. Thin-wall check: tapered edges up to 10° no longer count as walls.

### Practice projects: Dummy 13 (2026-11-08, owner request)
- Dummy 13 entries added: the original Dummy 13 by Lucky 13 Toys / soozafone (MakerWorld 638587, CC BY 4.0), flight-commander/dummy_13 (PLA print settings and files), allcapsjoe/dummy-13 (assembly guide) and fluo10/dummy13scad (parametric frame in OpenSCAD, MIT). Starter shapes include a clearance fit test (0.1 / 0.2 / 0.3 mm) and a display stand.
- Entries can now link to GitHub, another site, or a folder on this computer.
- Searched and left out: other GitHub "dummy13" repos (empty test repos, a seller's order page, a spam repo). No "T13" / Poppy Playtime Prototype projects exist on GitHub.
- Owner request: one fan-made "The Prototype" (Poppy Playtime) figure, linked only: Articulated Prototype V.2.0 by FIR23 (MakerWorld Exclusive License; built from Mr. Printer's Stick-Bot V2 parts, hands from a model by Rionyx). Marked as fan art of a MOB Entertainment character: print for yourself, do not sell. Three other fan Prototype listings were added, then removed at the owner's request.

### Practice projects: the owner's Dummy 13 heads (2026-11-08)
- The main process reads only files on a fixed allowlist (`src/shared/localModels.ts`); the interface asks by key.

### Phase 3 status
All Phase 3 items on the roadmap are built. Waiting for owner review before Phase 4 (AI Context Engine).

### Phase 8a (2026-11-08): Display Studio, face designer
Owner chose the desk-robot track first (see ROADMAP), aiming at a Stack-chan style robot.
- **Display catalog** (9 displays): M5Stack CoreS3 and Core2 screens (320 × 240, ILI9342C/E, from docs.m5stack.com), SSD1306 128 × 64 and 128 × 32, SH1106 128 × 64, GC9A01 round 240 × 240, ST7789 240 × 240 and 240 × 320, ILI9341 240 × 320. Each shows its controller, bus, notes and source.
- **Faces**: eyes (round / rounded / square, size, spacing, height, pupils), mouth (none / line / smile / open), colours and cheeks; four original presets (Friendly, Robot, Big eyes, Pixel pal). Sizes are fractions of the screen, so a face keeps its look on another display. All edits undoable (a slider drag is one undo step), saved in the project file and validated when opening.
- **Moods**: neutral, happy, sad, angry, sleepy, surprised (eyelid shapes and mouth change).
- **Alive** preview: blinks and glances around on its own; **Talk** moves the mouth.
- **Pixel-accurate preview** at the display's real resolution, whole-number zoom, optional pixel grid; monochrome displays show only lit/dark pixels; round displays are masked.
- How it works: a face becomes a list of simple drawing steps (rectangles, rounded rectangles, circles, ellipses, triangles), the same shapes the robot's display libraries draw. The preview draws that list; Phase 8c will turn the same list into code for the robot. Curved outlines may differ by about one pixel between libraries.
- Tested: 16 unit tests (catalog, exact rectangles, circle/ellipse/triangle areas, clipping, eye positions, blink, gaze, all moods distinct, talking, monochrome, round mask, commands with merged slider drags and undo, bad values refused, file round trip, no ellipse spikes). End-to-end: add a CoreS3 face, read real canvas pixels, apply a preset and undo it, all six moods differ, switch to a monochrome OLED. A screenshot check found and fixed single-pixel spikes on ellipses.

### Phase 8b (2026-11-08): animation timeline
- Each face can have animations: keyframes on a timeline with rows for **Mood, Look, Blink, Talk**. A keyframe sets only the things it names; each is interpolated on its own (smooth ease in/out), the mood switches at its keyframe. Loop or play once; length up to 60 s.
- Four original ready-made animations: **Wake up, Look around (loops), Happy hello, Fall asleep**, or start blank.
- Play / Pause / Rewind, click the track to scrub, double-click a row to add a keyframe (it starts with what the face shows at that moment), drag keyframes to move them (one undo step per drag), keyframe editor (time, mood, gaze, blink, talk, delete), **+ Blink here**.
- Without an animation selected, the face runs its idle life (Alive) as in 8a.
- Saved in the project; files from before 8b still open.
- Tested: 8 unit tests (per-channel easing, holds before/after keys, mood switching, loop wrap-around, blink helper, templates valid, commands sorted/undo/shortened length drops later keys, bad keyframes refused, file round trip incl. old files). End-to-end: Wake up starts asleep, scrubbing to the end shows open eyes (lit-pixel count), Play advances time, double-click adds a keyframe and undo removes it. A screenshot check replaced a "⏮" symbol the font could not show.

### Phase 8c (2026-11-08): put the face on a real robot
- **Put it on your robot** (Display Studio): choose a board and what plays at power-on (idle life or an animation), then **Export code project…** writes a PlatformIO project into a new folder (never overwrites an earlier export).
- Boards: M5Stack CoreS3 and Core2 (their built-in screens), Arduino Uno and Nano, ESP32 DevKit, ESP32-S3 DevKitC-1, Raspberry Pi Pico. Only boards that can drive the chosen display are offered (colour TFTs: 32-bit boards only).
- The project contains the **MakerStudio face engine in C++** (`face_engine.h`), a line-by-line port of the preview code that draws everything from horizontal lines, the **player** (`face_player.h`: animations, idle life with blinking and glancing, USB serial commands `0`-`9` / `i`), the face data, a `main.cpp` for the display library (M5Unified, Adafruit SSD1306 / SH110X / ST7789 / ILI9341 / GC9A01A) and a README with upload and wiring steps. TFT pins are an example for each board and say to change them to your wiring.
- Memory: keyframes and messages live in flash on 8-bit boards; colour TFTs are drawn in 40-row bands (25 KB instead of a 150 KB full-screen buffer); M5Stack draws into a canvas in PSRAM. 8-bit boards get only the starting animation.
- **Pixel parity, tested**: the C++ engine is compiled with g++ on this PC and draws 4 faces × 4 displays × 30 moments (every mood, blinks, gaze, talking); every pixel equals the preview's. Animation sampling matches to 1e-9 over all templates. A deliberate one-number bug in the C++ made 16 of 16 pixel tests fail (the test is real).
- **PlatformIO acceptance** (opt-in test `MAKERSTUDIO_PIO=1`): all 7 projects build: CoreS3 (RAM 8.6 %, flash 8.9 %), Core2, Uno + SSD1306 (RAM 29.2 % static + 1 KB display buffer at start, flash 74.9 %), Pico + ST7789, ESP32 + SH1106, ESP32-S3 + GC9A01, ESP32 + ILI9341. The first Uno build used 46 % static RAM, which with the display buffer would have left about 80 bytes; fixed before this commit.
- **Not verified**: running on real hardware (no board connected here). Owner: export a face for your board and upload it.

### Phase 9a (2026-11-08): Robotics Studio, joints and live posing
- **Joints (servos)** between 3D Studio parts: which part moves, what it is attached to (another part or the fixed base), the axis it turns around (X, Y, Z or reversed), the pivot point (numbers or **Pick on the model**), and its range. Chains work (body turns, head on the body nods). Loops, double joints and missing parts are refused with a clear message.
- **Add joint to part** picks a sensible start: pivot at the bottom centre of the part, attached to the part right below it if there is one.
- **Live posing**: a slider per joint, **Wiggle test** (every joint moves back and forth within its range), **Home pose**. Poses are for trying out, not saved.
- **Screens on the robot**: mount a Display Studio face by clicking a part's face in 3D; it starts at the display's real visible width (CoreS3: about 40.6 mm), moves with its part, and shows the live face (blinking, glancing).
- Servo settings per joint (pin, servo angle at the home pose, reverse) are stored for the code export in 9c.
- The 3D model as designed is the home pose (every joint at 0°). Pivots and screen positions are stored in millimetres at the home pose; if a part is moved later in 3D Studio, pick its pivot / place its screen again.
- Tested: 7 unit tests (home pose unchanged, rotation about a pivot, chained joints, limits, commands with undo and file round trip, refused loops/duplicates/self/missing parts, screen mounting). End-to-end with the Stack-chan practice project: joint on the head, axis X, posing changes the picture, mounting the face by clicking the head, wiggle animates, undo removes the mount. Screenshot checked: the face mounts behind the head's screen opening, upright and alive.

### Phase 9b (2026-11-08): behaviours
- A **behaviour** is a list of steps: **Mood, Look** (where the eyes look, over a time), **Move joint** (to an angle, over a time), **Face animation** (from Display Studio), **Talk, Blink, Wait, Repeat** (a number of times or forever, with steps inside, up to 3 levels deep). Timed steps can be marked **and go on** so they happen together with the next steps (turn the head while looking).
- **Idle life** option: blinks and glances around on its own between steps (glances only when no step has set the gaze for 3 s).
- **Run** plays the behaviour live on the 3D robot: joints move, the mounted face changes. Ready-made behaviours **Say hello, Curious** (loops), **Doze off**; they use the robot's own joints (a Z joint for turning, an X/Y joint for nodding) and leave out moves the robot has no joint for.
- Steps can be reordered, deleted and nested; every edit is undoable and saved in the project.
- The runner is deterministic (fixed 10 ms ticks, fixed pseudo-random numbers for idle life) so it can be ported to the robot in 9c and checked against the preview, like the face engine.
- Tested: 11 unit tests (eased joint moves, steps that go on together, joint limits, repeat counts and forever, face animation and final mood, talk and blink, skipping deleted joints/animations, same result every run incl. idle life, templates use the robot's joints, commands with nesting limit and file round trip). End-to-end: Say hello on the Stack-chan practice robot runs, moves the head, changes the picture and finishes; add step and undo.

### Phase 9c (2026-11-08): the whole robot on a real board
- **Put it on your robot** (Robotics Studio overview): board + starting behaviour → **Export robot code…** writes one PlatformIO project with the face (first mounted screen), the behaviour, and the servos.
- Servos: hobby (PWM) servos on the pins set per joint; servo angle = home angle ± joint angle (reverse option), kept within 0-180°. ESP32 / ESP32-S3 / M5Stack use ESP32Servo, Uno / Nano / Pico the Arduino Servo library. Joints without a pin move only in the preview (the export says which). Serial servos (such as some Stack-chan versions use) are not supported yet.
- The behaviour runner is a C++ port (`robot_core.h`) of the app's runner: behaviours are flattened into a small instruction list (repeats become begin/end markers); steps for deleted joints or animations and empty repeats are left out, as in the app.
- README covers upload, servo power (separate 5 V supply, common ground) and fitting servo horns at the home angle.
- **Behaviour parity, tested**: the C++ runner compiled with g++ gives the same mood, blink, gaze, talk, joint angles and "done" as the app at every 37 ms over 12-20 s, for all three ready-made behaviours, an edge-case behaviour (nested repeats, steps that go on together, joint limits, face animations, deleted joints, empty repeats, idle life) and idle life alone. Two deliberate one-line bugs in the C++ (random sequence, move start) each failed 4 tests.
- **PlatformIO**: 4 robot builds pass: CoreS3 desk robot (RAM 8.8 %), ESP32 servos only, Uno + SSD1306 + servos, Pico + ST7789. The first Uno robot build used 49.9 % static RAM, which with the 1 KB display buffer would not have run; now 37.5 % (joint slots sized to the robot, only used animations on 8-bit boards), about 250 bytes spare. The export says this is tight and suggests an ESP32 for bigger robots.
- **Not verified**: real servos and screens on real boards (no hardware connected here).

### Phase 5a (2026-11-08): circuit model and electrical checks
- **Parts**: battery / supply (alkaline, NiMH, LiPo, bench), resistor, LED (5 colours), diode, ceramic and electrolytic capacitors, push button, switch, NPN transistor, hobby servo, DC motor, I²C OLED module.
- **Boards with pin lists from manufacturer documents**: Arduino UNO R3 (A000066 datasheet: header tables, IOREF = 5 V, VIN 6-20 V), Raspberry Pi Pico (datasheet: IO fixed at 3.3 V, VSYS 1.8-5.5 V, 3V3(OUT) under 300 mA, special pins; GP/GND positions from the pinout diagram), ESP32-S3-DevKitC-1 (Espressif user guide v1.1: headers J1 and J3, GPIO35-37 taken by Octal flash/PSRAM on some modules, strapping and USB pins noted). Every number used by a check is marked verified (with its document) or estimated.
- **Checks** (SAFETY_REQUIREMENTS.md): netlist + DC solver (LEDs and diodes switched until consistent; every supply has a small internal resistance so shorts show up as huge currents; floating nets are recognised as "not connected" instead of being given meaningless voltages), run with GPIO pins as inputs and as outputs driven HIGH. Rules: short circuit, LED reversed, LED current (with a standard resistor value suggestion), electrolytic reversed / over-voltage, 5 V into 3.3 V pins (Danger based on the verified logic voltage; borderline cases are Info because exact limits were not read from a datasheet), GPIO wired directly to a supply or GND, GPIO output current, servo / motor / module powered from a GPIO, supply range (incl. board inputs such as Pico VSYS), missing common ground, not powered, LiPo safety, transistors not analysed (Info). Results are never called "safe": the best is "No problems detected by MakerStudio's checks (N checks run). This is not a guarantee."
- Undoable commands for parts and wires, saved and validated in the project file.
- **Acceptance tests (roadmap)**: short circuit (battery, board 5V-GND), reversed LED, LED without resistor (suggests 820 Ω for 9 V), missing ground (servo on its own battery), 5 V into a 3.3 V Pico / ESP32-S3 pin: all caught. Good circuits (LED + 220 Ω on an Uno pin, LED + resistor on 9 V, servo on an Uno, OLED on a Pico, 1k/2k divider to a Pico pin, button to GND) give no warnings. Writing the tests found and fixed three real check bugs (floating nets read as voltages, a pin wired to its own board's GND missed, wrong current direction in a message).

### Phase 5b (2026-11-08): wiring canvas
- **Circuit Studio** (Ctrl+3): parts palette by category (click to add, or drag onto the canvas); parts and boards drawn as simple original symbols with labelled pins (board pins in their header order); click a pin, then another, to connect them (wire colour: red for supplies, grey for ground, otherwise a cycle); drag parts to move (snapped to 0.1"), R rotates, Delete removes parts or wires, drag the background to pan, scroll to zoom.
- Hovering a pin shows what it is and where the fact comes from ("GPIO, 5 V logic (verified: Arduino UNO R3 datasheet: IOREF 'connected to 5V')").
- **Live checks** panel: summary, each finding with its fix; parts with problems get a red / amber outline; hovering a finding highlights its parts.
- It is a **wiring diagram**, not yet a physical breadboard (rows of holes and power rails); that view is planned as its own step.
- Found and fixed while testing: new parts could land under the side panel (a pin you could not click); wires were drawn under parts and ran backwards through the parts they left; drags only ended when the mouse was released over the canvas; wire ends covered pins; wires could run exactly along a row of pins and look connected (now on half-grid lanes); timeline scrubbing could not reach the very start/end.
- Tested: e2e wires an LED with a 220 Ω resistor to an Uno pin (no problems detected), then a 1 Ω resistor (LED current finding), undo, then the pin wired straight to 5V (Danger), undo. Unit test for the wire router.

### Phase 5c (2026-11-08): wiring your robot, current budget
- **Wire my robot** (Circuit Studio, when the robot has joints or a screen): pick a board, one click adds the board, one hobby servo per joint on its pin (on a separate 5 V servo supply, grounds joined to the board), and an I²C OLED on the board's default I²C pins, as one undo step; the view zooms to fit it. Joints without a pin, pins the board does not have, built-in M5Stack screens and SPI TFTs (not wired automatically yet) are reported, never invented. Robotics Studio has a "Wire it in Circuit Studio" shortcut.
- OLEDs are powered from 3.3 V on 3.3 V boards, so the module's I²C pull-ups cannot put 5 V on the pins; on the Uno from 5V.
- New board: **M5Stack CoreS3 (ports)**: Port A G2/G1 (I²C), Port B G9/G8, Port C G17/G18, 5 V on each port (M5Stack CoreS3 PinMap).
- Default I²C pins from the Arduino core sources the exported firmware uses: Uno A4/A5 (UNO R3 datasheet), Pico GP4/GP5 (ArduinoCore-mbed RASPBERRY_PI_PICO variant), ESP32-S3 GPIO8/GPIO9 (arduino-esp32 esp32s3 variant).
- **Current budget** check: typical peak current of servos (0.65 A each), motors and OLEDs on each board supply pin vs what the pin can give; Info when slightly over (estimated values), Warning at more than double (e.g. two servos on a USB-powered Uno's 5V pin).
- **Fit** button and a placement fix: new parts go to a free spot that is fully visible, zooming out when nothing fits (a small window used to push parts under the side panels).
- Tested: 5 unit tests (Pico robot with 2 servos + OLED: OLED on 3V3/GP4/GP5 and no problems; Uno: OLED on 5V, servos on D9/D10; CoreS3 on Port C, missing pins reported; one undo step; budget warning). End-to-end: the Stack-chan practice robot's head servo (pin 6) wired onto an ESP32-S3: 3 parts, 4 wires, no problems detected; undo.

### Phase 4a (2026-11-08): AI core: tools, proposals, approval
- **Tools** (one zod schema each, also published as JSON schema for any AI provider or MCP): read `get_project` (compact project snapshot: 3D objects with sizes and bounding boxes, circuit with its check results, displays, robot), `check_circuit`, `list_catalog` (parts, boards and pins with their sources, displays, shapes); change `cad_add_shape`, `cad_update`, `cad_combine`, `cad_delete` (destructive), `circuit_add_part`, `circuit_connect`, `circuit_delete` (destructive), `display_set_face`, `robot_set_joint`, `notes_append`. Change tools use the same undoable commands as the buttons.
- **Proposals**: a change tool call never touches the project. It is tried on a copy; later calls in the same proposal see earlier ones (add a shape, then move it); the AI gets the new ids back and is told nothing is applied yet. The circuit checks run before and after, and new Danger / Warning findings travel with the proposal.
- **Approve** applies everything as one undo step labelled "AI: ..." (history author "ai"); if the owner changed the project meanwhile and the proposal no longer fits, it fails cleanly and nothing changes. **Reject** discards it.
- **Modes**, enforced in code: Observe and Assist can only read; only Create can propose changes.
- **AI panel**: mode buttons, approval requests (source, every change, delete flags, safety warnings, Approve / Reject), recent decisions, and what an assistant can read.
- Tested: 8 unit tests with a scripted AI (schemas, reading, proposals on a copy that build on each other, one-step apply and undo, modes refusing changes, bad input and missing objects, destructive flag, circuit safety warnings carried, approval failing cleanly after the owner's own edit). The panel is exercised end-to-end in 4c through the Claude Code connection.

### Doom handheld: play it in MakerStudio (2026-11-09)
- Circuit Studio shows **🎮 Play** when the circuit has an ESP32-S3-DevKitC-1 and an ILI9341 screen. The player shows the handheld (D-pad, A/B, Start/Select, Menu/Option) with the game on the realistic 320 × 240 TFT panel.
- **Only what is wired like retro-go's esp32-s3-devkit config works** (core/practice/doom.ts `doomWiring`, from the netlist): no screen wiring → "the screen stays dark"; no SD card wiring → "no game card"; each button works only if wired GPIO→button→GND (D-pad: pull-down + button to 3V3 / through 10 kΩ). Unit tests remove single wires and check that exactly that part stops working.
- It is a **preview**: the PC runs doom.wasm v0.1.0 (jacobenget, GPL-2.0, from id Software's released source; Doom shareware WAD built in), not the ESP32. The engine (4.6 MB) and Freedoom 0.13.0 (BSD-style; hash equals Freedoom's signed CHECKSUM) are downloaded on first use into the app's data folder and checked against pinned SHA-256 hashes; they are not part of MakerStudio. Own WADs (IWAD/PWAD, ≤ 64 MB) can be picked. No sound (this engine has none). Frames: 640 × 400 from the engine, averaged down to 320 × 200 and letterboxed, like on the 320 × 240 screen.
- E2E: from the Doom project, Play → all ten buttons live → shareware boots → Start/D-pad change the picture. Freedoom was booted offline from the verified download (engine reports "Freedoom: Phase 1", frames drawn, no errors; the engine warns Freedoom "might not work in this port"). The live download test was not run (blocked by the session's permission check).

### Phase 11 (2026-11-09): packaging, version 0.2.0
- `npm run dist:linux` → AppImage, .deb, .tar.gz; `npm run dist:arch` → Arch package from the tarball (packaging/arch: PKGBUILD template, desktop entry, MIME type, make-pkg.sh); `npm run dist:win` → NSIS installer (cross-built with wine).
- Verified: all 25 end-to-end tests pass against the AppImage itself; .deb control and contents checked (desktop entry, MIME, icon, binary, dependencies); Arch package built with makepkg and its contents checked. Not installed system-wide here (needs root).
- Windows: installer built (NSIS, unsigned, per-user, choose folder) but not run on real Windows; a silent install under wine aborted (exit 2), which says little either way. INSTALL.md says so.

### Phase 10 (2026-11-09): Advanced AI
- **Design check** (core/ai/design.ts): checks the studios against each other: robot joints whose child/parent objects are gone, joints without a servo pin, joints sharing a pin, joints whose servo signal is not wired to the board pin in Circuit Studio, mounted faces whose screen part is missing from the circuit (or cannot be checked yet), the circuit checks summary, and parts bigger than the printer's build volume or below the bed. Shown on the Projects page and available to every AI as the read tool `check_design`; the prompts tell the AI to run it after designing a robot.
- **Picture to design**: 📎 in the chat attaches a picture (picked in the app's own dialog, ≤ 5 MB; the window only gets a token). Claude API and OpenAI-compatible/Ollama get it as an image block; Claude Code gets it copied into MakerStudio's private chat folder with `--tools Read` and `Read(//<that folder>/**)` only. The prompts ask for an APPROXIMATE editable model with cad_build and one real measurement for scale.
- Live checks with the owner's Claude Code: it described the test sketch as "a simple mug with a handle"; asked to read /etc/hostname it was refused ("you haven't granted it"). Robot designs from a sentence use the existing tools (cad_build, circuit, joints) plus check_design; not separately benchmarked.

### Phase 7 (2026-11-09): Parts Library
- core/parts/library.ts: zod schema where **every spec has value + unit + source + status** (manufacturer, distributor, standard, measured, estimated, unknown); a value without a source fails validation, and unknown specs have no value. Built from the app's own sourced catalogs (boards' pin maps and supplies, display controllers, generic modules marked generic/estimated) plus standard hardware from ISO tables (bearings 608/623/625/688 per ISO 15, M2-M4 socket head cap screws per ISO 4762, nuts per ISO 4032). Board sizes not confirmed in a readable source are stored as unknown (Uno, Pico, ESP32-S3 DevKitC, CoreS3); XIAO from the Seeed wiki; Pico flash/SRAM checked on raspberrypi.com.
- Parts Library page: search (words across name, summary, interfaces), category filters, detail with the spec table and coloured status badges, sources; actions: Add to Circuit Studio, Design a face for it (displays), Add size block to 3D Studio (only when all three dimensions are known).
- Search is in memory (the roadmap planned SQLite; not needed at this size). No purchase links or CAD files yet: none were verified.

### Phase 6c (2026-11-09): Raspberry Pi Pico code in the simulator
- Same Code panel for a Pico: compiled with PlatformIO (`raspberrypi`, board `pico`, Arduino-mbed core) and the real flash image runs on rp2040js 1.4.1 (MIT) with the RP2040 boot ROM B1 (Raspberry Pi pico-bootrom, BSD-3-Clause, notice kept in core/circuit/rp2040/bootrom.ts). Serial is the Pico's own USB serial (rp2040js USB CDC). GPIO modes, PWM duty and pull-ups go to SPICE as for the Uno; voltages come back as digital levels (1.65 V threshold) and ADC counts on GP26-28 (0-3.3 V, 12-bit).
- Tests: real firmware (tests/fixtures/pico-test.cpp) boots, prints over USB serial, blinks GP15, PWM 25 % on GP16, pull-up button echo, analogRead(1.65 V) = 512. E2E: the default Pico Blink lights an LED in the circuit (> 4 mA, hand calc ≈ 5.5 mA) and turns it off again.

### Phase 6b (2026-11-09): Arduino Uno code in the simulator
- Circuit Studio has a **Code** panel for the Uno: write a sketch (stored in the project, one undo step per edit), **Run code** compiles it with PlatformIO (`atmelavr`, board `uno`; cached by content) and runs the real firmware on an emulated ATmega328P (avr8js 0.21.1, MIT) in a Web Worker in real time (timers → millis/delay/PWM, GPIO, USART → serial monitor, ADC → analogRead). Compile errors show with sketch line numbers.
- Bridge: emulated pins drive the SPICE circuit (outputs HIGH/LOW; **PWM as the duty-weighted average of a HIGH and a LOW solve**, the average current a real LED sees, exact for up to 3 PWM pins; inputs as inputs or with the chip's pull-up, modelled as 35 kΩ, ATmega328P datasheet range 20-50 kΩ); the solved voltages go back to the chip (digitalRead threshold 2.5 V, analogRead 0-5 V). Badge "Emulated Uno (avr8js) + SPICE"; the simulation panel shows each pin as HIGH / LOW / PWM n % / input.
- Checks use the running code's pin modes: "if it is used as an output" warnings are skipped for pins the code reads as inputs.
- Tests: emulator with real compiled firmware (tests/fixtures/uno-test.cpp): Serial output, D13 blink period, PWM 25 % from analogWrite(9, 64), pull-up button, analogRead(2.5 V) = 509-513; runs about 1.2× real time. E2E in the app: a sketch reads a button through the SPICE circuit and lights an LED at 12.5 mA, Serial shows pressed/released, no false warning.
- Limits (stated in the panel): no timing finer than about 16 ms is shown; only the Uno is emulated (Pico next; ESP32 cannot be emulated here).

### Doom handheld + Upload page (2026-11-08)
- **Doom handheld practice project** (core/practice/doom.ts): retro-go 1.46 (GPL-2.0, ducalex/retro-go) on an ESP32-S3-DevKitC-1 N16R8. The project opens with a **ready-wired circuit generated from retro-go's `targets/esp32-s3-devkit/config.h`** (screen MOSI 12 / SCK 48 / DC 47 / RST 3 / backlight 39, CS to GND; SD MISO 9 / MOSI 11 / CLK 13 / CS 10; I²S BCK 41 / WS 42 / DATA 40; buttons A15 B5 Start17 Select16 Menu18 Option8; D-pad as voltage levels on GPIO6/GPIO7), so the prebuilt `retro-go_1.46_esp32-s3-devkit.img` runs unchanged; a practice handheld case (placeholder sizes); a build plan (flash at 0x0, WADs in /roms/doom/). Tests: every pin matches the config, no Danger/Warning (one honest Note: amp peak vs USB 500 mA), D-pad voltages **simulated in ngspice** land in retro-go's ADC ranges (Up > 3.0 V, Down 1.4-1.9 V). Not built on real hardware.
- New circuit parts: TFT 2.8" ILI9341 module (with touch pins), microSD module (3.3 V), MAX98357A I²S amplifier, speaker. Practice projects can now include a wired circuit.
- **Upload page** (Ctrl+9; Settings moved to Ctrl+0): lists real USB boards (pio device list, built-in serial ports filtered out), **flashes a firmware image** with PlatformIO's esptool, **builds and uploads a PlatformIO project** (e.g. Display/Robotics exports), and a **serial monitor** with send (pyserial from PlatformIO's Python). File paths only come from the app's own file pickers; ports are validated. Live-tested without a board: tools found, no false ports, a real build ran then failed cleanly at upload, esptool output streamed, the monitor read a pseudo-terminal "board". Not yet tried with a real board plugged in.

### XIAO ESP32-S3 Sense (2026-11-08)
- Board in Circuit Studio (`xiao-esp32s3-sense`): pins from the Seeed wiki pin map and the arduino-esp32 `XIAO_ESP32S3/pins_arduino.h` (both agree; physical order is the standard XIAO footprint), 3V3 output 700 mA (Seeed), I²C D4/D5, logic 3.3 V marked estimated (not stated on the page). Realistic drawing: black PCB, castellated pads, shield, USB-C, Sense camera module with lens. Robot auto-wiring offers it.
- Firmware target "Seeed XIAO ESP32-S3 (Sense)" (PlatformIO `seeed_xiao_esp32s3`, verified locally): SSD1306 and GC9A01 face exports **compiled with pio** (RAM 7.3 % / 6.9 %, flash 9.9 % / 9.2 %). Not uploaded to a real board.
- 8 practice projects (hello/blink, Wi-Fi camera, time-lapse to SD, OLED face, round eye, sound-reactive face, motion camera, desk buddy) with build plans pointing at code that exists in the installed core (CameraWebServer with CAMERA_MODEL_XIAO_ESP32S3, ESP_I2S PDM, SD) and practice cases at the board's real size.
- AI-drawn wires are colour-coded like hand-drawn ones (power red, ground grey).

### Phase 6a (2026-11-08): SPICE simulation
- **Power on** in Circuit Studio runs the circuit through ngspice (eecircuit-engine 1.9.0, MIT; ngspice BSD-3) in a Web Worker: DC operating point, re-run on every change. Badge "Simulated (SPICE · ngspice)"; a Danger finding needs confirming before power on.
- core/circuit/spice.ts builds the netlist from the same connections as the checks (wires, breadboard strips, plugged legs). Models are generic and documented (MODEL_NOTES): LEDs calibrated to the catalog Vf at 20 mA, 1N4148-class diode, textbook NPN/PNP/N-MOSFET, board supplies 0.5 Ω, GPIO HIGH/LOW behind 25 Ω, battery 0.1 Ω. Modules, servos, motors are listed as "not simulated".
- Simulation panel: every wired GPIO pin with HIGH / LOW / IN (what the code would do, until 6b emulates real firmware) and its current; every LED (and RGB / 7-segment channel) with its current; LEDs glow on the canvas by current; hovering a pin shows its voltage; the part inspector shows pin voltages.
- Tests (real ngspice): divider 9 V 1k/2k = 5.9998 V and 2.9999 mA exactly as hand calc; Uno pin HIGH → 220 Ω → red LED 11.5-13 mA (hand calc ≈ 12.4), LOW/IN off; each LED colour 20 mA at its Vf; NPN switch on/off; LED on a breadboard ≈ 7 mA (hand calc). E2E in the app: 12.5 mA lit, off when LOW. Not compared with the ngspice command line (not installed: `sudo pacman -S ngspice`).

### AI design, Claude Code chat, 3MF, model imports (2026-11-08)
- **Claude Code as the built-in AI** (Settings → AI providers → Claude Code): the chat runs the owner's installed `claude` (`-p`, stream-json) with their own login, restricted to MakerStudio's MCP tools (`--tools ""`, `--strict-mcp-config`, no settings/hooks), conversation kept with `--resume`. The MCP connection is switched on automatically; its token goes in a private 0600 config file, not the command line. Live test in the app: "make a small cute desk robot" → a 26-part proposal in about 40 s, approved and shown in 3D Studio.
- **`cad_build`**: one tool call builds a whole multi-part object (grouped, holes cut out), with coordinate rules and an example in its description; the chat and MCP instructions ask for real multi-part designs. Live on local models: qwen3.5:4b now builds a 12-part robot / 3-part mug (it used to add one box); qwen3.5:9b 4-14 parts but takes 3-5 minutes.
- **3MF import** (core/cad/threemf.ts): build items with component and item transforms (Bambu/Prusa project files), units. Used by the model import script; not yet wired into the 3D Studio import button.
- **Open a project by file** (double-click / `makerstudio-ai file.msproj`) and single instance: a second launch hands its file to the open window. (Before this, the file argument was ignored.)
- `scripts/import-models.ts`: turns folders of downloaded STL/OBJ/3MF into projects, one per model, parts laid out on a grid, big models split under 4.5 M triangles per project (first-fit), duplicate part names numbered.

### Circuit parts upgrade (2026-11-08)
- **Breadboards**: half (400 holes) and full (830 holes) with the real internal strips (5-hole columns a-e / f-j, 25/50-hole rails). Parts whose legs sit exactly in holes are plugged in (worked out from positions, no hidden wires); strips with something in them light up green. Empty strips do not count as connections.
- **Realistic artwork** for every part (original drawings, no logos): resistor colour bands computed from the value, ceramic capacitor codes, LED domes in their colour, boards with chips/USB/headers. Small parts use real lead spacing (0.1 inch grid) so they fit the holes; modules have their pins in a row along the bottom edge.
- **25 new parts** (Tinkercad-style): AA pack, coin cell, potentiometer, photoresistor, piezo buzzer, tilt switch, RGB LED, 7-segment display, NeoPixel ring, LCD 16×2 I²C, HC-SR04, PIR, TMP36, DHT11, soil moisture, IR receiver, MQ-2, joystick, keypad 4×4, relay, L298N, vibration motor, PNP, N-MOSFET. Specs are marked estimated (typical values) unless sourced.
- New checks: each RGB colour / 7-segment segment gets the LED current and direction checks; potentiometers are modelled as two resistors; new rule `signal-too-high` flags e.g. a 5 V HC-SR04 Echo into a 3.3 V pin.
- AI panel header shows the Claude Code connection and the chat provider separately.
- Tests: 10 new unit tests (hole counts, plugging incl. rotation, LED-on-breadboard current, RGB channels, potentiometer, 5 V into 3.3 V, all parts on-grid), e2e gallery placing every part through the MCP connection.

### Phase 4b (2026-11-08): built-in chat
- Chat in the AI panel (Ctrl+J): streams answers, shows each tool the AI used, Stop and New chat. Runs in the main process, so API keys never reach the window. Tool calls go through the same proposals as Claude Code (badge "AI chat"); the mode limits it the same way (Observe/Assist get only read tools).
- Settings → AI providers: **Ollama** (default, local, free; model list read from Ollama, status shown), **Claude** (Anthropic API key, model `claude-opus-5-5`, adaptive thinking, streaming, server-side refusal fallback `"default"`), **OpenAI-compatible** (address + model + key). Keys are stored encrypted in the system keyring (Electron safeStorage) and never shown again.
- Tested: e2e with a scripted provider (`MAKERSTUDIO_MOCK_AI=1`, test builds only): answer from the project, refused change in Assist, proposal + approve + undo in Create, settings card. Live test against the owner's Ollama with qwen3.5:4b (`OLLAMA_LIVE=1 npx vitest run tests/live --config vitest.live.config.ts`): it read the project correctly and proposed exactly a 20 × 20 × 10 mm "Test cube" without applying it. Claude and OpenAI providers are not tested against the real services (no key here).

### Phase 4c (2026-11-08): Claude Code connection (MCP)
- **Settings → Claude Code connection**: off by default. Turning it on starts a local MCP server (Streamable HTTP, `@modelcontextprotocol/sdk` 1.32.2, MIT) on `127.0.0.1` (port 47219 by default) and makes a random 256-bit token. The card shows the status, the number of tool calls, and the one command to run: `claude mcp add --transport http --scope user makerstudio http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"` (syntax checked against `claude mcp add --help`). "New token" cuts off old connections.
- Locked down: localhost only; every request needs the token (constant-time compare); requests with a browser `Origin` or another `Host` are refused (no access from web pages / DNS rebinding); 4 MB request limit.
- Claude Code gets the same tools as the in-app assistant, with server instructions: change tools only propose; never say a change was made before approval; use the catalog for specs; never call a design safe. Tool calls are answered by the window, so Claude Code's proposals land in the AI panel ("Claude Code" badge) with the same Approve / Reject, safety warnings and one-step undo. The AI mode applies to it too (Assist by default: read-only).
- Uses the owner's own Claude Code login. MakerStudio itself does not log in to Claude (see AI_ARCHITECTURE §7).
- Tested end-to-end with the official MCP client against the dev and the packaged app: settings show the server and command; no token / wrong token → 401, browser origin → 403; list tools; read the project; a change in Assist mode is refused; in Create mode it becomes a proposal in the panel without changing the project; Approve adds the box in 3D Studio; Ctrl+Z removes it; a rejected proposal leaves the notes unchanged.
- **Owner to do**: turn it on in Settings, run the command once, then ask Claude Code about the open project.

## What worked at the end of Phase 2

- Desktop app (Electron 45, React 19, TypeScript) with the dark emerald/teal theme.
- Navigation for all 9 workspaces (click or Ctrl+1…9). Workspaces not built yet say so and list what is planned.
- Collapsible AI panel (Ctrl+J) showing the real workspace context the AI will read. No AI connected yet.
- Project system: new, open, save, save as, duplicate, export copy, recent projects, `.msproj` file format (zip of JSON), design notes, change history and save revisions.
- Undo/redo for all project edits (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y), typing merged into one step.
- Unsaved-changes protection when creating/opening another project and when closing the window.
- Settings: grid, snapping, printer (Bambu Lab A1 defaults), secure key storage status, versions, shortcut list.
- Secure key storage backend (OS keyring) ready for Phase 4.

## How it was tested (2026-11-08)

| Test | Result |
|---|---|
| `npm test`: file format round trip, damaged/unsafe/newer files, undo/redo, typing merge, save revisions, settings/recent storage | 16/16 pass |
| `npm run test:e2e`: drives the real app: all workspaces, AI panel, new → edit → undo/redo → save → restart → reopen | 3/3 pass |
| Same e2e tests against the packaged Linux build (`release/linux-unpacked`) | 3/3 pass |
| AppImage launches on Omarchy | Started and stayed running |
| `.deb` contents (control file, desktop entry, icon) | Inspected, correct |
| Windows NSIS installer | Built (unsigned) |
| Windows app under wine | Window opened and the interface loaded (needs `--no-sandbox` under wine only) |
| WebGL2 in app | Works on RTX 2070 SUPER |
| OS keyring encryption on Omarchy | Works (gnome_libsecret) after fix |

## Not yet verified

- Running the Windows installer on **real Windows 10/11** (wine is not real Windows).
- The `.deb` on a Debian/Ubuntu machine.
- Visual check of the wide layout: the test window was 960 px wide (tiled), which shows the compact sidebar.

## Open questions for the owner

1. ~~What is "REA"?~~ Answered 2026-11-08: "reverse engineer". Plan: observe Tinkercad's behaviour in a browser session the owner logs into; no decompiling or copying (see `TINKERCAD_RESEARCH.md`).
2. App license (suggestion: MIT or Apache-2.0) before any public release.
3. ~~Windows for testing?~~ Answered 2026-11-08: owner has a Windows PC. Next: install `release/MakerStudio AI-0.1.0-win-x64.exe` there and run the Windows checklist below.
4. AI provider for Phase 4: owner wants to use Claude Code. Plan in `AI_ARCHITECTURE.md` §7.
5. Windows testing: postponed by the owner on 2026-11-08 ("Linux for now"). The checklist below is kept for later.

## Windows test checklist (real Windows 10/11)

1. Installer runs (SmartScreen warns because it is unsigned: "More info" → "Run anyway").
2. App opens from the Start menu and desktop shortcut.
3. Click every workspace; Ctrl+1…9 and Ctrl+J work.
4. New project → type notes → Ctrl+Z / Ctrl+Shift+Z → Ctrl+S saves to Documents\MakerStudio.
5. Close and reopen the app; reopen the project from Recent; notes are back.
6. Double-clicking a `.msproj` file opens MakerStudio.
7. Settings → AI providers shows "Secure key storage: available (windows-dpapi)".
8. Copy a `.msproj` saved on Linux to Windows and open it (and the other way round).
