// Device tooling against the real PlatformIO tools (no board attached). DEVICE_LIVE=1 XIAO_PROJECT=dir npx vitest run tests/live/device --config vitest.live.config.ts
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { flashImage, listPorts, startMonitor, stopJob, toolStatus, uploadProject, type DeviceEvent } from "../../src/main/device";

const collect = () => { const lines: string[] = []; let done: DeviceEvent | null = null; return { emit: (e: DeviceEvent) => { if (e.kind === "line") lines.push(e.text); else done = e; }, lines, get done() { return done as DeviceEvent | null; } }; };
const wait = async (c: { done: DeviceEvent | null }, ms: number) => { const t = Date.now(); while (!c.done && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 200)); };

describe.runIf(process.env.DEVICE_LIVE === "1")("device tools (no board)", () => {
  it("finds the tools", async () => {
    const t = await toolStatus();
    console.log("TOOLS", t);
    expect(t.pio && t.esptool && t.python).toBeTruthy();
  });
  it("lists only real USB boards (none here)", async () => {
    expect(await listPorts()).toEqual([]);
  }, 30000);
  it("upload builds the project, then fails cleanly with no board", async () => {
    const c = collect();
    await uploadProject(process.env.XIAO_PROJECT!, null, c.emit);
    await wait(c, 240000);
    console.log("UPLOAD tail:", c.lines.filter((l) => /RAM:|Flash:|Error|error|port|SUCCESS|FAILED/i.test(l)).slice(-8).join("\n"));
    expect(c.lines.some((l) => /RAM:/.test(l))).toBe(true);
    expect(c.done && c.done.kind === "done" && c.done.ok).toBe(false);
  }, 300000);
  it("flashing streams esptool output and reports the missing port", async () => {
    const c = collect();
    await flashImage("/dev/ttyACM9", "/dev/null", "0x0", c.emit);
    await wait(c, 30000);
    console.log("FLASH:", c.lines.slice(-4).join(" | "));
    expect(c.lines.some((l) => /ttyACM9/.test(l))).toBe(true);
    expect(c.done && c.done.kind === "done" && c.done.ok).toBe(false);
  }, 60000);
  it("serial monitor reads a (pseudo-terminal) board", async () => {
    // A fake board: a pty that prints a line every 100 ms.
    const fake = spawn("python3", ["-u", "-c", "import os,pty,time,sys\nm,s=pty.openpty()\nprint(os.ttyname(s),flush=True)\nwhile True:\n  os.write(m,b'hello from the board\\r\\n'); time.sleep(0.1)"]);
    const name = await new Promise<string>((r) => fake.stdout.once("data", (d: Buffer) => r(d.toString().trim())));
    const c = collect();
    await startMonitor(name, 115200, c.emit);
    await new Promise((r) => setTimeout(r, 2500));
    stopJob("monitor"); fake.kill();
    await wait(c, 5000);
    console.log("MONITOR:", c.lines.slice(0, 3));
    expect(c.lines.filter((l) => l.includes("hello from the board")).length).toBeGreaterThan(3);
  }, 30000);
});
