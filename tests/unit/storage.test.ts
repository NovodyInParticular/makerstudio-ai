import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, JsonStorage } from "../../src/main/storage";

const tempDir = () => mkdtemp(path.join(tmpdir(), "makerstudio-test-"));

describe("settings and recent projects storage", () => {
  it("returns Bambu A1 defaults when no settings exist", async () => {
    const s = new JsonStorage(await tempDir());
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("saves, validates and survives a damaged file", async () => {
    const dir = await tempDir();
    const s = new JsonStorage(dir);
    await s.setSettings({ gridSize: 0.5 });
    expect((await s.getSettings()).gridSize).toBe(0.5);
    await expect(s.setSettings({ gridSize: -1 })).rejects.toThrow();
    await writeFile(path.join(dir, "settings.json"), "{ not json");
    expect(await s.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps recent projects unique and newest first", async () => {
    const dir = await tempDir();
    const s = new JsonStorage(dir);
    await s.addRecent({ path: "/a.msproj", name: "A", openedAt: "1" });
    await s.addRecent({ path: "/b.msproj", name: "B", openedAt: "2" });
    await s.addRecent({ path: "/a.msproj", name: "A", openedAt: "3" });
    expect((await s.getRecent()).map((r) => r.path)).toEqual(["/a.msproj", "/b.msproj"]);
    await s.removeRecent("/a.msproj");
    expect(JSON.parse(await readFile(path.join(dir, "recent.json"), "utf8"))).toHaveLength(1);
  });
});
