// The Print panel with the real Bambu Studio slicer: slice, look at the layers, copy to a card.
// Skipped when Bambu Studio is not installed. The "SD card" is a temporary folder.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";

const bambu = ["/usr/bin/bambu-studio", "/opt/bambustudio-bin/AppRun", "/opt/bambu-studio/bin/bambu-studio"].some((f) => existsSync(f));
const shots = process.env.MAKERSTUDIO_SHOTS;

let app: ElectronApplication;
let page: Page;
let workDir: string;
let card: string;

test.skip(!bambu, "Bambu Studio is not installed");

test.beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-slice-"));
  // The stand-in card is "plugged in" once its folder exists (during the test).
  card = path.join(workDir, "card");
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }),
    env: {
      ...process.env,
      MAKERSTUDIO_USER_DATA: path.join(workDir, "userdata"),
      MAKERSTUDIO_DOCUMENTS: path.join(workDir, "documents"),
      MAKERSTUDIO_MOCK_AI: "1",
      MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1",
      MAKERSTUDIO_MODEL_SOURCE: "http://127.0.0.1:9",
      MAKERSTUDIO_SD_ROOT: card,
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
});

test.afterAll(async () => {
  await app?.close();
});

test("slice a part, look at its layers and copy it to the SD card", async () => {
  test.setTimeout(240_000);
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="add-box"]');
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(1);

  await page.click('[data-testid="print-open"]');
  const panel = page.locator('[data-testid="slice-panel-side"]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-testid="slice-quality"] option:checked')).toContainText("0.20mm Standard", { timeout: 30_000 });
  await expect(page.locator('[data-testid="slice-filament"] option:checked')).toHaveText("Bambu PLA Basic");
  // No card reader yet; plugging one in while the panel is open shows the card by itself.
  await expect(page.locator('[data-testid="slice-no-card"]')).toBeVisible();
  await mkdir(card);
  await expect(page.locator('[data-testid="slice-card"]')).toContainText("TEST CARD", { timeout: 10_000 });
  // No slice yet: there is nothing to copy.
  await expect(page.locator('[data-testid="slice-copy"]')).toBeDisabled();
  if (shots) await page.screenshot({ path: path.join(shots, "print-panel.png") });

  await page.locator('[data-testid="slice-infill"] button', { hasText: "Strong" }).click();
  await page.click('[data-testid="slice-slice"]');
  await expect(page.locator('[data-testid="slice-slicing"]')).toBeVisible();
  await expect(page.locator('[data-testid="slice-results"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-testid="slice-time"]')).toHaveText(/\d+ (s|min)|h/);
  await expect(page.locator('[data-testid="slice-grams"]')).toHaveText(/\d+\.\d g/);
  const layers = Number(await page.locator('[data-testid="slice-layers"]').textContent());
  expect(layers).toBeGreaterThan(10);

  // The layers replace the model in the 3D view; the slider walks through them.
  await expect(page.locator('[data-testid="layer-slider"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="layer-hint"]')).toContainText(`Layer ${layers} of ${layers}`);
  await page.locator('[data-testid="layer-range"]').evaluate((el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, "4");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator('[data-testid="layer-hint"]')).toContainText(`Layer 5 of ${layers}`);
  await expect(page.locator('[data-testid="slice-legend"]')).toContainText("Outer wall");
  if (shots) await page.screenshot({ path: path.join(shots, "print-layers.png") });

  await page.click('[data-testid="slice-copy"]');
  await expect(page.locator('[data-testid="slice-copied"]')).toBeVisible();
  const onCard = await readdir(card);
  expect(onCard).toHaveLength(1);
  expect(onCard[0]).toMatch(/\.gcode\.3mf$/);
  const zip = unzipSync(new Uint8Array(await readFile(path.join(card, onCard[0]!))));
  expect(strFromU8(zip["Metadata/slice_info.config"]!)).toContain('value="N2S"');
  expect(zip["Metadata/plate_1.png"]!.length).toBeGreaterThan(1000);
  expect(strFromU8(zip["Metadata/plate_1.gcode"]!)).toContain("; sparse_infill_density = 30%");
  if (shots) await page.screenshot({ path: path.join(shots, "print-copied.png") });

  // "No card reader?": the sliced file is handed to Bambu Studio (a stand-in that records what it
  // was asked to open, so no Bambu Studio window appears during the test).
  const fake = path.join(workDir, "fake-bambu.sh");
  const args = path.join(workDir, "bambu-args.txt");
  await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${args}"\n`);
  await chmod(fake, 0o755);
  await app.evaluate((_electron, file) => { process.env.MAKERSTUDIO_SLICER = file; }, fake);
  await expect(page.locator('[data-testid="slice-cloud"]')).toContainText("Slice plate");
  if (shots) await page.locator('[data-testid="slice-step-printer"]').screenshot({ path: path.join(shots, "print-step4.png") });
  await page.click('[data-testid="slice-open-bambu"]');
  await expect.poll(async () => (await readFile(args, "utf8").catch(() => "")).trim(), { timeout: 10_000 }).toMatch(/\.gcode\.3mf$/);
  const opened = (await readFile(args, "utf8")).trim();
  expect(unzipSync(new Uint8Array(await readFile(opened)))["Metadata/plate_1.gcode"]).toBeTruthy();
  await app.evaluate(() => { delete process.env.MAKERSTUDIO_SLICER; });

  // Back to the model, then change it: the panel says to slice again.
  await page.click('[data-testid="layer-back"]');
  await expect(page.locator('[data-testid="layer-slider"]')).toHaveCount(0);
  await page.click('[data-testid="add-box"]');
  await expect(page.locator('[data-testid="slice-stale"]')).toBeVisible();

  // The choices are remembered.
  const settings = JSON.parse(await readFile(path.join(workDir, "userdata", "settings.json"), "utf8"));
  expect(settings.slicing.infill).toBe(30);
});

test("opening another project drops the old project's print", async () => {
  test.setTimeout(240_000);
  await page.click('[data-testid="slice-slice"]');
  await expect(page.locator('[data-testid="layer-slider"]')).toBeVisible({ timeout: 150_000 });

  // A new project while the layers are shown: the panel stays, the old print and layers go.
  await page.keyboard.press("Control+n");
  const discard = page.locator('[data-testid="dialog-discard"]');
  if (await discard.isVisible({ timeout: 2000 }).catch(() => false)) await discard.click();
  await page.fill('[data-testid="dialog-input"]', "Another one");
  await page.click('[data-testid="dialog-ok"]');
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="slice-panel-side"]')).toBeVisible();
  await expect(page.locator('[data-testid="slice-results"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="layer-slider"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="slice-stale"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="slice-copy"]')).toBeDisabled();
});

test("the view fits the sliced layers, and the model again after", async () => {
  test.setTimeout(240_000);
  // "Another one" from the test before: one box, moved off the middle of the plate (the Print
  // panel takes the inspector's place, so it is closed for that).
  await page.click('[data-testid="slice-close"]');
  await page.click('[data-testid="add-box"]');
  await page.fill('[data-testid="pos-x"]', "90");
  await page.locator('[data-testid="pos-x"]').press("Enter");
  await expect(page.locator('[data-testid="pos-x"]')).toHaveValue("90");
  const canvas = page.locator('[data-testid="viewport"] canvas').first();
  await page.click('[data-testid="view-fit"]');
  await expect(canvas).toHaveAttribute("data-view-target", /^90,0,\d+$/);

  // The slicer arranges the box on the plate itself; the view follows the layers.
  await page.click('[data-testid="print-open"]');
  await page.click('[data-testid="slice-slice"]');
  await expect(page.locator('[data-testid="layer-slider"]')).toBeVisible({ timeout: 150_000 });
  await expect(canvas).not.toHaveAttribute("data-view-target", /^90,0,\d+$/);
  const onLayers = await canvas.getAttribute("data-view-target");
  expect(onLayers).toMatch(/^-?\d+,-?\d+,\d+$/);

  await page.click('[data-testid="layer-back"]');
  await expect(canvas).toHaveAttribute("data-view-target", /^90,0,\d+$/);
});
