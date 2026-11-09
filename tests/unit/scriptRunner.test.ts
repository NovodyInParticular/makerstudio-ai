// The Python side of script parts (src/main/scriptRunner.py): reading a PARAMETERS block and
// writing a changed copy. Needs python3 (skipped without it).

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runner = path.resolve("src/main/scriptRunner.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const py = (...args: string[]) => spawnSync("python3", ["-I", runner, ...args], { encoding: "utf8" });

const SCRIPT = `"""Test"""
from pathlib import Path
import math

# ============ PARAMETERS ============
SIZE = 20                  # größe in mm — ünïcode comment
RATIO = 0.5
CENTRE = (0.0, 2.0, 22.0)  # x, y, z
PTS = [(-1.0, 9.5), (9.0, 6.5)]
ON = True
# --- derived ---
HALF = SIZE * RATIO        # computed
ANGLE = math.radians(30)   # computed with math
NAME = "plate"             # a string: not a size
OUT = Path(__file__).parent / "out"
# ====================================
AFTER = 5                  # outside the block
`;

describe.skipIf(!hasPython)("script parts: Python helper", () => {
  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), "ms-runner-"));
    mkdirSync(path.join(dir, "cad", "original"), { recursive: true });
    mkdirSync(path.join(dir, "cad", "out"));
    writeFileSync(path.join(dir, "cad", "out", "real.stl"), "keep");
    const script = path.join(dir, "cad", "part.py");
    writeFileSync(script, SCRIPT);
    return { dir, script };
  }

  it("lists the sizes in the block with comments and groups; strings, paths and later lines are left out", () => {
    const { script } = setup();
    const r = py("inspect", script);
    expect(r.status).toBe(0);
    const params = JSON.parse(r.stdout) as { name: string; value: unknown; editable: boolean; comment: string; group: string; text: string }[];
    expect(params.map((p) => p.name)).toEqual(["SIZE", "RATIO", "CENTRE", "PTS", "ON", "HALF", "ANGLE"]);
    expect(params[0]).toMatchObject({ value: 20, editable: true, comment: "größe in mm — ünïcode comment", group: "" });
    expect(params[2]!.value).toEqual([0, 2, 22]);
    expect(params[3]!.value).toEqual([[-1, 9.5], [9, 6.5]]);
    expect(params[5]).toMatchObject({ editable: false, text: "SIZE * RATIO", group: "derived" });
    expect(params[6]).toMatchObject({ editable: false, text: "math.radians(30)" });
  });

  it("says when there is no PARAMETERS block", () => {
    const { dir } = setup();
    const plain = path.join(dir, "plain.py");
    writeFileSync(plain, "X = 1\n");
    expect(JSON.parse(py("inspect", plain).stdout)).toBeNull();
  });

  it("writes a changed copy (keeping comments and non-ASCII text) next to links; the original is not touched", () => {
    const { dir, script } = setup();
    const values = path.join(dir, "v.json");
    writeFileSync(values, JSON.stringify({ SIZE: 32.5, CENTRE: [1, 2, 3], PTS: [[0, 1], [2, 3]], ON: false }));
    const target = path.join(dir, "run");
    const r = py("prepare", script, values, target);
    expect(r.stderr).toBe("");
    const copy = readFileSync(path.join(target, "part.py"), "utf8");
    expect(copy).toContain("SIZE = 32.5                  # größe in mm — ünïcode comment");
    expect(copy).toContain("CENTRE = (1, 2, 3)  # x, y, z");
    expect(copy).toContain("PTS = ((0, 1), (2, 3))");
    expect(copy).toContain("ON = False");
    expect(copy).toContain("HALF = SIZE * RATIO");
    expect(readFileSync(script, "utf8")).toBe(SCRIPT);
    expect(lstatSync(path.join(target, "original")).isSymbolicLink()).toBe(true);
    // The copy gets its own empty out folder, not a link to the real one.
    expect(lstatSync(path.join(target, "out")).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(target, "out", "real.stl"))).toBe(false);
  });

  it.each([
    [{ HALF: 3 }, /HALF cannot be changed/],
    [{ NOPE: 1 }, /unknown parameters: NOPE/],
    [{ CENTRE: [1, 2] }, /does not have the same form/],
    [{ ON: 1 }, /does not have the same form/],
    [{ SIZE: "20; import os" }, /does not have the same form/],
    [{ AFTER: 1 }, /unknown parameters: AFTER/],
  ])("refuses %j", (change, error) => {
    const { dir, script } = setup();
    const values = path.join(dir, "v.json");
    writeFileSync(values, JSON.stringify(change));
    const r = py("prepare", script, values, path.join(dir, "run"));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(error);
  });
});
