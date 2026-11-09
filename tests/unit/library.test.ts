import { describe, expect, it } from "vitest";
import { LIBRARY, PartSchema, searchParts } from "../../src/core/parts/library";
import { componentDef } from "../../src/core/circuit/catalog";
import { displayById } from "../../src/core/display/catalog";

describe("Parts Library (acceptance: schema over the whole catalog, no spec without a source)", () => {
  it("every part passes the schema", () => {
    for (const p of LIBRARY) { const r = PartSchema.safeParse(p); expect(r.success, `${p.id}: ${r.success ? "" : JSON.stringify(r.error.issues[0])}`).toBe(true); }
  });
  it("no spec has a value without a source; unknown specs have no value", () => {
    for (const p of LIBRARY) for (const s of [...p.specs, ...(p.size ? [p.size.x, p.size.y, p.size.z] : [])]) {
      if (s.status === "unknown") expect(s.value, `${p.id} ${s.label}`).toBeNull();
      else { expect(s.value, `${p.id} ${s.label}`).not.toBeNull(); expect((s.source ?? "").length, `${p.id} ${s.label}`).toBeGreaterThan(5); }
    }
  });
  it("ids are unique and links to the studios resolve", () => {
    expect(new Set(LIBRARY.map((p) => p.id)).size).toBe(LIBRARY.length);
    for (const p of LIBRARY) {
      if (p.circuitType) expect(componentDef(p.circuitType), p.id).toBeTruthy();
      if (p.displayId) expect(displayById(p.displayId), p.id).toBeTruthy();
    }
  });
  it("search finds by words, category and interface", () => {
    expect(searchParts("xiao camera").map((p) => p.id)).toContain("xiao-esp32s3-sense");
    expect(searchParts("608", "Hardware").map((p) => p.id)).toEqual(["bearing-608"]);
    expect(searchParts("i²c").length).toBeGreaterThan(3);
    expect(searchParts("does-not-exist")).toEqual([]);
  });
  it("standard hardware dimensions are as the ISO tables give them", () => {
    const b = LIBRARY.find((p) => p.id === "bearing-608")!;
    expect(b.specs.map((s) => s.value)).toEqual([8, 22, 7]);
    const s3 = LIBRARY.find((p) => p.id === "screw-m3-shcs")!;
    expect(s3.specs.find((s) => s.label.startsWith("Head diameter"))!.value).toBe(5.5);
  });
});
