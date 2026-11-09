import { useEffect, useMemo, useState } from "react";
import { designReport } from "../../core/ai/design";
import { renameProject, setDescription, setNotes, type Command } from "../../core/document/commands";
import { duplicateCurrent, exportCopy, saveProject } from "../actions";
import { projectStore, useProject, useUi } from "../state";
import { PracticeCatalog } from "./PracticeCatalog";

function run(command: Command) {
  try {
    projectStore.getState().execute(command);
  } catch (error) {
    useUi.getState().notify("error", error instanceof Error ? error.message : String(error));
  }
}

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function DesignCheck() {
  const project = useProject((s) => s.project);
  const printer = useUi((s) => s.settings?.printer);
  const report = useMemo(() => designReport(project, printer), [project, printer]);
  const icon = { danger: "✖", warning: "⚠", info: "ℹ", ok: "✔" } as const;
  return (
    <section className="card" data-testid="design-check">
      <h2>Design check</h2>
      <p className="muted small">Checks the studios against each other: robot joints vs their servos in the circuit, mounted faces vs screen parts, the circuit checks, and parts vs your printer. The AI can run it too (check_design).</p>
      {report.map((f, i) => (
        <div key={i} className={`print-issue ${f.severity === "danger" ? "error" : f.severity === "ok" ? "" : f.severity}`} data-testid={`design-${f.severity}`}>
          <b>{icon[f.severity]} {f.area}:</b> {f.message}
          {f.fix && <div className="muted">Fix: {f.fix}</div>}
        </div>
      ))}
    </section>
  );
}

export function ProjectsPage() {
  const project = useProject((s) => s.project);
  const filePath = useProject((s) => s.filePath);
  const [name, setName] = useState(project.document.name);

  // Keep the field in step with undo/redo and with opening another project.
  useEffect(() => setName(project.document.name), [project.document.name, project.document.id]);

  const commitName = () => {
    if (name.trim() && name.trim() !== project.document.name) run(renameProject({ name }));
    else setName(project.document.name);
  };

  const revisions = [...project.history.revisions].reverse();
  const entries = [...project.history.entries].reverse().slice(0, 100);

  return (
    <div className="page">
      <h1>Projects</h1>
      <div className="grid-2">
        <DesignCheck />
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Project details</h2>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              data-testid="project-name-input"
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={3}
              value={project.document.description}
              maxLength={5000}
              onChange={(e) => run(setDescription({ description: e.target.value }))}
              placeholder="What is this project for?"
            />
          </label>
          <dl className="meta-list">
            <dt>File</dt><dd>{filePath ?? "Not saved yet"}{filePath && (
              <button className="link-btn" onClick={() => void window.makerstudio.revealInFolder(filePath)}>Show in folder</button>
            )}</dd>
            <dt>Created</dt><dd>{when(project.manifest.createdAt)}</dd>
            <dt>Last saved</dt><dd>{project.history.revisions.length ? when(project.manifest.modifiedAt) : "Never"}</dd>
            <dt>File format</dt><dd>version {project.manifest.formatVersion}, units {project.manifest.units}</dd>
          </dl>
          <div className="button-row">
            <button className="btn primary" onClick={() => void saveProject(false)} data-testid="save">Save</button>
            <button className="btn plain" onClick={() => void saveProject(true)}>Save as…</button>
            <button className="btn plain" onClick={() => void duplicateCurrent()}>Duplicate…</button>
            <button className="btn plain" onClick={() => void exportCopy()}>Export copy…</button>
          </div>
        </section>

        <section className="card">
          <h2>Design notes</h2>
          <textarea
            className="notes"
            value={project.notes}
            onChange={(e) => run(setNotes({ notes: e.target.value }))}
            placeholder="Measurements, part choices, ideas, to-dos… (saved inside the project as Markdown)"
            data-testid="notes"
          />
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Revisions</h2>
          {revisions.length === 0 ? (
            <p className="muted">A revision is recorded every time you save.</p>
          ) : (
            <ol className="history-list" data-testid="revisions">
              {revisions.map((r) => (
                <li key={r.number}><b>#{r.number}</b> <span>{r.summary}</span> <span className="muted small">{when(r.at)}</span></li>
              ))}
            </ol>
          )}
        </section>
        <section className="card">
          <h2>Change history</h2>
          {entries.length === 0 ? (
            <p className="muted">Every change, undo, redo and save is listed here.</p>
          ) : (
            <ol className="history-list" data-testid="history">
              {entries.map((e) => (
                <li key={e.id}>
                  <span className={`badge ${e.author}`}>{e.author}</span> <span>{e.label}</span>
                  <span className="muted small">{when(e.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <PracticeCatalog />
    </div>
  );
}
