// Quitting with unsaved changes (Save / Quit without saving / Cancel), and the print check
// running off the interface thread on a big mesh. Each test starts its own app.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function launch(workDir: string, closePrompt: boolean): Promise<{ app: ElectronApplication; page: Page }> {
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MAKERSTUDIO_USER_DATA: path.join(workDir, "userdata"),
    MAKERSTUDIO_DOCUMENTS: path.join(workDir, "documents"),
    MAKERSTUDIO_MOCK_AI: "1",
  };
  if (closePrompt) delete env.MAKERSTUDIO_SKIP_CLOSE_PROMPT;
  else env.MAKERSTUDIO_SKIP_CLOSE_PROMPT = "1";
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  return { app, page };
}

/** Answers the quit prompt with the given button, and the save dialog with `file`. */
async function answerDialogs(app: ElectronApplication, button: number, file: string) {
  await app.evaluate(({ dialog }, { button, file }) => {
    (globalThis as { asked?: number }).asked = 0;
    dialog.showMessageBoxSync = (() => { (globalThis as { asked?: number }).asked!++; return button; }) as typeof dialog.showMessageBoxSync;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, { button, file });
}

async function makeAChange(page: Page) {
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="add-box"]');
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(1);
}

test("quit with unsaved changes: Save saves the project, then the app closes", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-quit-"));
  const file = path.join(workDir, "Saved on quit.msproj");
  const { app, page } = await launch(workDir, true);
  await makeAChange(page);
  await answerDialogs(app, 0, file);
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
  await closed;
  expect((await stat(file)).size).toBeGreaterThan(0);
  // The saved file opens again with the box in it.
  const again = await launch(workDir, false);
  await again.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog; }, file);
  await again.page.getByRole("button", { name: /^Open/ }).first().click();
  await again.page.keyboard.press("Control+2");
  await expect(again.page.locator('[data-testid="tree-row"]')).toHaveCount(1);
  await again.app.close();
});

test("quit with unsaved changes: Cancel keeps the app open, nothing is saved", async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-quit-"));
  const file = path.join(workDir, "Should not exist.msproj");
  const { app, page } = await launch(workDir, true);
  await makeAChange(page);
  await answerDialogs(app, 2, file);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
  await expect.poll(() => app.evaluate(() => (globalThis as { asked?: number }).asked)).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(1); // still open and usable
  await expect(stat(file)).rejects.toThrow();
  // Now "Quit without saving" closes without writing anything.
  await answerDialogs(app, 1, file);
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
  await closed;
  await expect(stat(file)).rejects.toThrow();
});

test("print check of a big mesh runs in the background: the window keeps responding", async () => {
  test.setTimeout(180000);
  const workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-bigprint-"));
  // A closed torus with 1000 x 400 quads = 800,000 triangles, as a binary STL.
  const U = 1000, V = 400, R = 40, r = 15;
  const at = (i: number, j: number) => {
    const u = ((i % U) / U) * 2 * Math.PI, v = ((j % V) / V) * 2 * Math.PI;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r + r * Math.sin(v)];
  };
  const count = U * V * 2;
  const stl = Buffer.alloc(84 + count * 50);
  stl.writeUInt32LE(count, 80);
  let t = 0;
  const tri = (a: number[], b: number[], c: number[]) => {
    [a, b, c].forEach((p, k) => p.forEach((x, axis) => stl.writeFloatLE(x, 84 + t * 50 + 12 + k * 12 + axis * 4)));
    t++;
  };
  for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    tri(a, b, c); tri(a, c, d);
  }
  const source = path.join(workDir, "big torus.stl");
  await writeFile(source, stl);

  const { app, page } = await launch(workDir, false);
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog; }, source);
  await page.click('[data-testid="import-model"]');
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "big torus" })).toHaveCount(1, { timeout: 60000 });
  await page.keyboard.press("Escape"); // nothing selected: check the whole scene

  await page.click('[data-testid="print-check"]');
  await expect(page.getByText(/this can take a little while; you can keep working/)).toBeVisible();
  // While the worker runs, the window answers within a frame or two.
  const results = page.locator('[data-testid="print-results"]');
  let slowest = 0, samples = 0;
  while (!(await results.isVisible()) && samples < 400) {
    const ms = await page.evaluate(() => new Promise<number>((done) => { const s = performance.now(); requestAnimationFrame(() => done(performance.now() - s)); }));
    slowest = Math.max(slowest, ms);
    samples++;
  }
  await expect(results).toContainText("big torus", { timeout: 120000 });
  expect(samples).toBeGreaterThan(3); // it really was still working while we measured
  expect(slowest).toBeLessThan(500);
  await app.close();
  void readFile;
});
