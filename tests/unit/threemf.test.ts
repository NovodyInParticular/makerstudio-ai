import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { read3mf } from "../../src/core/cad/threemf";

const cube = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="2" v3="3"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>`;

describe("3MF", () => {
  it("reads build items with transforms and units", () => {
    const xml = `<model unit="centimeter"><resources><object id="1" name="Tet" type="model">${cube}</object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></build></model>`;
    const [o] = read3mf(zipSync({ "3D/3dmodel.model": strToU8(xml) }));
    expect(o!.name).toBe("Tet");
    expect(o!.mesh.indices.length).toBe(12);
    expect(Math.max(...o!.mesh.positions)).toBeCloseTo(150); // (10 + 5) cm
  });
  it("follows Bambu-style components into other model files", () => {
    const part = `<model unit="millimeter"><resources><object id="7" type="model">${cube}</object></resources></model>`;
    const main = `<model unit="millimeter"><resources><object id="2" name="Arm"><components><component p:path="/3D/Objects/object_1.model" objectid="7" transform="1 0 0 0 1 0 0 0 1 0 0 20"/><component p:path="/3D/Objects/object_1.model" objectid="7"/></components></object></resources><build><item objectid="2"/></build></model>`;
    const r = read3mf(zipSync({ "3D/3dmodel.model": strToU8(main), "3D/Objects/object_1.model": strToU8(part) }));
    expect(r.length).toBe(1);
    expect(r[0]!.name).toBe("Arm");
    expect(r[0]!.mesh.indices.length).toBe(24);
    expect(Math.max(...Array.from(r[0]!.mesh.positions).filter((_, i) => i % 3 === 2))).toBe(30);
  });
});
