import { newProject, openProject, refreshRecent } from "../actions";
import { Icon } from "../components/Icon";
import { useProject, useUi } from "../state";

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function HomePage() {
  const recent = useUi((s) => s.recent);
  const name = useProject((s) => s.project.document.name);
  const filePath = useProject((s) => s.filePath);
  const setWorkspace = useUi((s) => s.setWorkspace);
  return (
    <div className="page">
      <section className="hero">
        <h1>MakerStudio <span className="accent">AI</span></h1>
        <p className="tagline">Your AI-powered engineering and robotics workshop.</p>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => void newProject()} data-testid="home-new">
            <Icon name="plus" /> New project
          </button>
          <button className="btn plain" onClick={() => void openProject()}>
            <Icon name="open" /> Open project…
          </button>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Open now</h2>
          <p className="big">{name}</p>
          <p className="muted small">{filePath ?? "Not saved yet. Press Ctrl+S to choose where to save it."}</p>
          <button className="btn plain" onClick={() => setWorkspace("projects")}>Project details</button>
        </section>

        <section className="card">
          <h2>What works today</h2>
          <ul className="checklist">
            <li><Icon name="check" size={16} /> 3D Studio: shapes, holes and Booleans, STL / OBJ / STEP, script parts, print checks for the Bambu A1</li>
            <li><Icon name="check" size={16} /> Circuit Studio: wiring with live safety checks, SPICE simulation, Uno and Pico code running in the app</li>
            <li><Icon name="check" size={16} /> Display Studio: robot faces, moods and animations, exported as real code</li>
            <li><Icon name="check" size={16} /> Robotics Studio: joints, behaviours and robot code for ESP32, M5Stack, Uno, Pico</li>
            <li><Icon name="check" size={16} /> Parts Library and practice projects (robots, drones, the Dummy 13)</li>
            <li><Icon name="check" size={16} /> AI Engineer: chat (Claude Code, Ollama, Claude, OpenAI-compatible); every change needs your approval</li>
            <li><Icon name="check" size={16} /> Upload to real boards, notes, revision history, undo and redo</li>
          </ul>
        </section>
      </div>

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
  );
}
