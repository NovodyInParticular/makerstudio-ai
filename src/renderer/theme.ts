// Colours that cannot come from CSS: the 3D scenes. They follow the look chosen in Settings.

import { useUi } from "./state";

export interface SceneColors {
  background: string;
  bed: string;
  bedEdge: string;
  cell: string;
  section: string;
}

const NOVA: SceneColors = { background: "#1b2127", bed: "#222a32", bedEdge: "#5fb8a8", cell: "#2c353f", section: "#3b4a56" };
const CLASSIC: SceneColors = { background: "#101316", bed: "#15191d", bedEdge: "#2fd6a3", cell: "#2a3138", section: "#38515a" };

export function useSceneColors(): SceneColors {
  return useUi((s) => (s.settings?.theme === "classic" ? CLASSIC : NOVA));
}

/** Confetti colours for celebrations: soft teals and off-white. */
export const PARTY_COLORS = ["#5fb8a8", "#8fd3c6", "#3f8f82", "#dfe4e8"];
