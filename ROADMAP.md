# Roadmap

Each phase ends with tests, a `BUILD_STATUS.md` update, a git commit, and **owner approval** before the next phase starts. Sizes are rough relative estimates, not promises.

## Phase 1 — Research and Architecture ✅ (approved 2026-11-08)
- Inspect environment, check REA, research libraries/licenses, write all documentation, list risks.

## Phase 2 — Desktop Foundation (size: M) ✅ approved 2026-11-08
- Electron + Vite + React + TypeScript scaffold; dark charcoal / emerald-teal theme.
- Left navigation with the 9 workspaces (empty states that honestly say "coming in Phase N").
- Collapsible AI panel shell (no AI yet).
- Command/undo/redo core and document store.
- Project system: new, save, open, duplicate, export `.msproj`, recent projects, notes, revision history.
- Settings storage (SQLite) and OS-keychain storage for secrets.
- Linux AppImage + Windows NSIS test builds produced early to catch packaging problems.
- **Acceptance:** app launches on Omarchy and in Windows (wine smoke test, then real Windows if available); project round-trip test; undo/redo unit tests.

## Phase 3 — 3D Modeling (size: XL, split into 3a–3d) — 3a ✅ 3b ✅ 3c ✅ 3d ✅ (2026-11-08)
- 3a Viewport: perspective/ortho, orbit/pan/zoom, grid, snapping, selection, view cube.
- 3b Primitives (cube, sphere, cylinder, cone, torus, wedge, text) in the CAD worker; transform gizmo + typed dimensions; duplicate, group/ungroup, align, hierarchy panel.
- 3c Booleans (union, subtract, intersect, hole flag) with replicad; manifold-3d for imported meshes; measurement tool.
- 3d Import/export: STL, OBJ, STEP; Bambu A1 print-prep (build volume 256×256×256, bed placement, orientation, scale, wall/overhang warnings, multi-part export, "open in Bambu Studio" if installed).
- **Acceptance:** exported STL is watertight (checked by manifold-3d) and opens in a slicer; STEP round-trip test; Boolean regression suite.

> **Order changed by the owner on 2026-11-08 ("desk-robot track first"):** the goal is a
> Stack-chan-like desk robot with a screen face that can be programmed and seen coming alive
> in the app. Order from now on: **Phase 8 Display Studio → Phase 9 Robotics Studio (with
> behaviour programming and live preview) → Phase 5 Circuit Studio → Phase 4 AI → 6 → 7 → 10 → 11.**
> ESP32 (M5Stack) firmware cannot be emulated (see Phase 6), so "coming alive" in the app is a
> behaviour preview run by MakerStudio itself; the same behaviour is exported to run on the robot.

## Phase 4 — AI Context Engine (size: L)
- Provider layer: Anthropic, OpenAI-compatible, Ollama. Settings UI, connection test.
- Context engine: structured snapshot of the active workspace and selection.
- Tool registry mapping AI tool calls to commands; preview (ghosted), approve, reject, undo; AI changes recorded in history.
- Observe / Assist / Create modes; optional screenshot with explicit permission.
- **Acceptance:** scripted tests with a mock provider; live test with local Ollama; live Claude test when a key is provided.

## Phase 5 — Circuit Studio (size: L)
- Breadboard canvas, power rails, components (resistor, LED, capacitor, diode, transistor, button, switch, sensors, motors, drivers, batteries), wiring, labels.
- Boards: ESP32, ESP32-S3, XIAO ESP32-S3 Sense, Arduino Uno, Nano, Raspberry Pi, Pico — pinouts from manufacturer documents only.
- Netlist model and validation rules (`SAFETY_REQUIREMENTS.md`).
- **Acceptance:** rule unit tests with known-bad circuits (short, reversed LED, missing ground, 5 V into 3.3 V GPIO).

## Phase 6 — Simulation (size: L)
- Netlist → ngspice via eecircuit-engine: DC operating point, transient; virtual multimeter; LEDs lit from computed current.
- Uno/Nano via avr8js and Pico via rp2040js running compiled firmware (PlatformIO compile step).
- ESP32: documented limitation; visual-only demo clearly labelled, or deferred.
- **Acceptance:** results compared with hand calculations and with ngspice CLI on reference circuits.

## Phase 7 — Parts Library (size: L, ongoing)
- Catalog schema + SQLite index + search UI; seed set of verified parts (see `PARTS_LIBRARY.md`).
- Each spec carries a source and a verification status; CAD model links only when they actually exist.
- **Acceptance:** schema validation over the whole catalog; no part without a source on any spec.

## Phase 8 — Display Studio (size: M)
- Display catalog (SSD1306, SH1106, ST7789, ILI9341, …), pixel-accurate preview at real resolution.
- Editor for faces/eyes/status screens/menus; animation timeline.
- Export: bitmap headers + example code (U8g2 / Adafruit GFX / TFT_eSPI / LVGL) per board.
- **Acceptance:** generated examples compile with PlatformIO for ESP32-S3, Uno and Pico.

## Phase 9 — Robotics Studio (size: XL)
- Place catalog parts in 3D using their dimensions; mounting-hole snapping.
- Generate chassis/brackets around parts; interference and clearance checks.
- Wiring plan from the circuit; power budget; BOM export (CSV/Markdown).
- **Added 2026-11-08 (owner):** joints (servos) on 3D parts; behaviour programming (blocks and/or a small script: face moods, looking around, reacting) with a live preview that animates the screen face and moves the servos in the 3D view; export of the behaviour as firmware code for the real board (first target: M5Stack Stack-chan style desk robot).
- **Acceptance:** the Smart Dummy 13 / ESP32 rover examples build end-to-end with no false "safe" claims.

## Phase 10 — Advanced AI (size: L)
- Image-to-design (reference image → approximate editable geometry, always asking for dimensions).
- Robot design proposals from a sentence, compatibility diagnostics across mechanical + electrical.

## Phase 11 — Packaging and Testing (size: M)
- Signed-or-unsigned Windows NSIS installer, AppImage, .deb, Arch PKGBUILD; install docs; testing on real Windows.

## Technical risks and difficult features

| Risk | Impact | Mitigation |
|---|---|---|
| OCCT WASM size (~10–20 MB) and memory | Slow startup | Load in a worker after UI shows; cache |
| Boolean edge cases (coplanar faces, tiny slivers) | Failed or broken solids | B-rep kernel for authored parts, manifold-3d for meshes, regression suite, clear error messages |
| Parametric history + undo + AI previews interacting | Complex bugs | One command/patch system for everything (ARCHITECTURE §7) |
| ESP32 emulation | No permissive JS emulator; AGPL options only | Simulate the analog circuit with SPICE; label ESP32 firmware simulation as not supported until a compatible option exists |
| Breadboard editor | No reusable library | Custom build; keep scope tight in Phase 5 |
| Accurate parts data | Wrong specs could damage real hardware | Every value sourced and marked verified/estimated; no invented data |
| Manufacturer CAD licensing | Some STEP files cannot be redistributed | Link instead of bundle |
| AI reliability | Wrong geometry or unsafe advice | Schema-validated tools, preview/approve, safety engine runs on every AI change |
| Image-to-design accuracy | Images have no scale | Always labelled "approximate"; ask for reference dimensions |
| Windows testing from Linux | wine is not real Windows | Use a Windows machine/VM or GitHub Actions Windows runner before release |
| Scope (this is several products) | Never finishing | Strict phases; each phase useful on its own |
