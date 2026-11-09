// Practice projects: real open-source builds from GitHub to learn with.

import { Fragment, useState } from "react";
import { PRACTICE_PROJECTS, projectLocation, VERIFIED_ON, type Difficulty } from "../../core/practice/catalog";
import { startPracticeProject } from "../actions";

const LEVELS: (Difficulty | "All")[] = ["All", "Starter", "Intermediate", "Advanced"];

export function PracticeCatalog() {
  const [level, setLevel] = useState<Difficulty | "All">("All");
  const [open, setOpen] = useState<string | null>(null);
  const shown = PRACTICE_PROJECTS.filter((p) => level === "All" || p.difficulty === level);
  return (
    <section className="card practice" data-testid="practice-catalog">
      <div className="practice-head">
        <h2>Practice projects</h2>
        <div className="seg" role="group" aria-label="Difficulty">
          {LEVELS.map((l) => (
            <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)} data-testid={`practice-filter-${l}`}>{l}</button>
          ))}
        </div>
      </div>
      <p className="muted small">
        Open-source robots and gadgets on GitHub to build and learn from. Starting one makes a new project with a build plan in the
        design notes and practice shapes in 3D Studio (placeholder sizes: measure your real parts). Details checked {VERIFIED_ON}; the GitHub page is always the latest.
      </p>
      <div className="practice-grid">
        {shown.map((p) => {
          const expanded = open === p.id;
          return (
            <article key={p.id} className="practice-card" data-testid={`practice-${p.id}`}>
              <div className="practice-title">
                <h3>{p.title}</h3>
                <span className={`badge level-${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
              </div>
              <div className="muted small">{p.kind} · {p.license} · {projectLocation(p).url
                ? <a href={projectLocation(p).url!} target="_blank" rel="noreferrer">{projectLocation(p).label}</a>
                : <span title="On this computer">{projectLocation(p).label} (on this computer)</span>}</div>
              <p className="practice-summary">{p.summary}</p>
              {expanded && (
                <>
                  <dl className="meta-list practice-facts">
                    {p.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
                  </dl>
                  <p className="small"><b>You will learn:</b> {p.learn.join("; ")}.</p>
                  {p.caveats.map((c) => <p key={c} className="small practice-caveat">{c}</p>)}
                </>
              )}
              <div className="button-row">
                <button className="btn primary small" onClick={() => void startPracticeProject(p)} data-testid={`practice-start-${p.id}`}>Start practice project</button>
                <button className="btn plain small" onClick={() => setOpen(expanded ? null : p.id)}>{expanded ? "Less" : "Details"}</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
