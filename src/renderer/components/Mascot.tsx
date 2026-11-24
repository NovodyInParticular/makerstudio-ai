// Bolt, the MakerStudio helper robot (an original drawing): a floating head with a glowing
// visor, blinking eyes and a pulsing antenna. Purely decorative.

export function Mascot({ size = 150, mood = "happy" }: { size?: number; mood?: "happy" | "wow" }) {
  return (
    <svg className={`mascot mood-${mood}`} width={size} height={size * 1.08} viewBox="0 0 160 172" aria-hidden="true">
      <defs>
        <linearGradient id="bolt-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a9a8d" />
          <stop offset="1" stopColor="#6fc3b4" />
        </linearGradient>
        <linearGradient id="bolt-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#222a32" />
          <stop offset="1" stopColor="#171c22" />
        </linearGradient>
        <radialGradient id="bolt-glow">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#a5e3d8" />
          <stop offset="1" stopColor="#5fb8a8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className="mascot-shadow" cx="80" cy="164" rx="40" ry="6" fill="#000" opacity="0.35" />
      <g className="mascot-body">
        <line x1="80" y1="34" x2="80" y2="16" stroke="url(#bolt-shell)" strokeWidth="5" strokeLinecap="round" />
        <circle className="mascot-antenna" cx="80" cy="12" r="9" fill="url(#bolt-glow)" />
        <circle cx="80" cy="12" r="4.5" fill="#d6f2ec" />
        <rect x="8" y="66" width="16" height="34" rx="8" fill="#3d7f75" />
        <rect x="136" y="66" width="16" height="34" rx="8" fill="#3d7f75" />
        <rect x="18" y="32" width="124" height="104" rx="34" fill="url(#bolt-shell)" />
        <rect x="21" y="35" width="118" height="98" rx="31" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="2" />
        <rect x="32" y="50" width="96" height="66" rx="24" fill="url(#bolt-visor)" />
        <g className="mascot-eyes">
          <rect x="50" y="66" width="18" height="24" rx="9" fill="#a5e3d8" />
          <rect x="92" y="66" width="18" height="24" rx="9" fill="#a5e3d8" />
          <circle cx="62" cy="72" r="3.2" fill="#ffffff" />
          <circle cx="104" cy="72" r="3.2" fill="#ffffff" />
        </g>
        {mood === "wow"
          ? <ellipse cx="80" cy="104" rx="6" ry="5" fill="#a5e3d8" />
          : <path d="M68 100q12 10 24 0" fill="none" stroke="#a5e3d8" strokeWidth="4" strokeLinecap="round" />}
        <circle cx="44" cy="98" r="5" fill="#a5e3d8" opacity="0.25" />
        <circle cx="116" cy="98" r="5" fill="#a5e3d8" opacity="0.25" />
        <rect x="62" y="136" width="36" height="10" rx="5" fill="#3d7f75" />
      </g>
    </svg>
  );
}
