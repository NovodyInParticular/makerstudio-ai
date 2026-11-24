// Opening another project starts every studio fresh: nothing selected, the 3D view on the new
// project's parts, and no AI proposal made for the old project waiting to be approved.

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let app: ElectronApplication;
let page: Page;
let workDir: string;

test.beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-switch-"));
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
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
});

test.afterAll(async () => {
  await app?.close();
});

const viewTarget = () => page.locator('[data-testid="viewport"] canvas').first();

test("opening another project clears the selection, fits the view and drops old proposals", async () => {
  const file = path.join(workDir, "Far box.msproj");
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
  }, file);

  // Project 1: one box far from the middle of the bed, selected, saved.
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="add-box"]');
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(1);
  await page.fill('[data-testid="pos-x"]', "300");
  await page.locator('[data-testid="pos-x"]').press("Enter");
  await expect(page.locator('[data-testid="pos-x"]')).toHaveValue("300");
  await page.keyboard.press("Control+s");
  await expect(page.locator('[data-testid="dirty-indicator"]')).toHaveCount(0);

  // An AI proposal for project 1, left waiting.
  const panel = page.locator('[data-testid="ai-panel"]');
  if (!(await panel.isVisible())) await page.keyboard.press("Control+j");
  await page.click('[data-testid="ai-mode-create"]');
  await page.fill('[data-testid="chat-input"]', "add a box");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="proposal-approve"]')).toHaveCount(1);

  // Project 2 (new, empty): the view is back on the empty bed and the proposal cannot be approved.
  await page.locator("body").click({ position: { x: 600, y: 20 } });
  await page.keyboard.press("Control+n");
  await page.fill('[data-testid="dialog-input"]', "Second");
  await page.click('[data-testid="dialog-ok"]');
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Second");
  await expect(page.locator('[data-testid="proposal-approve"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="proposal"]').first()).toContainText("made for the project that was open before");
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(0);
  await expect(viewTarget()).toHaveAttribute("data-view-target", "0,0,0");

  // Back to project 1: nothing selected, and the view is centred on the far box.
  await page.keyboard.press("Control+o");
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="pos-x"]')).toHaveCount(0);
  await expect(viewTarget()).toHaveAttribute("data-view-target", /^300,0,\d+$/);
});
