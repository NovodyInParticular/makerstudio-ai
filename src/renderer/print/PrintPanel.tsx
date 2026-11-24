// The Print panel: four big steps from model to printer.
//   1 Choose how to print it   2 Slice   3 Put it on the SD card   4 Print it on the printer
// Shown in place of the inspector while it is open.

import { useEffect, useState, type ReactNode } from "react";
import { featureStyle, formatDuration } from "../../core/print/gcode";
import type { CadObject } from "../../core/cad/model";
import type { PresetChoice, RemovableDrive, SupportMode } from "../../shared/ipc";
import { Icon } from "../components/Icon";
import { useCad } from "../cad/cadState";
import { openInBambuStudio } from "../cad/printActions";
import { useProject } from "../state";
import {
  cancelSlicing, choosePlate, closePrintPanel, copyToCard, ejectCard, loadCatalog, refreshDrives,
  openSlicedInBambu, saveSlicedAs, setOption, setPreviewOn, showSlicedFolder, sliceIsStale, sliceNow, toggleFeature, useSlice, watchDrives,
} from "./slicing";

/** How often the open panel looks for a card reader that was plugged in or taken out. */
const CARD_WATCH_MS = 3000;

/** A friendly word for a layer height preset ("0.20mm Standard" -> "Standard: good for most things"). */
export function qualityHint(label: string): string {
  const h = parseFloat(label);
  if (!Number.isFinite(h)) return "";
  if (h <= 0.1) return "super smooth, very slow";
  if (h <= 0.14) return "smooth, slow";
  if (h <= 0.18) return "fine detail";
  if (h <= 0.21) return "good for most things";
  if (h <= 0.26) return "quicker, a bit rougher";
  return "fastest, roughest";
}

const INFILL: { value: number | null; label: string; hint: string }[] = [
  { value: 10, label: "Light", hint: "10% inside: saves plastic" },
  { value: null, label: "Normal", hint: "The quality's own amount (usually 15%)" },
  { value: 30, label: "Strong", hint: "30% inside: for parts that get pushed" },
  { value: 60, label: "Super", hint: "60% inside: very strong" },
  { value: 100, label: "Solid", hint: "100%: completely solid, slow" },
];

const SUPPORTS: { value: SupportMode; label: string; hint: string }[] = [
  { value: "off", label: "None", hint: "No supports" },
  { value: "tree", label: "Tree", hint: "Branches that hold up parts hanging in the air. Easy to snap off." },
  { value: "normal", label: "Normal", hint: "Straight supports under parts hanging in the air." },
];

function Step({ n, title, done, children, testId }: { n: number; title: string; done?: boolean; children: ReactNode; testId?: string }) {
  return (
    <section className={`pp-step ${done ? "done" : ""}`} data-testid={testId}>
      <header className="pp-step-head">
        <span className="pp-step-num" aria-hidden>{done ? "✓" : n}</span>
        <h3>{title}</h3>
      </header>
      <div className="pp-step-body">{children}</div>
    </section>
  );
}

function Chips<T>({ items, value, onPick, testId }: { items: { value: T; label: string; hint: string }[]; value: T; onPick(v: T): void; testId: string }) {
  return (
    <div className="pp-chips" role="radiogroup" data-testid={testId}>
      {items.map((item) => (
        <button key={String(item.value)} role="radio" aria-checked={item.value === value} className={item.value === value ? "on" : ""} title={item.hint} onClick={() => onPick(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function PresetSelect({ label, value, items, onChange, hint, testId }: { label: string; value: string; items: PresetChoice[]; onChange(v: string): void; hint?: (c: PresetChoice) => string; testId: string }) {
  const groups = [...new Set(items.map((i) => i.group ?? ""))];
  const option = (c: PresetChoice) => <option key={c.name} value={c.name} title={hint?.(c)}>{c.label}</option>;
  const selected = items.find((i) => i.name === value);
  return (
    <label className="pp-field">
      <span className="pp-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {groups.length > 1 ? groups.map((g) => <optgroup key={g} label={g || "Other"}>{items.filter((i) => (i.group ?? "") === g).map(option)}</optgroup>) : items.map(option)}
      </select>
      {hint && selected && <span className="pp-hint">{hint(selected)}</span>}
    </label>
  );
}

function Settings() {
  const { catalog, catalogError, options, phase } = useSlice();
  const check = useCad((s) => s.printCheck);
  const overhang = check?.report.parts.some((p) => p.issues.some((i) => i.code === "overhang")) ?? false;
  if (catalogError) {
    return (
      <div className="pp-callout error" data-testid="slice-catalog-error">
        <p>{catalogError}</p>
        <button className="btn small" onClick={() => void loadCatalog()}>Try again</button>
      </div>
    );
  }
  if (!catalog || !options) return <p className="muted">Asking Bambu Studio what it can do…</p>;
  const busy = phase === "slicing";
  return (
    <fieldset className="pp-settings" disabled={busy}>
      <p className="pp-printer"><span className="pp-ico"><Icon name="printer" size={18} /></span>{catalog.printer}</p>
      <PresetSelect label="Quality" value={options.process} items={catalog.processes} onChange={(v) => setOption("process", v)} hint={(c) => qualityHint(c.label)} testId="slice-quality" />
      <PresetSelect label="Material" value={options.filament} items={catalog.filaments} onChange={(v) => setOption("filament", v)} testId="slice-filament" />
      <PresetSelect label="Plate on the printer" value={options.plate} items={catalog.plates} onChange={(v) => setOption("plate", v)} testId="slice-plate" />
      <div className="pp-field">
        <span className="pp-label">Supports</span>
        <Chips items={SUPPORTS} value={options.supports} onPick={(v) => setOption("supports", v)} testId="slice-supports" />
        {overhang && options.supports === "off" && (
          <p className="pp-tip" data-testid="slice-support-tip"><Icon name="bulb" size={16} /><span>The print check found parts hanging in the air. Supports hold them up while printing. Try <b>Tree</b>.</span></p>
        )}
      </div>
      <div className="pp-field">
        <span className="pp-label">Strength inside</span>
        <Chips items={INFILL} value={options.infill} onPick={(v) => setOption("infill", v)} testId="slice-infill" />
      </div>
    </fieldset>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{Math.max(0, Math.round((Date.now() - since) / 1000))} s</>;
}

function SliceStep() {
  const { phase, step, startedAt, error, outcome, options, catalog } = useSlice();
  const objects = useProject((s) => s.project.document.workspaces.cad.objects as CadObject[]);
  const selection = useCad((s) => s.selection.length);
  const stale = outcome !== null && sliceIsStale(objects);
  return (
    <Step n={2} title="Slice it" done={phase === "done" && !stale} testId="slice-step-slice">
      <p className="muted small">Slicing turns your model into the layer-by-layer steps the printer follows. It uses Bambu Studio's own slicer.</p>
      {phase === "slicing" ? (
        <div className="pp-working" data-testid="slice-slicing">
          <div className="pp-progress"><span /></div>
          <p>{step} <span className="muted"><Elapsed since={startedAt} /></span></p>
          <button className="btn small" onClick={cancelSlicing} data-testid="slice-cancel">Stop</button>
        </div>
      ) : (
        <button className="btn primary pp-big" disabled={!options || !catalog} onClick={() => void sliceNow()} data-testid="slice-slice">
          <span className="pp-big-main"><Icon name="sparkle" size={20} /> {outcome ? "Slice again" : "Slice it!"}</span>
          <span className="pp-big-sub">{selection ? "the selected parts" : "everything you can see"}</span>
        </button>
      )}
      {phase === "error" && error && <div className="pp-callout error" data-testid="slice-error"><p>{error}</p></div>}
      {stale && phase !== "slicing" && <div className="pp-callout warn" data-testid="slice-stale"><p>You changed the model after slicing. Slice again to print the new version.</p></div>}
      {outcome && phase !== "slicing" && <Results />}
    </Step>
  );
}

function Results() {
  const { outcome, plate, preview, previewLoading, previewError, previewOn, hidden } = useSlice();
  if (!outcome) return null;
  const p = outcome.plates[plate]!;
  return (
    <div className="pp-results" data-testid="slice-results">
      {outcome.plates.length > 1 && (
        <div className="pp-plates" role="tablist">
          {outcome.plates.map((pl, i) => (
            <button key={pl.fileName} role="tab" aria-selected={i === plate} className={i === plate ? "on" : ""} onClick={() => choosePlate(i)} data-testid={`slice-plate-${i + 1}`}>
              Plate {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="pp-stats">
        <div className="pp-stat"><span className="pp-ico"><Icon name="clock" size={18} /></span><b data-testid="slice-time">{p.seconds !== null ? formatDuration(p.seconds) : "?"}</b><span>print time</span></div>
        <div className="pp-stat"><span className="pp-ico"><Icon name="spool" size={18} /></span><b data-testid="slice-grams">{p.filamentGrams !== null ? `${p.filamentGrams.toFixed(1)} g` : "?"}</b><span>{p.filamentMm !== null ? `${(p.filamentMm / 1000).toFixed(2)} m of filament` : "filament"}</span></div>
        <div className="pp-stat"><span className="pp-ico"><Icon name="layers" size={18} /></span><b data-testid="slice-layers">{p.layers ?? "?"}</b><span>layers{p.maxZ ? `, ${p.maxZ.toFixed(1)} mm tall` : ""}</span></div>
      </div>
      {outcome.plates.length > 1 && <p className="muted small">On this plate: {p.parts.join(", ")}</p>}
      <div className="pp-preview-toggle">
        <div className="pp-chips">
          <button className={!previewOn ? "on" : ""} onClick={() => setPreviewOn(false)} data-testid="slice-show-model">My model</button>
          <button className={previewOn ? "on" : ""} disabled={!preview} onClick={() => setPreviewOn(true)} data-testid="slice-show-layers">Layers</button>
        </div>
        {previewLoading && <span className="muted small">Making the preview…</span>}
      </div>
      {previewError && <p className="muted small">The preview could not be made: {previewError}</p>}
      {preview && previewOn && (
        <div className="pp-legend" data-testid="slice-legend">
          {preview.features.map((f) => {
            const style = featureStyle(f.name);
            const off = hidden.includes(f.name);
            return (
              <button key={f.name} className={`pp-legend-item ${off ? "off" : ""}`} onClick={() => toggleFeature(f.name)} title={off ? "Show" : "Hide"}>
                <span className="pp-swatch" style={{ background: style.color }} />{style.label}
              </button>
            );
          })}
          {preview.truncatedAtLayer !== null && <p className="muted small">This print is very big: the preview shows layers 1 to {preview.truncatedAtLayer}.</p>}
        </div>
      )}
    </div>
  );
}

function size(bytes: number | null) {
  if (bytes === null) return "";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function CardRow({ drive }: { drive: RemovableDrive }) {
  const { copied, drivesBusy, outcome, plate } = useSlice();
  const done = copied && copied.mount === drive.mount && copied.plate === plate;
  return (
    <div className={`pp-card ${done ? "done" : ""}`} data-testid="slice-card">
      <div className="pp-card-head">
        <span className="pp-ico" aria-hidden><Icon name="sdcard" size={20} /></span>
        <div>
          <b>{drive.label}</b>
          <div className="muted small">{drive.fsType.toUpperCase()}{drive.freeBytes !== null ? ` · ${size(drive.freeBytes)} free` : ""}</div>
        </div>
      </div>
      {!drive.printerReadable && <p className="pp-tip warn"><Icon name="warn" size={16} /><span>This card is {drive.fsType}. The A1 reads <b>FAT32</b> cards only. You can format the card in the printer.</span></p>}
      {done ? (
        <>
          <p className="pp-good" data-testid="slice-copied" title={copied.path}><Icon name="check" size={16} /> Copied! <span className="muted small">It's on the card as <b>{copied.path.split(/[\\/]/).pop()}</b></span></p>
          {drive.canEject && <button className="btn primary small" disabled={drivesBusy} onClick={() => void ejectCard(drive.mount)} data-testid="slice-eject"><Icon name="eject" size={15} /> Eject the card</button>}
          {!drive.canEject && <p className="muted small">Eject the card from your computer before you take it out.</p>}
        </>
      ) : (
        <button className="btn primary small" disabled={drivesBusy || !outcome} onClick={() => void copyToCard(drive.mount)} data-testid="slice-copy">
          Copy {outcome && outcome.plates.length > 1 ? `plate ${plate + 1}` : "the print"} to this card
        </button>
      )}
    </div>
  );
}

function CardStep() {
  const { drives, drivesBusy, drivesError, outcome, ejected, phase } = useSlice();
  const ready = outcome !== null && phase !== "slicing";
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void watchDrives(); }, CARD_WATCH_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <Step n={3} title="Put it on the SD card" done={ejected !== null} testId="slice-step-card">
      {ejected !== null ? (
        <p className="pp-good" data-testid="slice-ejected"><Icon name="check" size={16} /> The card is safe to take out. Put it back in the printer.</p>
      ) : drives === null || (drivesBusy && drives.length === 0) ? (
        <p className="muted">Looking for SD cards…</p>
      ) : drives.length === 0 ? (
        <div className="pp-howto" data-testid="slice-no-card">
          <p><b>No SD card found.</b></p>
          <ol>
            <li>Take the microSD card out of the printer.</li>
            <li>Put it in a USB card reader.</li>
            <li>Plug the reader into this computer. The card shows up here by itself.</li>
          </ol>
          {drivesError && <p className="muted small">{drivesError}</p>}
        </div>
      ) : (
        drives.map((d) => <CardRow key={d.mount} drive={d} />)
      )}
      {!ready && drives && drives.length > 0 && <p className="muted small">Slice first, then copy it here.</p>}
      <button className="btn plain small" disabled={drivesBusy} onClick={() => void refreshDrives()} data-testid="slice-find-cards"><Icon name="refresh" size={15} /> Find cards</button>
    </Step>
  );
}

function PrinterStep() {
  const { outcome, plate } = useSlice();
  const file = outcome?.plates[plate]?.fileName;
  return (
    <Step n={4} title="Print it!" testId="slice-step-printer">
      <ol className="pp-list">
        <li>Put the card back in the printer.</li>
        <li>On the printer's screen, open the <b>file list</b> and choose the <b>SD card</b>.</li>
        <li>Tap {file ? <b>{file.replace(/\.gcode\.3mf$/, "")}</b> : "your print"}.</li>
        <li>Check the filament and the plate, then start!</li>
      </ol>
      <div className="pp-howto pp-alt" data-testid="slice-cloud">
        <p><b>No card reader?</b> Send it from Bambu Studio instead.</p>
        <ol>
          <li>Press the button below. Bambu Studio opens with this print, the same plate and settings.</li>
          <li>In Bambu Studio, press <b>Slice plate</b>, then <b>Print plate</b>.</li>
        </ol>
        <p className="muted small">This sends the print over the internet, so you need to be logged in to Bambu Studio and your printer must be added to your Bambu account (in the Bambu Handy app or Bambu Studio's Device tab).</p>
        <button className="btn primary small" disabled={!outcome} onClick={() => void openSlicedInBambu()} data-testid="slice-open-bambu">Open this print in Bambu Studio</button>
      </div>
      <div className="pp-more">
        <button className="btn plain small" disabled={!outcome} onClick={() => void saveSlicedAs()} data-testid="slice-save">Save file…</button>
        <button className="btn plain small" disabled={!outcome} onClick={showSlicedFolder}>Show folder</button>
        <button className="btn plain small" onClick={() => void openInBambuStudio()} title="For colour painting, custom supports and other advanced settings">Open the model in Bambu Studio</button>
      </div>
    </Step>
  );
}

export function PrintPanel() {
  return (
    <aside className="inspector print-panel" data-testid="slice-panel-side">
      <div className="pp-head">
        <h2>Print it</h2>
        <button className="icon-btn small" onClick={closePrintPanel} aria-label="Close the print panel" data-testid="slice-close">✕</button>
      </div>
      <Step n={1} title="Choose how to print it" testId="slice-step-settings">
        <Settings />
      </Step>
      <SliceStep />
      <CardStep />
      <PrinterStep />
    </aside>
  );
}
