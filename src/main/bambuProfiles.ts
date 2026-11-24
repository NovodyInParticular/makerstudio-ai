// Bambu Studio's own printer, quality and filament profiles, read from its install folder.
//
// The profiles are layered: "Bambu PLA Basic @BBL A1" inherits "Bambu PLA Basic @base", which
// inherits "fdm_filament_pla", and so on. Bambu Studio's command-line slicer does not follow
// those links, so each profile is flattened (parents first, child last) before it is handed over.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PresetChoice, SlicingCatalog } from "../shared/ipc";

type Profile = Record<string, unknown>;
type Category = "machine" | "process" | "filament";

/** The build plates Bambu Studio knows for the A1 family, by their config value. */
export const PLATES: PresetChoice[] = [
  { name: "Textured PEI Plate", label: "Textured PEI (comes with the A1)" },
  { name: "High Temp Plate", label: "Smooth PEI / High Temp" },
  { name: "Cool Plate", label: "Cool Plate" },
  { name: "Engineering Plate", label: "Engineering Plate" },
];

export const DEFAULT_PROCESS = "0.20mm Standard";
export const DEFAULT_FILAMENT = "Bambu PLA Basic";

/** Folders where Bambu Studio keeps its profiles, for the known install locations. */
export function profileCandidates(launcher: string | null): string[] {
  const list: string[] = [];
  const override = process.env.MAKERSTUDIO_BAMBU_PROFILES;
  if (override) return [override];
  if (launcher && path.isAbsolute(launcher)) {
    const dir = path.dirname(launcher);
    list.push(path.join(dir, "resources", "profiles"), path.join(dir, "..", "resources", "profiles"), path.join(dir, "..", "Resources", "profiles"));
  }
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]) {
      if (root) list.push(path.join(root, "Bambu Studio", "resources", "profiles"));
    }
  } else if (process.platform === "darwin") {
    list.push("/Applications/BambuStudio.app/Contents/Resources/profiles");
  } else {
    const home = process.env.HOME ?? "";
    list.push(
      "/opt/bambustudio-bin/resources/profiles",
      "/opt/bambu-studio/resources/profiles",
      "/usr/share/bambu-studio/profiles",
      "/usr/share/BambuStudio/profiles",
      "/var/lib/flatpak/app/com.bambulab.BambuStudio/current/active/files/share/BambuStudio/profiles",
      path.join(home, ".local/share/flatpak/app/com.bambulab.BambuStudio/current/active/files/share/BambuStudio/profiles"),
    );
  }
  return list;
}

export async function findProfilesDir(launcher: string | null): Promise<string | null> {
  for (const dir of profileCandidates(launcher)) {
    const ok = await fs.stat(path.join(dir, "BBL", "machine")).then((s) => s.isDirectory(), () => false);
    if (ok) return path.join(dir, "BBL");
  }
  return null;
}

/** The part of a preset name before " @" ("0.20mm Standard @BBL A1" -> "0.20mm Standard"). */
export function shortName(name: string): string {
  const at = name.indexOf(" @");
  return at > 0 ? name.slice(0, at) : name;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(";").map((s) => s.trim()).filter(Boolean);
  return [];
}

function first(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
}

/** Merges a profile with its parents. Throws on a missing parent or an inheritance loop. */
export function flattenProfile(name: string, byName: Map<string, Profile>): Profile {
  const chain: Profile[] = [];
  const seen = new Set<string>();
  let current: string | undefined = name;
  while (current) {
    if (seen.has(current)) throw new Error(`Profile "${name}" inherits itself.`);
    seen.add(current);
    const profile = byName.get(current);
    if (!profile) throw new Error(chain.length ? `Profile "${name}" needs "${current}", which is missing.` : `Profile "${name}" was not found.`);
    chain.push(profile);
    current = typeof profile.inherits === "string" && profile.inherits ? profile.inherits : undefined;
  }
  const merged: Profile = {};
  for (const p of chain.reverse()) Object.assign(merged, p);
  delete merged.inherits;
  merged.name = name;
  merged.from = "system";
  return merged;
}

export class BambuProfiles {
  private loaded: Promise<Record<Category, Map<string, Profile>>> | null = null;
  private models: Promise<Map<string, Profile>> | null = null;

  constructor(readonly dir: string) {}

  private async readCategory(category: Category): Promise<Map<string, Profile>> {
    const folder = path.join(this.dir, category);
    const files = (await fs.readdir(folder)).filter((f) => f.toLowerCase().endsWith(".json"));
    const map = new Map<string, Profile>();
    // Read in batches: there are about two thousand filament files.
    for (let i = 0; i < files.length; i += 64) {
      const batch = await Promise.all(files.slice(i, i + 64).map(async (f) => {
        try {
          return JSON.parse(await fs.readFile(path.join(folder, f), "utf8")) as Profile;
        } catch {
          return null; // a damaged file only removes that one preset
        }
      }));
      for (const p of batch) if (p && typeof p.name === "string") map.set(p.name, p);
    }
    return map;
  }

  private all() {
    this.loaded ??= (async () => {
      const [machine, process, filament] = await Promise.all([this.readCategory("machine"), this.readCategory("process"), this.readCategory("filament")]);
      return { machine, process, filament };
    })();
    this.loaded.catch(() => { this.loaded = null; });
    return this.loaded;
  }

  /** "Bambu Lab A1" + 0.4 -> "Bambu Lab A1 0.4 nozzle", when Bambu Studio has that printer. */
  async machineName(printer: string, nozzle: number): Promise<string | null> {
    const { machine } = await this.all();
    const name = `${printer} ${nozzle} nozzle`;
    const p = machine.get(name);
    return p && p.instantiation === "true" ? name : null;
  }

  async catalog(printer: string, nozzle: number): Promise<SlicingCatalog> {
    const machineName = await this.machineName(printer, nozzle);
    if (!machineName) {
      throw new Error(`Bambu Studio has no profile for "${printer}" with a ${nozzle} mm nozzle. Set a Bambu Lab printer in Settings (for example "Bambu Lab A1", nozzle 0.4).`);
    }
    const { process, filament } = await this.all();
    const fits = (p: Profile) => p.instantiation === "true" && list(p.compatible_printers).includes(machineName);

    const processes = [...process.values()].filter(fits).map((p) => ({ name: String(p.name), label: shortName(String(p.name)) }));
    processes.sort((a, b) => parseFloat(a.label) - parseFloat(b.label) || a.label.localeCompare(b.label));

    const filaments: PresetChoice[] = [];
    const seen = new Set<string>();
    for (const p of filament.values()) {
      if (!fits(p)) continue;
      const label = shortName(String(p.name));
      if (seen.has(label)) continue;
      seen.add(label);
      let type = first(p.filament_type);
      if (!type) {
        try { type = first(flattenProfile(String(p.name), filament).filament_type); } catch { type = ""; }
      }
      filaments.push({ name: String(p.name), label, group: type || "Other" });
    }
    const rank = (c: PresetChoice) => (c.label === DEFAULT_FILAMENT ? 0 : c.label.startsWith("Bambu ") ? 1 : c.label.startsWith("Generic ") ? 2 : 3);
    filaments.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));

    if (processes.length === 0 || filaments.length === 0) throw new Error(`Bambu Studio's profiles for ${machineName} look incomplete (no quality or filament presets found).`);
    return {
      printer: machineName,
      processes,
      filaments,
      plates: PLATES,
      defaults: {
        process: processes.find((p) => p.label === DEFAULT_PROCESS)?.name ?? processes[0]!.name,
        filament: filaments.find((f) => f.label === DEFAULT_FILAMENT)?.name ?? filaments[0]!.name,
        plate: PLATES[0]!.name,
      },
    };
  }

  async flattened(category: Category, name: string): Promise<Profile> {
    const all = await this.all();
    return flattenProfile(name, all[category]);
  }

  /** The printer model's short id (A1 = "N2S"), which Bambu Studio writes into sliced files. */
  async modelId(printerModel: string): Promise<string | null> {
    this.models ??= (async () => {
      const { machine } = await this.all();
      const map = new Map<string, Profile>();
      for (const p of machine.values()) if (p.type === "machine_model" || typeof p.model_id === "string") map.set(String(p.name), p);
      return map;
    })();
    const model = (await this.models).get(printerModel);
    return typeof model?.model_id === "string" && model.model_id ? model.model_id : null;
  }
}

/** Centre of the printable area ("0x0,256x0,256x256,0x256"), for placing the preview on the bed. */
export function bedCentre(machine: Profile): [number, number] {
  const points = list(machine.printable_area).map((p) => p.split("x").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (points.length < 3) return [128, 128];
  const xs = points.map((p) => p[0]!), ys = points.map((p) => p[1]!);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
