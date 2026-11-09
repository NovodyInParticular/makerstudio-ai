# Installing MakerStudio AI (0.2.0)

Build the packages with `npm run dist:linux` (AppImage, .deb, .tar.gz), `npm run dist:arch` (Arch package) and `npm run dist:win` (Windows installer). They land in `release/` (Arch: `packaging/arch/build/`).

## Linux

| You use | Install | Remove |
|---|---|---|
| Arch / Omarchy | `sudo pacman -U packaging/arch/build/makerstudio-ai-0.2.0-1-x86_64.pkg.tar.zst` | `sudo pacman -R makerstudio-ai` |
| Debian / Ubuntu | `sudo apt install ./release/MakerStudio\ AI-0.2.0-linux-amd64.deb` | `sudo apt remove makerstudio-ai` |
| Anything else | make `release/MakerStudio AI-0.2.0-linux-x86_64.AppImage` executable and run it | delete the file |
| Just this user, no root | `scripts/install-desktop.sh` (copy in `~/.local/share`, menu entry, `.msproj` type) | `scripts/install-desktop.sh --remove` |

Every package adds "MakerStudio AI" to the app menu, the `makerstudio-ai` command and the `.msproj` file type (double-click opens the project). Projects live in `~/Documents/MakerStudio` and are never removed by uninstalling.

## Windows

Run `MakerStudio AI-0.2.0-win-x64.exe`. It is **not code-signed**, so Windows SmartScreen will warn ("More info" → "Run anyway"). It installs for the current user and lets you choose the folder.

**Not tested on real Windows yet.** It was built on Linux (electron-builder + wine); a silent install under wine aborted (NSIS exit code 2), which is not a reliable sign either way. Try it on a Windows PC or VM before sharing it.

## Optional tools (MakerStudio works without them)

| Tool | What it adds |
|---|---|
| PlatformIO (`pipx install platformio` / `uv tool install platformio`) | Compiling code: running Uno and Pico code in the simulator, the Upload page |
| Claude Code (`claude`, logged in) | The best built-in AI (Settings → AI providers → Claude Code) |
| Ollama | Free local AI chat |
| Bambu Studio | "Open in Bambu Studio" for prints |
| Serial port access | Linux: be in the `uucp` (Arch) or `dialout` (Debian/Ubuntu) group to upload to boards |

## What was tested

- The whole end-to-end suite (25 tests) runs against the **AppImage** and passes.
- The .deb and the Arch package were built and their contents checked (app, command, menu entry, file type, icon); they were not installed here (needs root).
- The Windows installer was built but not run on Windows.
