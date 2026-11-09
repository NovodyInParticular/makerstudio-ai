// Builds the user interface (Vite) and the desktop process (esbuild) into dist/.
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

await viteBuild({ configFile: "vite.config.mts", logLevel: "warn" });
await esbuild({
  entryPoints: { main: "src/main/main.ts", preload: "src/main/preload.ts" },
  outdir: "dist/main",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  // The part-script helper (Python) ships inside the bundle as text.
  loader: { ".py": "text" },
  sourcemap: true,
  logLevel: "warning",
});
console.log("Build complete: dist/renderer and dist/main");
