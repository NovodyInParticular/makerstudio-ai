import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { addObject, booleanOp, groupObjects, setParams, setTransforms } from "../../src/core/cad/commands";
import { checkMesh, initCsg, solidMesh } from "../../src/core/cad/csg";
import { collectParts, partFileNames, safeFileName, writeObj, writeStl } from "../../src/core/cad/exporting";
import { worldBounds } from "../../src/core/cad/geometry";
import {
  centreOnOrigin, decodeMesh, encodeMesh, getMesh, meshBounds, newMeshKey, parseMeshFile, registerMesh, weldTriangles, type MeshData,
} from "../../src/core/cad/meshes";
import { DEFAULT_PARAMS, IDENTITY, type CadObject, type PrimitiveKind } from "../../src/core/cad/model";
import { createProjectStore } from "../../src/core/document/store";
import { packProject, ProjectFormatError, unpackProject } from "../../src/shared/format";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

// A closed 10 x 20 x 30 mm box from x=5, y=5, z=5 (deliberately not at the origin), as an ASCII STL.
function boxTriangles(x0 = 5, y0 = 5, z0 = 5, w = 10, d = 20, h = 30): number[][] {
  const x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return faces.map((f) => f.flatMap((i) => v[i]!));
}

function asciiStl(tris: number[][]): Uint8Array {
  const lines = ["solid test"];
  for (const t of tris) {
    lines.push("facet normal 0 0 0", " outer loop");
    for (let c = 0; c < 3; c++) lines.push(`  vertex ${t[c * 3]} ${t[c * 3 + 1]} ${t[c * 3 + 2]}`);
    lines.push(" endloop", "endfacet");
  }
  lines.push("endsolid test");
  return new TextEncoder().encode(lines.join("\n"));
}

function binaryStl(tris: number[][]): Uint8Array {
  const bytes = new Uint8Array(84 + tris.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((v, j) => view.setFloat32(84 + i * 50 + 12 + j * 4, v, true)));
  return bytes;
}

function objFile(): Uint8Array {
  const tris = boxTriangles();
  const verts: string[] = [];
  const faces: string[] = [];
  tris.forEach((t, i) => {
    for (let c = 0; c < 3; c++) verts.push(`v ${t[c * 3]} ${t[c * 3 + 1]} ${t[c * 3 + 2]}`);
    faces.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`);
  });
  return new TextEncoder().encode(["o box", ...verts, ...faces].join("\n"));
}

function size(mesh: MeshData) {
  const { min, max } = meshBounds(mesh);
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((n) => Math.round(n * 1000) / 1000);
}

function meshObject(id: string, key: string, extra: Partial<CadObject> = {}): CadObject {
  return { id, name: id, kind: "mesh", mesh: key, params: {}, transform: { ...IDENTITY }, hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false, ...extra };
}

function shape(id: string, kind: PrimitiveKind, position: [number, number, number] = [0, 0, 0]): CadObject {
  return { id, name: id, kind, params: { ...DEFAULT_PARAMS[kind] }, transform: { ...IDENTITY, position }, hole: false, color: "#2fd6a3", parentId: null, visible: true, locked: false };
}

function importBox(): string {
  const key = newMeshKey();
  registerMesh(key, centreOnOrigin(parseMeshFile("box.stl", asciiStl(boxTriangles()))).mesh);
  return key;
}

describe("reading mesh files", () => {
  it.each([
    ["ASCII STL", "a.stl", asciiStl(boxTriangles())],
    ["binary STL", "b.STL", binaryStl(boxTriangles())],
    ["OBJ", "c.obj", objFile()],
  ])("%s: welded into a closed 10 x 20 x 30 mm solid", (_label, name, bytes) => {
    const mesh = parseMeshFile(name, bytes);
    expect(mesh.positions.length / 3).toBe(8); // 36 corners welded into 8 vertices
    expect(mesh.indices.length / 3).toBe(12);
    expect(size(mesh)).toEqual([10, 20, 30]);
    const check = checkMesh(mesh);
    expect(check.watertight).toBe(true);
    expect(check.volume).toBeCloseTo(6000, 3);
  });

  it("detects an open (not watertight) mesh", () => {
    const open = parseMeshFile("open.stl", asciiStl(boxTriangles().slice(0, 10)));
    expect(checkMesh(open).watertight).toBe(false);
  });

  it("refuses unknown formats, empty files and broken numbers", () => {
    expect(() => parseMeshFile("x.3mf", new Uint8Array(10))).toThrow(/Only STL and OBJ/);
    expect(() => parseMeshFile("x.obj", new TextEncoder().encode("# nothing"))).toThrow(/no usable triangles/);
    expect(() => weldTriangles([0, 0, 0, NaN, 0, 0, 0, 1, 0])).toThrow(/invalid coordinate/);
  });

  it("drops triangles that collapsed to a line", () => {
    const mesh = weldTriangles([...boxTriangles().flat(), 0, 0, 0, 0, 0, 0, 1, 1, 1]);
    expect(mesh.indices.length / 3).toBe(12);
  });

  it("centres the mesh on its bottom face and reports where it was", () => {
    const { mesh, offset } = centreOnOrigin(parseMeshFile("a.stl", asciiStl(boxTriangles())));
    expect(offset).toEqual([10, 15, 5]);
    expect(meshBounds(mesh)).toEqual({ min: [-5, -10, 0], max: [5, 10, 30] });
  });
});

describe("mesh storage", () => {
  it("binary encoding round trip", () => {
    const mesh = parseMeshFile("a.stl", asciiStl(boxTriangles()));
    const back = decodeMesh(encodeMesh(mesh));
    expect(Array.from(back.positions)).toEqual(Array.from(mesh.positions));
    expect(Array.from(back.indices)).toEqual(Array.from(mesh.indices));
  });

  it("rejects damaged mesh data", () => {
    const bytes = encodeMesh(parseMeshFile("a.stl", asciiStl(boxTriangles())));
    expect(() => decodeMesh(bytes.slice(0, bytes.length - 4))).toThrow(/wrong length/);
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(bad.length - 4, 999, true);
    expect(() => decodeMesh(bad)).toThrow(/does not exist/);
    expect(() => decodeMesh(new TextEncoder().encode("NOTAMESH12345678"))).toThrow(/unknown format/);
  });

  it("saves the mesh in the project file, reopens it, and drops meshes nothing uses", () => {
    const s = createProjectStore(undefined, "test");
    const key = importBox();
    const unused = importBox();
    s.getState().addAsset(key, encodeMesh(getMesh(key)!));
    s.getState().addAsset(unused, encodeMesh(getMesh(unused)!));
    s.getState().execute(addObject({ object: meshObject("m", key) }));
    const snapshot = s.getState().snapshotForSave();
    expect(Object.keys(snapshot.assets)).toEqual([key]);
    const reopened = unpackProject(packProject(snapshot));
    const t = createProjectStore(undefined, "test");
    t.getState().load(reopened, null);
    const objects = t.getState().project.document.workspaces.cad.objects as CadObject[];
    expect(worldBounds(["m"], objects).getSize(new Vector3()).toArray().map(Math.round)).toEqual([10, 20, 30]);
  });

  it("a project whose mesh is missing or damaged is refused with a clear message", () => {
    const s = createProjectStore(undefined, "test");
    const key = importBox();
    s.getState().addAsset(key, encodeMesh(getMesh(key)!));
    s.getState().execute(addObject({ object: meshObject("m", key) }));
    const snapshot = s.getState().snapshotForSave();
    expect(() => unpackProject(packProject({ ...snapshot, assets: {} }))).toThrow(ProjectFormatError);
    expect(() => unpackProject(packProject({ ...snapshot, assets: { [key]: new Uint8Array(20) } }))).toThrow(/damaged/);
  });

  it("an object cannot point at a mesh that was never loaded, and has no size fields", () => {
    const s = createProjectStore(undefined, "test");
    expect(() => s.getState().execute(addObject({ object: meshObject("m", newMeshKey()) }))).toThrow(/not been loaded/);
    const key = importBox();
    s.getState().execute(addObject({ object: meshObject("m", key) }));
    expect(() => s.getState().execute(setParams({ id: "m", params: { width: 5 } }))).toThrow(/Use Scale/);
  });
});

describe("Booleans with imported meshes", () => {
  it("a cylinder hole cut through an imported box", () => {
    const s = createProjectStore(undefined, "test");
    const key = importBox();
    s.getState().execute(addObject({ object: meshObject("m", key) }));
    s.getState().execute(addObject({ object: { ...shape("c", "cylinder"), params: { radius: 3, height: 40, segments: 48 } } }));
    s.getState().execute(booleanOp({ ids: ["m", "c"], groupId: "g", op: "subtract" }));
    const objects = s.getState().project.document.workspaces.cad.objects as CadObject[];
    const solid = solidMesh(objects.find((o) => o.id === "g")!, objects);
    expect(solid.genus).toBe(1); // one hole straight through
    expect(solid.volume).toBeLessThan(6000);
    expect(solid.volume).toBeGreaterThan(6000 - Math.PI * 9 * 30 - 1);
  });

  it("an open mesh cannot be combined, with a clear message", () => {
    const key = newMeshKey();
    registerMesh(key, parseMeshFile("open.stl", asciiStl(boxTriangles().slice(0, 10))));
    const o = meshObject("m", key, { name: "Broken part" });
    expect(() => solidMesh(o, [o])).toThrow(/"Broken part" is not a closed \(watertight\) solid/);
  });

  it("an open mesh cannot be grouped or combined, and nothing changes (regression: the window went blank)", () => {
    const key = newMeshKey();
    registerMesh(key, parseMeshFile("open.stl", asciiStl(boxTriangles().slice(0, 10))));
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: meshObject("m", key, { name: "Broken part" }) }));
    s.getState().execute(addObject({ object: shape("b", "box", [50, 0, 0]) }));
    const before = s.getState().project.document.workspaces.cad.objects;
    expect(() => s.getState().execute(groupObjects({ ids: ["m", "b"], groupId: "g" }))).toThrow(/"Broken part" is not a closed \(watertight\) solid, so it cannot be grouped/);
    expect(() => s.getState().execute(booleanOp({ ids: ["b", "m"], groupId: "g", op: "subtract" }))).toThrow(/cannot be grouped or combined/);
    expect(s.getState().project.document.workspaces.cad.objects).toBe(before);
    // Adding it straight into a group (as the AI could) is refused too.
    s.getState().execute(addObject({ object: shape("c", "box", [0, 50, 0]) }));
    s.getState().execute(groupObjects({ ids: ["b", "c"], groupId: "g2" }));
    expect(() => s.getState().execute(addObject({ object: meshObject("m2", key, { parentId: "g2" }) }))).toThrow(/cannot be grouped/);
  });

  it("worldBounds of a group that cannot be combined (an old file) falls back to its parts", () => {
    const key = newMeshKey();
    registerMesh(key, parseMeshFile("open.stl", asciiStl(boxTriangles().slice(0, 10))));
    const group: CadObject = { ...shape("g", "box"), kind: "group", params: {} };
    const objects = [group, meshObject("m", key, { parentId: "g" }), { ...shape("b", "box", [100, 0, 0]), parentId: "g" }];
    const box = worldBounds(["g"], objects);
    expect(box.isEmpty()).toBe(false);
    expect(box.max.x).toBeCloseTo(110);
  });
});

describe("exporting", () => {
  it("STL export of a moved and scaled object reads back closed, in world position", () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: shape("b", "box", [100, 0, 0]) }));
    s.getState().execute(setTransforms({ updates: [{ id: "b", transform: { scale: [2, 1, 1] } }] }));
    const objects = s.getState().project.document.workspaces.cad.objects as CadObject[];
    const { parts, warnings } = collectParts([], objects);
    expect(warnings).toEqual([]);
    const back = parseMeshFile("out.stl", writeStl(parts));
    expect(checkMesh(back).watertight).toBe(true);
    expect(checkMesh(back).volume).toBeCloseTo(16000, 2);
    expect(meshBounds(back)).toEqual({ min: [80, -10, 0], max: [120, 10, 20] });
  });

  it("a mirrored (negative scale) object stays right side out", () => {
    const o = { ...shape("b", "box"), transform: { ...IDENTITY, scale: [-1, 1, 1] as [number, number, number] } };
    const back = parseMeshFile("out.stl", writeStl(collectParts([], [o]).parts));
    expect(checkMesh(back).volume).toBeCloseTo(8000, 2);
  });

  it("cuts holes in groups, skips loose holes and hidden objects with warnings", () => {
    const s = createProjectStore(undefined, "test");
    s.getState().execute(addObject({ object: shape("a", "box") }));
    s.getState().execute(addObject({ object: shape("b", "box", [10, 0, 0]) }));
    s.getState().execute(booleanOp({ ids: ["a", "b"], groupId: "g", op: "subtract" }));
    s.getState().execute(addObject({ object: { ...shape("h", "sphere", [50, 0, 0]), hole: true } }));
    s.getState().execute(addObject({ object: { ...shape("x", "box", [-50, 0, 0]), visible: false } }));
    const objects = s.getState().project.document.workspaces.cad.objects as CadObject[];
    const { parts, warnings } = collectParts(["g", "h", "x"], objects);
    expect(parts.map((p) => p.name)).toEqual(["Subtraction"]);
    expect(warnings).toHaveLength(2);
    expect(checkMesh(parseMeshFile("o.stl", writeStl(parts))).volume).toBeCloseTo(4000, 2);
  });

  it("exports an open imported mesh with a warning instead of failing", () => {
    const key = newMeshKey();
    registerMesh(key, parseMeshFile("open.stl", asciiStl(boxTriangles().slice(0, 10))));
    const { parts, warnings } = collectParts([], [meshObject("m", key)]);
    expect(parts[0]!.watertight).toBe(false);
    expect(warnings[0]).toMatch(/not a closed/);
  });

  it("OBJ export reads back as the same solid", () => {
    const parts = collectParts([], [shape("b", "box"), shape("c", "cylinder", [40, 0, 0])]).parts;
    const text = new TextDecoder().decode(writeObj(parts));
    expect(text.match(/^o /gm)).toHaveLength(2);
    const back = parseMeshFile("o.obj", writeObj(parts));
    expect(size(back)).toEqual([60, 20, 20]);
  });

  it("makes safe, unique file names for multi-part export", () => {
    expect(safeFileName('Arm: left/right?')).toBe("Arm_ left_right_");
    expect(safeFileName("...")).toBe("part");
    const parts = ["Leg", "leg", "Arm"].map((name) => ({ id: name, name, positions: new Float32Array(), indices: new Uint32Array(), watertight: true }));
    expect(partFileNames(parts, "stl")).toEqual(["Leg.stl", "leg (2).stl", "Arm.stl"]);
  });
});
