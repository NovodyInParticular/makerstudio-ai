import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5199, strictPort: true },
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "chrome150" },
});
