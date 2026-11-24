import { describe, expect, it } from "vitest";
import { featureStyle, formatDuration, layerAtHeight, parseDuration, parseToolpaths, readGcodeSummary } from "../../src/core/print/gcode";

const HEADER = `; HEADER_BLOCK_START
; BambuStudio 02.09.01.70
; model printing time: 11m 59s; total estimated time: 1h 2m 18s
; total layer number: 100
; total filament length [mm] : 1236.91
; total filament volume [cm^3] : 2975.12
; total filament weight [g] : 3.75
; max_z_height: 20.00
; HEADER_BLOCK_END
`;

// Purge line before the first layer, two layers, a retraction, a travel, an arc and end code.
const GCODE = `${HEADER}
G90
M83
G1 X0 Y0 Z0.3 F3000
G1 X200 Y0 E10 ; purge line, not part of the print
; MACHINE_START_GCODE_END
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 X10 Y10 F42000
G1 Z0.2
; FEATURE: Outer wall
G1 X20 Y10 E0.5
G1 X20 Y20 E0.5
G1 E-0.8 F1800
G1 X30 Y20 F42000
G1 E0.8
; FEATURE: Sparse infill
G1 X40 Y20 E0.4
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
G1 Z0.4
; FEATURE: Outer wall
G1 X50 Y20 E0.4
; FEATURE: Bridge
G3 X60 Y20 I5 J0 E0.6
G3 Z0.6 I1.2 J0 P1 F42000
; MACHINE_END_GCODE_START
G1 X100 Y100 E5
`;

describe("G-code summary", () => {
  it("reads time, layers and filament from the header", () => {
    expect(readGcodeSummary(GCODE)).toEqual({ seconds: 3738, layers: 100, filamentGrams: 3.75, filamentMm: 1236.91, maxZ: 20 });
  });

  it("returns nulls when there is no header", () => {
    expect(readGcodeSummary("G1 X1 Y1\n")).toEqual({ seconds: null, layers: null, filamentGrams: null, filamentMm: null, maxZ: null });
  });

  it("parses and formats durations", () => {
    expect(parseDuration("1d 2h 3m 4s")).toBe(93784);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("soon")).toBeNull();
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(12 * 60 + 10)).toBe("12 min");
    expect(formatDuration(3 * 3600 + 5 * 60)).toBe("3 h 05 min");
    expect(formatDuration(26 * 3600)).toBe("1 d 2 h");
  });
});

describe("G-code toolpaths", () => {
  const preview = parseToolpaths(GCODE);
  const byName = Object.fromEntries(preview.features.map((f) => [f.name, f]));

  it("keeps only the print's extrusion moves, by layer", () => {
    expect(preview.layerCount).toBe(2);
    // Every previewed segment is inside the bounds (the purge line before the first layer is not).
    expect(preview.bounds![0]).toBeCloseTo(10, 5);
    expect(preview.bounds![1]).toBeCloseTo(10, 5);
    expect(preview.bounds![3]).toBeCloseTo(60, 3); // the bridge arc ends at X60; the purge line went to X200
    expect(preview.bounds![5]).toBeCloseTo(0.4, 5);
    expect(Array.from(preview.layerZ)).toEqual([expect.closeTo(0.2, 5), expect.closeTo(0.4, 5)]);
    // Outer wall: 2 segments on layer 1, 1 on layer 2. The purge line, travel and end code are left out.
    expect(Array.from(byName["Outer wall"]!.layerEnds)).toEqual([2, 3]);
    expect(Array.from(byName["Outer wall"]!.positions.slice(0, 6))).toEqual([10, 10, expect.closeTo(0.2, 5), 20, 10, expect.closeTo(0.2, 5)]);
    // The move after the retraction starts where the travel ended.
    expect(Array.from(byName["Sparse infill"]!.positions)).toEqual([30, 20, expect.closeTo(0.2, 5), 40, 20, expect.closeTo(0.2, 5)]);
    expect(Array.from(byName["Sparse infill"]!.layerEnds)).toEqual([1, 1]);
  });

  it("turns an extruding arc into short segments and ignores lift spirals", () => {
    const bridge = byName["Bridge"]!;
    expect(Array.from(bridge.layerEnds)).toEqual([0, bridge.positions.length / 6]);
    expect(bridge.positions.length / 6).toBeGreaterThan(10);
    // Counter-clockwise half circle from (50,20) around (55,20): it passes below the centre line.
    const ys = [];
    for (let i = 1; i < bridge.positions.length; i += 3) ys.push(bridge.positions[i]!);
    expect(Math.min(...ys)).toBeCloseTo(15, 1);
    const last = bridge.positions.length - 3;
    expect([bridge.positions[last], bridge.positions[last + 1]]).toEqual([60, 20]);
  });

  it("stops at the segment limit and says where", () => {
    const small = parseToolpaths(GCODE, { maxSegments: 2 });
    expect(small.segments).toBe(2);
    expect(small.truncatedAtLayer).toBe(0);
  });

  it("handles absolute extrusion (M82) and G92 resets", () => {
    const g = `; CHANGE_LAYER\n; Z_HEIGHT: 0.2\nM82\nG92 E0\n; FEATURE: Outer wall\nG1 X1 Y0 Z0.2 E1\nG1 X2 Y0 E1\nG1 X3 Y0 E2\nG92 E0\nG1 X4 Y0 E0.5\n`;
    const p = parseToolpaths(g);
    expect(p.segments).toBe(3);
  });

  it("finds the layer at a height", () => {
    const z = Float32Array.from([0.2, 0.4, 0.6, 0.8]);
    expect(layerAtHeight(z, 0.5)).toBe(1);
    expect(layerAtHeight(z, 0.8)).toBe(3);
    expect(layerAtHeight(z, 0)).toBe(0);
  });

  it("names and colours features", () => {
    expect(featureStyle("Sparse infill").label).toBe("Infill");
    expect(featureStyle("Something new").label).toBe("Something new");
  });
});
