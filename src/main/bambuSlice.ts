// Slicing with Bambu Studio's command-line slicer (no window), for the Print panel.
//
// The parts arrive as STL files. Bambu Studio arranges them on the plate, slices with the
// chosen quality / filament / plate, and writes a sliced project (.gcode.3mf) that the printer
// prints from its SD card. When the parts need more than one plate, each plate is sliced again
// on its own so every file holds exactly one plate.
//
// Only the presets Bambu Studio itself offers for the printer in Settings can be chosen; the
// interface never passes a path or a program to run.

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { readGcodeSummary } from "../core/print/gcode";
import type { SliceOptions, SliceOutcome, SliceRequest, SlicedPlate, SlicingCatalog } from "../shared/ipc";
import { BambuProfiles, bedCentre, findProfilesDir } from "./bambuProfiles";
import { findLauncher, type Launcher } from "./slicer";

const SLICE_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_PARTS = 200;
const KEEP_RESULTS = 20;
const LOG_LIMIT = 64 * 1024;

interface Context {
  launcher: Launcher;
  profiles: BambuProfiles;
}

let cachedProfiles: BambuProfiles | null = null;

async function context(): Promise<Context> {
  const launcher = await findLauncher();
  if (!launcher) throw new Error("Bambu Studio was not found on this computer. Install it from bambulab.com to slice here.");
  if (!cachedProfiles) {
    const dir = await findProfilesDir(launcher.command);
    if (!dir) throw new Error("Bambu Studio is installed, but its printer profiles were not found. Reinstalling Bambu Studio should fix this.");
    cachedProfiles = new BambuProfiles(dir);
  }
  return { launcher, profiles: cachedProfiles };
}

export async function sliceCatalog(printer: string, nozzle: number): Promise<SlicingCatalog> {
  const { profiles } = await context();
  return profiles.catalog(printer, nozzle);
}

/** Checks the choices against what Bambu Studio offers; unknown ones fall back to the defaults. */
export function checkOptions(options: SliceOptions, catalog: SlicingCatalog): SliceOptions {
  const has = (list: { name: string }[], name: unknown) => typeof name === "string" && list.some((p) => p.name === name);
  const supports = options?.supports === "normal" || options?.supports === "tree" ? options.supports : "off";
  const infill = typeof options?.infill === "number" && Number.isInteger(options.infill) && options.infill >= 0 && options.infill <= 100 ? options.infill : null;
  return {
    process: has(catalog.processes, options?.process) ? options.process : catalog.defaults.process,
    filament: has(catalog.filaments, options?.filament) ? options.filament : catalog.defaults.filament,
    plate: has(catalog.plates, options?.plate) ? options.plate : catalog.defaults.plate,
    supports,
    infill,
  };
}

/** The process settings the Print panel changes on top of the quality preset. */
export function processOverrides(options: SliceOptions): Record<string, string> {
  const o: Record<string, string> = { curr_bed_type: options.plate };
  if (options.supports === "off") o.enable_support = "0";
  else {
    o.enable_support = "1";
    o.support_type = options.supports === "tree" ? "tree(auto)" : "normal(auto)";
  }
  if (options.infill !== null) o.sparse_infill_density = `${options.infill}%`;
  return o;
}

/** A name that is safe on the printer's FAT32 card and on every desktop system. */
export function cardSafeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*;\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 60);
  return cleaned || "print";
}

/**
 * Adds what the command-line slicer leaves out of a sliced file: the printer model id (the
 * desktop app writes it, so the file says which printer it is for) and the pictures the printer
 * shows in its file list.
 */
export function finishSlicedFile(bytes: Uint8Array, extras: { modelId: string | null; thumbnails?: { large: Uint8Array; small: Uint8Array } }): Uint8Array {
  const files = unzipSync(bytes);
  const info = files["Metadata/slice_info.config"];
  if (extras.modelId && info) {
    const text = strFromU8(info).replace(/(<metadata key="printer_model_id" value=")[^"]*(")/, `$1${extras.modelId}$2`);
    files["Metadata/slice_info.config"] = strToU8(text);
  }
  if (extras.thumbnails) {
    files["Metadata/plate_1.png"] = new Uint8Array(extras.thumbnails.large);
    files["Metadata/plate_1_small.png"] = new Uint8Array(extras.thumbnails.small);
    const types = files["[Content_Types].xml"];
    if (types) {
      const text = strFromU8(types);
      if (!/Extension="png"/i.test(text)) files["[Content_Types].xml"] = strToU8(text.replace("</Types>", ' <Default Extension="png" ContentType="image/png"/>\n</Types>'));
    }
  }
  const zippable: Zippable = {};
  for (const [name, data] of Object.entries(files)) zippable[name] = name.endsWith(".png") ? [data, { level: 0 }] : data;
  return zipSync(zippable, { level: 6 });
}

interface CliResult {
  return_code?: number;
  error_string?: string;
  sliced_plates?: { id: number; objects?: { name?: string }[]; total_predication?: number }[];
}

/** Turns the slicer's own messages into plain advice where we know what they mean. */
export function explainSliceError(result: CliResult | null, log: string): string {
  const message = result?.error_string?.trim() ?? "";
  if (/plate is empty|no object fully inside/i.test(message)) {
    return "A part is bigger than the printer's bed, so it can't go on a plate. Make it smaller (Scale), lay it down another way (Orient), or cut it into pieces, then slice again.";
  }
  if (/conflict|collision/i.test(message)) return `Bambu Studio found parts that would hit each other while printing: ${message}`;
  if (message && message !== "Success.") return `Bambu Studio could not slice this: ${message}`;
  const tail = log.trim().split("\n").slice(-3).join(" ").slice(-300);
  return `Bambu Studio stopped without slicing${tail ? `: ${tail}` : "."}`;
}

let running: ChildProcess | null = null;
let cancelled = false;

export function cancelSlicing() {
  cancelled = true;
  running?.kill();
}

export function slicing(): boolean {
  return running !== null;
}

function runCli(launcher: Launcher, args: string[], cwd: string): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    let log = "";
    const keep = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-LOG_LIMIT); };
    const child = spawn(launcher.command, [...launcher.args, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    running = child;
    const timer = setTimeout(() => { log += "\nStopped: slicing took longer than 20 minutes."; child.kill(); }, SLICE_TIMEOUT_MS);
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.once("error", (error) => {
      clearTimeout(timer);
      running = null;
      reject(new Error(`Bambu Studio could not be started: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      running = null;
      if (cancelled) reject(new Error("Slicing was stopped."));
      else resolve({ code, log });
    });
  });
}

async function readResult(dir: string): Promise<CliResult | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8")) as CliResult;
  } catch {
    return null;
  }
}

async function headOf(file: string, bytes = 64 * 1024): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

interface StoredPlate { file: string; gcode: string; fileName: string }
const results = new Map<string, { folder: string; plates: StoredPlate[] }>();

export function slicedPlate(id: string, plate: number): StoredPlate {
  const result = typeof id === "string" ? results.get(id) : undefined;
  const p = result && Number.isInteger(plate) ? result.plates[plate] : undefined;
  if (!p) throw new Error("That sliced file is no longer available. Slice again.");
  return p;
}

/** Slices the parts. `outputRoot` is the Exports folder; each slice gets its own folder in it. */
export async function slice(request: SliceRequest, printer: { name: string; nozzle: number }, outputRoot: string): Promise<SliceOutcome> {
  if (running) throw new Error("Already slicing. Wait for it to finish or press Stop.");
  const files = Array.isArray(request?.files) ? request.files : [];
  if (files.length === 0) throw new Error("There is nothing to slice.");
  if (files.length > MAX_PARTS) throw new Error(`Too many parts to slice at once (${files.length}). Select up to ${MAX_PARTS}.`);
  for (const f of files) {
    if (typeof f?.name !== "string" || f.name !== path.basename(f.name) || !f.name.toLowerCase().endsWith(".stl") || f.name.startsWith(".") || !(f.bytes instanceof Uint8Array)) {
      throw new Error(`Invalid part file: ${String(f?.name)}`);
    }
  }
  const started = Date.now();
  cancelled = false;
  const { launcher, profiles } = await context();
  const catalog = await profiles.catalog(printer.name, printer.nozzle);
  const options = checkOptions(request.options, catalog);

  const base = cardSafeName(String(request.name ?? "print"));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const folder = path.join(outputRoot, "Sliced", `${base} ${stamp}`);
  const partsDir = path.join(folder, "parts");
  const settingsDir = path.join(folder, "settings");
  await fs.mkdir(partsDir, { recursive: true });
  await fs.mkdir(settingsDir, { recursive: true });

  const stlPaths = new Map<string, string>();
  for (const f of files) {
    const target = path.join(partsDir, cardSafeName(f.name.slice(0, -4)) + ".stl");
    if (stlPaths.has(path.basename(target))) throw new Error(`Two parts have the same file name: ${f.name}`);
    await fs.writeFile(target, f.bytes);
    stlPaths.set(path.basename(target), target);
  }

  const machine = await profiles.flattened("machine", catalog.printer);
  const proc = { ...(await profiles.flattened("process", options.process)), ...processOverrides(options) };
  const filament = await profiles.flattened("filament", options.filament);
  const machineFile = path.join(settingsDir, "machine.json");
  const processFile = path.join(settingsDir, "process.json");
  const filamentFile = path.join(settingsDir, "filament.json");
  await fs.writeFile(machineFile, JSON.stringify(machine, null, 1));
  await fs.writeFile(processFile, JSON.stringify(proc, null, 1));
  await fs.writeFile(filamentFile, JSON.stringify(filament, null, 1));

  const sliceInto = async (dir: string, fileName: string, stls: string[]) => {
    await fs.mkdir(dir, { recursive: true });
    const args = [
      "--debug", "2",
      "--slice", "0",
      "--arrange", "1",
      "--orient", "0",
      "--load-settings", `${machineFile};${processFile}`,
      "--load-filaments", filamentFile,
      "--outputdir", dir,
      "--export-3mf", fileName,
      ...stls,
    ];
    const { log } = await runCli(launcher, args, dir);
    const result = await readResult(dir);
    if (!result || result.return_code !== 0) throw new Error(explainSliceError(result, log));
    return result;
  };

  const modelId = await profiles.modelId(String(machine.printer_model ?? ""));
  const warnings: string[] = [];
  const plates: SlicedPlate[] = [];
  const stored: StoredPlate[] = [];
  const finish = async (dir: string, fileName: string, parts: string[]) => {
    const file = path.join(dir, fileName);
    await fs.writeFile(file, finishSlicedFile(new Uint8Array(await fs.readFile(file)), { modelId, thumbnails: request.thumbnails }));
    const gcode = path.join(dir, "plate_1.gcode");
    const summary = readGcodeSummary(await headOf(gcode));
    plates.push({ fileName, parts, seconds: summary.seconds, filamentGrams: summary.filamentGrams, filamentMm: summary.filamentMm, layers: summary.layers, maxZ: summary.maxZ });
    stored.push({ file, gcode, fileName });
  };

  const allNames = [...stlPaths.keys()];
  const first = await sliceInto(path.join(folder, "all"), `${base}.gcode.3mf`, [...stlPaths.values()]);
  const sliced = first.sliced_plates ?? [];
  const partName = (n: string) => n.replace(/\.stl$/i, "");
  if (sliced.length <= 1) {
    await finish(path.join(folder, "all"), `${base}.gcode.3mf`, allNames.map(partName));
  } else {
    // One file per plate: slice each plate's parts on their own.
    for (const [i, plate] of sliced.entries()) {
      const names = (plate.objects ?? []).map((o) => String(o.name ?? "")).filter((n) => stlPaths.has(n));
      if (names.length === 0) continue;
      const fileName = `${base} plate ${i + 1}.gcode.3mf`;
      const dir = path.join(folder, `plate ${i + 1}`);
      const again = await sliceInto(dir, fileName, names.map((n) => stlPaths.get(n)!));
      if ((again.sliced_plates?.length ?? 1) > 1) warnings.push(`Plate ${i + 1} still needed more than one plate; only its first plate is in the file.`);
      await finish(dir, fileName, names.map(partName));
    }
    await fs.rm(path.join(folder, "all", `${base}.gcode.3mf`), { force: true });
    warnings.unshift(`Your parts need ${plates.length} plates, so there is one file per plate. Print them one after another.`);
  }

  const id = randomBytes(8).toString("hex");
  results.set(id, { folder, plates: stored });
  while (results.size > KEEP_RESULTS) results.delete(results.keys().next().value!);
  return { id, folder, plates, bedCentre: bedCentre(machine), took: (Date.now() - started) / 1000, warnings };
}
