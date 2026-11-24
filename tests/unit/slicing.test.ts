import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BambuProfiles, bedCentre, flattenProfile, shortName } from "../../src/main/bambuProfiles";
import { cardSafeName, checkOptions, explainSliceError, finishSlicedFile, processOverrides } from "../../src/main/bambuSlice";
import { copyToDrive, parseLsblk, parseWindowsDisks } from "../../src/main/drives";
import type { SlicingCatalog } from "../../src/shared/ipc";

describe("profile flattening", () => {
  const byName = new Map<string, Record<string, unknown>>([
    ["base", { name: "base", a: 1, b: 1, instantiation: "false" }],
    ["middle", { name: "middle", inherits: "base", b: 2, c: 2 }],
    ["leaf", { name: "leaf", inherits: "middle", c: 3, instantiation: "true" }],
    ["loop1", { name: "loop1", inherits: "loop2" }],
    ["loop2", { name: "loop2", inherits: "loop1" }],
    ["orphan", { name: "orphan", inherits: "nowhere" }],
  ]);

  it("merges parents first, child last", () => {
    expect(flattenProfile("leaf", byName)).toEqual({ name: "leaf", a: 1, b: 2, c: 3, instantiation: "true", from: "system" });
  });

  it("reports missing parents and loops", () => {
    expect(() => flattenProfile("orphan", byName)).toThrow(/needs "nowhere"/);
    expect(() => flattenProfile("loop1", byName)).toThrow(/inherits itself/);
    expect(() => flattenProfile("missing", byName)).toThrow(/was not found/);
  });

  it("shortens preset names and finds the bed centre", () => {
    expect(shortName("0.20mm Standard @BBL A1")).toBe("0.20mm Standard");
    expect(shortName("Plain")).toBe("Plain");
    expect(bedCentre({ printable_area: ["0x0", "256x0", "256x256", "0x256"] })).toEqual([128, 128]);
    expect(bedCentre({ printable_area: ["10x20", "190x20", "190x200", "10x200"] })).toEqual([100, 110]);
    expect(bedCentre({})).toEqual([128, 128]);
  });
});

describe("Bambu Studio profile folder", () => {
  let dir = "";
  const write = (category: string, profile: Record<string, unknown>) => fs.writeFile(path.join(dir, category, `${String(profile.name)}.json`), JSON.stringify(profile));

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ms-profiles-"));
    for (const c of ["machine", "process", "filament"]) await fs.mkdir(path.join(dir, c));
    await write("machine", { type: "machine_model", name: "Bambu Lab A1", model_id: "N2S" });
    await write("machine", { type: "machine", name: "fdm_common", instantiation: "false", printable_area: ["0x0", "256x0", "256x256", "0x256"] });
    await write("machine", { type: "machine", name: "Bambu Lab A1 0.4 nozzle", inherits: "fdm_common", instantiation: "true", printer_model: "Bambu Lab A1" });
    await write("process", { type: "process", name: "fdm_process", instantiation: "false", sparse_infill_density: "15%" });
    await write("process", { type: "process", name: "0.20mm Standard @BBL A1", inherits: "fdm_process", instantiation: "true", compatible_printers: ["Bambu Lab A1 0.4 nozzle"] });
    await write("process", { type: "process", name: "0.12mm Fine @BBL A1", inherits: "fdm_process", instantiation: "true", compatible_printers: ["Bambu Lab A1 0.4 nozzle"] });
    await write("process", { type: "process", name: "0.20mm Standard @BBL X1C", inherits: "fdm_process", instantiation: "true", compatible_printers: ["Bambu Lab X1 Carbon 0.4 nozzle"] });
    await write("filament", { type: "filament", name: "fdm_filament_pla", instantiation: "false", filament_type: ["PLA"] });
    await write("filament", { type: "filament", name: "Bambu PLA Basic @base", inherits: "fdm_filament_pla", instantiation: "false" });
    await write("filament", { type: "filament", name: "Bambu PLA Basic @BBL A1", inherits: "Bambu PLA Basic @base", instantiation: "true", compatible_printers: ["Bambu Lab A1 0.4 nozzle"] });
    await write("filament", { type: "filament", name: "Generic PETG @BBL A1", instantiation: "true", filament_type: ["PETG"], compatible_printers: ["Bambu Lab A1 0.4 nozzle"] });
    await fs.writeFile(path.join(dir, "filament", "broken.json"), "{ not json");
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("lists the presets that fit the printer, standard ones first", async () => {
    const catalog = await new BambuProfiles(dir).catalog("Bambu Lab A1", 0.4);
    expect(catalog.printer).toBe("Bambu Lab A1 0.4 nozzle");
    expect(catalog.processes.map((p) => p.label)).toEqual(["0.12mm Fine", "0.20mm Standard"]);
    expect(catalog.filaments).toEqual([
      { name: "Bambu PLA Basic @BBL A1", label: "Bambu PLA Basic", group: "PLA" },
      { name: "Generic PETG @BBL A1", label: "Generic PETG", group: "PETG" },
    ]);
    expect(catalog.defaults).toEqual({ process: "0.20mm Standard @BBL A1", filament: "Bambu PLA Basic @BBL A1", plate: "Textured PEI Plate" });
  });

  it("explains a printer Bambu Studio does not know", async () => {
    await expect(new BambuProfiles(dir).catalog("My Printer", 0.4)).rejects.toThrow(/no profile for "My Printer"/);
    await expect(new BambuProfiles(dir).catalog("Bambu Lab A1", 0.6)).rejects.toThrow(/0.6 mm nozzle/);
  });

  it("flattens profiles and finds the model id", async () => {
    const profiles = new BambuProfiles(dir);
    expect((await profiles.flattened("filament", "Bambu PLA Basic @BBL A1")).filament_type).toEqual(["PLA"]);
    expect(await profiles.modelId("Bambu Lab A1")).toBe("N2S");
    expect(await profiles.modelId("Unknown")).toBeNull();
  });
});

describe("slicing options and sliced files", () => {
  const catalog: SlicingCatalog = {
    printer: "Bambu Lab A1 0.4 nozzle",
    processes: [{ name: "P", label: "P" }],
    filaments: [{ name: "F", label: "F" }],
    plates: [{ name: "Textured PEI Plate", label: "t" }, { name: "Cool Plate", label: "c" }],
    defaults: { process: "P", filament: "F", plate: "Textured PEI Plate" },
  };

  it("only accepts presets Bambu Studio offers", () => {
    expect(checkOptions({ process: "../../etc/passwd", filament: "F", plate: "Cool Plate", supports: "tree", infill: 40 }, catalog)).toEqual({ process: "P", filament: "F", plate: "Cool Plate", supports: "tree", infill: 40 });
    expect(checkOptions({ process: "P", filament: "nope", plate: "x", supports: "bogus" as never, infill: 101 }, catalog)).toEqual({ process: "P", filament: "F", plate: "Textured PEI Plate", supports: "off", infill: null });
  });

  it("turns choices into Bambu Studio settings", () => {
    expect(processOverrides({ process: "P", filament: "F", plate: "Textured PEI Plate", supports: "off", infill: null })).toEqual({ curr_bed_type: "Textured PEI Plate", enable_support: "0" });
    expect(processOverrides({ process: "P", filament: "F", plate: "Cool Plate", supports: "normal", infill: 25 })).toEqual({ curr_bed_type: "Cool Plate", enable_support: "1", support_type: "normal(auto)", sparse_infill_density: "25%" });
  });

  it("makes card-safe file names", () => {
    expect(cardSafeName('My "robot": arm/left;v2. ')).toBe("My robot armleftv2");
    expect(cardSafeName("???")).toBe("print");
    expect(cardSafeName("x".repeat(100))).toHaveLength(60);
  });

  it("adds the printer model and pictures to a sliced file", () => {
    const original = zipSync({
      "[Content_Types].xml": strToU8('<Types><Default Extension="model" ContentType="x"/></Types>'),
      "Metadata/slice_info.config": strToU8('<plate><metadata key="printer_model_id" value=""/></plate>'),
      "Metadata/plate_1.gcode": strToU8("G1 X1\n"),
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const files = unzipSync(finishSlicedFile(original, { modelId: "N2S", thumbnails: { large: png, small: png } }));
    expect(strFromU8(files["Metadata/slice_info.config"]!)).toContain('value="N2S"');
    expect(files["Metadata/plate_1.png"]).toEqual(png);
    expect(files["Metadata/plate_1_small.png"]).toEqual(png);
    expect(strFromU8(files["[Content_Types].xml"]!)).toContain('Extension="png"');
    expect(strFromU8(files["Metadata/plate_1.gcode"]!)).toBe("G1 X1\n");
  });

  it("explains slicer errors in plain words", () => {
    expect(explainSliceError({ return_code: -50, error_string: "One of the plate is empty or has no object fully inside it." }, "")).toMatch(/bigger than the printer's bed/);
    expect(explainSliceError({ return_code: -1, error_string: "Weird thing" }, "")).toBe("Bambu Studio could not slice this: Weird thing");
    expect(explainSliceError(null, "line 1\nline 2\ncrashed")).toMatch(/stopped without slicing: line 1 line 2 crashed/);
  });
});

describe("SD cards", () => {
  const lsblk = {
    blockdevices: [
      { name: "nvme0n1", path: "/dev/nvme0n1", rm: false, hotplug: false, tran: "nvme", fstype: null, mountpoints: [null], children: [
        { name: "nvme0n1p1", path: "/dev/nvme0n1p1", rm: false, hotplug: false, tran: "nvme", fstype: "vfat", label: null, size: 2e9, fsavail: 1e9, mountpoints: ["/boot"] },
      ] },
      { name: "sdb", path: "/dev/sdb", rm: true, hotplug: true, tran: "usb", fstype: null, mountpoints: [null], children: [
        { name: "sdb1", path: "/dev/sdb1", rm: true, hotplug: true, tran: null, fstype: "vfat", label: "BAMBU", size: 31914983424, fsavail: 30000000000, mountpoints: ["/run/media/pm/BAMBU"] },
      ] },
      { name: "sdc", path: "/dev/sdc", rm: "1", hotplug: "1", tran: "usb", fstype: "exfat", label: "STICK", size: "64000000000", fsavail: null, mountpoints: ["/run/media/pm/STICK"] },
      { name: "sdd", path: "/dev/sdd", rm: true, hotplug: true, tran: "usb", fstype: "vfat", label: "UNMOUNTED", mountpoints: [null] },
      { name: "mmcblk0", path: "/dev/mmcblk0", rm: false, hotplug: false, tran: null, children: [
        { name: "mmcblk0p1", path: "/dev/mmcblk0p1", fstype: "vfat", label: null, size: 8e9, fsavail: 7e9, mountpoint: "/media/card" },
      ] },
    ],
  };

  it("finds mounted cards and sticks, not internal disks", () => {
    const drives = parseLsblk(lsblk);
    expect(drives.map((d) => [d.mount, d.label, d.printerReadable, d.device, d.disk])).toEqual([
      ["/run/media/pm/BAMBU", "BAMBU", true, "/dev/sdb1", "/dev/sdb"],
      ["/run/media/pm/STICK", "STICK", false, "/dev/sdc", "/dev/sdc"],
      ["/media/card", "card", true, "/dev/mmcblk0p1", "/dev/mmcblk0"],
    ]);
    expect(drives[0]!.freeBytes).toBe(30000000000);
    expect(drives[1]!.sizeBytes).toBe(64000000000);
  });

  it("reads Windows removable drives", () => {
    expect(parseWindowsDisks({ DeviceID: "E:", VolumeName: "BAMBU", FileSystem: "FAT32", Size: 32e9, FreeSpace: 31e9 })).toEqual([
      { mount: "E:\\", label: "BAMBU", fsType: "FAT32", printerReadable: true, sizeBytes: 32e9, freeBytes: 31e9, canEject: false },
    ]);
    expect(parseWindowsDisks([{ DeviceID: "F:", FileSystem: null }, { DeviceID: "G:", FileSystem: "exFAT" }]).map((d) => [d.mount, d.printerReadable])).toEqual([["G:\\", false]]);
  });

  it("copies onto the card without overwriting", async () => {
    const card = await fs.mkdtemp(path.join(os.tmpdir(), "ms-card-"));
    const src = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ms-src-")), "robot.gcode.3mf");
    await fs.writeFile(src, "sliced");
    const before = process.env.MAKERSTUDIO_SD_ROOT;
    process.env.MAKERSTUDIO_SD_ROOT = card;
    try {
      expect(await copyToDrive(src, card, "robot.gcode.3mf")).toBe(path.join(card, "robot.gcode.3mf"));
      expect(await copyToDrive(src, card, "robot.gcode.3mf")).toBe(path.join(card, "robot (2).gcode.3mf"));
      expect((await fs.readdir(card)).sort()).toEqual(["robot (2).gcode.3mf", "robot.gcode.3mf"]);
      await expect(copyToDrive(src, "/somewhere/else", "x.gcode.3mf")).rejects.toThrow(/not plugged in/);
    } finally {
      if (before === undefined) delete process.env.MAKERSTUDIO_SD_ROOT;
      else process.env.MAKERSTUDIO_SD_ROOT = before;
      await fs.rm(card, { recursive: true, force: true });
    }
  });
});
