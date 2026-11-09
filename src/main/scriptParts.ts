// Parametric Python part scripts ("script parts"): read the PARAMETERS block of a script, and
// build it with changed values in a temporary copy, so the original script and its out/ folder
// are never written. See scriptRunner.py for the Python side.
//
// Running a script runs code on this computer, so it only ever happens after the owner confirms
// it for that script (once per app session). The AI tools cannot start a build.

import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import runnerSource from "./scriptRunner.py";
import type { ScriptBuild, ScriptParameter, ScriptValues } from "../shared/ipc";

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 300 * 1024 * 1024;
const LOG_LIMIT = 6000;

let runnerPath: string | null = null;
let building = false;

async function runner(): Promise<string> {
  if (runnerPath && existsSync(runnerPath)) return runnerPath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "makerstudio-script-"));
  runnerPath = path.join(dir, "scriptRunner.py");
  await fs.writeFile(runnerPath, runnerSource, "utf8");
  return runnerPath;
}

function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (dir && existsSync(candidate)) return candidate;
  }
  for (const dir of [path.join(os.homedir(), ".local", "bin"), "/usr/local/bin", "/usr/bin"]) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function python(): string {
  const found = findOnPath(process.platform === "win32" ? "python.exe" : "python3") ?? findOnPath("python");
  if (!found) throw new Error("Python 3 was not found on this computer. Script parts need Python (python.org).");
  return found;
}

function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out = (out + d).slice(-200_000); });
    child.stderr.on("data", (d) => { err = (err + d).slice(-200_000); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`The script took longer than ${timeoutMs / 60000} minutes and was stopped.`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function checkScript(script: string) {
  if (!path.isAbsolute(script) || path.extname(script).toLowerCase() !== ".py") throw new Error("That is not a Python script (.py).");
  if (!existsSync(script)) throw new Error(`The script was not found: ${script}`);
}

/** The editable sizes of a script, or null when it has no PARAMETERS block. */
export async function inspectScript(script: string): Promise<ScriptParameter[] | null> {
  checkScript(script);
  const r = await run(python(), ["-I", await runner(), "inspect", script], path.dirname(script), 30_000);
  if (r.code !== 0) throw new Error(`The script could not be read: ${lastLine(r.err) || "Python error"}`);
  return JSON.parse(r.out) as ScriptParameter[] | null;
}

const lastLine = (text: string) => text.trim().split("\n").filter(Boolean).pop() ?? "";

/** Builds the script with the given values in a temporary copy and returns the STL files it made. */
export async function buildScript(script: string, values: ScriptValues): Promise<ScriptBuild> {
  checkScript(script);
  if (building) throw new Error("A script part is already being built. Wait for it to finish.");
  building = true;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "makerstudio-build-"));
  try {
    const valuesFile = path.join(work, "values.json");
    await fs.writeFile(valuesFile, JSON.stringify(values), "utf8");
    const copy = path.join(work, "run");
    const prep = await run(python(), ["-I", await runner(), "prepare", script, valuesFile, copy], path.dirname(script), 60_000);
    if (prep.code !== 0) throw new Error(lastLine(prep.err) || "The script could not be prepared.");
    const copied = path.join(copy, path.basename(script));
    // A uv project next to the script brings its own Python and libraries.
    const project = path.dirname(script);
    const uv = existsSync(path.join(project, "pyproject.toml")) ? findOnPath(process.platform === "win32" ? "uv.exe" : "uv") : null;
    const started = Date.now();
    const result = uv
      ? await run(uv, ["run", "--project", project, "python", copied], copy, BUILD_TIMEOUT_MS)
      : await run(python(), [copied], copy, BUILD_TIMEOUT_MS);
    const log = `${result.out}${result.err ? `\n${result.err}` : ""}`.trim().slice(-LOG_LIMIT);
    if (result.code !== 0) throw new Error(`The script stopped with an error: ${lastLine(result.err) || `exit code ${result.code}`}`);
    const outDir = path.join(copy, "out");
    const names = existsSync(outDir) ? (await fs.readdir(outDir)).filter((n) => n.toLowerCase().endsWith(".stl")).sort() : [];
    // Files starting with "_" are helpers (reference "ghosts"), not parts to print.
    const parts = names.filter((n) => !n.startsWith("_"));
    if (parts.length === 0) throw new Error("The script ran but wrote no STL files into its out folder.");
    let total = 0;
    const files = [];
    for (const name of parts) {
      const bytes = new Uint8Array(await fs.readFile(path.join(outDir, name)));
      total += bytes.length;
      if (total > MAX_OUTPUT_BYTES) throw new Error("The script's STL files are too large to load.");
      files.push({ name, bytes });
    }
    return { files, log, seconds: Math.round((Date.now() - started) / 100) / 10, skipped: names.filter((n) => n.startsWith("_")) };
  } finally {
    building = false;
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
