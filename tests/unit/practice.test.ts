import { beforeAll, describe, expect, it } from "vitest";
import { checkMesh, initCsg } from "../../src/core/cad/csg";
import { collectParts } from "../../src/core/cad/exporting";
import { CadObjectSchema } from "../../src/core/cad/model";
import { BAMBU_A1, checkPart } from "../../src/core/cad/printcheck";
import { createPracticeProject, PRACTICE_PROJECTS, practiceNotes } from "../../src/core/practice/catalog";
import { packProject, unpackProject } from "../../src/shared/format";

beforeAll(async () => {
  await initCsg(async () => (await import("manifold-3d/manifold")).default());
});

describe("practice projects", () => {
  it("have unique ids, a place to find them, and a license", () => {
    const ids = PRACTICE_PROJECTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PRACTICE_PROJECTS) {
      if (p.repo) expect(p.repo).toMatch(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
      else expect(p.link?.url ?? p.localPath).toBeTruthy();
      expect(p.license).toMatch(/^(MIT|Apache-2\.0|GPL-3\.0|CC-BY-SA-4\.0|CC-BY-4\.0|CC BY-NC-SA|MakerWorld Exclusive|Standard Digital File|unspecified|Own project|GPL-2.0)$/);
      if (p.kind.startsWith("Fan-made")) expect(p.caveats.join(" ")).toMatch(/do not sell/);
      expect(p.steps.length).toBeGreaterThan(1);
      expect(p.exercises.length).toBeGreaterThan(0);
    }
  });

  it.each(PRACTICE_PROJECTS.map((p) => [p.id, p] as const))("%s makes a valid project that saves, reopens and prints", (_id, p) => {
    const project = createPracticeProject(p, "test");
    const objects = project.document.workspaces.cad.objects;
    for (const o of objects) CadObjectSchema.parse(o);
    expect(project.notes).toBe(practiceNotes(p));
    expect(project.notes).toContain(p.repo ? `https://github.com/${p.repo}` : (p.link?.url ?? p.localPath!));
    expect(project.notes).toContain("placeholder sizes");
    // Saves and reopens through the real file format.
    const reopened = unpackProject(packProject(project));
    expect(reopened.document.workspaces.cad.objects).toEqual(objects);
    // Every starter part is a watertight solid that fits the A1.
    const { parts, warnings } = collectParts([], objects);
    expect(warnings).toEqual([]);
    // Entries that load the owner's own model files start without placeholder shapes.
    if (!p.localModels?.length) expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      expect(checkMesh(part).watertight).toBe(true);
      const codes = checkPart(part, BAMBU_A1).issues.map((i) => i.code);
      expect(codes).not.toContain("too-big");
      expect(codes).not.toContain("too-thin");
      expect(codes).not.toContain("off-bed");
    }
  });
});

describe("local models", () => {
  it("every model a practice project loads is on the main process allowlist", async () => {
    const { LOCAL_MODELS } = await import("../../src/shared/localModels");
    for (const p of PRACTICE_PROJECTS) for (const key of p.localModels ?? []) expect(LOCAL_MODELS[key], `${p.id}: ${key}`).toBeTruthy();
    expect(Object.values(LOCAL_MODELS).every((m) => !m.file.includes("..") && m.file.endsWith(".stl"))).toBe(true);
  });
});

describe("practice starters sit on the bed", () => {
  it.each(PRACTICE_PROJECTS.map((p) => [p.id, p] as const))("%s", (_id, p) => {
    const objects = createPracticeProject(p, "test").document.workspaces.cad.objects;
    for (const part of collectParts([], objects).parts) {
      const codes = checkPart(part, BAMBU_A1).issues.map((i) => i.code);
      expect(codes).not.toContain("floating");
      expect(codes).not.toContain("thin-wall");
    }
  });
});
