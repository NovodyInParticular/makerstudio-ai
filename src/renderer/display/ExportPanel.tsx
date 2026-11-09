// "Put it on your robot": export the face as a PlatformIO project for a real board.

import { useEffect, useState } from "react";
import { boardsFor, firmwareProject, preferredBoard } from "../../core/display/firmware";
import type { Screen } from "../../core/display/face";
import { useProject, useUi } from "../state";

export function ExportPanel({ screen }: { screen: Screen }) {
  const boards = boardsFor(screen.display);
  const circuitParts = useProject((st) => st.project.document.workspaces.circuit.components);
  const preferred = preferredBoard(boards, circuitParts);
  const [boardId, setBoardId] = useState(preferred);
  const [start, setStart] = useState(-1);
  const anims = screen.animations ?? [];
  useEffect(() => { if (!boards.some((b) => b.id === boardId)) setBoardId(preferred); }, [screen.display]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (start >= anims.length) setStart(-1); }, [anims.length, start]);

  const exportNow = async () => {
    const notify = useUi.getState().notify;
    let project;
    try {
      project = firmwareProject({ screen, boardId, start });
    } catch (error) {
      return notify("error", error instanceof Error ? error.message : String(error));
    }
    const result = await window.makerstudio.exportCodeProject(project.name, project.files);
    if (!result.ok) return notify("error", result.error);
    if (!result.value) return;
    notify("success", [`Code project saved in ${result.value}.`, "Connect the board with USB and run \"pio run -t upload\" in that folder (see its README).", ...project.notes].join(" "));
  };

  return (
    <section data-testid="export-panel">
      <h4>Put it on your robot</h4>
      <label className="field">
        <span>Board</span>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-testid="export-board">
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>When it starts</span>
        <select value={start} onChange={(e) => setStart(Number(e.target.value))} data-testid="export-start">
          <option value={-1}>Idle life (blink, look around)</option>
          {anims.map((a, i) => <option key={a.id} value={i}>Play "{a.name}"</option>)}
        </select>
      </label>
      <button className="btn primary small" onClick={() => void exportNow()} disabled={!boardId} data-testid="export-code">Export code project…</button>
      <p className="muted small">
        Makes a PlatformIO project with the same drawing code as this preview. Upload it with PlatformIO;
        over USB serial, type 0-9 to play an animation or i for idle life.
      </p>
    </section>
  );
}
