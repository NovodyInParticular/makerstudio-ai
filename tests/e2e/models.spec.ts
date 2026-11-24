// Practice projects download the project's own print files from GitHub into 3D Studio, and the
// next start works offline from the app's cache. Needs the internet; skipped without it.
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Practice: the JPL rover's mast parts come from GitHub, then load offline from the cache", async () => {
  test.setTimeout(120000);
  const online = await fetch("https://raw.githubusercontent.com/", { method: "HEAD", signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
  test.skip(!online, "GitHub is not reachable from this computer");
  const w = await mkdtemp(path.join(tmpdir(), "makerstudio-models-"));
  const packaged = process.env.MAKERSTUDIO_EXECUTABLE;

  const startRover = async (extraEnv: Record<string, string>) => {
    const app = await electron.launch({
      ...(packaged ? { executablePath: packaged, args: [] } : { args: ["."] }),
      env: { ...process.env, MAKERSTUDIO_USER_DATA: path.join(w, "ud"), MAKERSTUDIO_DOCUMENTS: path.join(w, "docs"), MAKERSTUDIO_SKIP_CLOSE_PROMPT: "1", ...extraEnv },
    });
    const page = await app.firstWindow();
    await page.waitForSelector('[data-testid="workspace-home"]');
    await page.keyboard.press("Control+8");
    await page.click('[data-testid="practice-start-jpl-rover"]');
    await expect(page.getByText(/Started "NASA JPL Open Source Rover".*2 parts are laid out in 3D Studio/)).toBeVisible({ timeout: 60000 });
    await page.keyboard.press("Control+2");
    const rows = page.locator('[data-testid="tree-row"]');
    await expect(rows.filter({ hasText: "mast_backplate" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "mast_head-2" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Nameplate (practice)" })).toHaveCount(1); // the starter shapes stay
    await app.close();
  };

  await startRover({});
  // Second start with no way to reach GitHub: the parts come from the cache.
  await startRover({ MAKERSTUDIO_MODEL_SOURCE: "http://127.0.0.1:9" });
});
