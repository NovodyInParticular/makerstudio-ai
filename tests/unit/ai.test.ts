// Phase 4 acceptance (scripted, no real model): tools, proposals, modes, approval, undo.
import { describe, expect, it } from "vitest";
import { initCsg } from "../../src/core/cad/csg";
import type { CadObject } from "../../src/core/cad/model";
import { createProjectStore } from "../../src/core/document/store";
import { aiApply, callTool, proposalTitle, type Mode, type Proposal } from "../../src/core/ai/proposals";
import { toolSpecs, TOOLS } from "../../src/core/ai/tools";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

let n = 0;
const newId = () => `ai-${++n}`;

/** A scripted "AI": runs tool calls against a project store, like a provider or Claude Code would. */
function session(mode: Mode = "create") {
  const store = createProjectStore(undefined, "test");
  let proposal: Proposal | null = null;
  const call = (name: string, params: unknown = {}) => {
    const out = callTool({ name, params, mode, source: "test", state: store.getState().project, proposal, env: { extras: { workspace: "cad" }, newId } });
    proposal = out.proposal;
    return out.result;
  };
  const approve = () => {
    store.getState().execute(aiApply({ title: proposalTitle(proposal!), commands: proposal!.commands }), { author: "ai" });
    proposal = { ...proposal!, status: "approved" };
  };
  return { store, call, approve, get proposal() { return proposal; } };
}
const objects = (s: ReturnType<typeof session>) => s.store.getState().project.document.workspaces.cad.objects as CadObject[];

describe("AI tools", () => {
  it("describe themselves with JSON schemas, and say that changes need approval", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name)).toEqual(TOOLS.map((t) => t.name));
    for (const s of specs) expect(s.inputSchema.type).toBe("object");
    expect(specs.find((s) => s.name === "cad_add_shape")!.description).toMatch(/must approve/);
    expect(specs.find((s) => s.name === "cad_delete")!.description).toMatch(/Destructive/);
    expect(toolSpecs(["read"]).every((s) => !/must approve/.test(s.description))).toBe(true);
  });

  it("read the project", () => {
    const s = session("observe");
    const r = s.call("get_project");
    expect(r.ok && (r.data as { units: string }).units).toBe("mm");
  });
});

describe("proposals", () => {
  it("collect changes on a copy, build on each other, and apply as one AI undo step", () => {
    const s = session();
    const a = s.call("cad_add_shape", { kind: "box", name: "Base plate", params: { width: 40, depth: 30, height: 4 } });
    expect(a.ok).toBe(true);
    const id = (a as { data: { created: { id: string } } }).data.created.id;
    // A later call in the same proposal can use the object the earlier one created.
    const b = s.call("cad_update", { object: id, position: [10, 0, 0], color: "#ff0000" });
    expect(b.ok).toBe(true);
    // Reading during the proposal shows the proposed state.
    const seen = s.call("get_project") as { data: { cad: { objects: { name: string }[] } } };
    expect(seen.data.cad.objects.map((o) => o.name)).toContain("Base plate");
    // ... but nothing has changed in the real project yet.
    expect(objects(s)).toEqual([]);
    expect(s.proposal!.calls.map((c) => c.summary)).toEqual(['Add box "Base plate"', 'Change "Base plate" (position, color)']);

    s.approve();
    expect(objects(s)).toHaveLength(1);
    expect(objects(s)[0]!.transform.position).toEqual([10, 0, 0]);
    const last = s.store.getState().project.history.entries.at(-1)!;
    expect(last).toMatchObject({ author: "ai", label: 'AI: Add box "Base plate" (+1 more)' });
    s.store.getState().undo();
    expect(objects(s)).toEqual([]); // one undo removes the whole AI change
  });

  it("refuse changes in Observe and Assist modes", () => {
    for (const mode of ["observe", "assist"] as const) {
      const s = session(mode);
      const r = s.call("cad_add_shape", { kind: "box" });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/not allowed in .* mode/);
      expect(s.proposal).toBeNull();
    }
  });

  it("report bad input and missing objects without changing the proposal", () => {
    const s = session();
    s.call("cad_add_shape", { kind: "sphere" });
    const before = s.proposal!.calls.length;
    const bad = s.call("cad_add_shape", { kind: "pyramid" });
    expect(!bad.ok && bad.error).toMatch(/Invalid input/);
    const missing = s.call("cad_update", { object: "nope", position: [0, 0, 0] });
    expect(!missing.ok && missing.error).toMatch(/No 3D object/);
    const tooBig = s.call("cad_add_shape", { kind: "box", params: { width: 99999 } });
    expect(tooBig.ok).toBe(false);
    expect(s.proposal!.calls.length).toBe(before);
  });

  it("mark deletions as destructive", () => {
    const s = session();
    s.call("cad_add_shape", { kind: "box", name: "Old" });
    s.approve();
    const r = callTool({ name: "cad_delete", params: { objects: ["Old"] }, mode: "create", source: "test", state: s.store.getState().project, proposal: null, env: { extras: {}, newId } });
    expect(r.result.ok).toBe(true);
    expect(r.proposal!.calls[0]!.destructive).toBe(true);
  });

  it("carry the circuit safety warnings a change would cause", () => {
    const s = session();
    const uno = s.call("circuit_add_part", { type: "arduino-uno-r3" }) as { data: { created: { id: string } } };
    expect(s.proposal!.warnings).toEqual([]);
    const w = s.call("circuit_connect", { from: { part: uno.data.created.id, pin: "5V" }, to: { part: "Arduino UNO R3", pin: "D13" } }) as { data: { safety_warnings?: string[] } };
    expect(w.data.safety_warnings?.join(" ")).toMatch(/danger: .*wired directly to/);
    expect(s.proposal!.warnings.map((f) => f.rule)).toContain("gpio-tied");
  });

  it("fail cleanly on approval if the project changed underneath", () => {
    const s = session();
    const a = s.call("cad_add_shape", { kind: "box", name: "Keep" }) as { data: { created: { id: string } } };
    s.approve();
    const r = callTool({ name: "cad_update", params: { object: a.data.created.id, color: "#00ff00" }, mode: "create", source: "test", state: s.store.getState().project, proposal: null, env: { extras: {}, newId } });
    // the owner deletes the object before approving
    s.store.getState().undo();
    expect(() => s.store.getState().execute(aiApply({ title: "late", commands: r.proposal!.commands }), { author: "ai" })).toThrow(/no object with id/);
    expect(objects(s)).toEqual([]);
  });
});

describe("cad_build", () => {
  it("builds a grouped multi-part object with a hole in one proposal", async () => {
    const { createProjectStore } = await import("../../src/core/document/store");
    const { callTool, previewState } = await import("../../src/core/ai/proposals");
    const { cadObjects } = await import("../../src/core/cad/commands");
    const store = createProjectStore();
    let n = 0;
    const out = callTool({
      name: "cad_build", mode: "create", source: "chat", state: store.getState().project, proposal: null, env: { newId: () => `b${++n}`, extras: {} },
      params: { name: "Mug", parts: [
        { kind: "cylinder", name: "Body", params: { radius: 40, height: 90 } },
        { kind: "cylinder", name: "Inside", params: { radius: 36, height: 90 }, position: [0, 0, 4], hole: true },
        { kind: "torus", name: "Handle", params: { radius: 22, tube: 5 }, position: [40, 0, 23], rotation: [90, 0, 0] },
      ] },
    });
    expect(out.result.ok).toBe(true);
    expect(out.proposal!.calls[0]!.summary).toBe('Build "Mug" (3 parts, 1 cut out)');
    const objs = cadObjects(previewState(store.getState().project, out.proposal!.commands));
    const group = objs.find((o) => o.kind === "group")!;
    expect(group.name).toBe("Mug");
    expect(objs.filter((o) => o.parentId === group.id).length).toBe(3);
  });
});

describe("AI tools: Drone Studio", () => {
  it("starts a design, checks it, and proposes changes that only apply when approved (one undo step)", () => {
    const s = session("create");
    // A small frame with four motor rings.
    expect(s.call("cad_build", { name: "Quad", parts: [
      { kind: "box", name: "Plate", params: { width: 40, depth: 40, height: 3 } },
      { kind: "box", name: "Arm", params: { width: 96, depth: 6, height: 3 }, rotation: [0, 0, 45] },
      { kind: "box", name: "Arm", params: { width: 96, depth: 6, height: 3 }, rotation: [0, 0, -45] },
      ...[[32, 32], [-32, 32], [-32, -32], [32, -32]].map(([x, y]) => ({ kind: "cylinder", name: "Motor ring", params: { radius: 6, height: 8 }, position: [x, y, 0] })),
    ] })).toMatchObject({ ok: true });
    s.approve();
    expect(s.call("drone_check")).toMatchObject({ ok: true, data: { drone: null } });
    expect(s.call("drone_start")).toMatchObject({ ok: true });
    s.approve();
    const check = s.call("drone_check") as { ok: true; data: { totalMass_g: number; thrustToWeight: number; findings: { verdict: string }[] } };
    expect(check.ok).toBe(true);
    expect(check.data.totalMass_g).toBeGreaterThan(30);
    expect(check.data.thrustToWeight).toBeGreaterThan(1);
    const before = check.data.totalMass_g;
    const projectBattery = () => (s.store.getState().project.document.workspaces as { drone?: { battery: { mass: number } } }).drone!.battery.mass;
    expect(s.call("drone_update", { battery: { mass: 60 } })).toMatchObject({ ok: true });
    expect(projectBattery()).toBe(25); // the project is unchanged until approved
    expect((s.call("drone_check") as { data: { totalMass_g: number } }).data.totalMass_g).toBeCloseTo(before + 35, 5); // the AI sees its own proposal
    s.approve();
    expect(projectBattery()).toBe(60);
    expect((s.call("drone_check") as { data: { totalMass_g: number } }).data.totalMass_g).toBeCloseTo(before + 35, 5);
    s.store.getState().undo();
    expect((s.call("drone_check") as { data: { totalMass_g: number } }).data.totalMass_g).toBeCloseTo(before, 5);
    expect(s.call("drone_start")).toMatchObject({ ok: false });
  });
  it("is read-only outside Create mode", () => {
    const s = session("assist");
    expect(s.call("drone_start")).toMatchObject({ ok: false });
    expect(s.call("drone_check")).toMatchObject({ ok: true });
  });
});
