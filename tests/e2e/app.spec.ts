import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let app: ElectronApplication;
let page: Page;
let workDir: string;
const shots = process.env.MAKERSTUDIO_SHOTS; // optional folder for screenshots

async function launch() {
  // MAKERSTUDIO_EXECUTABLE lets the same tests run against a packaged build.
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }),
    env: {
      ...process.env,
      MAKERSTUDIO_USER_DATA: path.join(workDir, "userdata"),
      MAKERSTUDIO_DOCUMENTS: path.join(workDir, "documents"),
      MAKERSTUDIO_MOCK_AI: "1",
      MAKERSTUDIO_SLICER: path.join(workDir, "fake-slicer.sh"),
      MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1",
    },
  });
  page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  // The native save dialog cannot be clicked by a test, so answer it automatically.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, path.join(workDir, "Test Rover.msproj"));
}

test.beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "makerstudio-e2e-"));
  // Stands in for Bambu Studio: records the files it was asked to open.
  const fake = path.join(workDir, "fake-slicer.sh");
  await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(workDir, "slicer-args.txt")}"\n`);
  await chmod(fake, 0o755);
  await launch();
});

test.afterAll(async () => {
  await app?.close();
});

test("all ten workspaces are reachable by click and keyboard", async () => {
  const ids = ["home", "cad", "circuit", "robotics", "parts", "display", "ai", "projects", "device", "settings"];
  for (const id of ids) {
    await page.click(`[data-testid="nav-${id}"]`);
    await expect(page.locator(`[data-testid="workspace-${id}"]`)).toBeVisible();
    if (shots) await page.screenshot({ path: path.join(shots, `${id}.png`) });
  }

  for (let i = 0; i < ids.length; i++) {
    await page.keyboard.press(`Control+${i === 9 ? 0 : i + 1}`);
    await expect(page.locator(`[data-testid="workspace-${ids[i]}"]`)).toBeVisible();
  }
});

test("AI panel toggles with Ctrl+J", async () => {
  const panel = page.locator('[data-testid="ai-panel"]');
  const wasOpen = await panel.isVisible();
  await page.keyboard.press("Control+j");
  await expect(panel).toBeVisible({ visible: !wasOpen });
  await page.keyboard.press("Control+j");
  await expect(panel).toBeVisible({ visible: wasOpen });
});

test("AI Engineer page is the working assistant (not a 'planned' placeholder)", async () => {
  await page.keyboard.press("Control+7");
  const aiPage = page.locator('[data-testid="ai-page"]');
  await expect(aiPage).toBeVisible();
  await expect(page.getByText(/planned for Phase/)).toHaveCount(0);
  await expect(page.locator('[data-testid="nav-ai"]')).not.toContainText("P4");
  // The same assistant fills the page, so the side panel steps aside here.
  await expect(page.locator('[data-testid="ai-panel"]')).toHaveCount(0);
  await expect(aiPage.locator('[data-testid="ai-mode-create"]')).toBeVisible();
  await expect(aiPage.getByRole("button", { name: "Send" })).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "ai-page.png") });
  await page.keyboard.press("Control+1");
});

test("create, edit, undo, save and reopen a project", async () => {
  await page.keyboard.press("Control+1");
  await page.click('[data-testid="home-new"]');
  await page.fill('[data-testid="dialog-input"]', "Test Rover");
  await page.click('[data-testid="dialog-ok"]');
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Test Rover");
  await expect(page.locator('[data-testid="workspace-projects"]')).toBeVisible();

  await page.fill('[data-testid="notes"]', "Two N20 motors, wheel base 110 mm");
  await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

  // Rename, then undo the rename with the keyboard.
  await page.fill('[data-testid="project-name-input"]', "Wrong name");
  await page.locator('[data-testid="project-name-input"]').press("Enter");
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Wrong name");
  await page.locator("body").click({ position: { x: 600, y: 20 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Test Rover");
  await expect(page.locator('[data-testid="notes"]')).toHaveValue("Two N20 motors, wheel base 110 mm");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Wrong name");
  await page.keyboard.press("Control+z");

  await page.keyboard.press("Control+s");
  await expect(page.locator('[data-testid="dirty-indicator"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="revisions"]')).toContainText("Saved");
  const file = path.join(workDir, "Test Rover.msproj");
  expect((await stat(file)).size).toBeGreaterThan(100);
  if (shots) await page.screenshot({ path: path.join(shots, "projects-saved.png") });

  // Restart the app and reopen from the recent list.
  await app.close();
  await launch();
  await expect(page.locator('[data-testid="recent-list"]')).toContainText("Test Rover");
  await page.getByRole("button", { name: /Test Rover/ }).first().click();
  await expect(page.locator('[data-testid="project-name"]')).toHaveText("Test Rover");
  await page.keyboard.press("Control+8");
  await expect(page.locator('[data-testid="notes"]')).toHaveValue("Two N20 motors, wheel base 110 mm");
  await expect(page.locator('[data-testid="history"]')).toContainText("Undo: Rename project");
  if (shots) await page.screenshot({ path: path.join(shots, "home-reopened.png") });
});

test("3D Studio: add, resize, undo, group, duplicate, nudge, delete, save", async () => {
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
  const rows = page.locator('[data-testid="tree-row"]');
  const readout = page.locator('[data-testid="size-readout"]');
  const startCount = await rows.count();

  await page.click('[data-testid="add-box"]');
  await expect(rows).toHaveCount(startCount + 1);
  await expect(readout).toContainText("20 × 20 × 20 mm");

  await page.fill('[data-testid="param-width"]', "50");
  await page.locator('[data-testid="param-width"]').press("Enter");
  await expect(readout).toContainText("50 × 20 × 20 mm");
  // A size of 0 is refused with a message, and nothing changes.
  await page.fill('[data-testid="param-height"]', "0");
  await page.locator('[data-testid="param-height"]').press("Enter");
  await expect(page.getByText(/Height \(Z\) must be at least/)).toBeVisible();
  await expect(readout).toContainText("50 × 20 × 20 mm");

  await page.locator('[data-testid="param-height"]').press("Escape"); // leave the field without changing it
  await page.keyboard.press("Control+z");
  await expect(readout).toContainText("20 × 20 × 20 mm");

  // Nudge with the arrow key (1 mm grid by default).
  await rows.last().click();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-testid="pos-x"]')).toHaveValue("1");

  await page.click('[data-testid="add-cylinder"]');
  await page.fill('[data-testid="pos-x"]', "40");
  await page.locator('[data-testid="pos-x"]').press("Enter");
  await rows.last().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+g");
  await expect(page.getByText("Group", { exact: true }).first()).toBeVisible();
  await expect(rows).toHaveCount(startCount + 3); // group + 2 shapes
  await expect(readout).toContainText("59 × 20 × 20 mm"); // box -9..11 and cylinder 30..50 on X

  await page.keyboard.press("Control+Shift+g");
  await expect(rows).toHaveCount(startCount + 2);
  await page.keyboard.press("Control+d");
  await expect(rows).toHaveCount(startCount + 4);
  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(startCount + 2);

  await page.click('[data-testid="add-wedge"]');
  await page.click('[data-testid="add-torus"]');
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  if (shots) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, "cad.png") });
    await page.locator('[data-testid="tree-row"]').first().click();
    await page.getByRole("button", { name: "Home", exact: true }).last().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shots, "cad-selected.png") });
    await page.keyboard.press("Escape");
  }
  const count = await rows.count();

  // Save, restart, reopen: objects are still there.
  await page.keyboard.press("Control+s");
  await expect(page.locator('[data-testid="dirty-indicator"]')).toHaveCount(0);
  await app.close();
  await launch();
  await page.getByRole("button", { name: /Test Rover/ }).first().click();
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(count); // new window, so a new locator
});

test("3D Studio: Booleans, group mode, text, measure and workplane tools", async () => {
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  const rows = page.locator('[data-testid="tree-row"]');
  const readout = page.locator('[data-testid="size-readout"]');

  // Two 20 mm boxes, the second moved 10 mm along X so they overlap by half.
  await page.click('[data-testid="add-box"]');
  await page.fill('[data-testid="pos-x"]', "200");
  await page.locator('[data-testid="pos-x"]').press("Enter");
  await page.click('[data-testid="add-box"]');
  await page.fill('[data-testid="pos-x"]', "210");
  await page.locator('[data-testid="pos-x"]').press("Enter");
  const n = await rows.count();
  const selectBoth = async () => {
    await rows.nth(n - 2).click();
    await rows.nth(n - 1).click({ modifiers: ["Shift"] });
    await expect(page.getByText("2 objects selected")).toBeVisible();
  };

  // Subtract: the first selected box keeps only its left half.
  await selectBoth();
  await page.click('[data-testid="bool-subtract"]');
  await expect(page.locator('[data-testid="inspector"] .badge')).toHaveText("Group");
  await expect(readout).toContainText("10 × 20 × 20 mm");
  await expect(rows.filter({ hasText: "hole" })).toHaveCount(1);
  if (shots) await page.screenshot({ path: path.join(shots, "cad-subtract.png") });
  await page.keyboard.press("Control+z");
  await expect(rows).toHaveCount(n);

  // Intersect: only the overlap remains.
  await selectBoth();
  await page.click('[data-testid="bool-intersect"]');
  await expect(readout).toContainText("10 × 20 × 20 mm");
  await page.keyboard.press("Control+z");

  // Union, then switch the group to intersect and back.
  await selectBoth();
  await page.click('[data-testid="bool-union"]');
  await expect(readout).toContainText("30 × 20 × 20 mm");
  await page.locator('[data-testid="group-mode"]').getByRole("button", { name: "Intersect" }).click();
  await expect(readout).toContainText("10 × 20 × 20 mm");
  await page.keyboard.press("Control+z");
  await expect(readout).toContainText("30 × 20 × 20 mm");
  await page.click("text=Ungroup");
  await expect(rows).toHaveCount(n);

  // Text: editing it changes the size; empty text is refused.
  await page.click('[data-testid="add-text"]');
  await expect(page.locator('[data-testid="text-input"]')).toHaveValue("Text");
  const before = await readout.textContent();
  await page.fill('[data-testid="text-input"]', "MakerStudio");
  await page.locator('[data-testid="text-input"]').press("Enter");
  await expect(readout).not.toHaveText(before ?? "");
  await page.fill('[data-testid="text-input"]', "   ");
  await page.locator('[data-testid="text-input"]').press("Enter");
  await expect(page.getByText("Text cannot be empty.")).toBeVisible();
  await expect(page.locator('[data-testid="text-input"]')).toHaveValue("MakerStudio");
  await page.keyboard.press("Escape");

  // Measure: two clicks on the bed show a distance label.
  const canvas = page.locator('[data-testid="viewport"] canvas');
  await page.click('[data-testid="tool-measure"]');
  await expect(page.locator('[data-testid="viewport-hint"]')).toContainText("Measure");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * 0.85, y: box.height * 0.8 } });
  await canvas.click({ position: { x: box.width * 0.95, y: box.height * 0.8 } });
  await expect(page.locator('[data-testid="measure-label"]')).toBeVisible();
  await expect(page.locator('[data-testid="measure-label"]')).toContainText("mm");
  if (shots) await page.screenshot({ path: path.join(shots, "cad-measure.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="measure-label"]')).toHaveCount(0);

  // Workplane: the button toggles the tool; Escape cancels it.
  await page.click('[data-testid="tool-workplane"]');
  await expect(page.locator('[data-testid="viewport-hint"]')).toContainText("Workplane");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="viewport-hint"]')).toHaveCount(0);
});

test("3D Studio: import STL, convert units, export STL / parts, save and reopen", async () => {
  // A closed 10 x 20 x 30 mm box as a binary STL.
  const v = [[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 20, 0], [0, 0, 30], [10, 0, 30], [10, 20, 30], [0, 20, 30]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const stl = Buffer.alloc(84 + faces.length * 50);
  stl.writeUInt32LE(faces.length, 80);
  faces.forEach((f, i) => f.forEach((vi, c) => v[vi]!.forEach((x, a) => stl.writeFloatLE(x, 84 + i * 50 + 12 + c * 12 + a * 4))));
  const source = path.join(workDir, "bracket.stl");
  await writeFile(source, stl);
  const exported = path.join(workDir, "exported.stl");
  const partsDir = path.join(workDir, "parts");
  await mkdir(partsDir);

  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, source);
  await page.click('[data-testid="import-model"]');
  const row = page.locator('[data-testid="tree-row"]', { hasText: "bracket" });
  await expect(row).toHaveCount(1);
  const readout = page.locator('[data-testid="size-readout"]');
  await expect(readout).toContainText("10 × 20 × 30 mm");
  await expect(readout).toContainText("bottom at Z 0 mm");
  await expect(page.locator('[data-testid="mesh-info"]')).toContainText("Yes (closed solid)");
  await expect(page.locator('[data-testid="mesh-info"]')).toContainText("12");

  await page.getByRole("button", { name: "inches → mm" }).click();
  await expect(readout).toContainText("254 × 508 × 762 mm");
  await page.keyboard.press("Control+z");
  await expect(readout).toContainText("10 × 20 × 30 mm");

  // Export the selected mesh as one STL.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, exported);
  await page.click('[data-testid="export-stl"]');
  await expect(page.getByText(/Exported 1 part to/)).toBeVisible();
  expect((await stat(exported)).size).toBe(84 + 12 * 50);

  // Export every visible object as its own STL.
  await page.keyboard.press("Escape");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, partsDir);
  await page.click('[data-testid="export-parts"]');
  await expect(page.getByText(/Exported \d+ parts to/)).toBeVisible();
  const written = await readdir(partsDir);
  expect(written).toContain("bracket.stl");
  expect(written.every((f) => f.endsWith(".stl"))).toBe(true);
  if (shots) await page.screenshot({ path: path.join(shots, "cad-import.png") });

  // The mesh is stored in the project file.
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, path.join(workDir, "Test Rover.msproj"));
  await page.keyboard.press("Control+s");
  await expect(page.locator('[data-testid="dirty-indicator"]')).toHaveCount(0);
  await app.close();
  await launch();
  await page.getByRole("button", { name: /Test Rover/ }).first().click();
  await page.keyboard.press("Control+2");
  await page.locator('[data-testid="tree-row"]', { hasText: "bracket" }).click();
  await expect(page.locator('[data-testid="size-readout"]')).toContainText("10 × 20 × 30 mm");
});

test("3D Studio: print check, orient for printing, open in Bambu Studio", async () => {
  // Continues with the 10 x 20 x 30 mm "bracket" from the previous test, standing upright.
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.locator('[data-testid="tree-row"]', { hasText: "bracket" }).click();
  const readout = page.locator('[data-testid="size-readout"]');
  await expect(readout).toContainText("10 × 20 × 30 mm");

  await page.click('[data-testid="print-check"]');
  const results = page.locator('[data-testid="print-results"]');
  await expect(results).toContainText("bracket");
  await expect(results).toContainText("No problems found.");

  // Orient lays it on its largest face (20 x 30), so it is 10 mm tall; undo stands it up again.
  await page.click('[data-testid="print-orient"]');
  await expect(page.getByText(/Turned 1 part for printing/)).toBeVisible();
  await expect(readout).toContainText("× 10 mm");
  await expect(readout).toContainText("bottom at Z 0 mm");
  await page.keyboard.press("Control+z");
  await expect(readout).toContainText("10 × 20 × 30 mm");
  await expect(page.locator('[data-testid="print-stale"]')).toBeVisible();

  // Lifted off the bed: the check notices.
  await page.keyboard.press("PageUp");
  await page.click('[data-testid="print-check"]');
  await expect(page.locator('[data-testid="print-issue-floating"]')).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "cad-print-check.png") });
  await page.keyboard.press("Control+z");

  // Hand the part to the slicer: one STL per part in a new folder under Documents/MakerStudio/Exports.
  await expect(page.locator('[data-testid="print-slicer"]')).toBeEnabled();
  await page.click('[data-testid="print-slicer"]');
  await expect(page.getByText(/Opened 1 part in Bambu Studio/)).toBeVisible();
  await expect.poll(() => readFile(path.join(workDir, "slicer-args.txt"), "utf8").catch(() => ""), { timeout: 5000 }).toContain("bracket.stl");
  const args = (await readFile(path.join(workDir, "slicer-args.txt"), "utf8")).trim().split("\n");
  expect(args).toHaveLength(1);
  expect(args[0]!.startsWith(path.join(workDir, "documents", "MakerStudio", "Exports", "For Bambu Studio"))).toBe(true);
  expect((await stat(args[0]!)).size).toBe(84 + 12 * 50);

  // With nothing selected the whole scene is checked; the torus has overhangs to highlight.
  await page.keyboard.press("Escape");
  await page.click('[data-testid="print-check"]');
  await expect(page.locator('[data-testid="print-issue-overhang"]').first()).toBeVisible();
  await expect(page.getByText("Show in the view:")).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "cad-print-all.png") });
});

test("3D Studio: STEP export and import round trip", async () => {
  // The 10 x 20 x 30 mm "bracket" mesh plus a cylinder: one faceted and one exact solid.
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="add-cylinder"]'); // the new cylinder is selected
  await page.locator('[data-testid="tree-row"]', { hasText: "bracket" }).click({ modifiers: ["Shift"] });
  await expect(page.locator('[data-testid="tree-row"].selected')).toHaveCount(2);

  const file = path.join(workDir, "round trip.step");
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  }, file);
  await page.click('[data-testid="export-step"]');
  await expect(page.getByText(/Exported 2 parts to/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/"bracket" is made of flat faces/)).toBeVisible();
  const text = await readFile(file, "utf8");
  expect(text.startsWith("ISO-10303-21;")).toBe(true);
  expect(text).toContain("bracket");
  expect(text).toContain("CYLINDRICAL_SURFACE"); // the cylinder is a true cylinder, not triangles

  // Import it back: two solids, placed next to each other as in the file.
  await page.keyboard.press("Escape");
  const before = await page.locator('[data-testid="tree-row"]').count();
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [source] })) as typeof dialog.showOpenDialog;
  }, file);
  await page.click('[data-testid="import-model"]');
  await expect(page.getByText(/Imported "round trip" from STEP: 2 solids/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-testid="tree-row"]')).toHaveCount(before + 2);
  const sizes = [];
  for (const label of ["round trip 1", "round trip 2"]) {
    await page.locator('[data-testid="tree-row"]', { hasText: label }).click();
    sizes.push(await page.locator('[data-testid="size-readout"]').innerText());
  }
  expect(sizes.some((s) => s.includes("10 × 20 × 30 mm"))).toBe(true);
  if (shots) await page.screenshot({ path: path.join(shots, "cad-step.png") });
});

test("Projects: start a practice project from the catalog", async () => {
  await page.keyboard.press("Control+8");
  const catalog = page.locator('[data-testid="practice-catalog"]');
  await expect(catalog).toBeVisible();
  await expect(catalog.locator(".practice-card")).toHaveCount(28);
  await expect(catalog.locator('[data-testid="practice-xiao-oled-face"]')).toContainText("OLED robot face");
  // Drones (added 2026-11-09), two of them for the ESP32-S3.
  await expect(catalog.locator('[data-testid="practice-litewing"]')).toContainText("ESP32-S3");
  await expect(catalog.locator('[data-testid="practice-esp-drone"]')).toContainText("ESP-Drone");
  await expect(catalog.locator('[data-testid="practice-flix"]')).toContainText("Flix");
  await page.click('[data-testid="practice-filter-Starter"]');
  await expect(catalog.locator(".practice-card")).toHaveCount(8);
  if (shots) await page.screenshot({ path: path.join(shots, "practice.png"), fullPage: true });

  await page.click('[data-testid="practice-start-roboeyes"]');
  // The current project has unsaved changes from earlier tests, so the app asks first.
  await expect(page.locator(".dialog h3")).toHaveText("Unsaved changes");
  await page.locator(".dialog button", { hasText: "Discard changes" }).click();
  await expect(page.getByText(/Started "Animated robot eyes/)).toBeVisible();
  await expect(page.locator('[data-testid="notes"]')).toHaveValue(/https:\/\/github.com\/FluxGarage\/RoboEyes/);
  await expect(page.locator('[data-testid="notes"]')).toHaveValue(/- \[ \] Install the Arduino IDE/);

  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "Face box" })).toHaveCount(1);
  await page.locator('[data-testid="tree-row"]', { hasText: "Face box" }).click();
  await expect(page.locator('[data-testid="size-readout"]')).toContainText("40 × 24 × 32 mm");
});

test("Display Studio: add a face, preset, undo, moods, alive", async () => {
  await page.keyboard.press("Control+6");
  await expect(page.locator('[data-testid="display-workspace"]')).toBeVisible();
  await page.selectOption('[data-testid="new-face-display"]', "m5stack-cores3");
  await page.click('[data-testid="new-face"]');
  await expect(page.locator('[data-testid="screen-row"]')).toHaveCount(1);
  const canvas = page.locator('[data-testid="face-canvas"]');
  await expect(canvas).toBeVisible();
  await page.click('[data-testid="face-alive"]'); // stop blinking so pixels are steady
  // The realistic view is the default; exact pixels are checked in Pixels mode.
  await expect(page.locator('[data-testid="device-frame"]')).toBeVisible();
  await page.click('[data-testid="look-pixels"]');

  // Colour of one display pixel (the left eye's centre in the default face).
  const sample = () => canvas.evaluate((c: HTMLCanvasElement) => {
    const zoom = c.width / 320;
    const d = c.getContext("2d")!.getImageData(Math.floor(93 * zoom + zoom / 2), Math.floor(96 * zoom + zoom / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  await expect.poll(sample).toEqual([255, 255, 255]);
  await page.getByRole("button", { name: "Robot", exact: true }).click();
  await expect.poll(sample).toEqual([0x2f, 0xd6, 0xa3]);
  await page.keyboard.press("Control+z");
  await expect.poll(sample).toEqual([255, 255, 255]);

  // Every mood changes the picture.
  const images = new Set<string>();
  for (const mood of ["neutral", "happy", "sad", "angry", "sleepy", "surprised"]) {
    await page.click(`[data-testid="mood-${mood}"]`);
    await page.waitForTimeout(50);
    images.add(await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()));
  }
  expect(images.size).toBe(6);
  await page.click('[data-testid="mood-happy"]');
  await page.click('[data-testid="face-alive"]');
  await page.click('[data-testid="face-talk"]');
  if (shots) await page.screenshot({ path: path.join(shots, "display-studio.png") });

  // Timeline: a ready-made "Wake up" animation starts asleep and ends awake.
  const lit = () => canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200) n++;
    return n;
  });
  await page.click('[data-testid="anim-new-Wake up"]');
  await expect(page.locator('[data-testid="anim-select"]')).toHaveValue(/.+/);
  await expect(page.locator('[data-testid="anim-time"]')).toHaveText("0.00 / 4.0 s");
  const asleep = await lit();
  const track = page.locator('[data-testid="anim-track"]');
  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width - 1, box.y + 5); // scrub to the end
  await expect(page.locator('[data-testid="anim-time"]')).toHaveText("4.00 / 4.0 s");
  await expect.poll(lit).toBeGreaterThan(asleep * 1.5); // eyes open
  await page.click('[data-testid="anim-play"]'); // plays again from the start
  await expect.poll(async () => page.locator('[data-testid="anim-time"]').innerText()).not.toBe("4.00 / 4.0 s");
  await page.click('[data-testid="anim-play"]'); // pause
  if (shots) await page.screenshot({ path: path.join(shots, "display-timeline.png") });

  // Double-click a row to add a keyframe; undo removes it.
  const keys = page.locator('[data-testid="keyframe"]');
  const before = await keys.count();
  const talkRow = (await page.locator('[data-testid="anim-row-talk"]').boundingBox())!;
  await page.mouse.dblclick(talkRow.x + talkRow.width * 0.3, talkRow.y + talkRow.height / 2);
  await expect(keys).toHaveCount(before + 1);
  await expect(page.locator('[data-testid="key-editor"]')).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(keys).toHaveCount(before);

  // Export a PlatformIO project for the M5Stack CoreS3 that starts with "Wake up".
  const firmwareDir = path.join(workDir, "firmware");
  await mkdir(firmwareDir);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, firmwareDir);
  await expect(page.locator('[data-testid="export-board"]')).toHaveValue("m5stack-cores3");
  await page.selectOption('[data-testid="export-start"]', "0");
  await page.click('[data-testid="export-code"]');
  await expect(page.getByText(/Code project saved in/)).toBeVisible();
  const [projectDir] = await readdir(firmwareDir);
  const projectPath = path.join(firmwareDir, projectDir!);
  expect((await readdir(projectPath)).sort()).toEqual(["README.md", "include", "platformio.ini", "src"]);
  expect(await readFile(path.join(projectPath, "platformio.ini"), "utf8")).toContain("board = m5stack-cores3");
  const data = await readFile(path.join(projectPath, "include", "face_data.h"), "utf8");
  expect(data).toContain("#define START_ANIMATION 0");
  expect(data).toContain('"Wake up"');

  // A monochrome OLED shows only lit and dark pixels.
  await page.selectOption('[data-testid="face-display"]', "ssd1306-128x64");
  await expect(page.getByText("128 × 64 px · monochrome")).toBeVisible();
  await expect(page.locator('[data-testid="export-board"] option')).toHaveText(["Arduino Uno", "Arduino Nano (ATmega328P)", "ESP32 DevKit", "ESP32-S3 DevKitC-1", "Seeed XIAO ESP32-S3 (Sense)", "Raspberry Pi Pico"]);
});

test("Robotics Studio: joint on the Stack-chan head, pose, mount the face, wiggle", async () => {
  // Start from the Stack-chan practice project (head and base parts).
  await page.keyboard.press("Control+8");
  await page.click('[data-testid="practice-start-stack-chan"]');
  if (await page.locator(".dialog").isVisible().catch(() => false) || await page.locator(".dialog").waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await page.locator(".dialog button", { hasText: "Discard changes" }).click();
  }
  await expect(page.getByText(/Started "Stack-chan desk robot/)).toBeVisible();
  // A face to put on it.
  await page.keyboard.press("Control+6");
  await page.click('[data-testid="new-face"]');

  await page.keyboard.press("Control+4");
  await expect(page.locator('[data-testid="robotics-workspace"]')).toBeVisible();
  await expect(page.locator('[data-testid="robot-part"]')).toHaveCount(3);
  await page.locator('[data-testid="robot-part"]', { hasText: "Head" }).click();
  await page.click('[data-testid="add-joint"]');
  await expect(page.locator('[data-testid="joint-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="joint-inspector"]')).toBeVisible();
  await page.click('[data-testid="joint-axis-x"]');
  await expect(page.locator('[data-testid="robot-part"]', { hasText: "Head" })).toContainText("moves");

  // Posing the joint moves the head in the 3D view.
  const canvas = page.locator('[data-testid="robot-canvas"] canvas');
  const snap = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(300);
  const home = await snap();
  await page.locator('[data-testid="joint-try"]').fill("45");
  await expect(page.locator('[data-testid="joint-row"]')).toContainText("45°");
  await expect.poll(snap).not.toBe(home);

  // Mount the face by clicking the head in the view (it is in the middle of the picture).
  await page.locator('[data-testid="joint-try"]').fill("0");
  await page.click('[data-testid="mount-screen"]');
  await expect(page.locator('[data-testid="pick-hint"]')).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-testid="mount-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="mount-row"]')).toContainText("on Head");
  await expect(page.locator('[data-testid="mount-inspector"]')).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "robotics-mounted.png") });

  await page.locator('[data-testid="joint-row"]').click();
  await page.locator('[data-testid="joint-try"]').fill("30");
  if (shots) await page.screenshot({ path: path.join(shots, "robotics.png") });

  // Wiggle test animates the joints.
  await page.click('[data-testid="wiggle"]');
  const a = await snap();
  await expect.poll(snap).not.toBe(a);
  await page.click('[data-testid="wiggle"]');

  // Undo removes the mounted screen.
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="mount-row"]')).toHaveCount(0);

  // Behaviour: "Say hello" nods the head (its X joint), talks, and finishes.
  await page.click('[data-testid="behavior-new-Say hello"]');
  await expect(page.locator('[data-testid="behavior-select"]')).toHaveValue(/.+/);
  const steps = page.locator('[data-testid="step"]');
  expect(await steps.count()).toBeGreaterThan(5);
  const before = await snap();
  await page.click('[data-testid="behavior-run"]');
  await expect(page.locator('[data-testid="behavior-run"]')).toHaveText("Stop");
  await expect.poll(async () => page.locator('[data-testid="joint-row"]').innerText(), { timeout: 3000 }).not.toMatch(/\b0°/);
  await expect.poll(snap).not.toBe(before);
  if (shots) await page.screenshot({ path: path.join(shots, "robotics-behavior.png") });
  await expect(page.locator('[data-testid="behavior-run"]')).toHaveText("Run", { timeout: 10000 }); // finished

  // Add a step, then undo it.
  const n = await steps.count();
  await page.selectOption('[data-testid="add-step-0"]', "wait");
  await expect(steps).toHaveCount(n + 1);
  await page.keyboard.press("Control+z");
  await expect(steps).toHaveCount(n);

  // Give the head joint a servo pin, then export the whole robot's code.
  await page.locator('[data-testid="joint-row"]').click();
  const pin = page.locator('[data-testid="joint-inspector"] .num-field', { hasText: "Pin" }).locator("input");
  await pin.fill("6");
  await pin.blur();
  await page.mouse.click(box.x + 10, box.y + 10); // empty sky: back to the robot overview
  await expect(page.locator('[data-testid="robot-export"]')).toBeVisible();
  const robotDir = path.join(workDir, "robot-code");
  await mkdir(robotDir);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, robotDir);
  await page.selectOption('[data-testid="robot-export-behavior"]', { label: "Say hello" });
  await page.click('[data-testid="robot-export-code"]');
  await expect(page.getByText(/Robot code saved in/)).toBeVisible();
  const [exported] = await readdir(robotDir);
  const robotData = await readFile(path.join(robotDir, exported!, "include", "robot_data.h"), "utf8");
  expect(robotData).toContain('behaviour "Say hello"');
  expect(robotData).toContain("static const int RB_SERVO_PIN[] = {6};");
  expect(await readFile(path.join(robotDir, exported!, "src", "main.cpp"), "utf8")).toContain('#include "robot_runner.h"');
});

test("Circuit Studio: wire an LED to an Uno, live checks catch mistakes", async () => {
  await page.keyboard.press("Control+3");
  await expect(page.locator('[data-testid="circuit-workspace"]')).toBeVisible();
  for (const part of ["arduino-uno-r3", "resistor", "led"]) await page.click(`[data-testid="part-${part}"]`);
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(3);
  if (shots) await page.screenshot({ path: path.join(shots, "circuit-placed.png") });
  const connect = async (a: string, b: string) => {
    await page.locator(`[data-testid="pin-${a}"]`).click();
    await page.locator(`[data-testid="pin-${b}"]`).click();
  };
  await connect("Arduino UNO R3-D13", "Resistor-1");
  await connect("Resistor-2", "LED-A");
  await connect("LED-K", "Arduino UNO R3-GND1");
  await expect(page.locator('[data-testid="wire"]')).toHaveCount(3);
  const summary = page.locator('[data-testid="check-summary"]');
  await expect(summary).toHaveText(/^No problems detected by MakerStudio's checks \(\d+ checks run\)\. This is not a guarantee\.$/);
  if (shots) await page.screenshot({ path: path.join(shots, "circuit-ok.png") });

  // Make the resistor far too small: the LED current check fires.
  if (shots) await page.screenshot({ path: path.join(shots, "circuit-before-select.png") });
  await page.locator('[data-part="Resistor"] rect[fill="#d9c49b"]').click({ force: true });
  await page.locator('[data-testid="prop-ohms"]').fill("1");
  await page.locator('[data-testid="prop-ohms"]').blur();
  await expect(page.locator('[data-testid="finding-led-current"]')).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(summary).toHaveText(/^No problems detected/);

  // Wire the pin straight to 5V: a direct tie from a GPIO to a supply is a danger.
  await connect("Arduino UNO R3-5V", "Arduino UNO R3-D13");
  await expect(page.locator('[data-testid="finding-gpio-tied"]')).toBeVisible();
  await expect(summary).toHaveText(/problem/);
  if (shots) await page.screenshot({ path: path.join(shots, "circuit-danger.png") });
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="finding-gpio-tied"]')).toHaveCount(0);

  // Wire the robot from the Robotics Studio (its head servo is on pin 6) onto an ESP32-S3.
  await expect(page.locator('[data-testid="wire-robot"]')).toBeVisible();
  await page.selectOption('[data-testid="wire-robot-board"]', "esp32-s3-devkitc-1");
  await page.click('[data-testid="wire-robot-go"]');
  await expect(page.getByText(/Wired .*: 3 parts, 4 wires \(one undo step\)/)).toBeVisible();
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(6);
  await expect(summary).toHaveText(/^No problems detected/);
  if (shots) await page.screenshot({ path: path.join(shots, "circuit-robot.png") });
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(3);
});

test("Claude Code connection (MCP): read, propose, approve in the AI panel, undo; locked down", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  // Turn the connection on in Settings (a free port for the test).
  await page.keyboard.press("Control+0");
  const card = page.locator('[data-testid="claude-code-card"]');
  await card.locator(".field", { hasText: "Port" }).locator("input").fill("47391");
  await card.locator(".field", { hasText: "Port" }).locator("input").blur();
  await page.click('[data-testid="mcp-enabled"]');
  await expect(page.locator('[data-testid="mcp-status"]')).toContainText("Listening on http://127.0.0.1:47391/mcp", { timeout: 10000 });
  const command = await page.locator('[data-testid="mcp-command"]').innerText();
  expect(command).toMatch(/^claude mcp add --transport http --scope user makerstudio http:\/\/127\.0\.0\.1:47391\/mcp --header "Authorization: Bearer [A-Za-z0-9_-]{43}"$/);
  const token = command.match(/Bearer ([A-Za-z0-9_-]+)/)![1]!;
  const url = "http://127.0.0.1:47391/mcp";

  // Locked down: no token, a wrong token, or a browser origin are refused.
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
  const post = (headers: Record<string, string>) => fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(init) });
  expect((await post({})).status).toBe(401);
  expect((await post({ authorization: "Bearer nope" })).status).toBe(401);
  expect((await post({ authorization: `Bearer ${token}`, origin: "https://evil.example" })).status).toBe(403);

  // Connect like Claude Code does.
  const client = new Client({ name: "e2e-claude-code", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["get_project", "cad_add_shape", "circuit_connect", "list_catalog"]));
  const project = await client.callTool({ name: "get_project", arguments: {} });
  expect(JSON.parse((project.content as { text: string }[])[0]!.text).units).toBe("mm");

  // Assist mode (the default): changes are refused.
  const refused = await client.callTool({ name: "cad_add_shape", arguments: { kind: "box", name: "From Claude" } });
  expect(refused.isError).toBe(true);
  expect((refused.content as { text: string }[])[0]!.text).toMatch(/not allowed in assist mode/);

  // Create mode: the change becomes a proposal, nothing is applied yet.
  await page.click('[data-testid="ai-mode-create"]');
  const proposed = await client.callTool({ name: "cad_add_shape", arguments: { kind: "box", name: "From Claude", params: { width: 30, depth: 20, height: 10 } } });
  expect(proposed.isError).toBeFalsy();
  expect((proposed.content as { text: string }[])[0]!.text).toMatch(/Not applied yet/);
  const card2 = page.locator('[data-testid="proposal"]').first();
  await expect(card2).toContainText("Claude Code");
  await expect(card2).toContainText('Add box "From Claude"');
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "From Claude" })).toHaveCount(0);

  // Approve: one undoable AI step.
  await page.click('[data-testid="proposal-approve"]');
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "From Claude" })).toHaveCount(1);
  if (shots) await page.screenshot({ path: path.join(shots, "claude-code-approved.png") });
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "From Claude" })).toHaveCount(0);

  // A rejected proposal changes nothing.
  await client.callTool({ name: "notes_append", arguments: { text: "Hello from Claude Code" } });
  await page.click('[data-testid="proposal-reject"]');
  await page.keyboard.press("Control+8");
  await expect(page.locator('[data-testid="notes"]')).not.toHaveValue(/Hello from Claude Code/);

  await client.close();
  await page.click('[data-testid="ai-mode-assist"]');
});

test("Built-in AI chat: settings, answers from the project, proposes in Create mode", async () => {
  await page.keyboard.press("Control+0");
  const card = page.locator('[data-testid="providers-card"]');
  await expect(card).toContainText("AI providers (built-in chat)");
  await expect(page.locator('[data-testid="ai-provider"]')).toHaveValue("ollama");
  // The Claude choice shows the key field (keys are never shown back).
  await page.selectOption('[data-testid="ai-provider"]', "anthropic");
  await expect(card).toContainText("console.anthropic.com");
  await expect(page.locator('[data-testid="key-anthropic"]')).toHaveAttribute("type", "password");
  await page.selectOption('[data-testid="ai-provider"]', "ollama");

  await page.keyboard.press("Control+2");
  const panel = page.locator('[data-testid="ai-panel"]');
  if (!(await panel.isVisible())) await page.keyboard.press("Control+j");
  await page.click('[data-testid="ai-mode-assist"]');
  await page.fill('[data-testid="chat-input"]', "what is in my project?");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="chat-assistant"]').last()).toContainText(/\(mock, assist mode\) The project has \d+ 3D objects\./);
  await expect(page.locator('[data-testid="chat-assistant"]').last()).toContainText("get project");

  // Assist mode: the proposal is refused and the chat says so.
  await page.fill('[data-testid="chat-input"]', "add a box");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="chat-assistant"]').last()).toContainText("not allowed in assist mode");

  // Create mode: it becomes a proposal; approve applies it.
  await page.click('[data-testid="ai-mode-create"]');
  await page.fill('[data-testid="chat-input"]', "add a box");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="chat-assistant"]').last()).toContainText("waiting for your approval");
  const card2 = page.locator('[data-testid="proposal"]').first();
  await expect(card2).toContainText('Add box "Chat box"');
  await expect(card2).toContainText("AI chat");
  await page.click('[data-testid="proposal-approve"]');
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "Chat box" })).toHaveCount(1);
  if (shots) await page.screenshot({ path: path.join(shots, "chat-approved.png") });
  await page.keyboard.press("Control+z");
  await page.click('[data-testid="chat-new"]');
  await expect(page.locator('[data-testid="chat-assistant"]')).toHaveCount(0);
  await page.click('[data-testid="ai-mode-assist"]');
});

test("Circuit Studio: breadboard and the full parts library drawn as real parts", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+0");
  const command = await page.locator('[data-testid="mcp-command"]').innerText();
  const token = command.match(/Bearer ([A-Za-z0-9_-]+)/)![1]!;
  const port = command.match(/127\.0\.0\.1:(\d+)/)![1]!;
  // Start from an empty circuit.
  await page.keyboard.press("Control+3");
  for (let i = 0; i < 40 && (await page.locator('[data-testid="circuit-part"]').count()) > 0; i++) {
    await page.locator('[data-testid="circuit-part"] > g').first().click({ force: true });
    await page.keyboard.press("Delete");
  }
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(0);
  await page.keyboard.press("Control+0");
  const client = new Client({ name: "e2e-gallery", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  await page.click('[data-testid="ai-mode-create"]');
  const add = async (type: string, x: number, y: number, label?: string, props?: Record<string, number | string | boolean>) => {
    const r = await client.callTool({ name: "circuit_add_part", arguments: { type, x, y, ...(label ? { label } : {}), ...(props ? { props } : {}) } });
    expect(r.isError, `${type}: ${JSON.stringify(r.content)}`).toBeFalsy();
  };
  // A working LED circuit on a breadboard: LED legs in e10/e12, 220 Ω from a12 to a16.
  await add("breadboard-half", 0, 0, "Breadboard");
  await add("led", 11, 6, "LED");
  await add("resistor", 13, 2, "R1", { ohms: 220 });
  await add("arduino-uno-r3", -22, 0, "Uno");
  // Every other part in a gallery below.
  const skip = new Set(["breadboard-half", "led", "resistor", "arduino-uno-r3"]);
  const { COMPONENTS } = await import("../../src/core/circuit/catalog");
  const { partLayout } = await import("../../src/core/circuit/layout");
  let x = -22, y = 40, rowH = 0;
  for (const def of COMPONENTS.filter((d) => !skip.has(d.id))) {
    const L = partLayout(def.id);
    if (x + L.w > 70) { x = -22; y += rowH + 9; rowH = 0; }
    await add(def.id, x, y + 6);
    x += L.w + 5; rowH = Math.max(rowH, L.h + 6);
  }
  await page.click('[data-testid="proposal-approve"]');
  for (const [from, to] of [[["Uno", "D13"], ["Breadboard", "b10"]], [["Uno", "GND1"], ["Breadboard", "b16"]]] as const) {
    const r = await client.callTool({ name: "circuit_connect", arguments: { from: { part: from[0], pin: from[1] }, to: { part: to[0], pin: to[1] } } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  }
  await page.click('[data-testid="proposal-approve"]');
  await client.close();
  await page.click('[data-testid="ai-mode-assist"]');
  await page.keyboard.press("Control+3");
  await page.click('[data-testid="circuit-fit"]');
  // The plugged LED + resistor + wires make a complete, problem-free circuit.
  await expect(page.locator('[data-testid="circuit-checks"]')).not.toContainText("Danger");
  await expect(page.locator('[data-testid="pin-Breadboard-e12"]')).toHaveAttribute("fill", "#2e9e45");
  if (shots) {
    await page.screenshot({ path: path.join(shots, "circuit-gallery.png") });
    const canvas = page.locator('[data-testid="circuit-canvas"]');
    for (let i = 0; i < 5; i++) await canvas.dispatchEvent("wheel", { deltaY: -100, clientX: 520, clientY: 260 });
    await page.screenshot({ path: path.join(shots, "circuit-breadboard-zoom.png") });
  }
});

test("Simulation: power on, drive a pin, the LED lights by its SPICE current", async () => {
  // Uses the breadboard circuit from the gallery test: Uno D13 -> LED -> 220 Ω -> GND.
  await page.keyboard.press("Control+3");
  await page.click('[data-testid="circuit-fit"]');
  await page.click('[data-testid="sim-power"]');
  await expect(page.locator('[data-testid="sim-badge"]')).toHaveText("Simulated (SPICE · ngspice)", { timeout: 30000 });
  await expect(page.locator('[data-testid="sim-led-LED"]')).toHaveText("0 mA");
  await page.click('[data-testid="gpio-D13-high"]');
  await expect(page.locator('[data-testid="led-glow"]').first()).toBeVisible({ timeout: 15000 });
  // Hand calc: (5 V - ~1.95 V) / (220 Ω + 25 Ω pin) ≈ 12.4 mA.
  const mA = Number((await page.locator('[data-testid="sim-led-LED"]').innerText()).replace(" mA", ""));
  expect(mA).toBeGreaterThan(11.5);
  expect(mA).toBeLessThan(13);
  if (shots) await page.screenshot({ path: path.join(shots, "sim-led-on.png") });
  await page.click('[data-testid="gpio-D13-low"]');
  await expect(page.locator('[data-testid="led-glow"]')).toHaveCount(0, { timeout: 15000 });
  await page.click('[data-testid="sim-power"]');
  await expect(page.locator('[data-testid="sim-badge"]')).toHaveCount(0);
});

test("Display Studio: every display drawn as the real module", async () => {
  await page.keyboard.press("Control+6");
  if ((await page.locator('[data-testid="screen-row"]').count()) === 0) await page.click('[data-testid="new-face"]');
  await page.click('[data-testid="look-real"]');
  const { DISPLAYS } = await import("../../src/core/display/catalog");
  for (const d of DISPLAYS) {
    await page.selectOption('[data-testid="face-display"]', d.id);
    await expect(page.locator('[data-testid="device-frame"]')).toBeVisible();
    // The panel is lit (not blank) in the realistic view.
    const lit = await page.locator('[data-testid="face-canvas"]').evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4 * 3) if (data[i]! + data[i + 1]! + data[i + 2]! > 300) n++;
      return n;
    });
    expect(lit, d.id).toBeGreaterThan(0);
    if (d.color === "mono") await page.selectOption('[data-testid="oled-tint"]', d.id === "ssd1306-128x64" ? "yellow-blue" : "blue");
    if (shots) await page.screenshot({ path: path.join(shots, `display-real-${d.id}.png`) });
  }
  await page.selectOption('[data-testid="face-display"]', "m5stack-cores3");
});

/** Empties the circuit through the app's own delete tool (approved in the AI panel). */
async function clearCircuit(client: { callTool(a: { name: string; arguments: Record<string, unknown> }): Promise<unknown> }) {
  const res = (await client.callTool({ name: "get_project", arguments: {} })) as { content: { text: string }[] };
  const snap = JSON.parse(res.content[0]!.text);
  const parts = (snap.circuit.parts as { id: string }[]).map((p) => p.id);
  for (let i = 0; i < parts.length; i += 100) {
    const r = (await client.callTool({ name: "circuit_delete", arguments: { parts: parts.slice(i, i + 100) } })) as { isError?: boolean; content: unknown };
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  }
  if (parts.length) {
    await page.click('[data-testid="proposal-approve"]');
  }
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(0);
}

test("XIAO ESP32-S3 Sense: drawn as the real board, wired to an OLED with clean checks", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.keyboard.press("Control+0");
  const command = await page.locator('[data-testid="mcp-command"]').innerText();
  const token = command.match(/Bearer ([A-Za-z0-9_-]+)/)![1]!, port = command.match(/127\.0\.0\.1:(\d+)/)![1]!;
  await page.keyboard.press("Control+3");

  const client = new Client({ name: "e2e-xiao", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  await page.click('[data-testid="ai-mode-create"]');
  await clearCircuit(client);
  const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); expect(r.isError, JSON.stringify(r.content)).toBeFalsy(); };
  await call("circuit_add_part", { type: "xiao-esp32s3-sense", x: 0, y: 0, label: "XIAO" });
  await call("circuit_add_part", { type: "oled-i2c", x: 26, y: 2, label: "OLED" });
  for (const [a, b] of [["3V3", "VCC"], ["GND", "GND"], ["D4", "SDA"], ["D5", "SCL"]]) await call("circuit_connect", { from: { part: "XIAO", pin: a }, to: { part: "OLED", pin: b } });
  await page.click('[data-testid="proposal-approve"]');
  await client.close();
  await page.click('[data-testid="ai-mode-assist"]');
  await page.click('[data-testid="circuit-fit"]');
  await expect(page.locator('[data-testid="check-summary"]')).toContainText("No problems detected");
  await expect(page.locator('[data-testid="pin-XIAO-D4"]')).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "xiao-oled.png") });
});

test("Upload page: no board → clear help; tools found", async () => {
  await page.keyboard.press("Control+9");
  await expect(page.locator('[data-testid="device-board"]')).toBeVisible();
  await expect(page.locator('[data-testid="device-none"]')).toContainText("No board found", { timeout: 20000 });
  await expect(page.locator('[data-testid="device-flash"]')).toBeDisabled();
  await expect(page.locator('[data-testid="device-upload"]')).toBeDisabled();
  if (shots) await page.screenshot({ path: path.join(shots, "upload-page.png") });
});

test("Doom handheld project: opens wired like retro-go, clean checks, case in 3D Studio", async () => {
  await page.keyboard.press("Control+8");
  await page.click('[data-testid="practice-start-doom-handheld"]');
  const discard = page.locator(".dialog button", { hasText: "Discard changes" });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await expect(page.getByText(/Started "Doom handheld/)).toBeVisible();
  await expect(page.locator('[data-testid="notes"]')).toHaveValue(/retro-go_1\.46_esp32-s3-devkit\.img/);
  await page.keyboard.press("Control+3");
  await page.click('[data-testid="circuit-fit"]');
  await expect(page.locator('[data-testid="circuit-part"]')).toHaveCount(19);
  await expect(page.locator('[data-testid="check-summary"]')).not.toHaveClass(/danger|warning/);
  if (shots) await page.screenshot({ path: path.join(shots, "doom-circuit.png") });
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="tree-row"]', { hasText: "Front shell (practice)" })).toHaveCount(1);
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  await page.locator('[data-testid="tree-row"]', { hasText: "Front shell (practice)" }).click();
  await page.keyboard.press("f");
  await page.waitForTimeout(4000);
  if (shots) await page.screenshot({ path: path.join(shots, "doom-case.png") });
});

test("Code on the Uno: compiled, emulated, drives the circuit and reads a button", async () => {
  test.setTimeout(240000);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.keyboard.press("Control+0");
  const command = await page.locator('[data-testid="mcp-command"]').innerText();
  const token = command.match(/Bearer ([A-Za-z0-9_-]+)/)![1]!, port = command.match(/127\.0\.0\.1:(\d+)/)![1]!;
  await page.keyboard.press("Control+3");
  const client = new Client({ name: "e2e-uno", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  await page.click('[data-testid="ai-mode-create"]');
  await clearCircuit(client);
  const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); expect(r.isError, JSON.stringify(r.content)).toBeFalsy(); };
  await call("circuit_add_part", { type: "arduino-uno-r3", x: 0, y: 0, label: "Uno" });
  await call("circuit_add_part", { type: "resistor", x: 24, y: 26, label: "R1", props: { ohms: 220 } });
  await call("circuit_add_part", { type: "led", x: 34, y: 26, label: "LED" });
  await call("circuit_add_part", { type: "button", x: 24, y: 6, label: "Button" });
  for (const [a, ap, b, bp] of [["Uno", "D13", "R1", "1"], ["R1", "2", "LED", "A"], ["LED", "K", "Uno", "GND1"], ["Button", "1", "Uno", "D2"], ["Button", "2", "Uno", "GND2"]]) await call("circuit_connect", { from: { part: a, pin: ap }, to: { part: b, pin: bp } });
  await page.click('[data-testid="proposal-approve"]');
  await client.close();
  await page.click('[data-testid="ai-mode-assist"]');
  await page.click('[data-testid="circuit-fit"]');

  await page.fill('[data-testid="code-editor"]', [
    "void setup() { pinMode(13, OUTPUT); pinMode(2, INPUT_PULLUP); Serial.begin(9600); Serial.println(\"ready\"); }",
    "bool was = false;",
    "void loop() { bool on = digitalRead(2) == LOW; digitalWrite(13, on); if (on != was) { Serial.println(on ? \"pressed\" : \"released\"); was = on; } }",
  ].join("\n"));
  await page.click('[data-testid="code-run"]');
  await expect(page.locator('[data-testid="code-status"]')).toContainText("Running", { timeout: 180000 });
  await expect(page.locator('[data-testid="code-serial"]')).toContainText("ready", { timeout: 15000 });
  await expect(page.locator('[data-testid="code-pin-D13"]')).toHaveText("LOW", { timeout: 15000 });
  await expect(page.locator('[data-testid="code-pin-D2"]')).toHaveText("input (pull-up)");
  await expect(page.locator('[data-testid="sim-led-LED"]')).toHaveText("0 mA");
  // Press the button in the circuit: the emulated chip reads LOW on D2 and turns the LED on.
  await page.locator('[data-part="Button"] > g').first().click({ force: true });
  await page.click('[data-testid="prop-closed"]');
  await expect(page.locator('[data-testid="code-pin-D13"]')).toHaveText("HIGH", { timeout: 15000 });
  await expect(page.locator('[data-testid="code-serial"]')).toContainText("pressed", { timeout: 15000 });
  // The circuit re-solves with D13 HIGH: about (5 - 1.95) / (220 + 25) ≈ 12.4 mA.
  await expect.poll(async () => Number((await page.locator('[data-testid="sim-led-LED"]').innerText()).replace(" mA", "")), { timeout: 10000 }).toBeGreaterThan(11.5);
  expect(Number((await page.locator('[data-testid="sim-led-LED"]').innerText()).replace(" mA", ""))).toBeLessThan(13);
  // The code reads D2 as an input, so the pressed button is not a "pin to GND" warning.
  await expect(page.locator('[data-testid="check-summary"]')).not.toHaveClass(/warning|danger/);
  if (shots) await page.screenshot({ path: path.join(shots, "uno-code.png") });
  await page.click('[data-testid="prop-closed"]');
  await expect(page.locator('[data-testid="code-serial"]')).toContainText("released", { timeout: 15000 });
  await page.click('[data-testid="code-stop"]');
  await page.click('[data-testid="sim-power"]');
});

test("Code on the Pico: compiled, emulated (rp2040js), USB serial, blinks an LED in the circuit", async () => {
  test.setTimeout(240000);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  await page.keyboard.press("Control+0");
  const command = await page.locator('[data-testid="mcp-command"]').innerText();
  const token = command.match(/Bearer ([A-Za-z0-9_-]+)/)![1]!, port = command.match(/127\.0\.0\.1:(\d+)/)![1]!;
  await page.keyboard.press("Control+3");
  const client = new Client({ name: "e2e-pico", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  await page.click('[data-testid="ai-mode-create"]');
  await clearCircuit(client);
  const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); expect(r.isError, JSON.stringify(r.content)).toBeFalsy(); };
  await call("circuit_add_part", { type: "raspberry-pi-pico", x: 0, y: 0, label: "Pico" });
  await call("circuit_add_part", { type: "resistor", x: 24, y: 30, label: "R1", props: { ohms: 220 } });
  await call("circuit_add_part", { type: "led", x: 34, y: 30, label: "LED" });
  for (const [a, ap, b, bp] of [["Pico", "GP15", "R1", "1"], ["R1", "2", "LED", "A"], ["LED", "K", "Pico", "GND1"]]) await call("circuit_connect", { from: { part: a, pin: ap }, to: { part: b, pin: bp } });
  await page.click('[data-testid="proposal-approve"]');
  await client.close();
  await page.click('[data-testid="ai-mode-assist"]');
  await page.click('[data-testid="circuit-fit"]');
  await expect(page.locator('[data-testid="code-editor"]')).toHaveValue(/GP15/);
  await page.click('[data-testid="code-run"]');
  await expect(page.locator('[data-testid="code-status"]')).toContainText("Running", { timeout: 180000 });
  await expect(page.locator('[data-testid="sim-badge"]')).toHaveText("Emulated Pico (rp2040js) + SPICE", { timeout: 15000 });
  await expect(page.locator('[data-testid="code-serial"]')).toContainText("on", { timeout: 30000 });
  // The LED blinks: it is seen lit (3.3 V - ~1.95 V over 245 Ω ≈ 5.5 mA) and later off.
  await expect.poll(async () => Number((await page.locator('[data-testid="sim-led-LED"]').innerText()).replace(" mA", "")), { timeout: 20000 }).toBeGreaterThan(4);
  if (shots) await page.screenshot({ path: path.join(shots, "pico-code.png") });
  await expect(page.locator('[data-testid="sim-led-LED"]')).toHaveText("0 mA", { timeout: 20000 });
  await page.click('[data-testid="code-stop"]');
  await page.click('[data-testid="sim-power"]');
});

test("Parts Library: search, sourced specs with status, add to the studios", async () => {
  await page.keyboard.press("Control+5");
  await page.fill('[data-testid="parts-search"]', "xiao camera");
  await page.click('[data-testid="part-row-xiao-esp32s3-sense"]');
  const table = page.locator('[data-testid="spec-table"]');
  await expect(table).toContainText("Seeed wiki");
  await expect(table).toContainText("700 mA");
  await expect(page.locator('[data-testid="part-detail"] .spec-badge.manufacturer').first()).toBeVisible();
  await page.fill('[data-testid="parts-search"]', "608");
  await page.click('[data-testid="part-row-bearing-608"]');
  await expect(table).toContainText("ISO 15");
  await page.click('[data-testid="part-add-block"]');
  await expect(page.getByText(/Added a 22 × 22 × 7 mm block/)).toBeVisible();
  await page.fill('[data-testid="parts-search"]', "uno");
  await page.click('[data-testid="part-row-arduino-uno-r3"]');
  await expect(page.locator('[data-testid="part-detail"] .spec-badge.unknown').first()).toBeVisible(); // board size not recorded rather than guessed
  if (shots) await page.screenshot({ path: path.join(shots, "parts.png") });
});

test("Advanced AI: design check across studios; a picture attached to the chat", async () => {
  await page.keyboard.press("Control+8");
  await expect(page.locator('[data-testid="design-check"]')).toBeVisible();
  await expect(page.locator('[data-testid="design-check"]')).toContainText(/Wiring|Robot|Printing/);
  // Attach a sketch to the chat (scripted provider in tests).
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
  }, path.resolve("tests/fixtures/mug-sketch.png"));
  if (!(await page.locator('[data-testid="ai-panel"]').isVisible())) await page.keyboard.press("Control+j");
  await page.click('[data-testid="chat-image"]');
  await expect(page.locator('[data-testid="chat-attached"]')).toContainText("mug-sketch.png");
  await page.fill('[data-testid="chat-input"]', "make this mug");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="chat-assistant"]').last()).toContainText("I can see the picture");
  await expect(page.locator(".chat-msg.user img.chat-image").last()).toBeVisible();
  if (shots) await page.screenshot({ path: path.join(shots, "advanced-ai.png") });
});

test("Doom handheld: play the preview in MakerStudio (wired buttons work, the game runs)", async () => {
  test.setTimeout(240000);
  await page.keyboard.press("Control+8");
  await page.click('[data-testid="practice-start-doom-handheld"]');
  const discard = page.locator(".dialog button", { hasText: "Discard changes" });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.keyboard.press("Control+3");
  await page.click('[data-testid="hh-play"]');
  await expect(page.locator('[data-testid="handheld-player"]')).toBeVisible();
  // The project's circuit is wired like retro-go: every button is live.
  for (const b of ["up", "down", "left", "right", "A", "B", "START", "SELECT", "MENU", "OPTION"]) await expect(page.locator(`[data-testid="hh-${b}"]`)).not.toHaveClass(/dead/);
  await page.click('[data-testid="hh-shareware"]');
  await expect(page.locator('[data-testid="hh-msg"]')).toHaveCount(0, { timeout: 120000 });
  const sample = () => page.locator('[data-testid="hh-screen"]').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4 * 61) sum += d[i]! + d[i + 1]! + d[i + 2]!;
    return sum;
  });
  await page.waitForTimeout(1500);
  const a = await sample();
  expect(a).toBeGreaterThan(0);
  // Start a game with the handheld's buttons (Enter = Start), then move: the picture keeps changing.
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
  await page.keyboard.down("ArrowUp"); await page.waitForTimeout(800); await page.keyboard.up("ArrowUp");
  const b = await sample();
  expect(b).not.toBe(a);
  if (shots) await page.screenshot({ path: path.join(shots, "doom-play.png") });
  await page.click('[data-testid="hh-close"]');
  await expect(page.locator('[data-testid="handheld-player"]')).toHaveCount(0);
});
