import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { blobSha, fetchRemoteModel, safeRepoPath } from "../../src/main/modelDownload";
import { REMOTE_MODELS, type RemoteModel } from "../../src/shared/remoteModels";

const tempDir = () => mkdtemp(path.join(tmpdir(), "makerstudio-models-"));
const bytes = (text: string) => new TextEncoder().encode(text);

/** A fake web server: path → bytes; records the URLs asked for. */
function server(files: Record<string, Uint8Array>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const body = files[url];
    return { ok: !!body, status: body ? 200 : 404, arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer };
  };
  return { asked, fetch };
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const BASE = "http://models.test";

describe("practice project downloads", () => {
  it("git blob ids match git's own (git hash-object)", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobSha(bytes("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("downloads the listed files once, checks them, and uses the cache the next time", async () => {
    const a = bytes("solid a\nendsolid a\n"), b = bytes("solid b\nendsolid b\n");
    const set: RemoteModel = {
      name: "test parts", repo: "maker/robot", commit: COMMIT,
      files: [
        { path: "stl/Leg A.stl", size: a.length, sha: blobSha(a) },
        { path: "stl/body.stl", size: b.length, sha: blobSha(b) },
      ],
    };
    const web = server({ [`${BASE}/maker/robot/${COMMIT}/stl/Leg%20A.stl`]: a, [`${BASE}/maker/robot/${COMMIT}/stl/body.stl`]: b });
    const cacheDir = await tempDir();
    const first = await fetchRemoteModel(set, { cacheDir, base: BASE, fetch: web.fetch });
    expect(first.map((f) => f.name)).toEqual(["Leg A.stl", "body.stl"]);
    expect(first[1]!.bytes).toEqual(b);
    expect(web.asked).toHaveLength(2);
    const again = await fetchRemoteModel(set, { cacheDir, base: BASE, fetch: web.fetch });
    expect(again.map((f) => f.name)).toEqual(["Leg A.stl", "body.stl"]);
    expect(web.asked).toHaveLength(2); // nothing downloaded the second time
  });

  it("refuses a file that is not the expected one, and reports a missing file by name", async () => {
    const good = bytes("solid good\n"), bad = bytes("solid changed\n");
    const set: RemoteModel = { name: "test parts", repo: "maker/robot", commit: COMMIT, files: [{ path: "a.stl", size: good.length, sha: blobSha(good) }] };
    await expect(fetchRemoteModel(set, { cacheDir: await tempDir(), base: BASE, fetch: server({ [`${BASE}/maker/robot/${COMMIT}/a.stl`]: bad }).fetch }))
      .rejects.toThrow(/a\.stl: the downloaded file is not the expected one/);
    await expect(fetchRemoteModel(set, { cacheDir: await tempDir(), base: BASE, fetch: server({}).fetch }))
      .rejects.toThrow(/a\.stl: download failed \(HTTP 404\)/);
  });

  it("unpacks only the .stl files directly inside the listed ZIP folders", async () => {
    const stl = bytes("solid x\n");
    const zip = zipSync({
      "Kit/Frame/frame chest.stl": stl,
      "Kit/Frame/notes.pdf": bytes("pdf"),
      "Kit/Frame/old/frame chest v1.stl": stl,
      "Kit/Armor/2x armor shin.STL": stl,
      "Kit/gcode/part.gcode": bytes("G1"),
      "__MACOSX/Kit/Frame/._frame chest.stl": bytes("junk"),
    });
    const set: RemoteModel = { name: "kit", repo: "maker/kit", commit: COMMIT, files: [{ path: "Kit.zip", size: zip.length, sha: blobSha(zip), unzip: ["Kit/Frame/", "Kit/Armor/"] }] };
    const files = await fetchRemoteModel(set, { cacheDir: await tempDir(), base: BASE, fetch: server({ [`${BASE}/maker/kit/${COMMIT}/Kit.zip`]: zip }).fetch });
    expect(files.map((f) => f.name)).toEqual(["2x armor shin.STL", "frame chest.stl"]);
  });

  it("never asks for a path outside the repository", async () => {
    for (const p of ["../x.stl", "a/../../x.stl", "/etc/x.stl", "a//b.stl", "a\\b.stl", ""]) expect(safeRepoPath(p), p).toBe(false);
    expect(safeRepoPath("STL files/Articulation 1/1M1.STL")).toBe(true);
    const set: RemoteModel = { name: "bad", repo: "maker/robot", commit: COMMIT, files: [{ path: "../secret.stl", size: 1, sha: "0".repeat(40) }] };
    const web = server({});
    await expect(fetchRemoteModel(set, { cacheDir: await tempDir(), base: BASE, fetch: web.fetch })).rejects.toThrow(/Invalid model file/);
    expect(web.asked).toHaveLength(0);
  });

  it("every listed set is pinned to a commit, with safe paths and model or ZIP files", () => {
    for (const [key, m] of Object.entries(REMOTE_MODELS)) {
      expect(m.repo, key).toMatch(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
      expect(m.commit, key).toMatch(/^[0-9a-f]{40}$/);
      expect(m.files.length, key).toBeGreaterThan(0);
      for (const f of m.files) {
        expect(safeRepoPath(f.path), f.path).toBe(true);
        expect(f.sha, f.path).toMatch(/^[0-9a-f]{40}$/);
        if (f.unzip) expect(f.path, key).toMatch(/\.zip$/i);
        else expect(f.path, key).toMatch(/\.(stl|obj|3mf)$/i);
      }
    }
  });
});
