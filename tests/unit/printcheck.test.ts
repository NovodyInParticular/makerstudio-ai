import { beforeAll, describe, expect, it } from "vitest";
import { addObject, groupObjects, orientObjects, setTransforms } from "../../src/core/cad/commands";
import { initCsg } from "../../src/core/cad/csg";
import { collectParts } from "../../src/core/cad/exporting";
import { worldBounds } from "../../src/core/cad/geometry";
import { DEFAULT_PARAMS, IDENTITY, type CadObject, type PrimitiveKind } from "../../src/core/cad/model";
import { BAMBU_A1, bestOrientation, checkPart, checkPrint } from "../../src/core/cad/printcheck";
import { createProjectStore } from "../../src/core/document/store";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

function shape(id: string, kind: PrimitiveKind, params: Record<string, number> = {}, position: [number, number, number] = [0, 0, 0]): CadObject {
  return {
    id, name: id, kind, params: { ...DEFAULT_PARAMS[kind], ...params }, transform: { ...IDENTITY, position },
    hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false,
  };
}

const box = (id: string, width: number, depth: number, height: number, position: [number, number, number] = [0, 0, 0]) =>
  shape(id, "box", { width, depth, height }, position);

/** Report for a single object on its own. */
function report(o: CadObject) {
  const { parts } = collectParts([], [o]);
  return checkPart(parts[0]!, BAMBU_A1);
}

const codes = (r: ReturnType<typeof report>) => r.issues.map((i) => i.code).sort();

describe("print check", () => {
  it("finds nothing wrong with a plain box on the bed", () => {
    const r = report(box("a", 20, 20, 20));
    expect(r.issues).toEqual([]);
    expect(r.bedContactArea).toBeCloseTo(400, 3);
    expect(r.overhangArea).toBe(0);
    expect(r.size).toEqual([20, 20, 20]);
  });

  it("refuses parts bigger than the A1 build volume and says when turning would help", () => {
    const wide = report(box("a", 400, 20, 20));
    expect(codes(wide)).toContain("too-big");
    expect(wide.issues.find((i) => i.code === "too-big")!.message).toMatch(/Scale it down/);
    const tall = report(box("b", 20, 20, 270));
    expect(tall.issues.find((i) => i.code === "too-big")!.message).toMatch(/diagonally/);
    // On a printer with a lower build height, a tall part fits when laid on its side.
    const low = { ...BAMBU_A1, bedZ: 200 };
    const { parts } = collectParts([], [box("d", 20, 20, 220)]);
    expect(checkPart(parts[0]!, low).issues.find((i) => i.code === "too-big")!.message).toMatch(/turned on its side/);
    // Exactly the build volume fits.
    expect(codes(report(box("c", 256, 256, 256)))).not.toContain("too-big");
  });

  it("reports parts off the bed, floating, or below it", () => {
    expect(codes(report(box("a", 20, 20, 20, [130, 0, 0])))).toContain("off-bed");
    expect(codes(report(box("b", 20, 20, 20, [0, 0, 5])))).toEqual(["floating"]);
    expect(codes(report(box("c", 20, 20, 20, [0, 0, -3])))).toContain("below-bed");
  });

  it("measures wall thickness against the nozzle", () => {
    const tooThin = report(box("a", 20, 0.3, 20));
    expect(codes(tooThin)).toContain("too-thin");
    expect(tooThin.thinnest!).toBeCloseTo(0.3, 2);
    const thin = report(box("b", 20, 0.6, 20));
    expect(codes(thin)).toContain("thin-wall");
    expect(codes(thin)).not.toContain("too-thin");
    expect(thin.thinnest!).toBeCloseTo(0.6, 2);
    expect(report(box("c", 20, 2, 20)).thinnest).toBeNull();
  });

  it("measures walls on a very detailed mesh with a bounded number of rays (regression: 4 million triangles took 17 s)", () => {
    // A 40 x 40 mm plate 0.3 mm thick, each face split into 2 x 250 x 250 triangles (250,000 in all).
    const n = 250, size = 40, thick = 0.3;
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [y, flip] of [[-thick / 2, false], [thick / 2, true]] as const) {
      const base = positions.length / 3;
      for (let i = 0; i <= n; i++) for (let k = 0; k <= n; k++) positions.push(-size / 2 + (size * i) / n, y, (size * k) / n);
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
        const a = base + i * (n + 1) + k, b = a + n + 1, c = a + 1, d = b + 1;
        // Front faces -Y, back faces +Y (outward normals).
        if (flip) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
      }
    }
    const part = { id: "p", name: "Plate", positions: new Float32Array(positions), indices: new Uint32Array(indices), watertight: true };
    const start = performance.now();
    const r = checkPart(part, BAMBU_A1);
    const ms = performance.now() - start;
    expect(r.issues.map((i) => i.code)).toContain("too-thin");
    expect(r.thinnest!).toBeCloseTo(thick, 2);
    // Sampled, but still an unbiased estimate of both 1600 mm² faces.
    expect(r.tooThinArea).toBeGreaterThan(3200 * 0.9);
    expect(r.tooThinArea).toBeLessThan(3200 * 1.1);
    expect(ms).toBeLessThan(8000); // loose bound: tests share the CPU
  });

  it.each([[20, 20], [30, 12], [40, 8]])("does not call the sharp edge of a %i x %i wedge a thin wall", (width, height) => {
    const r = report(shape("w", "wedge", { width, depth: 20, height }));
    expect(codes(r)).not.toContain("too-thin");
    expect(codes(r)).not.toContain("thin-wall");
  });

  it("finds a wall left thin by a hole", () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: box("block", 20, 20, 10) }));
    s.getState().execute(addObject({ object: { ...shape("hole", "cylinder", { radius: 9.9, height: 12 }, [0, 0, -1]), hole: true } }));
    s.getState().execute(groupObjects({ ids: ["block", "hole"], groupId: "g" }));
    const objects = s.getState().project.document.workspaces.cad.objects as CadObject[];
    const { parts } = collectParts([], objects);
    const r = checkPart(parts[0]!, BAMBU_A1);
    expect(codes(r)).toContain("too-thin");
    expect(r.thinnest!).toBeLessThan(0.4);
  });

  it("finds overhangs, but not the face resting on the bed", () => {
    // A T shape: a 5 x 5 pillar carrying a 30 x 30 slab.
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: box("pillar", 5, 5, 20) }));
    s.getState().execute(addObject({ object: box("slab", 30, 30, 3, [0, 0, 20]) }));
    s.getState().execute(groupObjects({ ids: ["pillar", "slab"], groupId: "t" }));
    const objects = s.getState().project.document.workspaces.cad.objects as CadObject[];
    const r = checkPart(collectParts([], objects).parts[0]!, BAMBU_A1);
    expect(r.overhangArea).toBeCloseTo(900 - 25, 3);
    expect(r.bedContactArea).toBeCloseTo(25, 3);
    expect(codes(r)).toContain("overhang");
    expect(r.overhangTriangles.length).toBeGreaterThan(0);
  });

  it("warns when nothing flat rests on the bed", () => {
    expect(codes(report(shape("ball", "sphere", { radius: 10 })))).toContain("no-contact");
  });

  it("summarises the worst problem over all parts", () => {
    const objects = [box("ok", 10, 10, 10), box("float", 10, 10, 10, [40, 0, 5])];
    expect(checkPrint(collectParts([], objects).parts, BAMBU_A1).worst).toBe("info");
    const big = [...objects, box("big", 300, 10, 10, [0, 60, 0])];
    const all = checkPrint(collectParts([], big).parts, BAMBU_A1);
    expect(all.worst).toBe("error");
    expect(all.parts.map((p) => p.id)).toEqual(["ok", "float", "big"]);
  });
});

describe("print orientation", () => {
  function tShape() {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: box("pillar", 5, 5, 20) }));
    s.getState().execute(addObject({ object: box("slab", 30, 30, 3, [0, 0, 20]) }));
    s.getState().execute(groupObjects({ ids: ["pillar", "slab"], groupId: "t" }));
    return s;
  }
  const objects = (s: ReturnType<typeof tShape>) => s.getState().project.document.workspaces.cad.objects as CadObject[];

  it("turns a T shape upside down so the slab is on the bed, and undo restores it", () => {
    const s = tShape();
    const part = collectParts(["t"], objects(s)).parts[0]!;
    const choice = bestOrientation(part, BAMBU_A1);
    expect(choice.keep).toBe(false);
    expect(choice.overhangArea).toBeLessThan(1);
    expect(choice.contactArea).toBeCloseTo(900, 3);
    expect(choice.current.overhangArea).toBeCloseTo(875, 3);

    s.getState().execute(orientObjects({ updates: [{ id: "t", quaternion: choice.quaternion }] }));
    const after = checkPart(collectParts(["t"], objects(s)).parts[0]!, BAMBU_A1);
    expect(after.overhangArea).toBeLessThan(1);
    expect(after.bedContactArea).toBeCloseTo(900, 2);
    const b = worldBounds(["t"], objects(s));
    expect(b.min.z).toBeCloseTo(0, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(23, 4);
    // Stays where it was on the bed (centre in X/Y).
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 4);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(0, 4);

    s.getState().undo();
    expect(objects(s).find((o) => o.id === "t")!.transform).toEqual(IDENTITY);
  });

  it("keeps a box that is already printable as it is", () => {
    const choice = bestOrientation(collectParts([], [box("a", 20, 20, 20)]).parts[0]!, BAMBU_A1);
    expect(choice.keep).toBe(true);
    expect(choice.quaternion).toEqual([0, 0, 0, 1]);
  });

  it("lays a tall thin bar down onto its long side", () => {
    const choice = bestOrientation(collectParts([], [box("bar", 10, 10, 60)]).parts[0]!, BAMBU_A1);
    expect(choice.keep).toBe(false);
    expect(choice.height).toBeCloseTo(10, 4);
    expect(choice.contactArea).toBeCloseTo(600, 3);
  });

  it("lays a part that is too long for the printer diagonally across the bed", () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: box("pole", 10, 10, 300) }));
    const objects = () => s.getState().project.document.workspaces.cad.objects as CadObject[];
    const choice = bestOrientation(collectParts([], objects()).parts[0]!, BAMBU_A1);
    expect(choice.keep).toBe(false);
    expect(choice.height).toBeCloseTo(10, 4);
    s.getState().execute(orientObjects({ updates: [{ id: "pole", quaternion: choice.quaternion }] }));
    expect(codes(checkPart(collectParts([], objects()).parts[0]!, BAMBU_A1))).not.toContain("too-big");
  });

  it("refuses to orient objects inside a group", () => {
    const s = tShape();
    expect(() => s.getState().execute(orientObjects({ updates: [{ id: "slab", quaternion: [0, 0, 0, 1] }] }))).toThrow(/top-level/);
    s.getState().execute(setTransforms({ updates: [{ id: "t", transform: { position: [1, 2, 0] } }] }));
  });
});
