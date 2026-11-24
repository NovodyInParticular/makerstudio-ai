// SD cards (and USB sticks) for printing from the card: find the ones that are plugged in,
// copy a sliced file onto one, and eject it safely.
//
// Linux: `lsblk` lists the drives (the desktop mounts a card when it is plugged in) and
// `udisksctl` ejects. Windows: removable drive letters from PowerShell; ejecting is left to the
// system tray. Only fixed programs are started, and a card is only ever written to when it is
// in the list the system reports at that moment.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { RemovableDrive } from "../shared/ipc";

const run = promisify(execFile);

interface LsblkNode {
  name?: string;
  path?: string;
  rm?: boolean | string | number;
  hotplug?: boolean | string | number;
  tran?: string | null;
  fstype?: string | null;
  label?: string | null;
  size?: number | string | null;
  fsavail?: number | string | null;
  mountpoints?: (string | null)[];
  mountpoint?: string | null;
  children?: LsblkNode[];
}

/** A drive as found on Linux, with the device names needed to eject it. */
export interface LinuxDrive extends RemovableDrive {
  device: string;
  disk: string;
}

const yes = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const SYSTEM_MOUNTS = /^\/(boot|efi|home|var|usr|opt|srv|nix|snap)?(\/|$)/;

/** Picks the mounted, removable file systems out of `lsblk -J -b` output. */
export function parseLsblk(json: unknown): LinuxDrive[] {
  const out: LinuxDrive[] = [];
  const devices = (json as { blockdevices?: LsblkNode[] })?.blockdevices ?? [];
  const visit = (node: LsblkNode, disk: LsblkNode) => {
    const mounts = (node.mountpoints ?? [node.mountpoint ?? null]).filter((m): m is string => typeof m === "string" && m.startsWith("/"));
    const removable = yes(node.rm) || yes(node.hotplug) || yes(disk.rm) || yes(disk.hotplug) || ["usb", "mmc"].includes(String(disk.tran ?? "")) || String(disk.name ?? "").startsWith("mmcblk");
    const mount = mounts.find((m) => !SYSTEM_MOUNTS.test(m) || m.startsWith("/run/media/") || m.startsWith("/media/") || m.startsWith("/mnt/"));
    if (removable && mount && node.fstype && node.path) {
      const fsType = String(node.fstype);
      out.push({
        mount,
        label: String(node.label || path.basename(mount) || node.name),
        fsType,
        printerReadable: fsType.toLowerCase() === "vfat",
        sizeBytes: num(node.size),
        freeBytes: num(node.fsavail),
        canEject: true,
        device: node.path,
        disk: String(disk.path ?? node.path),
      });
    }
    for (const child of node.children ?? []) visit(child, disk);
  };
  for (const d of devices) visit(d, d);
  return out;
}

interface WinDisk { DeviceID?: string; VolumeName?: string | null; FileSystem?: string | null; Size?: number | string | null; FreeSpace?: number | string | null }

export function parseWindowsDisks(json: unknown): RemovableDrive[] {
  const list: WinDisk[] = Array.isArray(json) ? json : json && typeof json === "object" ? [json as WinDisk] : [];
  return list
    .filter((d) => typeof d.DeviceID === "string" && /^[A-Z]:$/i.test(d.DeviceID) && d.FileSystem)
    .map((d) => ({
      mount: `${d.DeviceID}\\`,
      label: d.VolumeName || `Drive ${d.DeviceID}`,
      fsType: String(d.FileSystem),
      printerReadable: String(d.FileSystem).toUpperCase() === "FAT32",
      sizeBytes: num(d.Size),
      freeBytes: num(d.FreeSpace),
      canEject: false,
    }));
}

async function listLinux(): Promise<LinuxDrive[]> {
  try {
    const { stdout } = await run("lsblk", ["-J", "-b", "-o", "NAME,PATH,RM,HOTPLUG,TRAN,FSTYPE,LABEL,SIZE,FSAVAIL,MOUNTPOINTS"], { timeout: 10_000 });
    return parseLsblk(JSON.parse(stdout));
  } catch {
    // Older lsblk without MOUNTPOINTS
    const { stdout } = await run("lsblk", ["-J", "-b", "-o", "NAME,PATH,RM,HOTPLUG,TRAN,FSTYPE,LABEL,SIZE,FSAVAIL,MOUNTPOINT"], { timeout: 10_000 });
    return parseLsblk(JSON.parse(stdout));
  }
}

async function listWindows(): Promise<RemovableDrive[]> {
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress"],
    { timeout: 15_000, windowsHide: true },
  );
  return stdout.trim() ? parseWindowsDisks(JSON.parse(stdout)) : [];
}

/** Tests point this at a folder that stands in for a card (plugged in while the folder exists). */
async function testCard(): Promise<RemovableDrive[] | null> {
  const root = process.env.MAKERSTUDIO_SD_ROOT;
  if (!root) return null;
  if (!(await exists(root))) return [];
  return [{ mount: root, label: "TEST CARD", fsType: "vfat", printerReadable: true, sizeBytes: null, freeBytes: null, canEject: false }];
}

async function listAll(): Promise<(RemovableDrive & Partial<Pick<LinuxDrive, "device" | "disk">>)[]> {
  const fake = await testCard();
  if (fake) return fake;
  if (process.platform === "linux") return listLinux();
  if (process.platform === "win32") return listWindows();
  return [];
}

export async function listDrives(): Promise<RemovableDrive[]> {
  return (await listAll()).map(({ mount, label, fsType, printerReadable, sizeBytes, freeBytes, canEject }) => ({ mount, label, fsType, printerReadable, sizeBytes, freeBytes, canEject }));
}

async function findDrive(mount: string) {
  const drive = typeof mount === "string" ? (await listAll()).find((d) => d.mount === mount) : undefined;
  if (!drive) throw new Error("That card is not plugged in any more. Plug it in again and press Find cards.");
  return drive;
}

async function exists(file: string) {
  return fs.stat(file).then(() => true, () => false);
}

/** Copies the file onto the card's top folder (never over an existing file) and makes sure it is written. */
export async function copyToDrive(source: string, mount: string, fileName: string): Promise<string> {
  const drive = await findDrive(mount);
  const size = (await fs.stat(source)).size;
  if (drive.freeBytes !== null && drive.freeBytes < size + 1024 * 1024) throw new Error(`The card is full (it needs ${(size / 1e6).toFixed(1)} MB free). Delete some old prints from it first.`);
  const dot = fileName.toLowerCase().endsWith(".gcode.3mf") ? fileName.length - ".gcode.3mf".length : fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  let target = path.join(drive.mount, fileName);
  for (let n = 2; await exists(target); n++) {
    if (n > 99) throw new Error("There are too many files with this name on the card.");
    target = path.join(drive.mount, `${stem} (${n})${ext}`);
  }
  const temp = `${target}.part`;
  try {
    await fs.copyFile(source, temp);
    const handle = await fs.open(temp, "r+");
    try {
      await handle.sync(); // really on the card before we say it is safe
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return target;
}

export async function ejectDrive(mount: string): Promise<void> {
  const drive = await findDrive(mount);
  if (!drive.canEject || !drive.device || process.platform !== "linux") {
    throw new Error(process.platform === "win32" ? "Use \"Safely Remove Hardware\" in the Windows taskbar, then take the card out." : "Eject the card from your file manager, then take it out.");
  }
  if (!/^\/dev\/[A-Za-z0-9._-]+$/.test(drive.device) || !/^\/dev\/[A-Za-z0-9._-]+$/.test(drive.disk ?? "")) throw new Error("Unexpected device name; eject the card from your file manager.");
  try {
    await run("udisksctl", ["unmount", "--no-user-interaction", "-b", drive.device], { timeout: 30_000 });
  } catch (error) {
    const text = String((error as { stderr?: string }).stderr ?? (error as Error).message);
    if (/busy/i.test(text)) throw new Error("The card is still in use (maybe a file manager window has it open). Close that and press Eject again.");
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Eject the card from your file manager, then take it out.");
    throw new Error(`The card could not be ejected: ${text.trim()}`);
  }
  // Powering the reader off is a nicety; some readers do not support it.
  await run("udisksctl", ["power-off", "--no-user-interaction", "-b", drive.disk!], { timeout: 30_000 }).catch(() => undefined);
}
