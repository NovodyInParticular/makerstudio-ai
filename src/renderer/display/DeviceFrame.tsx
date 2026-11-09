// The module or device around a display, drawn so the preview looks like the part on your desk.
// Original drawings of the typical look (no logos). Proportions follow common modules; physical
// sizes vary between sellers, so this is not a measuring tool.

import type { ReactNode } from "react";
import type { DisplaySpec } from "../../core/display/catalog";

interface Frame {
  /** Margins around the screen as fractions of the screen's width (x) and height (y). */
  left: number; right: number; top: number; bottom: number;
  board: string; radius: number; round?: boolean;
  pins?: { side: "top" | "left"; count: number };
  kind: "module" | "case";
  ribbon?: boolean;
  label?: string;
}

function frameFor(d: DisplaySpec): Frame {
  if (d.id.startsWith("m5stack")) return { kind: "case", left: 0.09, right: 0.09, top: 0.1, bottom: 0.32, board: d.id === "m5stack-cores3" ? "#2b2f34" : "#1c1f23", radius: 0.08 };
  if (d.round) return { kind: "module", left: 0.12, right: 0.12, top: 0.12, bottom: 0.12, board: "#14171a", radius: 0.5, round: true, pins: { side: "top", count: 7 } };
  if (d.color === "mono" && d.height === 32) return { kind: "module", left: 0.2, right: 0.06, top: 0.35, bottom: 0.35, board: "#1f4fa8", radius: 0.05, pins: { side: "left", count: 4 }, ribbon: true };
  if (d.color === "mono") return { kind: "module", left: 0.1, right: 0.1, top: 0.46, bottom: 0.38, board: "#1f4fa8", radius: 0.04, pins: { side: "top", count: 4 }, ribbon: true };
  if (d.width === 240 && d.height === 240) return { kind: "module", left: 0.12, right: 0.12, top: 0.28, bottom: 0.16, board: "#1d3f86", radius: 0.04, pins: { side: "top", count: 7 } };
  // 2.4-2.8" SPI TFTs: the familiar red board with a pin row along one edge.
  return { kind: "module", left: 0.22, right: 0.07, top: 0.07, bottom: 0.16, board: "#b3242c", radius: 0.025, pins: { side: "left", count: 14 }, ribbon: true };
}

export function DeviceFrame({ display, width, height, children }: { display: DisplaySpec; width: number; height: number; children: ReactNode }) {
  const f = frameFor(display);
  const ml = f.left * width, mr = f.right * width, mt = f.top * height, mb = f.bottom * height;
  const W = width + ml + mr, H = height + mt + mb;
  const r = f.round ? W / 2 : f.radius * Math.min(W, H);
  const pinR = Math.max(3, Math.min(width, height) * 0.018);
  const pins: { x: number; y: number }[] = [];
  if (f.pins?.side === "top") {
    // On a round board the pins sit inside the circle, above the screen.
    const span = Math.min(W * (f.round ? 0.34 : 0.62), f.pins.count * pinR * 5.2);
    const y = f.round ? mt * 0.55 : Math.min(mt * 0.42, pinR * 4);
    for (let i = 0; i < f.pins.count; i++) pins.push({ x: W / 2 - span / 2 + (i + 0.5) * (span / f.pins.count), y });
  } else if (f.pins?.side === "left") {
    const span = Math.min(H * 0.86, f.pins.count * pinR * 5.2);
    for (let i = 0; i < f.pins.count; i++) pins.push({ x: Math.min(ml * 0.38, pinR * 4), y: H / 2 - span / 2 + (i + 0.5) * (span / f.pins.count) });
  }
  const holes = f.kind === "module" && !f.round ? [[1, 1], [W - 1, 1], [1, H - 1], [W - 1, H - 1]].map(([x, y]) => [x! < W / 2 ? pinR * 2.6 : W - pinR * 2.6, y! < H / 2 ? pinR * 2.6 : H - pinR * 2.6]) : [];
  return (
    <div className="device-frame" style={{ width: W, height: H }} data-testid="device-frame">
      <svg className="device-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <linearGradient id="df-sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.14" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.25" /></linearGradient>
          <linearGradient id="df-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3d27a" /><stop offset="1" stopColor="#a8821f" /></linearGradient>
        </defs>
        {f.round
          ? <circle cx={W / 2} cy={H / 2} r={W / 2 - 1} fill={f.board} stroke="#000" />
          : <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={r} fill={f.board} stroke="#000" />}
        {f.round ? <circle cx={W / 2} cy={H / 2} r={W / 2 - 1} fill="url(#df-sheen)" /> : <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={r} fill="url(#df-sheen)" />}
        {f.kind === "case" && (
          <>
            {/* Glass over the whole front, a little bigger than the screen. */}
            <rect x={ml * 0.45} y={mt * 0.45} width={W - ml * 0.9} height={height + mt * 0.55 + mb * 0.2} rx={r * 0.5} fill="#050607" stroke="#3a3f45" strokeWidth={1} />
            {/* Three touch areas under the screen, like the board's on-screen buttons. */}
            {[0.25, 0.5, 0.75].map((x) => <circle key={x} cx={W * x} cy={H - mb * 0.38} r={Math.max(3, mb * 0.08)} fill="#3a3f45" />)}
            <rect x={W * 0.47} y={H - 3} width={W * 0.06} height={3} rx={1.5} fill="#8a9097" />
          </>
        )}
        {f.kind === "module" && (
          <>
            {/* Black panel glass, slightly larger than the active area. */}
            {f.round
              ? <circle cx={W / 2} cy={H / 2} r={width / 2 + Math.min(ml, mt) * 0.35} fill="#050607" stroke="#2a2e33" />
              : <rect x={ml - Math.min(ml, mr) * 0.35} y={mt - Math.min(mt, mb) * 0.3} width={width + Math.min(ml, mr) * 0.7} height={height + Math.min(mt, mb) * 0.3 + mb * 0.35} rx={2} fill="#050607" stroke="#2a2e33" />}
            {f.ribbon && <rect x={ml + width * 0.3} y={mt + height + mb * 0.35} width={width * 0.4} height={mb * 0.35} fill="#c98a1e" opacity={0.85} />}
            {holes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={pinR * 1.4} fill="#0b0d10" stroke="url(#df-gold)" strokeWidth={pinR * 0.6} />)}
            {pins.map((p, i) => (
              <g key={i}>
                <rect x={p.x - pinR * 1.5} y={p.y - pinR * 1.5} width={pinR * 3} height={pinR * 3} rx={pinR * 0.4} fill="#111" />
                <circle cx={p.x} cy={p.y} r={pinR * 0.8} fill="url(#df-gold)" />
              </g>
            ))}
          </>
        )}
      </svg>
      <div className="device-screen" style={{ left: ml, top: mt, width, height, borderRadius: f.round ? "50%" : 2 }}>{children}</div>
    </div>
  );
}
