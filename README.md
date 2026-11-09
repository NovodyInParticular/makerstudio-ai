# MakerStudio AI

Your AI-powered engineering and robotics workshop. Desktop app for Windows and Linux.

Current state: **Phase 3b (3D Studio basics)**. Linux first; Windows testing later. See `BUILD_STATUS.md` for what works and `ROADMAP.md` for what comes next.

## Run it

```bash
npm install          # first time only
npm start            # build and launch
npm run dev          # development mode with live reload
```

## Test it

```bash
npm test             # unit tests
npm run test:e2e     # drives the real app window (a window opens briefly)
npm run typecheck
```

## Build installers

```bash
npm run dist:linux   # release/*.AppImage and release/*.deb
npm run dist:win     # release/*.exe (Windows installer, built with wine)
```

If downloads from GitHub fail with "504", see `ARCHITECTURE.md` §9.

## Where things live

| Path | What |
|---|---|
| `src/main/` | Desktop process: windows, files, settings, key storage |
| `src/renderer/` | User interface (React) |
| `src/core/` | Shared logic without UI (commands, undo/redo) |
| `src/shared/` | Project file format and the UI ↔ desktop API |
| `tests/` | Unit and end-to-end tests |
| Projects | Saved by default in `Documents/MakerStudio/*.msproj` |
| Settings | Electron user-data folder (`~/.config/MakerStudio AI` on Linux, `%APPDATA%\MakerStudio AI` on Windows) |

## Install on this computer (Linux)

    scripts/install-desktop.sh            # build, install, add "MakerStudio AI" to the app menu
    scripts/install-desktop.sh --remove   # uninstall (projects in ~/Documents/MakerStudio stay)

Installs a copy of the packaged app in `~/.local/share/makerstudio-ai`, a menu entry with its icon,
a `makerstudio-ai` command, and the `.msproj` file type (double-click a project to open it).
Run it again after updating to install the new build.
