// The window: full screen on first launch, the full-screen button and F11, and remembering it.
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("window: full screen at first launch, button and F11 toggle it, the choice is remembered", async () => {
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-window-"));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const env = { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" };
  const launch = () => electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env });
  const isFull = (app: Awaited<ReturnType<typeof launch>>) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen());

  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  const button = page.locator('[data-testid="fullscreen"]');
  await expect.poll(() => isFull(app)).toBe(true);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("F11");
  await expect.poll(() => isFull(app)).toBe(false);
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect.poll(() => isFull(app)).toBe(true);
  await button.click();
  await expect.poll(() => isFull(app)).toBe(false);
  await app.close();

  // Left windowed: it opens windowed next time.
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await page.waitForTimeout(800);
  expect(await isFull(app)).toBe(false);
  await app.close();
});

test("interface size: set in Settings, applied to the window and remembered after a restart", async () => {
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-zoom-"));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const env = { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" };
  const launch = () => electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env });
  const zoom = (app: Awaited<ReturnType<typeof launch>>) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor());
  let app = await launch();
  let page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  expect(await zoom(app)).toBe(1);
  await page.keyboard.press("Control+0");
  await page.selectOption('[data-testid="ui-zoom"]', "1.5");
  await expect.poll(() => zoom(app)).toBe(1.5);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await expect.poll(() => zoom(app)).toBe(1.5);
  // The menu's "Smaller" (Ctrl+-) changes it and the Settings page follows.
  await app.evaluate(({ Menu }) => { Menu.getApplicationMenu()!.items.flatMap((i) => i.submenu?.items ?? []).find((i) => i.label === "Smaller")!.click(); });
  await expect.poll(() => zoom(app)).toBeCloseTo(1.4, 5);
  await page.keyboard.press("Control+0");
  await expect(page.locator('[data-testid="ui-zoom"]')).toHaveValue("1.4");
  await app.close();
});

