import type { IconName } from "../workspaces";

type Name = IconName | "undo" | "redo" | "save" | "panel" | "close" | "plus" | "open" | "check" | "fullscreen" | "exitFullscreen";

// Simple original line icons (24x24 grid, stroke based).
const paths: Record<Name, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5",
  cube: "M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Zm0 0v0M4 7.5l8 4.5 8-4.5M12 12v9",
  circuit: "M4 7h5l2 3h9M4 17h7l2-3h7M7 7v0M17 10v0M7 4v6M17 14v6",
  robot: "M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm5-4v4M9.5 13h.01M14.5 13h.01M9 16.5h6M3 12v3M21 12v3",
  parts: "M4 5h7v7H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 14h7v5H4z",
  display: "M3 5h18v11H3zM8 20h8M12 16v4M8 10h.01M16 10h.01M9.5 12.5c1.5 1 3.5 1 5 0",
  ai: "M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  usb: "M12 3v14M12 3l-2.5 3h5L12 3ZM12 12l-4-2.5V7M12 14l4-2.5V9M6.5 7h3M14.5 9h3M12 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  save: "M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v5h8V3M7 21v-7h10v7",
  panel: "M3 4h18v16H3zM15 4v16",
  close: "M6 6l12 12M18 6 6 18",
  drone: "M9 9h6v6H9zM9 9 6 6M15 9l3-3M15 15l3 3M9 15l-3 3M3 6h6M15 6h6M3 18h6M15 18h6",
  fullscreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  exitFullscreen: "M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5",
  plus: "M12 5v14M5 12h14",
  open: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1M3 7v10a2 2 0 0 0 2 2h12l4-9H7l-4 9",
  check: "M5 12.5 10 17l9-10",
};

export function Icon({ name, size = 18 }: { name: Name; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
