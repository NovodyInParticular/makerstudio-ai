// Real boards over USB: list ports, flash a firmware image (esptool), upload a PlatformIO project,
// and a serial monitor. Uses the tools PlatformIO installs (pio, its esptool and Python + pyserial),
// so nothing native is bundled into the app. Output streams to the window line by line.

import { spawn, type ChildProcess, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface DevicePort { port: string; description: string; hwid: string }
export type DeviceEvent = { job: string; kind: "line"; text: string } | { job: string; kind: "done"; ok: boolean; message: string };

const home = homedir();
const PORT_RE = /^(\/dev\/(tty(ACM|USB)\d+|cu\.[\w.-]+|tty\.[\w.-]+)|COM\d+)$/;
export const isPort = (p: unknown): p is string => typeof p === "string" && PORT_RE.test(p);

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (p && existsSync(p)) return p;
  return null;
}
async function viaShell(cmd: string): Promise<string | null> {
  const out = await new Promise<string>((resolve) => execFile("bash", ["-lc", `command -v ${cmd}`], { timeout: 5000 }, (_e, o) => resolve(String(o ?? "").trim())));
  return out && existsSync(out) ? out : null;
}

export async function findPio(): Promise<string | null> {
  return firstExisting([...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "pio")), path.join(home, ".local/bin/pio"), path.join(home, ".platformio/penv/bin/pio")]) ?? (await viaShell("pio"));
}
function findEsptool(): string | null {
  return firstExisting([path.join(home, ".platformio/packages/tool-esptool/esptool"), path.join(home, ".platformio/packages/tool-esptool/esptool.exe")]);
}
/** The Python that runs PlatformIO (it has pyserial). */
async function findPython(): Promise<string | null> {
  const pio = await findPio();
  if (pio) {
    try {
      const line = readFileSync(pio, "utf8").split("\n")[0] ?? "";
      const m = /^#!\s*(\S+)/.exec(line);
      if (m && existsSync(m[1]!)) return m[1]!;
    } catch { /* not a script */ }
  }
  return firstExisting([path.join(home, ".platformio/penv/bin/python")]);
}

export async function toolStatus() {
  return { pio: await findPio(), esptool: findEsptool(), python: await findPython() };
}

export async function listPorts(): Promise<DevicePort[]> {
  const pio = await findPio();
  if (!pio) throw new Error("PlatformIO is not installed (needed to talk to boards). Install it from platformio.org.");
  const out = await new Promise<string>((resolve, reject) => execFile(pio, ["device", "list", "--json-output"], { timeout: 20000, maxBuffer: 4 << 20 }, (e, o) => (e ? reject(e) : resolve(o))));
  const all = JSON.parse(out) as DevicePort[];
  // Real USB devices only (built-in serial ports report hwid "n/a").
  return all.filter((p) => p.hwid && p.hwid !== "n/a" && isPort(p.port));
}

const jobs = new Map<string, ChildProcess>();

function run(job: string, cmd: string, args: string[], emit: (e: DeviceEvent) => void, opts: { cwd?: string; stdin?: boolean } = {}): ChildProcess {
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1", PLATFORMIO_NO_ANSI: "1" } });
  jobs.set(job, child);
  let tail = "";
  const feed = (chunk: Buffer) => {
    const text = (tail + chunk.toString("utf8")).replace(/\r(?!\n)/g, "\n");
    const lines = text.split("\n");
    tail = lines.pop() ?? "";
    for (const l of lines) emit({ job, kind: "line", text: l.replace(/\x1b\[[0-9;]*m/g, "") });
  };
  child.stdout!.on("data", feed);
  child.stderr!.on("data", feed);
  child.on("close", (code, signal) => {
    if (tail) emit({ job, kind: "line", text: tail });
    jobs.delete(job);
    emit({ job, kind: "done", ok: code === 0, message: signal ? "Stopped." : code === 0 ? "Done." : `Finished with exit code ${code}.` });
  });
  child.on("error", (err) => { jobs.delete(job); emit({ job, kind: "done", ok: false, message: err.message }); });
  return child;
}

export async function flashImage(port: string, image: string, address: string, emit: (e: DeviceEvent) => void) {
  const esptool = findEsptool();
  if (!esptool) throw new Error("esptool was not found. Build any ESP32 project with PlatformIO once (it installs esptool), then try again.");
  if (!/^0x[0-9a-fA-F]{1,8}$/.test(address)) throw new Error("The flash address must look like 0x0 or 0x10000.");
  return run("flash", esptool, ["--port", port, "--baud", "460800", "write-flash", "--flash-size", "detect", address, image], emit);
}

export async function uploadProject(dir: string, port: string | null, emit: (e: DeviceEvent) => void) {
  const pio = await findPio();
  if (!pio) throw new Error("PlatformIO is not installed.");
  if (!existsSync(path.join(dir, "platformio.ini"))) throw new Error("That folder has no platformio.ini (choose a project exported by MakerStudio or another PlatformIO project).");
  return run("upload", pio, ["run", "-t", "upload", "-d", dir, ...(port ? ["--upload-port", port] : [])], emit);
}

const MONITOR = `
import sys, serial
port, baud = sys.argv[1], int(sys.argv[2])
s = serial.Serial(port, baud, timeout=0.2)
import threading
def writer():
    for line in sys.stdin:
        s.write(line.encode())
threading.Thread(target=writer, daemon=True).start()
buf = b""
while True:
    data = s.read(256)
    if data:
        sys.stdout.write(data.decode("utf-8", "replace")); sys.stdout.flush()
`;

export async function startMonitor(port: string, baud: number, emit: (e: DeviceEvent) => void) {
  const py = await findPython();
  if (!py) throw new Error("PlatformIO's Python (with pyserial) was not found.");
  stopJob("monitor");
  return run("monitor", py, ["-u", "-c", MONITOR, port, String(baud)], emit, { stdin: true });
}

export function sendToMonitor(text: string) {
  const m = jobs.get("monitor");
  if (!m?.stdin) throw new Error("The serial monitor is not running.");
  m.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function stopJob(job: string) {
  jobs.get(job)?.kill("SIGTERM");
}

export function stopAll() {
  for (const j of jobs.values()) j.kill("SIGTERM");
}
