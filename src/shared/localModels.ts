// Model files on this computer that practice projects may load. The main process reads only
// these exact files or folders (relative to the home folder); the interface asks for them by key.
// A folder entry loads every .stl directly inside it (not subfolders), except the file names
// (without ".stl") listed in `skip`.

export type LocalModel =
  | { name: string; file: string }
  | { name: string; folder: string; skip?: string[] };

export const LOCAL_MODELS: Record<string, LocalModel> = {
};

/** Most files one folder entry may load. */
export const MAX_LOCAL_FOLDER_FILES = 200;

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

/**
 * Drops parts that a later variant replaces: a file named "<part> (<variant>).stl" (for example
 * "armor, shin, 2x (plated).stl" from a kit) replaces "<part>.stl" (the stock "armor, shin, 2x.stl").
 * Everything else keeps its order.
 */
export function replaceVariants<T extends { name: string }>(files: T[]): T[] {
  const replaced = new Set<string>();
  for (const f of files) {
    const m = /^(.*\S) \([^()]+\)$/.exec(stem(f.name));
    if (m) replaced.add(m[1]!.toLowerCase());
  }
  return files.filter((f) => !replaced.has(stem(f.name).toLowerCase()));
}
