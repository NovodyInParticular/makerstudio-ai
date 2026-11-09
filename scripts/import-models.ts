// Turns folders of downloaded model files (STL / OBJ / 3MF) into MakerStudio projects, one per
// model, with every part laid out on a grid. Very large models are split into several projects.
//   node import-models.cjs <out-dir> <name>=<folder>[:stl-only] ...

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { centreOnOrigin, encodeMesh, meshBounds, newMeshKey, parseMeshFile, type MeshData } from "../src/core/cad/meshes";
import { read3mf } from "../src/core/cad/threemf";
import { createEmptyProject, newId, packProject } from "../src/shared/format";
import { IDENTITY, PALETTE, type CadObject } from "../src/core/cad/model";

const BUDGET = 4_500_000; // triangles per project, so the 3D view stays responsive
const ROW = 250, GAP = 8;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; })
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function partsOf(path: string): { name: string; mesh: MeshData }[] {
  const ext = extname(path).toLowerCase();
  const bytes = new Uint8Array(readFileSync(path));
  const stem = basename(path, extname(path)).replace(/^obj_\d+_/, "");
  if (ext === ".3mf") return read3mf(bytes).map((o, i, all) => ({ name: all.length > 1 ? `${stem} · ${o.name}` : stem, mesh: o.mesh }));
  return [{ name: stem, mesh: parseMeshFile(path, bytes) }];
}

const [outDir, ...specs] = process.argv.slice(2);
for (const spec of specs) {
  const eq = spec.indexOf("=");
  const name = spec.slice(0, eq), rest = spec.slice(eq + 1);
  const [folder, ...opts] = rest.split(":") as [string, ...string[]];
  const stlOnly = opts.includes("stl-only");
  const skip = opts.find((o) => o.startsWith("skip="))?.slice(5).split(",") ?? [];
  const inputs = files(folder).filter((f) => /\.(stl|obj|3mf)$/i.test(f) && !(stlOnly && /\.3mf$/i.test(f)) && !skip.some((x) => basename(f).startsWith(x)));
  const parts: { name: string; mesh: MeshData; file: string; tris: number }[] = [];
  const problems: string[] = [];
  for (const f of inputs) {
    try {
      for (const p of partsOf(f)) parts.push({ ...p, mesh: centreOnOrigin(p.mesh).mesh, file: f.slice(folder.length + 1), tris: p.mesh.indices.length / 3 });
    } catch (e) { problems.push(`${f.slice(folder.length + 1)}: ${e instanceof Error ? e.message : e}`); }
  }
  // Number parts that share a name ("Assembly 1", "Assembly 2" ...).
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const p of parts) if (count.get(p.name)! > 1) { const n = (seen.get(p.name) ?? 0) + 1; seen.set(p.name, n); p.name = `${p.name} ${n}`; }
  // Split into as few projects as possible under the triangle budget (first fit, biggest first),
  // then keep file order inside each project.
  const batches: typeof parts[] = [];
  const load: number[] = [];
  for (const p of [...parts].sort((a, b) => b.tris - a.tris)) {
    const i = load.findIndex((t) => t + p.tris <= BUDGET);
    if (i >= 0) { batches[i]!.push(p); load[i]! += p.tris; } else { batches.push([p]); load.push(p.tris); }
  }
  for (const b of batches) b.sort((a, c) => parts.indexOf(a) - parts.indexOf(c));
  if (!batches.length) batches.push([]);
  batches.forEach((batch, bi) => {
    const title = batches.length > 1 ? `${name} (${bi + 1} of ${batches.length})` : name;
    const project = createEmptyProject(title, "import-script");
    let x = 0, y = 0, rowDepth = 0;
    batch.forEach((p, i) => {
      const { min, max } = meshBounds(p.mesh);
      const w = max[0] - min[0], d = max[1] - min[1];
      if (x > 0 && x + w > ROW) { x = 0; y -= rowDepth + GAP; rowDepth = 0; }
      const key = newMeshKey();
      project.assets[key] = encodeMesh(p.mesh);
      const object: CadObject = {
        id: newId(), name: p.name.slice(0, 120), kind: "mesh", mesh: key, params: {},
        transform: { ...IDENTITY, position: [Math.round((x + w / 2 - ROW / 2) * 10) / 10, Math.round((y - d / 2) * 10) / 10, 0] },
        hole: false, color: PALETTE[i % PALETTE.length]!, parentId: null, visible: true, locked: false,
      };
      (project.document.workspaces.cad.objects as CadObject[]).push(object);
      x += w + GAP; rowDepth = Math.max(rowDepth, d);
    });
    project.notes = [
      `# ${title}`, "",
      `Imported from \`${folder}\` (downloaded model files; check the creator's license, usually personal use only).`,
      `${batch.length} parts, ${batch.reduce((n, p) => n + p.tris, 0).toLocaleString("en")} triangles.${batches.length > 1 ? ` Split into ${batches.length} projects to keep the 3D view smooth.` : ""}`,
      "", "Parts are laid out side by side for checking, not arranged for printing: use the creator's plates or Check for printing.", "",
      "## Files", ...[...new Set(batch.map((p) => p.file))].map((f) => `- ${f}`),
      ...(problems.length && bi === 0 ? ["", "## Could not import", ...problems.map((p) => `- ${p}`)] : []),
    ].join("\n");
    let out = join(outDir!, `${title.replace(/[\/\\:*?"<>|]/g, "-")}.msproj`);
    if (existsSync(out)) out = out.replace(/\.msproj$/, ` (import ${Date.now()}).msproj`);
    writeFileSync(out, packProject(project));
    console.log(`${basename(out)}: ${batch.length} parts, ${batch.reduce((n, p) => n + p.tris, 0).toLocaleString("en")} triangles, ${(statSync(out).size / 1e6).toFixed(0)} MB`);
  });
  for (const p of problems) console.log(`  ! ${p}`);
}
