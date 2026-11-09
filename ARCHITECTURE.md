# Architecture

Status: Phase 2 foundation implemented (2026-11-08); later layers still proposed. Versions and licenses below were checked with `npm view` / `pacman -Si` on 2026-11-08.

## 1. Environment inspected (2026-11-08)

| Tool | Found | Notes |
|---|---|---|
| Node.js / npm | v26.12.0 / 12.2.1 | Good for Vite + Electron tooling |
| Electron (system) | v44.9.3 | The project will pin its own Electron via npm instead (current: 45.2.3) |
| Python / uv | 3.14.8 / 0.13.4 | For optional Python services |
| git | 2.56.0 | |
| gcc / cmake / make | 16.2.1 / 4.4.4 / 4.4.1 | Needed for native npm modules (better-sqlite3) |
| Docker / Podman | 29.9.2 / 6.1.4 | Possible for reproducible Windows builds |
| wine | 11.20 | Lets electron-builder build/test the Windows NSIS installer from Linux |
| makepkg / fakeroot | 7.1.0 / 1.37.2 | For an Arch/Omarchy package |
| PlatformIO | 6.2.0 | Can compile example firmware for ESP32/Arduino/Pico in tests |
| OpenSCAD | 2021.01 | Old; not a planned dependency |
| Playwright / Chromium | 1.64.0 / 155 | UI end-to-end tests for Electron |
| Ollama | installed, with qwen3.5:2b/4b/9b | Local AI provider for testing; no vision model installed yet |
| GPU | RTX 2070 SUPER, 31 GiB RAM, 8 cores | Fine for WebGL viewport and local 4–9B models |
| Missing | pnpm, rustc, ngspice, KiCad, FreeCAD, arduino-cli, appimagetool, dpkg-deb | None blocking. electron-builder downloads its own AppImage tooling and can build `.deb` with its bundled fpm |
| **REA** | **not found** | No `rea` command, package, pip/npm module or MCP server. See `TINKERCAD_RESEARCH.md` |

## 2. Recommended stack

| Layer | Choice | License | Why |
|---|---|---|---|
| Desktop shell | Electron 45 + electron-builder 26 | MIT / MIT | One codebase for Windows (.exe NSIS) and Linux (AppImage, .deb, pacman). Full Chromium means WebGL2 and WebAssembly work the same everywhere |
| UI | React 19 + TypeScript + Vite 8 | MIT / Apache-2.0 / MIT | Matches the brief; large ecosystem |
| State | Zustand 5 + Immer-style patches | MIT | Simple stores; patches give undo/redo and AI change previews |
| 3D viewport | three.js 0.187 + @react-three/fiber 9 + drei 10 + three-mesh-bvh | MIT | Fast picking, gizmos, ortho/perspective cameras |
| Solid modeling (B-rep) | replicad 1.2.1 on replicad-opencascadejs (OpenCascade/OCCT in WASM) | MIT (replicad) / LGPL-2.1 (OCCT WASM) | Real solids, fillets, chamfers, Booleans, **STEP import/export**. Runs in a Web Worker |
| Fast mesh Booleans | manifold-3d 3.5.4 | Apache-2.0 | Robust, guaranteed-manifold mesh Booleans for STL/OBJ imports and for fast previews |
| STEP import of vendor CAD | via replicad/OCCT | LGPL-2.1 | Manufacturer STEP models for parts |
| Circuit simulation | eecircuit-engine 1.9.0 (ngspice compiled to WASM) | MIT wrapper; ngspice is BSD-3-Clause | Real SPICE operating-point / transient analysis offline in the app |
| Microcontroller emulation | avr8js 0.21 (Uno/Nano), rp2040js 1.4 (Pico) | MIT / MIT | Real instruction-level emulation of compiled firmware. ESP32 has no comparable permissive JS emulator (see risks) |
| Schematic / breadboard editor | Custom SVG/Canvas editor in React; @xyflow/react 12 only for block/wiring diagrams | MIT | No maintained permissive breadboard-editor library exists |
| Local storage | Phase 2: small JSON files in the user-data folder (settings, recent projects), written atomically. Phase 7: Node's built-in `node:sqlite` (Electron 45 ships Node 24) for the parts catalog | — | No native module to rebuild per platform; better-sqlite3 kept as fallback |
| Project files | `.msproj` = zip of JSON + binary assets (see §5) | — | Portable between Windows and Linux |
| Project zip | fflate 0.8 | MIT | Fast zip in pure JS; works in main, renderer and tests |
| Undo/redo patches | immer 11 | MIT | Records every command as forward/inverse patches |
| AI SDKs | @anthropic-ai/sdk 1.6, openai 7.53 (also used for Ollama's OpenAI-compatible API) | Apache-2.0 | Provider abstraction in `AI_ARCHITECTURE.md` |
| Schemas | zod 4 | MIT | Validate every AI tool call and every file loaded |
| Tests | Vitest, Playwright (Electron), PlatformIO for firmware examples | MIT / Apache-2.0 | |

### Rejected or deferred

- **opencascade.js 1.1.1 directly**: last stable release 2023; replicad ships its own maintained build. The @taucad 3.0 beta fork is promising but still beta.
- **JSCAD (@jscad/modeling)**: MIT and active, but mesh/CSG based with no STEP. Kept as a fallback reference.
- **three-bvh-csg**: MIT, fast, but 0.0.x and not guaranteed manifold output; manifold-3d is the safer Boolean engine.
- **Falstad CircuitJS**: GPL-2.0, and a Java→JS codebase that is hard to embed. Not used.
- **Wokwi**: the hosted simulator is a commercial cloud service (no offline embedding). Its open MIT emulators (avr8js, rp2040js) are used directly instead.
- **Velxio**: AGPL-3.0; would force the whole app to AGPL. Not used.
- **Python CAD services (CadQuery/build123d)**: not needed while replicad covers B-rep in-process. Python stays optional (possible later use: heavy mesh repair, image processing).
- **Tauri**: smaller binaries, but WebKitGTK on Linux has uneven WebGL/WASM-thread behavior; Electron is the lower-risk choice for a CAD viewport.

## 3. Process layout

```
Electron main process (Node)
  ├─ file system, project save/load, SQLite (parts, settings, history)
  ├─ AI provider calls (API keys never reach the renderer)
  ├─ OS keychain via Electron safeStorage for keys
  └─ IPC API (typed, validated with zod)

Renderer (React UI)
  ├─ Workspaces: Home, 3D Studio, Circuit Studio, Robotics Studio, Parts Library,
  │              Display Studio, AI Engineer, Projects, Settings
  ├─ Document store (Zustand): one project document, patch-based undo/redo
  └─ AI panel (persistent, collapsible)

Web Workers (keep the UI responsive)
  ├─ cad-worker:   replicad/OCCT B-rep kernel, STEP/STL export, tessellation
  ├─ mesh-worker:  manifold-3d Booleans, STL/OBJ import, print checks
  ├─ spice-worker: eecircuit-engine (ngspice WASM)
  └─ mcu-worker:   avr8js / rp2040js emulation
```

## 4. Licensing policy

- Allowed: MIT, BSD, Apache-2.0, ISC, MPL-2.0, and **LGPL-2.1** for separately loaded WASM modules (OCCT). LGPL obligations: ship the OCCT license text, keep the WASM as a replaceable separate file, link to its source.
- Not allowed in the app: GPL or AGPL code (would change the license of the whole app).
- Parts data: KiCad libraries are CC-BY-SA 4.0 (with a design-use exception); Fritzing parts are CC-BY-SA 3.0. Any imported data keeps attribution and its share-alike license in `parts/LICENSES/`. Manufacturer CAD files are linked, not redistributed, unless the license allows redistribution.
- The app's own license is the owner's decision (suggestion: MIT or Apache-2.0) and must be set before the repo goes public.

## 5. Project file format (`.msproj`)

A zip archive containing:

```
manifest.json        format version, app version, created/modified, units = mm
document.json        scene tree (parametric feature history per object), circuits, assemblies, displays
history.json         revision log (including AI-authored changes and who approved them)
notes.md             design notes
ai/conversations/*.json
assets/              imported STL/OBJ/STEP, reference images, display bitmaps
cache/               optional tessellated meshes (can be regenerated, safe to delete)
```

- Units are always millimetres internally; paths stored with `/`; UTF-8; no absolute paths. This makes files portable between Windows and Linux.
- Each format version has a migration function; loading is validated with zod and errors name the broken field.

## 6. Source layout (planned for Phase 2)

```
apps/desktop/        Electron main + preload
src/app/             shell, navigation, theme
src/workspaces/      one folder per workspace
src/core/document/   document model, commands, undo/redo, history
src/core/cad/        CAD command layer + worker clients
src/core/circuit/    netlist model, validation, SPICE export
src/core/parts/      catalog access
src/core/ai/         context engine, tool registry, providers
src/core/safety/     rule engine shared by circuit + robotics
workers/             cad, mesh, spice, mcu
parts/               catalog source data (JSON) + license files
tests/               unit, integration, e2e
```

## 7. Key design decision: commands

Every change to a project — from a mouse drag, a menu, or the AI — is a **command** (`{type, params}`) applied to the document. Commands produce patches. This single mechanism gives undo/redo, revision history, AI previews (apply patches to a copy and render it ghosted), and approval (only commit the patches when the user accepts).

## 8. Phase 2 implementation notes

- **Build**: Vite builds the interface to `dist/renderer`; esbuild bundles `src/main/main.ts` and `preload.ts` to `dist/main`. `npm run dev` gives live reload.
- **Security**: renderer runs with `contextIsolation`, `sandbox` and no Node access; a strict Content-Security-Policy; external links open in the system browser; navigation away from the app is blocked.
- **Shortcuts** are handled in the renderer so they work with the menu bar hidden (Alt shows it). Menu items show the same shortcuts without registering them twice.
- **Keyring on Omarchy/Hyprland**: Electron does not recognise Hyprland, so it chose weak `basic_text` storage. The app now passes `--password-store=gnome-libsecret` on Linux (override with `MAKERSTUDIO_PASSWORD_STORE`). Verified 2026-11-08: backend `gnome_libsecret`, encrypt/decrypt round trip OK with gnome-keyring. Settings shows a warning if no keyring is available.
- **WebGL check** (for Phase 3): WebGL2 works in the app on the RTX 2070 SUPER through ANGLE/OpenGL ES 3.2.

## 9. Building installers

```bash
npm run dist:linux     # AppImage + .deb in release/
npm run dist:win       # Windows NSIS installer (built on Linux via wine)
```

Known problem (2026-11-08): GitHub release downloads intermittently answered 504. Workarounds used:
- `ELECTRON_BUILDER_7ZIP_PATH=/usr/bin/7za` uses the system 7-Zip instead of downloading it.
- `-c.electronDist=<folder>` uses a locally extracted Electron zip whose SHA-256 was checked against `node_modules/electron/checksums.json`.
- Retrying usually succeeds.

## STEP engine in a worker (2026-11-08)

The replicad OpenCascade WebAssembly build uses JavaScript `eval` in its generated bindings.
The window's Content Security Policy (`src/renderer/index.html`) does not allow `unsafe-eval`
and must keep not allowing it. OCCT therefore runs in `src/renderer/cad/step.worker.ts`, a
module Web Worker loaded from the app's own files, which has its own (empty) policy. The
worker is started on first STEP use. Only bundled app code runs in it.

Packaging: `electron-builder.yml` excludes `node_modules/**`; all runtime code is bundled into
`dist/`. If a future main-process dependency must stay external, add it back explicitly.
