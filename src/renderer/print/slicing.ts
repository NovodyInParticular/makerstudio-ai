// The Print panel's state and actions: choose settings, slice with Bambu Studio, preview the
// layers, and put the file on the printer's SD card.

import { create } from "zustand";
import type { CadObject } from "../../core/cad/model";
import { partFileNames, writeStl } from "../../core/cad/exporting";
import type { ToolpathPreview } from "../../core/print/gcode";
import type { RemovableDrive, SliceOptions, SliceOutcome, SlicingCatalog } from "../../shared/ipc";
import { collectForSlicing } from "../cad/printActions";
import { projectStore, useUi } from "../state";
import { confetti } from "../components/confetti";
import { parseGcodeInWorker } from "./gcodeClient";
import { renderThumbnails } from "./thumbnail";

export type SlicePhase = "idle" | "slicing" | "done" | "error";

interface SliceState {
  open: boolean;
  catalog: SlicingCatalog | null;
  catalogError: string | null;
  options: SliceOptions | null;
  phase: SlicePhase;
  /** What is happening right now, in a few words. */
  step: string;
  startedAt: number;
  error: string | null;
  outcome: SliceOutcome | null;
  /** The object list the result was made from (it is out of date once that changes). */
  slicedObjects: CadObject[] | null;
  plate: number;
  preview: ToolpathPreview | null;
  previewError: string | null;
  previewLoading: boolean;
  /** Show the layers instead of the model in the 3D view. */
  previewOn: boolean;
  /** Top layer shown (0-based). */
  layer: number;
  hidden: string[];
  drives: RemovableDrive[] | null;
  drivesError: string | null;
  drivesBusy: boolean;
  /** The last file put on a card. */
  copied: { plate: number; mount: string; path: string } | null;
  ejected: string | null;
  set(patch: Partial<SliceState>): void;
}

export const useSlice = create<SliceState>()((set) => ({
  open: false,
  catalog: null,
  catalogError: null,
  options: null,
  phase: "idle",
  step: "",
  startedAt: 0,
  error: null,
  outcome: null,
  slicedObjects: null,
  plate: 0,
  preview: null,
  previewError: null,
  previewLoading: false,
  previewOn: false,
  layer: 0,
  hidden: [],
  drives: null,
  drivesError: null,
  drivesBusy: false,
  copied: null,
  ejected: null,
  set: (patch) => set(patch),
}));

const notify = (kind: "success" | "error" | "info", message: string) => useUi.getState().notify(kind, message);
const patch = (p: Partial<SliceState>) => useSlice.getState().set(p);

/** Nothing sliced yet (also what is left after another project is opened). */
const NO_RESULT: Partial<SliceState> = {
  phase: "idle", step: "", error: null, outcome: null, slicedObjects: null, plate: 0,
  preview: null, previewError: null, previewLoading: false, previewOn: false, layer: 0, hidden: [], copied: null, ejected: null,
};

// Another project was opened: the sliced print and its layers belonged to the old one. A slice
// still running for it is stopped, and its result is dropped when it comes back.
projectStore.subscribe((state, previous) => {
  if (state.loads === previous.loads) return;
  if (useSlice.getState().phase === "slicing") void window.makerstudio.cancelSlice();
  patch(NO_RESULT);
});

/** True while the project that was open at `loads` is still the open one. */
const sameProject = (loads: number) => projectStore.getState().loads === loads;

export async function loadCatalog() {
  patch({ catalogError: null });
  const result = await window.makerstudio.sliceCatalog();
  if (!result.ok) return patch({ catalog: null, catalogError: result.error });
  const saved = useUi.getState().settings?.slicing;
  const catalog = result.value;
  const pick = (list: { name: string }[], name: string | undefined, fallback: string) => (name && list.some((p) => p.name === name) ? name : fallback);
  patch({
    catalog,
    options: {
      process: pick(catalog.processes, saved?.process, catalog.defaults.process),
      filament: pick(catalog.filaments, saved?.filament, catalog.defaults.filament),
      plate: pick(catalog.plates, saved?.plate, catalog.defaults.plate),
      supports: saved?.supports ?? "off",
      infill: saved?.infill ?? null,
    },
  });
}

export function openPrintPanel() {
  patch({ open: true });
  const s = useSlice.getState();
  if (!s.catalog) void loadCatalog();
  if (s.drives === null) void refreshDrives();
}

export function closePrintPanel() {
  patch({ open: false, previewOn: false });
}

export function setOption<K extends keyof SliceOptions>(key: K, value: SliceOptions[K]) {
  const options = useSlice.getState().options;
  if (!options) return;
  const next = { ...options, [key]: value };
  patch({ options: next });
  void window.makerstudio.setSettings({ slicing: next }).then((s) => useUi.getState().setSettings?.(s));
}

export function setPreviewOn(on: boolean) {
  patch({ previewOn: on && useSlice.getState().preview !== null });
}

export function setLayer(layer: number) {
  const preview = useSlice.getState().preview;
  if (!preview) return;
  patch({ layer: Math.max(0, Math.min(preview.layerCount - 1, Math.round(layer))) });
}

export function toggleFeature(name: string) {
  const hidden = useSlice.getState().hidden;
  patch({ hidden: hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name] });
}

async function loadPreview(id: string, plate: number) {
  patch({ previewLoading: true, previewError: null, preview: null });
  const bytes = await window.makerstudio.slicedGcode(id, plate);
  if (useSlice.getState().outcome?.id !== id || useSlice.getState().plate !== plate) return;
  if (!bytes.ok) return patch({ previewLoading: false, previewError: bytes.error });
  try {
    const preview = await parseGcodeInWorker(bytes.value);
    if (useSlice.getState().outcome?.id !== id || useSlice.getState().plate !== plate) return;
    patch({ preview, previewLoading: false, previewOn: true, layer: Math.max(0, preview.layerCount - 1) });
  } catch (error) {
    patch({ previewLoading: false, previewError: error instanceof Error ? error.message : String(error) });
  }
}

export function choosePlate(plate: number) {
  const outcome = useSlice.getState().outcome;
  if (!outcome || plate < 0 || plate >= outcome.plates.length) return;
  patch({ plate, copied: null });
  void loadPreview(outcome.id, plate);
}

export async function sliceNow() {
  const s = useSlice.getState();
  if (s.phase === "slicing" || !s.options) return;
  const loads = projectStore.getState().loads;
  patch({ phase: "slicing", step: "Getting the parts ready…", startedAt: Date.now(), error: null, copied: null, ejected: null });
  const collected = await collectForSlicing();
  if (!sameProject(loads)) return;
  if (!collected) return patch({ phase: "idle", step: "" });
  const names = partFileNames(collected.parts, "stl");
  const files = collected.parts.map((part, i) => ({ name: names[i]!, bytes: writeStl([part], `${part.name} (mm)`) }));
  patch({ step: "Taking a picture for the printer's screen…" });
  const colors = new Map(collected.objects.map((o) => [o.id, o.color]));
  const thumbnails = (await renderThumbnails(collected.parts, (p) => colors.get(p.id) ?? "#ff8a3d")) ?? undefined;
  if (!sameProject(loads)) return;
  patch({ step: "Bambu Studio is slicing your model…" });
  const project = projectStore.getState().project.document.name;
  const result = await window.makerstudio.slice({ name: project, files, options: s.options, thumbnails });
  // Another project was opened while slicing: this print is not for it.
  if (!sameProject(loads)) return;
  if (!result.ok) {
    const stopped = /stopped/i.test(result.error);
    patch({ phase: stopped ? "idle" : "error", step: "", error: stopped ? null : result.error });
    if (stopped) notify("info", "Slicing stopped.");
    return;
  }
  const outcome = result.value;
  patch({ phase: "done", step: "", outcome, slicedObjects: collected.objects, plate: 0, hidden: [] });
  confetti();
  for (const w of [...collected.warnings, ...outcome.warnings]) notify("info", w);
  void loadPreview(outcome.id, 0);
  void refreshDrives();
}

export function cancelSlicing() {
  void window.makerstudio.cancelSlice();
}

export async function refreshDrives() {
  patch({ drivesBusy: true, drivesError: null });
  const result = await window.makerstudio.removableDrives();
  patch(result.ok ? { drives: result.value, drivesBusy: false } : { drives: [], drivesBusy: false, drivesError: result.error });
}

let watching = false;

/**
 * Looks for cards again without showing "Looking for SD cards…" (the panel does this every few
 * seconds while it is open, so a card reader plugged in later shows up by itself). Leaves the
 * list alone while a copy or eject is running, and when nothing changed.
 */
export async function watchDrives() {
  if (watching || useSlice.getState().drivesBusy) return;
  watching = true;
  try {
    const result = await window.makerstudio.removableDrives();
    const s = useSlice.getState();
    if (!result.ok || s.drivesBusy || !s.open) return;
    if (JSON.stringify(result.value) === JSON.stringify(s.drives)) return;
    // A card plugged in after one was ejected: step 3 starts again for it.
    const known = new Set((s.drives ?? []).map((d) => d.mount));
    const newCard = result.value.some((d) => !known.has(d.mount));
    patch({ drives: result.value, drivesError: null, ...(s.ejected && newCard ? { ejected: null, copied: null } : {}) });
  } finally {
    watching = false;
  }
}

export async function copyToCard(mount: string) {
  const { outcome, plate } = useSlice.getState();
  if (!outcome) return;
  patch({ drivesBusy: true, ejected: null });
  const result = await window.makerstudio.copyToDrive(outcome.id, plate, mount);
  patch({ drivesBusy: false });
  if (!result.ok) return notify("error", result.error);
  patch({ copied: { plate, mount, path: result.value } });
  confetti();
  void refreshDrives();
}

export async function ejectCard(mount: string) {
  patch({ drivesBusy: true });
  const result = await window.makerstudio.ejectDrive(mount);
  patch({ drivesBusy: false });
  if (!result.ok) return notify("error", result.error);
  patch({ ejected: mount });
  await refreshDrives();
}

export async function saveSlicedAs() {
  const { outcome, plate } = useSlice.getState();
  if (!outcome) return;
  const result = await window.makerstudio.saveSliced(outcome.id, plate);
  if (!result.ok) notify("error", result.error);
  else if (result.value) notify("success", `Saved ${result.value}`);
}

/** Opens the sliced file in Bambu Studio, which can send it to the printer over the internet. */
export async function openSlicedInBambu() {
  const { outcome, plate } = useSlice.getState();
  if (!outcome) return;
  const result = await window.makerstudio.openSlicedInBambu(outcome.id, plate);
  if (!result.ok) notify("error", result.error);
  else notify("info", "Bambu Studio is opening your print. Press Slice plate, then Print plate.");
}

export function showSlicedFolder() {
  const outcome = useSlice.getState().outcome;
  if (outcome) void window.makerstudio.revealInFolder(outcome.folder);
}

/** True when the model was changed after slicing. */
export function sliceIsStale(objects: CadObject[]): boolean {
  const sliced = useSlice.getState().slicedObjects;
  return sliced !== null && sliced !== objects;
}

