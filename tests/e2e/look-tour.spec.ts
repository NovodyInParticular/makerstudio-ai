// Screenshot tour for design review. Skipped unless SHOTS is set:
//   SHOTS=/some/folder [THEME=classic] npx playwright test tests/e2e/look-tour.spec.ts
import { _electron as electron, test } from "@playwright/test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test.skip(!process.env.SHOTS, "design screenshots only");

test("look tour", async () => {
  test.setTimeout(180_000);
  const out = process.env.SHOTS!;
  const work = await mkdtemp(path.join(tmpdir(), "ms-look-"));
  const card = path.join(work, "card");
  await mkdir(card);
  const app = await electron.launch({ args: ["."], env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(work, "u"), MAKERSTUDIO_DOCUMENTS: path.join(work, "d"), MAKERSTUDIO_MOCK_AI: "1", MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1", MAKERSTUDIO_MODEL_SOURCE: "http://127.0.0.1:9", MAKERSTUDIO_SD_ROOT: card } });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setFullScreen(false); });
  await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]!; w.unmaximize(); w.setSize(1600, 1000); w.center(); });
  await page.waitForTimeout(1000);
  const theme = process.env.THEME ?? "nova";
  if (theme !== "nova") {
    await page.click('[data-testid="nav-settings"]');
    await page.click(`[data-testid="theme-${theme}"]`);
    await page.click('[data-testid="nav-home"]');
  }
  await page.waitForTimeout(400);
  const shot = (n: string) => page.screenshot({ path: path.join(out, `${theme}-${n}.png`) });
  await shot("home");
  for (const id of ["circuit", "robotics", "parts", "settings", "projects", "ai"]) {
    await page.click(`[data-testid="nav-${id}"]`);
    await page.waitForTimeout(500);
    await shot(id);
  }
  await page.click('[data-testid="nav-cad"]');
  await page.waitForTimeout(2500);
  await page.click('[data-testid="add-box"]');
  await page.click('[data-testid="add-cylinder"]');
  await page.waitForTimeout(500);
  await shot("cad");
  await page.click('[data-testid="print-open"]');
  await page.waitForSelector('[data-testid="slice-quality"]');
  await page.waitForTimeout(800);
  await shot("print");
  await page.click('[data-testid="slice-slice"]');
  await page.waitForSelector('[data-testid="layer-slider"]', { timeout: 120_000 });
  await page.waitForTimeout(300);
  await shot("sliced-confetti");
  await page.waitForTimeout(2200);
  await page.locator('[data-testid="layer-range"]').evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "40"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click('[data-testid="slice-copy"]');
  await page.waitForTimeout(400);
  await shot("layers-copied");
  await app.close();
});
