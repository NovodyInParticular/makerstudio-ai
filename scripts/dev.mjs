// Development mode: live-reloading interface + automatic rebuild of the desktop process.
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.config.mts" });
await server.listen();
const url = server.resolvedUrls.local[0];

let electron = null;
const startElectron = () => {
  if (electron) electron.kill();
  electron = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["electron", "."], {
    stdio: "inherit",
    env: { ...process.env, MAKERSTUDIO_DEV_URL: url },
  });
};

const ctx = await context({
  entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts" },
  outdir: "dist/main",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  plugins: [{ name: "restart", setup(b) { b.onEnd((r) => { if (r.errors.length === 0) startElectron(); }); } }],
});
await ctx.watch();
console.log(`Dev server at ${url}. Electron restarts when main/preload change.`);
