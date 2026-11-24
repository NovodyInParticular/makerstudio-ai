export type WorkspaceId =
  | "home"
  | "cad"
  | "circuit"
  | "robotics"
  | "drone"
  | "parts"
  | "display"
  | "ai"
  | "projects"
  | "device"
  | "settings";

export interface WorkspaceInfo {
  id: WorkspaceId;
  label: string;
  icon: IconName;
  /** Ctrl+<key> opens it ("1"…"0"); fixed per workspace so adding one never renumbers the rest. */
  key?: string;
  /** Roadmap phase that builds this workspace; undefined when it already works. */
  plannedPhase?: number;
  summary: string;
  /** A few friendly words under the name in the sidebar. */
  tagline: string;
  planned?: string[];
}

export type IconName = "drone" | "home" | "cube" | "circuit" | "robot" | "parts" | "display" | "ai" | "folder" | "usb" | "gear";

export const WORKSPACES: WorkspaceInfo[] = [
  { id: "home", tagline: "Start here", key: "1", label: "Home", icon: "home", summary: "Start, open recent projects, see what works today." },
  { id: "cad", tagline: "Make 3D shapes", key: "2", label: "3D Studio", icon: "cube", summary: "Model printable parts with real dimensions." },
  {
    id: "circuit", tagline: "Wire up electronics", key: "3",
    label: "Circuit Studio",
    icon: "circuit",
    summary: "Wire parts and boards together, with live safety checks.",
  },
  {
    id: "robotics", tagline: "Bring robots to life", key: "4",
    label: "Robotics Studio",
    icon: "robot",
    summary: "Make your robot move: joints, screens and poses.",
  },
  { id: "drone", tagline: "Design & fly drones", label: "Drone Studio", icon: "drone", summary: "Will your drone fly? Weight, balance and thrust from your 3D design, then fly it in a simulator." },
  { id: "parts", tagline: "Find any part", key: "5", label: "Parts Library", icon: "parts", summary: "Searchable catalog of parts; every spec shows its source." },
  {
    id: "display", tagline: "Draw robot faces", key: "6",
    label: "Display Studio",
    icon: "display",
    summary: "Design robot faces for small screens and watch them come alive.",
  },
  {
    id: "ai", tagline: "Your build buddy", key: "7",
    label: "AI Engineer",
    icon: "ai",
    summary: "An assistant that understands your project and can build with you.",
  },
  { id: "projects", tagline: "Notes & history", key: "8", label: "Projects", icon: "folder", summary: "Details, notes and revision history of the open project." },
  { id: "device", tagline: "Send code to boards", key: "9", label: "Upload", icon: "usb", summary: "Flash firmware, upload code to a real board and watch its serial output." },
  { id: "settings", tagline: "Change how it works", key: "0", label: "Settings", icon: "gear", summary: "Units, grid, printer and app information." },
];

export function workspaceInfo(id: WorkspaceId): WorkspaceInfo {
  return WORKSPACES.find((w) => w.id === id)!;
}
