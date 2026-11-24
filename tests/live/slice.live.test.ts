// Slices with the real Bambu Studio command-line slicer. Skipped when Bambu Studio is not installed.
// Run: npx vitest run -c vitest.live.config.ts tests/live/slice.live.test.ts

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseToolpaths } from "../../src/core/print/gcode";
import { slice, sliceCatalog, slicedPlate } from "../../src/main/bambuSlice";
import { findLauncher } from "../../src/main/slicer";

function cubeStl(size: number): Uint8Array {
  const v = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => [x * size, y * size, z * size])));
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  let s = "solid cube\n";
  for (const [a, b, c, d] of faces) {
    for (const t of [[a, b, c], [a, c, d]]) {
      s += " facet normal 0 0 0\n  outer loop\n" + t.map((i) => `   vertex ${v[i!]!.join(" ")}\n`).join("") + "  endloop\n endfacet\n";
    }
  }
  return new TextEncoder().encode(s + "endsolid cube\n");
}

const PRINTER = { name: "Bambu Lab A1", nozzle: 0.4 };
const OPTIONS = { process: "0.20mm Standard @BBL A1", filament: "Bambu PLA Basic @BBL A1", plate: "Textured PEI Plate", supports: "off" as const, infill: null };

const installed = await findLauncher();

describe.skipIf(!installed)("slicing with Bambu Studio", () => {
  let out = "";
  beforeAll(async () => { out = await fs.mkdtemp(path.join(os.tmpdir(), "ms-slice-")); });
  afterAll(() => fs.rm(out, { recursive: true, force: true }));

  it("offers the A1's presets", async () => {
    const catalog = await sliceCatalog(PRINTER.name, PRINTER.nozzle);
    expect(catalog.printer).toBe("Bambu Lab A1 0.4 nozzle");
    expect(catalog.processes.map((p) => p.label)).toContain("0.20mm Standard");
    expect(catalog.filaments[0]!.label).toBe("Bambu PLA Basic");
    expect(catalog.filaments.some((f) => f.group === "PETG")).toBe(true);
  });

  it("slices one part into one A1 file", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await slice({ name: "Test cube", files: [{ name: "cube.stl", bytes: cubeStl(20) }], options: OPTIONS, thumbnails: { large: png, small: png } }, PRINTER, out);
    expect(result.plates).toHaveLength(1);
    const plate = result.plates[0]!;
    expect(plate.fileName).toBe("Test cube.gcode.3mf");
    expect(plate.layers).toBe(100);
    expect(plate.filamentGrams).toBeGreaterThan(2);
    expect(plate.seconds).toBeGreaterThan(60);
    expect(result.bedCentre).toEqual([128, 128]);

    const stored = slicedPlate(result.id, 0);
    const files = unzipSync(new Uint8Array(await fs.readFile(stored.file)));
    const info = strFromU8(files["Metadata/slice_info.config"]!);
    expect(info).toContain('key="printer_model_id" value="N2S"');
    expect(files["Metadata/plate_1.png"]).toEqual(png);
    const gcode = strFromU8(files["Metadata/plate_1.gcode"]!);
    expect(gcode).toContain("; printer_model = Bambu Lab A1");
    expect(gcode).toContain("; curr_bed_type = Textured PEI Plate");

    const preview = parseToolpaths(await fs.readFile(stored.gcode, "utf8"));
    expect(preview.layerCount).toBe(100);
    expect(preview.features.map((f) => f.name)).toContain("Outer wall");
  }, 120_000);

  it("turns on supports and changes infill", async () => {
    const result = await slice({ name: "Options", files: [{ name: "cube.stl", bytes: cubeStl(20) }], options: { ...OPTIONS, supports: "tree", infill: 40, plate: "Cool Plate" } }, PRINTER, out);
    const gcode = await fs.readFile(slicedPlate(result.id, 0).gcode, "utf8");
    expect(gcode).toContain("; enable_support = 1");
    expect(gcode).toContain("; sparse_infill_density = 40%");
    expect(gcode).toContain("; curr_bed_type = Cool Plate");
  }, 120_000);

  it("makes one file per plate when the parts do not fit on one", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `block ${i + 1}.stl`, bytes: cubeStl(100) }));
    const result = await slice({ name: "Blocks", files, options: OPTIONS }, PRINTER, out);
    expect(result.plates.map((p) => p.fileName)).toEqual(["Blocks plate 1.gcode.3mf", "Blocks plate 2.gcode.3mf"]);
    expect(result.plates.flatMap((p) => p.parts).sort()).toEqual(files.map((f) => f.name.replace(".stl", "")).sort());
    for (const [i] of result.plates.entries()) {
      const zip = unzipSync(new Uint8Array(await fs.readFile(slicedPlate(result.id, i).file)));
      expect(Object.keys(zip).filter((n) => /plate_\d+\.gcode$/.test(n))).toEqual(["Metadata/plate_1.gcode"]);
    }
    expect(result.warnings[0]).toMatch(/need 2 plates/);
  }, 300_000);

  it("explains a part that is bigger than the bed", async () => {
    await expect(slice({ name: "Huge", files: [{ name: "huge.stl", bytes: cubeStl(300) }], options: OPTIONS }, PRINTER, out)).rejects.toThrow(/bigger than the printer's bed/);
  }, 120_000);
});
