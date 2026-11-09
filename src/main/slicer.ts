// Finds Bambu Studio on this computer and opens exported parts in it.
//
// Only a fixed list of known install locations is used (plus the MAKERSTUDIO_SLICER override
// that tests use); the interface cannot choose which program is started.

import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { SlicerStatus } from "../shared/ipc";

interface Launcher {
  command: string;
  args: string[];
  label: string;
}

async function executable(file: string): Promise<boolean> {
  try {
    const info = await fs.stat(file);
    if (!info.isFile()) return false;
    await fs.access(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function onPath(names: string[]): Promise<string | null> {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const file = path.join(dir, name);
      if (await executable(file)) return file;
    }
  }
  return null;
}

async function flatpakInstalled(appId: string): Promise<boolean> {
  const roots = ["/var/lib/flatpak/app", path.join(process.env.HOME ?? "", ".local/share/flatpak/app")];
  for (const root of roots) {
    if (await fs.stat(path.join(root, appId)).then(() => true, () => false)) return true;
  }
  return false;
}

async function findLauncher(): Promise<Launcher | null> {
  const override = process.env.MAKERSTUDIO_SLICER;
  if (override) return (await executable(override)) ? { command: override, args: [], label: override } : null;

  if (process.platform === "win32") {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")];
    for (const root of roots) {
      if (!root) continue;
      const file = path.join(root, "Bambu Studio", "bambu-studio.exe");
      if (await executable(file)) return { command: file, args: [], label: file };
    }
    return null;
  }
  if (process.platform === "darwin") {
    const file = "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio";
    return (await executable(file)) ? { command: file, args: [], label: file } : null;
  }
  const found = await onPath(["bambu-studio", "BambuStudio", "bambustudio"]);
  if (found) return { command: found, args: [], label: found };
  for (const file of ["/opt/bambu-studio/bin/bambu-studio", "/opt/bambustudio-bin/bambu-studio"]) {
    if (await executable(file)) return { command: file, args: [], label: file };
  }
  if (await flatpakInstalled("com.bambulab.BambuStudio")) {
    const flatpak = await onPath(["flatpak"]);
    if (flatpak) return { command: flatpak, args: ["run", "com.bambulab.BambuStudio"], label: "Bambu Studio (Flatpak)" };
  }
  return null;
}

export async function slicerStatus(): Promise<SlicerStatus> {
  const launcher = await findLauncher();
  return launcher ? { found: true, name: "Bambu Studio", location: launcher.label } : { found: false, name: "Bambu Studio", location: null };
}

/** Starts the slicer with the given files and does not wait for it. */
export async function openInSlicer(files: string[]): Promise<void> {
  const launcher = await findLauncher();
  if (!launcher) throw new Error("Bambu Studio was not found on this computer. Install it from bambulab.com, or export the parts and open them in your slicer yourself.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launcher.command, [...launcher.args, ...files], { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (error) => reject(new Error(`Bambu Studio could not be started: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
