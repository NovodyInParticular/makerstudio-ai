// Answers AI requests from the main process (Claude Code over MCP, later the in-app chat).
import { toolSpecs } from "../../core/ai/tools";
import { runTool } from "./aiState";

let installed = false;

export function installAiBridge() {
  if (installed || !window.makerstudio?.onAiRequest) return;
  installed = true;
  window.makerstudio.onAiRequest((request) => {
    try {
      if (request.kind === "specs") {
        window.makerstudio.aiRespond({ id: request.id, ok: true, data: toolSpecs(request.readOnly ? ["read"] : ["read", "change"]) });
        return;
      }
      const result = runTool(request.source, request.name, request.params);
      window.makerstudio.aiRespond(result.ok ? { id: request.id, ok: true, data: result.data } : { id: request.id, ok: false, error: result.error });
    } catch (error) {
      window.makerstudio.aiRespond({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
