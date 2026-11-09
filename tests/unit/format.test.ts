import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createEmptyProject, duplicateProject, FORMAT_VERSION, isSafeArchivePath, packProject, ProjectFormatError, unpackProject,
} from "../../src/shared/format";

describe("project file format", () => {
  it("round-trips a project with notes, history, conversations and binary assets", () => {
    const project = createEmptyProject("Rover", "test");
    project.notes = "# Notes\nWheel base 120 mm — ünïcode ✓";
    project.document.description = "ESP32 rover";
    project.history.entries.push({ id: "h1", at: new Date().toISOString(), label: "x", author: "user", kind: "change" });
    project.conversations.push({ id: "c1", title: "Chat", createdAt: new Date().toISOString(), messages: [] });
    project.assets["reference/photo.png"] = new Uint8Array([0, 1, 2, 255]);
    const back = unpackProject(packProject(project));
    expect(back.document).toEqual(project.document);
    expect(back.notes).toBe(project.notes);
    expect(back.history).toEqual(project.history);
    expect(back.conversations).toEqual(project.conversations);
    expect([...back.assets["reference/photo.png"]!]).toEqual([0, 1, 2, 255]);
    expect(back.manifest.formatVersion).toBe(FORMAT_VERSION);
  });

  it("rejects files that are not zip archives", () => {
    expect(() => unpackProject(strToU8("hello"))).toThrow(ProjectFormatError);
  });

  it("names the missing part of a damaged project", () => {
    const bytes = zipSync({ "manifest.json": strToU8("{}") });
    expect(() => unpackProject(bytes)).toThrow(/manifest\.json/);
  });

  it("refuses projects from a newer file format", () => {
    const project = createEmptyProject("Future", "test");
    project.manifest.formatVersion = FORMAT_VERSION + 1;
    expect(() => unpackProject(packProject(project))).toThrow(/newer MakerStudio/);
  });

  it("rejects unsafe archive paths", () => {
    expect(isSafeArchivePath("assets/a.png")).toBe(true);
    for (const bad of ["../x", "/etc/passwd", "assets/../../x", "C:/x", "a\\b", ""]) expect(isSafeArchivePath(bad)).toBe(false);
    const bytes = zipSync({ "../evil.txt": strToU8("x"), "manifest.json": strToU8("{}") });
    expect(() => unpackProject(bytes)).toThrow(/unsafe path/);
  });

  it("duplicates with a new id and name", () => {
    const project = createEmptyProject("Arm", "test");
    const copy = duplicateProject(project, "Arm v2");
    expect(copy.document.id).not.toBe(project.document.id);
    expect(copy.document.name).toBe("Arm v2");
    expect(copy.history.revisions).toEqual([]);
    expect(project.document.name).toBe("Arm"); // original untouched
  });
});
