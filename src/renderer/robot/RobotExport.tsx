// "Put it on your robot": export the whole robot (face, behaviour, servos) as a PlatformIO project.

import { useEffect, useState } from "react";
import { preferredBoard } from "../../core/display/firmware";
import type { Screen } from "../../core/display/face";
import { robotBoards, robotFirmwareProject } from "../../core/robot/firmware";
import type { Robot } from "../../core/robot/model";
import { useProject, useUi } from "../state";

export function RobotExport({ robot, screens }: { robot: Robot; screens: Screen[] }) {
  const boards = robotBoards(robot, screens);
  const circuitParts = useProject((st) => st.project.document.workspaces.circuit.components);
  const preferred = preferredBoard(boards, circuitParts);
  const [boardId, setBoardId] = useState(preferred);
  const behaviors = robot.behaviors ?? [];
  const [behaviorId, setBehaviorId] = useState<string>(behaviors[0]?.id ?? "");
  useEffect(() => { if (!boards.some((b) => b.id === boardId)) setBoardId(preferred); }, [boards.map((b) => b.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (behaviorId && !behaviors.some((b) => b.id === behaviorId)) setBehaviorId(behaviors[0]?.id ?? ""); }, [behaviors.map((b) => b.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportNow = async () => {
    const notify = useUi.getState().notify;
    let project;
    try {
      project = robotFirmwareProject({ robot, screens, behaviorId: behaviorId || null, boardId });
    } catch (error) {
      return notify("error", error instanceof Error ? error.message : String(error));
    }
    const result = await window.makerstudio.exportCodeProject(project.name, project.files);
    if (!result.ok) return notify("error", result.error);
    if (!result.value) return;
    notify("success", [`Robot code saved in ${result.value}.`, "Connect the board with USB and run \"pio run -t upload\" in that folder (see its README for servo power).", ...project.notes].join(" "));
  };

  return (
    <section data-testid="robot-export">
      <h4>Put it on your robot</h4>
      <label className="field"><span>Board</span>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)} data-testid="robot-export-board">
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Behaviour at start</span>
        <select value={behaviorId} onChange={(e) => setBehaviorId(e.target.value)} data-testid="robot-export-behavior">
          <option value="">None (idle life)</option>
          {behaviors.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <button className="btn primary small" disabled={!boardId} onClick={() => void exportNow()} data-testid="robot-export-code">Export robot code…</button>
      <button className="btn plain small" onClick={() => useUi.getState().setWorkspace("circuit")} data-testid="robot-to-circuit">Wire it in Circuit Studio…</button>
      <p className="muted small">Face, behaviour and servos in one PlatformIO project. Set each joint's servo pin first (select the joint). The robot moves like the preview: same steps, same timing.</p>
    </section>
  );
}
