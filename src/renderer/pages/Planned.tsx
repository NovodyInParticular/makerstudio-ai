import { Icon } from "../components/Icon";
import type { WorkspaceInfo } from "../workspaces";

/** Shown for workspaces that are not built yet. It says so plainly instead of pretending. */
export function PlannedPage({ info }: { info: WorkspaceInfo }) {
  return (
    <div className="page planned" data-testid={`planned-${info.id}`}>
      <div className="planned-icon"><Icon name={info.icon} size={44} /></div>
      <h1>{info.label}</h1>
      <p className="tagline">{info.summary}</p>
      <span className="phase-badge">Not built yet — planned for Phase {info.plannedPhase}</span>
      {info.planned && (
        <section className="card planned-list">
          <h2>What this workspace will do</h2>
          <ul>
            {info.planned.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
