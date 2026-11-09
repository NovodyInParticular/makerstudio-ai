// Script parts: open a Python part script, change sizes, build, rebuild in place, undo.
// The original script and its out folder must never be written.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let app: ElectronApplication;
let page: Page;
let script: string;
let original: string;

test.beforeAll(async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-script-"));
  await mkdir(path.join(workDir, "cad"));
  script = path.join(workDir, "cad", "plate.py");
  await copyFile(path.join("tests", "fixtures", "scripts", "plate.py"), script);
  original = await readFile(script, "utf8");
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }),
    env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(workDir, "userdata"), MAKERSTUDIO_DOCUMENTS: path.join(workDir, "documents"), MAKERSTUDIO_MOCK_AI: "1", MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
});

test.afterAll(async () => { await app?.close(); });

async function answer(run: boolean) {
  await app.evaluate(({ dialog }, { file, run }) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    (globalThis as { asked?: number }).asked = 0;
    dialog.showMessageBox = (async () => { (globalThis as { asked?: number }).asked!++; return { response: run ? 0 : 1, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
  }, { file: script, run });
}
const asked = () => app.evaluate(() => (globalThis as { asked?: number }).asked ?? 0);

async function setNumber(name: string, value: string) {
  const field = page.locator(`[data-testid="script-param-${name}"] input`).first();
  await field.fill(value);
  await field.press("Enter");
}

test("script part: sizes as fields, asks before running, builds, rebuilds in place, undo", async () => {
  const rows = page.locator('[data-testid="tree-row"]');
  const readout = page.locator('[data-testid="size-readout"]');

  // Open: the sizes appear with their comments and groups; computed ones are not editable.
  await answer(false);
  await page.click('[data-testid="open-script"]');
  const panel = page.locator('[data-testid="script-panel"]');
  await expect(panel).toContainText("plate.py");
  await expect(page.locator('[data-testid="script-param-WIDTH"]')).toContainText("plate width (X)");
  await expect(page.locator('[data-testid="script-param-GAP"]')).toContainText("= WIDTH / 2 + 5");
  await expect(page.locator('[data-testid="script-param-GAP"] input')).toHaveCount(0);
  await expect(page.locator('[data-testid="script-param-PEG"] input')).toHaveCount(3);
  await expect(page.locator('[data-testid="script-param-OUT"]')).toHaveCount(0); // a folder path, not a size

  // Saying no to running the script builds nothing.
  await setNumber("WIDTH", "40");
  await page.click('[data-testid="script-build"]');
  await expect.poll(asked).toBe(1);
  await page.waitForTimeout(300);
  await expect(rows).toHaveCount(0);

  // Yes: two parts (the "_ghost" helper is left out), placed together and standing on the bed.
  await answer(true);
  await page.click('[data-testid="script-build"]');
  await expect(page.getByText(/Built "plate.py" in .* with 1 changed size: 2 parts added/)).toBeVisible({ timeout: 30000 });
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "plate: plate" }).click();
  await expect(readout).toContainText("40 × 10 × 5 mm");
  await expect(readout).toContainText("bottom at Z 0 mm");

  // Close the panel; the part's inspector reopens it with the changed size remembered.
  await page.click('[data-testid="script-close"]');
  await expect(page.locator('[data-testid="script-source"]')).toContainText("plate.py");
  await page.click('[data-testid="script-edit"]');
  await expect(page.locator('[data-testid="script-param-WIDTH"] input')).toHaveValue("40");
  await setNumber("HEIGHT", "8");
  await page.locator('[data-testid="script-param-PEG_ON"] input').uncheck();
  await expect(page.locator('[data-testid="script-build"]')).toHaveText("Rebuild 2 parts");
  await page.click('[data-testid="script-build"]');
  await expect(page.getByText(/1 part rebuilt in place\. The script no longer writes peg\.stl/)).toBeVisible({ timeout: 30000 });
  await expect(rows).toHaveCount(2); // the peg part is kept as it was
  await page.click('[data-testid="script-close"]');
  await rows.filter({ hasText: "plate: plate" }).click();
  await expect(readout).toContainText("40 × 10 × 8 mm");

  // A copy of a script part is rebuilt too.
  await page.keyboard.press("Control+d");
  await expect(rows).toHaveCount(3);
  await page.click('[data-testid="script-edit"]');
  await setNumber("DEPTH", "12");
  await page.click('[data-testid="script-build"]');
  await expect(page.getByText(/2 parts rebuilt in place/)).toBeVisible({ timeout: 30000 });
  await page.click('[data-testid="script-close"]');
  for (const row of await rows.filter({ hasText: "plate: plate" }).all()) {
    await row.click();
    await expect(readout).toContainText("40 × 12 × 8 mm");
  }
  await page.keyboard.press("Control+z"); // the rebuild
  await page.keyboard.press("Control+z"); // the duplicate
  await expect(rows).toHaveCount(2);
  await rows.filter({ hasText: "plate: plate" }).click();

  // One undo step brings back the previous build.
  await page.keyboard.press("Control+z");
  await expect(readout).toContainText("40 × 10 × 5 mm");

  // It was asked only once for this script in this session (the first "no" + one "yes").
  expect(await asked()).toBe(1);

  // The original script is unchanged and its folder has no out/ written by MakerStudio.
  expect(await readFile(script, "utf8")).toBe(original);
  expect(existsSync(path.join(path.dirname(script), "out"))).toBe(false);
  expect((await readdir(path.dirname(script))).sort()).toEqual(["plate.py"]);
});

test("script part: a size that is not a number is refused, the field keeps its value", async () => {
  await page.click('[data-testid="open-script"]');
  const first = page.locator('[data-testid="script-param-PEG"] input').first();
  await first.fill("abc");
  await first.press("Enter");
  await expect(first).toHaveValue("4");
  await page.click('[data-testid="script-close"]');
});
