import { newProject, openProject, refreshRecent } from "../actions";
import { Icon } from "../components/Icon";
import { Mascot } from "../components/Mascot";
import { useProject, useUi } from "../state";
import { workspaceInfo, type WorkspaceId } from "../workspaces";

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const STUDIOS: WorkspaceId[] = ["cad", "circuit", "robotics", "drone", "display", "parts", "ai"];

export function HomePage() {
  const recent = useUi((s) => s.recent);
  const name = useProject((s) => s.project.document.name);
  const filePath = useProject((s) => s.filePath);
  const setWorkspace = useUi((s) => s.setWorkspace);
  return (
    <div className="page home">
      <section className="hero home-hero">
        <Mascot />
        <div className="home-hero-text">
          <p className="home-hi">Hi, maker!</p>
          <h1>What do you want to <span className="accent">make</span> today?</h1>
          <p className="tagline">Pick a studio to start, or carry on with <b>{name}</b>.</p>
          <div className="hero-actions">
            <button className="btn primary" onClick={() => void newProject()} data-testid="home-new">
              <Icon name="plus" /> New project
            </button>
            <button className="btn plain" onClick={() => void openProject()}>
              <Icon name="open" /> Open project…
            </button>
          </div>
        </div>
      </section>

      <section className="studio-grid" aria-label="Studios">
        {STUDIOS.map((id) => {
          const w = workspaceInfo(id);
          return (
            <button key={id} className="studio-card" onClick={() => setWorkspace(id)} data-testid={`home-studio-${id}`}>
              <span className="studio-icon"><Icon name={w.icon} size={26} /></span>
              <span className="studio-name">{w.label}</span>
              <span className="studio-summary">{w.summary}</span>
              <span className="studio-go">Open <Icon name="arrow" size={16} />{w.key && <kbd>Ctrl+{w.key}</kbd>}</span>
            </button>
          );
        })}
        <button className="studio-card practice-card-link" onClick={() => setWorkspace("projects")} data-testid="home-practice">
          <span className="studio-icon"><Icon name="sparkle" size={26} /></span>
          <span className="studio-name">Practice projects</span>
          <span className="studio-summary">Build a real robot, drone or figure step by step, with its parts and print files.</span>
          <span className="studio-go">Pick one <Icon name="arrow" size={16} /></span>
        </button>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Open now</h2>
          <p className="big">{name}</p>
          <p className="muted small">{filePath ?? "Not saved yet. Press Ctrl+S to choose where to save it."}</p>
          <button className="btn plain" onClick={() => setWorkspace("projects")}>Project details</button>
        </section>

        <section className="card">
        <div className="card-header">
          <h2>Recent projects</h2>
          <button className="btn plain small" onClick={() => void refreshRecent()}>Refresh</button>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No recent projects yet.</p>
        ) : (
          <ul className="recent-list" data-testid="recent-list">
            {recent.map((item) => (
              <li key={item.path}>
                <button className="recent-open" onClick={() => void openProject(item.path)} title={item.path}>
                  <span className="recent-name">{item.name}</span>
                  <span className="recent-path">{item.path}</span>
                </button>
                <span className="muted small">{formatDate(item.openedAt)}</span>
                <button
                  className="icon-btn small"
                  title="Remove from this list (the file is not deleted)"
                  aria-label={`Remove ${item.name} from recent projects`}
                  onClick={async () => { await window.makerstudio.forgetRecent(item.path); await refreshRecent(); }}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}
