// Drone Studio: start a design on the Flix practice frame, check "Will it fly?", fly it.
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import dgram from "node:dgram";
import { tmpdir } from "node:os";
import path from "node:path";

test("Drone Studio: will the Flix practice frame fly, then take off, hold height and fly forward", async () => {
  test.setTimeout(120000);
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-drone-"));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.waitForSelector('[data-testid="workspace-home"]');
  await page.keyboard.press("Control+8");
  await page.click('[data-testid="practice-start-flix"]');
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });

  await page.click('[data-testid="nav-drone"]');
  await page.click('[data-testid="drone-new"]');
  // Motors found from the frame's "Motor ring" shapes; the nameplate is left out of the frame.
  await expect(page.getByText(/motors placed from the 4 objects named "Motor/)).toBeVisible();
  const report = page.locator('[data-testid="drone-report"]');
  await expect(report).toContainText("Enough thrust");
  await expect(report).toContainText("Balanced (0.0 mm from centre)");
  await expect(report).toContainText("Propellers have room");
  await expect(page.locator('[data-testid="drone-finding-danger"]')).toHaveCount(0);

  // Heavier battery: the weight and thrust-to-weight follow; undo brings it back.
  const twr = await page.locator('[data-testid="drone-twr"]').innerText();
  await page.fill('[data-testid="drone-battery-mass"]', "200");
  await page.locator('[data-testid="drone-battery-mass"]').press("Enter");
  await expect(report).toContainText(/Too heavy|Barely flies/);
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="drone-twr"]')).toHaveText(twr);

  // Fly: arm, climb, height hold, forward.
  await page.click('[data-testid="drone-tab-fly"]');
  await page.locator(".drone-canvas canvas").click();
  await expect(page.locator('[data-testid="drone-status"]')).toContainText("Disarmed");
  await page.keyboard.press("Space");
  await expect(page.locator('[data-testid="drone-status"]')).toContainText("Armed");
  await page.keyboard.down("KeyW"); await page.waitForTimeout(900); await page.keyboard.up("KeyW");
  await expect(page.locator('[data-testid="drone-status"]')).toHaveText("Flying");
  const alt = async () => Number((await page.locator('[data-testid="drone-alt"]').innerText()).replace(" m", ""));
  expect(await alt()).toBeGreaterThan(1);
  await page.keyboard.press("KeyH");
  await expect(page.locator('[data-testid="drone-mode"]')).toHaveText("Height hold");
  await page.waitForTimeout(1500);
  const h1 = await alt();
  await page.waitForTimeout(1000);
  expect(Math.abs((await alt()) - h1)).toBeLessThan(0.3);
  await page.keyboard.press("KeyR");
  await expect(page.locator('[data-testid="drone-status"]')).toContainText("Disarmed");
  expect(errors).toEqual([]);
  await app.close();
});

test("Drone Studio: export the drone code, and fly a (fake) real drone over UDP with the safety rules", async () => {
  test.setTimeout(120000);
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-drone-real-"));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" } });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await page.keyboard.press("Control+8");
  await page.click('[data-testid="practice-start-flix"]');
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="nav-drone"]');
  await page.click('[data-testid="drone-new"]');

  // Export: a full PlatformIO project with the README's safety checks.
  await page.click('[data-testid="drone-tab-code"]');
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog; }, w);
  await page.click('[data-testid="drone-export"]');
  await expect(page.getByText(/Drone code saved in/)).toBeVisible();
  const folder = (await readdir(w)).find((n) => n.startsWith("Drone - "))!;
  const readme = await readFile(path.join(w, folder, "README.md"), "utf8");
  expect(readme).toMatch(/NOT been tested on a real drone/);
  expect(await readFile(path.join(w, folder, "include", "flight_core.h"), "utf8")).toContain("struct FcController");

  // Wire it: the circuit lands in Circuit Studio with clean checks.
  await page.click('[data-testid="drone-wire"]');
  await expect(page.locator('[data-testid="workspace-circuit"]')).toBeVisible();
  await expect(page.getByText(/Wired the drone: \d+ parts/)).toBeVisible();
  await expect(page.locator('[data-testid="circuit-part"][data-part^="Motor "]')).toHaveCount(4);
  await expect(page.locator('[data-testid="check-summary"]')).not.toContainText(/danger/i);
  await page.click('[data-testid="nav-drone"]');

  // A fake drone: records the packets and answers with telemetry.
  const got: { throttle: number; roll: number; arm: boolean; hold: boolean; climb: number }[] = [];
  const fake = dgram.createSocket("udp4");
  fake.on("message", (msg, from) => {
    if (msg.length !== 16 || msg.toString("ascii", 0, 4) !== "MSD1") return;
    const p = { throttle: msg.readInt16LE(6) / 1000, roll: msg.readInt16LE(8) / 1000, arm: (msg.readUInt8(14) & 1) === 1, hold: (msg.readUInt8(14) & 2) === 2, climb: msg.readInt8(15) / 100 };
    got.push(p);
    const t = JSON.stringify({ armed: p.arm ? 1 : 0, roll: 1.5, pitch: -2, yaw: 0, volts: 3.95, loopHz: 500, calibrated: 1, height: 0.84, hold: p.hold ? 1 : 0 });
    fake.send(t, from.port, from.address);
  });
  await new Promise<void>((done) => fake.bind(4210, "127.0.0.1", done));
  const latest = () => got[got.length - 1];

  await page.click('[data-testid="drone-tab-fly"]');
  await page.click('[data-testid="drone-real"]');
  await page.locator('[data-testid="drone-real-panel"] input.drone-host').fill("127.0.0.1");
  await page.click('[data-testid="drone-connect"]');
  await expect(page.getByText(/Drone answering · loop 500 Hz · calibrated/)).toBeVisible();
  await expect(page.locator('[data-testid="drone-real-status"]')).toContainText("3.95 V");
  // Not ready: Space does not arm.
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  expect(latest()!.arm).toBe(false);
  await page.check('[data-testid="drone-ready"]');
  await page.locator('[data-testid="drone-real-status"]').click();
  await page.keyboard.press("Space");
  await expect.poll(() => latest()!.arm).toBe(true);
  expect(latest()!.throttle).toBe(0); // armed at zero throttle
  await page.keyboard.down("KeyW"); await page.waitForTimeout(700); await page.keyboard.up("KeyW");
  await expect.poll(() => latest()!.throttle).toBeGreaterThan(0.15);
  await page.keyboard.down("ArrowRight"); await expect.poll(() => latest()!.roll).toBe(1); await page.keyboard.up("ArrowRight");
  // Height hold: H sets the flag; W is then the climb stick and leaves the throttle lever alone.
  const lever = latest()!.throttle;
  await page.keyboard.press("KeyH");
  await expect.poll(() => latest()!.hold).toBe(true);
  await expect(page.locator('[data-testid="drone-real-mode"]')).toHaveText("Height hold");
  await expect(page.locator('[data-testid="drone-real-status"]')).toContainText("0.84 m");
  await page.keyboard.down("KeyW");
  await expect.poll(() => latest()!.climb).toBe(1);
  expect(latest()!.throttle).toBe(lever);
  await page.keyboard.up("KeyW");
  await expect.poll(() => latest()!.climb).toBe(0);
  await page.keyboard.press("KeyH");
  // X cuts at once.
  await page.keyboard.press("KeyX");
  await expect.poll(() => latest()!.arm).toBe(false);
  expect(latest()!.throttle).toBe(0);
  // Disconnecting sends a final disarmed packet and stops sending.
  await page.keyboard.press("Space");
  await expect.poll(() => latest()!.arm).toBe(true);
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => latest()!.arm).toBe(false);
  const count = got.length;
  await page.waitForTimeout(300);
  expect(got.length).toBe(count);
  fake.close();
  await app.close();
});
