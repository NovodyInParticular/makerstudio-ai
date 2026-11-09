# Changelog

## 2026-11-09 — Options: zoom, 3MF, drone wiring, AI drone tools, brushless, real height hold
- **Interface size**: Settings, or Ctrl+= / Ctrl+− / Ctrl+Shift+0; remembered.
- **3MF import** in 3D Studio (button and drag and drop): every object, in place.
- **Wire my drone** (Drone Studio → Drone code): board, LiPo, IMU, optional height sensor, and per motor a MOSFET with pull-down and diode, or an ESC and brushless motor; clean checks.
- **AI tools** for the Drone Studio: drone_check, drone_start, drone_update (changes wait for approval).
- **Bigger drones**: brushless ESC and brushless motor parts; motor type and "5-inch brushless" starting values (estimates); the drone code drives ESCs with 1000-2000 µs pulses, with ESC safety steps in the README.
- **Height hold on a real drone** with a VL53L1X distance sensor: the same height-hold law as the simulator (parity-tested), brakes then holds where it stopped; falls back to stabilize when the sensor has no reading. H in Fly it → Real drone.

## 2026-11-09 — Drone code for a real drone
- Drone Studio → **Drone code**: exports a PlatformIO project for the ESP32-S3-DevKitC-1 or XIAO ESP32-S3 that flies your design with the **same flight controller as the simulator** (a test compiles the C++ and compares it with the simulator step by step). MPU-6050 IMU, brushed motors on MOSFETs, Wi-Fi control. Not yet tested on a real drone; the README lists the propeller-off checks.
- Safety in the drone code: motors off at power-on; arms only calibrated, at zero throttle, nearly level and with a control signal; motors stop 0.5 s after the last control packet, when tipped past 70°, when the IMU fails, and (if measured) when the battery is empty; props-off motor test over serial.
- Fly it → **Real drone**: fly it from MakerStudio over the drone's Wi-Fi with the keyboard or a gamepad (throttle lever, arming only after the "propellers checked, area clear" box, X / Esc cut the motors, a final disarm on disconnect), with live telemetry.

## 2026-11-09 — Drone Studio
- New **Drone Studio** (after Robotics Studio in the sidebar). Start a design from your 3D Studio frame: motors are found from objects named "Motor…" (or placed as an X quad), the frame parts are picked automatically, and every part value that is a typical estimate is marked "est.".
- **Will it fly?**: exact frame weight, centre of mass and inertia from the solid shapes (× material density × fill), plus motors, propellers, battery and other parts; thrust-to-weight, hover throttle, whether the motors can hold it level, propeller clearance, estimated flight time, and a top view with the centre of mass.
- **Fly it**: 6-degree-of-freedom flight simulator of your design (motor lag, battery sag, drag, ground, crashes) with a stabilize flight controller and a height-hold mode; keyboard or gamepad; knock test; tunable PID.
- Ctrl+1…0 shortcuts are now fixed per workspace (adding a studio no longer renumbers them).

## 2026-11-09 — Drone parts
- Circuit Studio and Parts Library: brushed coreless motor (716 / 720 / 8520, 3.7 V), 1S LiPo battery (capacity and C rating; always shows its safety warning), MPU-6050 IMU module (GY-521, I²C 0x68 / 0x69, interrupt pin). Drawn as real parts; the safety checks cover them (motor on a GPIO pin, LiPo short).
- Parts Library: 55 mm and 65 mm micro drone propellers. Specs say where they come from (TDK InvenSense datasheet, ESP-Drone and Flix parts lists) and how sure they are.

## 2026-11-09 — Drone practice projects, bug fixes (round 4)
- Practice projects: three drones checked on GitHub — LiteWing (ESP32-S3, CC BY-NC-SA), ESP-Drone (Espressif; builds for ESP32-S3, GPL-3.0) and Flix (ESP32 / ESP32-S3, no license file: build for yourself). Each with a build plan, propeller and LiPo safety notes, and original practice shapes (mini quad frame, propeller guard, stand and battery holder).
- 3D Studio: switching a shape between hole and solid no longer detaches the move / rotate handles (three.js error).
- Home's "What works today" listed long-finished work as "Next"; it now lists what the app does. Old phase numbers removed from Settings and Robotics Studio.
- Circuit Studio: part names no longer overlap their own drawings; "Wire my robot" lays parts out with room for names and wires.

## 2026-11-09 — Full screen
- MakerStudio opens full screen the first time, and afterwards the way you left it (full screen, maximized or a window size).
- Full-screen button in the top bar; F11 also toggles it.

## 2026-11-09 — Bug fixes (round 3)
- Selecting a big imported mesh no longer freezes the window (9 s on a 4-million-triangle figure): the watertight / volume line is worked out in the background and remembered. Importing big STL / STEP files no longer blocks for the same check.
- Rebuilding a script part also rebuilds its copies (duplicates were left at the old size).
- Robot code and face code export now start on the board in Circuit Studio (an ESP32-S3 robot was offered as Arduino Uno code), and so does "Wire my robot".
- "Wire my robot" no longer places the OLED above the visible canvas, and Circuit Studio shows the whole circuit when a project opens.

## 2026-11-09 — Script parts (parametric Python part scripts)
- 3D Studio → Files → **Script part…**: open a Python part script with a `# === PARAMETERS ===` block (like the Smart Dummy 13 head, neck and torso). Every size shows as a field with the script's own comment and heading; computed sizes are shown, not edited.
- **Build and add** runs a temporary copy of the script with your changed sizes (in its own uv project when there is a pyproject.toml) and brings in the STL files it writes, lined up as the script made them. Files starting with "_" (helpers) are left out.
- Parts remember their script: select one → **Change sizes…** → **Rebuild** swaps the shapes in place (position, rotation and scale kept). One undo step.
- Safety: the script and its out folder are never written; MakerStudio asks before running a script (once per script per session); the AI cannot start a build.

## 2026-11-09 — AI Engineer page
- The AI Engineer workspace was still showing the old "planned for Phase 4" placeholder (and a P4 badge in the sidebar). It is now the working assistant at full size: chat as the main area, with mode, approval requests, project context and connections beside it. The side panel steps aside on this page.

## 2026-11-09 — Print check in the background, Save when quitting
- Check for printing, Orient and Bambu Studio export run in a background worker: the window keeps working during long checks of big imported figures.
- Quitting with unsaved changes now offers Save, Quit without saving, or Cancel (Save asks where for a new project and closes only when the save worked).

## 2026-11-09 — Bug fixes from testing with real projects
- Grouping or combining an imported mesh that is not watertight no longer blanks the window; it is refused with a message.
- Robotics Studio no longer blanks the window on projects with an open imported mesh.
- A page that hits an error now shows the message with "Try again" / "Go to Home" instead of an empty window.
- Big imported figures (millions of triangles): 3D Studio opens several times faster and reuses the model on later visits, Robotics Studio in under half a second, the wall-thickness check keeps to its ray budget, and long print checks show a "Checking…" message.
- Edits that could make a saved project unopenable are fixed (duplicate with repeated or bad input, align / group / drop next to an empty Intersect or a group of only holes, repeated ids in Combine, shapes put inside a non-group). The project now refuses any edit that would make the file invalid, and AI proposals are checked the same way.
- Validation errors read as one sentence instead of a JSON list.

## 2026-11-08 — Phase 4b: built-in AI chat
- Chat in the AI panel with Ollama (local, default), Claude (API key) or any OpenAI-compatible service; changes are proposals you approve.
- `scripts/install-desktop.sh`: app-menu entry, icon, `.msproj` file type.

## 2026-11-08 — Phase 4a + 4c: AI core and Claude Code connection
- AI tools over the existing commands, proposals tested on a copy with safety warnings, Approve/Reject in the AI panel, one-step undo, Observe/Assist/Create modes.
- Local MCP server (off by default, localhost, bearer token) so Claude Code can read the project and propose changes for approval.

## 2026-11-08 — Phase 5c: robot wiring and current budget
- "Wire my robot" builds servos, servo supply and OLED wiring from the Robotics Studio; M5Stack CoreS3 ports; default I²C pins from the Arduino core sources; current budget check; Fit view.

## 2026-11-08 — Phase 5b: Circuit Studio wiring canvas
- Wiring canvas with parts palette, pin-to-pin wires, pin info with sources, live checks with highlighted parts.

## 2026-11-08 — Phase 5a: circuit checks
- Circuit model, parts catalog, Uno R3 / Pico / ESP32-S3-DevKitC-1 boards from manufacturer documents, DC solver and electrical safety checks with acceptance tests.

## 2026-11-08 — Phase 9c: robot code export
- Export face + behaviour + servos as a PlatformIO project; C++ behaviour runner matches the preview (tested with g++); 4 robot builds compile.

## 2026-11-08 — Phase 9b: robot behaviours
- Step-list behaviours (mood, look, move joint, face animation, talk, blink, wait, repeat), run live on the 3D robot, with idle life and three ready-made behaviours.

## 2026-11-08 — Phase 9a: Robotics Studio joints and posing
- Joints between parts (axis, pivot, range, chains), live pose sliders, wiggle test, live faces mounted on the robot in 3D.

## 2026-11-08 — Phase 8c: robot code export
- Export a face and its animations as a PlatformIO project for M5Stack CoreS3/Core2, Uno, Nano, ESP32, ESP32-S3 and Pico with SSD1306/SH1106/ST7789/ILI9341/GC9A01 displays.
- C++ face engine draws the same pixels as the preview (tested with g++); all 7 sample projects compile with PlatformIO.

## 2026-11-08 — Phase 8b: face animation timeline
- Keyframe animations per face (mood, look, blink, talk) with easing, loop, scrub, drag, keyframe editor and four ready-made animations.

## 2026-11-08 — Phase 8a: Display Studio face designer
- Display catalog (M5Stack CoreS3/Core2, SSD1306, SH1106, GC9A01, ST7789, ILI9341) with sources.
- Face designer with presets, six moods, Alive (blink, look around) and Talk preview, pixel-accurate at real resolution.
- Screens saved and validated in the project file.

## 2026-11-08 — Practice projects
- Catalog of 11 verified open-source GitHub builds (incl. Stack-chan) with one-click practice projects (notes, build plan, starter shapes).
- Dialogs now appear above notifications; at most 4 notifications at once.

## 2026-11-08 — Phase 3d part 3: STEP
- Export STEP: exact solids (true curves, OCCT Booleans) where possible, faceted solids otherwise, named and coloured per part, mm.
- Import STEP / STP: every solid becomes a mesh object, units converted to mm.
- OpenCascade runs in a Web Worker, loaded on first use; window Content Security Policy unchanged.
- Packaged app no longer ships raw node_modules (app.asar 254 MB → 27 MB).

## 2026-11-08 — Phase 3d part 2: print preparation
- Print panel: Check for printing (build volume, bed placement, overhangs, thin walls, bed contact), Orient for printing (undoable), open parts in Bambu Studio.
- Overhang and thin-wall areas highlighted in the viewport.
- Settings printer (Bambu Lab A1 by default) drives the build volume and nozzle size.
- Tests can redirect the Documents folder (`MAKERSTUDIO_DOCUMENTS`) and the slicer program (`MAKERSTUDIO_SLICER`).

## 2026-11-08 — Phase 3d part 1: STL / OBJ import and export
- Import STL / OBJ (button or drag and drop), meshes stored in the project, unit conversion buttons.
- Export STL / OBJ as one file or one STL per part, through the solid engine (watertight output).

## 2026-11-08 — Phase 3c: Booleans, text, measure, workplane
- Union / Subtract / Intersect, real hole cutting (manifold-3d), text shape, measure and workplane tools.

## 2026-11-08 — Phase 3a + 3b: 3D viewport and modeling basics
- 3D Studio with three.js / react-three-fiber: Bambu A1 bed and grid, Z-up camera, perspective/orthographic, view presets, fit.
- Primitives: box, sphere, cylinder, cone, torus, wedge (bottom-centre origin, sit on the bed).
- Selection, object list, move/rotate/scale gizmo with snapping, exact typed values, size readout.
- Commands: add, delete, transform, resize (validated), properties, duplicate, group/ungroup, align, drop to bed, nudge.
- Exact world bounding boxes from real vertices (alignment is exact for rotated round shapes).
- Project files now validate 3D objects.
- Fixes found by looking at screenshots: camera started top-down, heavy black shadows, missing edge lines.

## 2026-11-08 — Phase 2: Desktop foundation
- Electron 45 + React 19 + TypeScript + Vite 8 app with dark emerald/teal theme.
- Navigation for 9 workspaces, honest "planned for Phase N" pages for unbuilt ones.
- Persistent, collapsible AI panel showing live workspace context (no AI yet).
- Command system with undo/redo (immer patches), change history and save revisions.
- `.msproj` project format v1 (zip: manifest, document, history, notes, AI conversations, assets) with validation and safe-path checks.
- New / open / save / save as / duplicate / export / recent projects; unsaved-changes prompts.
- Settings (grid, snap, printer with Bambu Lab A1 defaults) and OS-keyring secret storage; fixed weak key storage on Hyprland by selecting libsecret.
- Keyboard shortcuts for all project actions and workspace switching.
- Unit tests (Vitest) and end-to-end tests that drive the real Electron app (Playwright).
- Test builds: Linux AppImage, .deb, Windows NSIS installer.

## 2026-11-08 — Phase 1
- Created project folder and git repository.
- Inspected the Omarchy development environment (tools, GPU, Ollama models).
- Checked for REA: not available.
- Researched and license-checked CAD, mesh, simulation, emulation, UI and AI libraries.
- Added PROJECT, ARCHITECTURE, TINKERCAD_RESEARCH, ROADMAP, BUILD_STATUS, CHANGELOG, PARTS_LIBRARY, AI_ARCHITECTURE and SAFETY_REQUIREMENTS documents.
