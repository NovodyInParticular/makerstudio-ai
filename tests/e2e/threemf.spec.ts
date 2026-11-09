// 3MF import from the 3D Studio (Bambu Studio / MakerWorld files): every object, kept in place.
import { _electron as electron, expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tet = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>`;

test("3D Studio: import a 3MF with two objects, side by side as in the file", async () => {
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-3mf-"));
  const xml = `<model unit="millimeter"><resources><object id="1" name="Left" type="model">${tet}</object><object id="2" name="Right" type="model">${tet}</object></resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 0 0"/></build></model>`;
  const file = path.join(w, "plate.3mf");
  await writeFile(file, zipSync({ "3D/3dmodel.model": strToU8(xml) }));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;
  const app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }), env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1" } });
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="workspace-home"]');
  await page.keyboard.press("Control+2");
  await expect(page.getByText("Loading the solid geometry engine…")).toHaveCount(0, { timeout: 15000 });
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog; }, file);
  await page.click('[data-testid="import-model"]');
  await expect(page.getByText(/Imported "plate" from 3MF: 2 objects, 40 × 10 × 10 mm/)).toBeVisible();
  const rows = page.locator('[data-testid="tree-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("plate · Left");
  await page.keyboard.press("Control+a");
  await expect(page.locator('[data-testid="size-readout"]')).toContainText("40 × 10 × 10 mm");
  await expect(page.locator('[data-testid="size-readout"]')).toContainText("bottom at Z 0 mm");
  await app.close();
});
