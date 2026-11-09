// Realistic top-view drawings of parts (original artwork, in 0.1 inch grid units). Pins are drawn
// by the canvas on top; these draw the body, legs and markings. No manufacturer logos.

import type { ReactNode } from "react";
import type { ComponentDef } from "../../core/circuit/catalog";
import { partLayout } from "../../core/circuit/layout";
import { capacitorCode, resistorBands } from "../../core/circuit/markings";
import type { CircuitComponent } from "../../core/circuit/schema";

const LEG = "#b9c0c7";
const LED_FILL: Record<string, string> = { red: "#ff3b3b", yellow: "#ffd400", green: "#2fdc6a", blue: "#3d7bff", white: "#f4f6f8" };

/** Shared gradients, placed once in the canvas <defs>. */
export function PartDefs() {
  return (
    <>
      <linearGradient id="pa-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eef1f4" /><stop offset="0.5" stopColor="#a9b1b9" /><stop offset="1" stopColor="#d7dce1" /></linearGradient>
      <linearGradient id="pa-metal-h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8e979f" /><stop offset="0.35" stopColor="#f2f4f6" /><stop offset="1" stopColor="#9aa2aa" /></linearGradient>
      <linearGradient id="pa-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.25" /><stop offset="0.45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.25" /></linearGradient>
      <radialGradient id="pa-dome" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stopColor="#fff" stopOpacity="0.85" /><stop offset="0.25" stopColor="#fff" stopOpacity="0.15" /><stop offset="1" stopColor="#000" stopOpacity="0.25" /></radialGradient>
      <linearGradient id="pa-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3d27a" /><stop offset="1" stopColor="#a8821f" /></linearGradient>
      <pattern id="pa-mesh" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><rect width="0.5" height="0.5" fill="#c7cdd3" /><circle cx="0.25" cy="0.25" r="0.14" fill="#5b636b" /></pattern>
    </>
  );
}

const Leg = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={LEG} strokeWidth={0.16} strokeLinecap="round" />;
const Sheen = ({ x, y, w, h, rx = 0.3 }: { x: number; y: number; w: number; h: number; rx?: number }) => <rect x={x} y={y} width={w} height={h} rx={rx} fill="url(#pa-body)" pointerEvents="none" />;
const Txt = ({ x, y, s = 0.7, fill = "#f4f6f8", anchor = "middle", children, mono }: { x: number; y: number; s?: number; fill?: string; anchor?: "start" | "middle" | "end"; children: ReactNode; mono?: boolean }) =>
  <text x={x} y={y} fontSize={s} fill={fill} textAnchor={anchor} fontFamily={mono ? "monospace" : undefined} pointerEvents="none">{children}</text>;
/** Black header strip along a module's bottom edge, under its pins. */
const Header = ({ w, h, n }: { w: number; h: number; n: number }) => <rect x={(w - 2 * n) / 2 + 0.2} y={h - 0.55} width={2 * n - 0.4} height={1.1} rx={0.15} fill="#15181b" />;
/** A module PCB with mounting holes. */
function Pcb({ w, h, color, holes = true }: { w: number; h: number; color: string; holes?: boolean }) {
  return (
    <g>
      <rect x={0} y={0} width={w} height={h - 0.4} rx={0.5} fill={color} stroke="#0b0e10" strokeWidth={0.1} />
      <Sheen x={0} y={0} w={w} h={h - 0.4} rx={0.5} />
      {holes && [[0.9, 0.9], [w - 0.9, 0.9]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.45} fill="#0b0e10" stroke="#c9a227" strokeWidth={0.12} />)}
    </g>
  );
}

function twoPin(c: CircuitComponent, def: ComponentDef, span: number): ReactNode {
  const t = c.type;
  switch (t) {
    case "resistor": {
      const bands = resistorBands(Number(c.props.ohms ?? 220)).colors;
      return (
        <g>
          <Leg x1={0} y1={2} x2={span} y2={2} />
          <rect x={0.75} y={1.45} width={2.5} height={1.1} rx={0.5} fill="#d9c49b" stroke="#8a7350" strokeWidth={0.06} />
          {bands.map((col, i) => <rect key={i} x={i < 3 ? 1.1 + i * 0.42 : 2.7} y={1.45} width={0.24} height={1.1} fill={col} />)}
          <Sheen x={0.75} y={1.45} w={2.5} h={1.1} rx={0.5} />
        </g>
      );
    }
    case "photoresistor":
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.6} y2={0.6} /><Leg x1={span} y1={2} x2={span - 0.6} y2={0.6} />
          <circle cx={1} cy={0.2} r={1.05} fill="#e8d7a8" stroke="#8a7350" strokeWidth={0.08} />
          <path d="M0.35 -0.3 h1.3 M1.65 -0.3 v0.25 h-1.3 v0.25 h1.3 v0.25 h-1.3 v0.25 h1.3" fill="none" stroke="#b5432c" strokeWidth={0.13} />
          <circle cx={1} cy={0.2} r={1.05} fill="url(#pa-dome)" />
        </g>
      );
    case "led": {
      const fill = LED_FILL[String(c.props.color ?? "red")] ?? LED_FILL.red!;
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.55} y2={0.6} /><Leg x1={span} y1={2} x2={span - 0.55} y2={0.6} />
          <path d="M-0.15 0.95 A1.15 1.15 0 1 1 2.05 0.95 L2.05 1.25 L-0.15 1.25 Z" fill={fill} opacity={0.92} stroke="#00000055" strokeWidth={0.06} />
          <rect x={-0.3} y={1.1} width={2.6} height={0.3} rx={0.1} fill={fill} opacity={0.75} />
          <line x1={2.15} y1={-0.2} x2={2.15} y2={1.4} stroke="#00000066" strokeWidth={0.12} />
          <circle cx={0.95} cy={0.2} r={1.1} fill="url(#pa-dome)" pointerEvents="none" />
        </g>
      );
    }
    case "diode":
      return (
        <g>
          <Leg x1={0} y1={2} x2={span} y2={2} />
          <rect x={1} y={1.55} width={2} height={0.9} rx={0.25} fill="#222" />
          <rect x={2.55} y={1.55} width={0.25} height={0.9} fill="#c7cdd3" />
          <Sheen x={1} y={1.55} w={2} h={0.9} rx={0.25} />
        </g>
      );
    case "capacitor":
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.5} y2={0.9} /><Leg x1={span} y1={2} x2={span - 0.5} y2={0.9} />
          <ellipse cx={1} cy={0.4} rx={1.25} ry={1.05} fill="#d98b2b" stroke="#8a5216" strokeWidth={0.07} />
          <Txt x={1} y={0.65} s={0.6} fill="#3b2208">{capacitorCode(Number(c.props.microfarads ?? 0.1))}</Txt>
          <ellipse cx={1} cy={0.4} rx={1.25} ry={1.05} fill="url(#pa-dome)" />
        </g>
      );
    case "electrolytic":
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.4} y2={1.2} /><Leg x1={span} y1={2} x2={span - 0.4} y2={1.2} />
          <rect x={-0.4} y={-2.6} width={2.8} height={3.9} rx={0.4} fill="#1d2a5c" />
          <rect x={1.55} y={-2.6} width={0.85} height={3.9} fill="#b7c0d8" />
          {[-1.9, -1.1, -0.3, 0.5].map((y) => <Txt key={y} x={1.97} y={y + 0.2} s={0.6} fill="#1d2a5c">−</Txt>)}
          <Txt x={0.55} y={-0.9} s={0.5}>{Number(c.props.microfarads ?? 100)}µF</Txt>
          <Txt x={0.55} y={-0.2} s={0.5}>{Number(c.props.ratedVolts ?? 16)}V</Txt>
          <rect x={-0.4} y={-2.6} width={2.8} height={3.9} rx={0.4} fill="url(#pa-metal-h)" opacity={0.25} />
        </g>
      );
    case "button":
      return (
        <g>
          <rect x={0.3} y={0.3} width={3.4} height={3.4} rx={0.25} fill="url(#pa-metal)" stroke="#5b636b" strokeWidth={0.08} />
          <rect x={0.6} y={0.6} width={2.8} height={2.8} rx={0.2} fill="#1b1e21" />
          <circle cx={2} cy={2} r={1.05} fill={c.props.closed ? "#3a3f45" : "#2a2e33"} stroke="#000" strokeWidth={0.08} />
          <circle cx={2} cy={2} r={1.05} fill="url(#pa-dome)" opacity={0.5} />
        </g>
      );
    case "switch": {
      const on = Boolean(c.props.closed);
      return (
        <g>
          <rect x={-0.6} y={0.7} width={3.2} height={2.6} rx={0.25} fill="#2a5db0" stroke="#163466" strokeWidth={0.08} />
          <rect x={-0.2} y={1.25} width={2.4} height={1.0} rx={0.15} fill="#163466" />
          <rect x={on ? 1.05 : -0.1} y={0.95} width={1.15} height={1.6} rx={0.2} fill="#1b1e21" />
          <Txt x={1} y={3.05} s={0.5}>{on ? "ON" : "OFF"}</Txt>
          <Sheen x={-0.6} y={0.7} w={3.2} h={2.6} />
        </g>
      );
    }
    case "tilt-switch":
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.6} y2={0.9} /><Leg x1={span} y1={2} x2={span - 0.6} y2={0.9} />
          <rect x={-0.2} y={-1.6} width={2.4} height={2.6} rx={1.1} fill="#1f6b3c" />
          <Sheen x={-0.2} y={-1.6} w={2.4} h={2.6} rx={1.1} />
        </g>
      );
    case "speaker":
      return (
        <g>
          <path d="M0 2 V0.8" stroke="#d0312d" strokeWidth={0.18} /><path d={`M${span} 2 V0.8`} stroke="#1a1a1a" strokeWidth={0.18} />
          <circle cx={span / 2} cy={-1.4} r={2.8} fill="url(#pa-metal)" stroke="#5b636b" strokeWidth={0.08} />
          <circle cx={span / 2} cy={-1.4} r={2.2} fill="#1b1e21" />
          {[1.6, 1.0, 0.45].map((r) => <circle key={r} cx={span / 2} cy={-1.4} r={r} fill="none" stroke="#30353b" strokeWidth={0.12} />)}
          <circle cx={span / 2} cy={-1.4} r={0.35} fill="#2b2f33" />
        </g>
      );
    case "buzzer":
      return (
        <g>
          <circle cx={2} cy={2} r={2.3} fill="#1b1e21" stroke="#000" strokeWidth={0.08} />
          <circle cx={2} cy={2} r={0.45} fill="#000" />
          <Txt x={0.7} y={1.1} s={0.7}>+</Txt>
          <circle cx={2} cy={2} r={2.3} fill="url(#pa-dome)" opacity={0.4} />
        </g>
      );
    case "battery-aa":
      return (
        <g>
          <path d={`M0 2 V0.6`} stroke="#d0312d" strokeWidth={0.22} fill="none" />
          <path d={`M${span} 2 V0.6`} stroke="#1a1a1a" strokeWidth={0.22} fill="none" />
          <rect x={-0.4} y={-5.6} width={span + 0.8} height={6.4} rx={0.3} fill="#1b1e21" />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={0.1} y={-5.2 + i * 1.5} width={span - 0.2} height={1.2} rx={0.5} fill="#2f6b3b" />
              <rect x={i % 2 ? 0.1 : span - 1.7} y={-5.2 + i * 1.5} width={1.6} height={1.2} rx={0.4} fill="url(#pa-metal)" />
            </g>
          ))}
          <Txt x={span / 2} y={0.55} s={0.5}>4 × AA · {Number(c.props.volts ?? 6)} V</Txt>
        </g>
      );
    case "coin-cell":
      return (
        <g>
          <Leg x1={0} y1={2} x2={0.8} y2={1.2} /><Leg x1={span} y1={2} x2={span - 0.8} y2={1.2} />
          <circle cx={3} cy={-0.4} r={2.6} fill="#1b1e21" />
          <circle cx={3} cy={-0.4} r={2.1} fill="url(#pa-metal)" stroke="#7d868f" strokeWidth={0.08} />
          <Txt x={3} y={-0.6} s={0.55} fill="#30363c">CR2032</Txt>
          <Txt x={3} y={0.2} s={0.55} fill="#30363c">3V +</Txt>
        </g>
      );
    case "battery": {
      const v = Number(c.props.volts ?? 9);
      return (
        <g>
          <path d={`M0 2 V1.2`} stroke="#d0312d" strokeWidth={0.22} /><path d={`M${span} 2 V1.2`} stroke="#1a1a1a" strokeWidth={0.22} />
          <rect x={0.4} y={-3.2} width={span - 0.8} height={4.4} rx={0.35} fill="#1b1e21" />
          <rect x={0.4} y={-3.2} width={(span - 0.8) * 0.38} height={4.4} rx={0.35} fill="#b87333" />
          <rect x={span * 0.28} y={-3.6} width={0.9} height={0.6} rx={0.2} fill="url(#pa-metal)" />
          <rect x={span * 0.62} y={-3.6} width={0.9} height={0.6} rx={0.2} fill="url(#pa-metal)" />
          <Txt x={span * 0.62} y={-0.6} s={1.1}>{v} V</Txt>
          <Sheen x={0.4} y={-3.2} w={span - 0.8} h={4.4} rx={0.35} />
        </g>
      );
    }
    case "motor":
      return (
        <g>
          <path d="M0 2 V1.4" stroke="#d0312d" strokeWidth={0.2} /><path d={`M${span} 2 V1.4`} stroke="#1a1a1a" strokeWidth={0.2} />
          <rect x={0.8} y={-2.8} width={span - 1.6} height={4.2} rx={0.6} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <rect x={span - 1.6} y={-2.4} width={0.9} height={3.4} rx={0.3} fill="#c9a227" opacity={0.85} />
          <rect x={span - 0.7} y={-1.05} width={1.4} height={0.3} fill="#d7dce1" />
          <Txt x={span / 2 - 0.4} y={-0.4} s={0.7} fill="#30363c">{Number(c.props.volts ?? 6)} V DC</Txt>
        </g>
      );
    case "coreless-motor": {
      const size = String(c.props.size ?? "8520");
      return (
        <g>
          <path d="M0 2 V1.3" stroke="#d0312d" strokeWidth={0.18} /><path d={`M${span} 2 V1.3`} stroke="#2f6fd6" strokeWidth={0.18} />
          <rect x={1.2} y={-2.2} width={span - 2.4} height={3.4} rx={0.5} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <rect x={span / 2 - 0.12} y={-3.4} width={0.24} height={1.2} fill="#d7dce1" />
          <Txt x={span / 2} y={-0.2} s={0.6} fill="#30363c">{size}</Txt>
          <Txt x={span / 2} y={0.75} s={0.45} fill="#30363c">{Number(c.props.volts ?? 3.7)} V</Txt>
        </g>
      );
    }
    case "lipo-1s":
      return (
        <g>
          <path d="M0 2 V0.9" stroke="#d0312d" strokeWidth={0.2} /><path d={`M${span} 2 V0.9`} stroke="#1a1a1a" strokeWidth={0.2} />
          <rect x={0.4} y={-2.4} width={span - 0.8} height={3.4} rx={0.3} fill="#b9c2ca" />
          <rect x={0.4} y={-2.4} width={span - 0.8} height={0.9} rx={0.3} fill="#e8b33a" />
          <Txt x={span / 2} y={-0.4} s={0.75} fill="#1b1e21">1S {Number(c.props.volts ?? 3.7)} V</Txt>
          <Txt x={span / 2} y={0.65} s={0.45} fill="#1b1e21">{Number(c.props.capacity ?? 300)} mAh {Number(c.props.crating ?? 25)}C</Txt>
          <Sheen x={0.4} y={-2.4} w={span - 0.8} h={3.4} rx={0.3} />
        </g>
      );
    case "vibration-motor":
      return (
        <g>
          <path d="M0 2 Q0.5 0.5 2 -0.2" stroke="#d0312d" strokeWidth={0.16} fill="none" />
          <path d={`M${span} 2 Q${span - 0.5} 0.5 ${span - 2} -0.2`} stroke="#2f6fd6" strokeWidth={0.16} fill="none" />
          <circle cx={span / 2} cy={-1} r={1.9} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <circle cx={span / 2} cy={-1} r={1.2} fill="none" stroke="#8e979f" strokeWidth={0.06} />
        </g>
      );
    default:
      return <g><Leg x1={0} y1={2} x2={span} y2={2} /><rect x={span / 2 - 1.2} y={1} width={2.4} height={2} rx={0.3} fill="#2a3138" /><Txt x={span / 2} y={2.2} s={0.5}>{def.name.slice(0, 6)}</Txt></g>;
  }
}

/** Legs from the body down to the pins along the bottom edge. */
const Legs = ({ xs, from, to }: { xs: number[]; from: number; to: number }) => <>{xs.map((x) => <Leg key={x} x1={x} y1={from} x2={x} y2={to} />)}</>;

function moduleArt(c: CircuitComponent, w: number, h: number, n: number, pinXs: number[]): ReactNode {
  switch (c.type) {
    case "npn": case "pnp": case "tmp36":
      return (
        <g>
          <Legs xs={pinXs} from={2.6} to={h} />
          <path d="M0.6 2.8 V1.2 A2.4 1.6 0 0 1 5.4 1.2 V2.8 Z" fill="#1b1e21" />
          <Sheen x={0.6} y={-0.4} w={4.8} h={3.2} rx={1} />
          <Txt x={3} y={2.2} s={0.6}>{c.type === "tmp36" ? "TMP36" : c.type.toUpperCase()}</Txt>
        </g>
      );
    case "mosfet":
      return (
        <g>
          <Legs xs={pinXs} from={4} to={h} />
          <rect x={0.5} y={-1.6} width={5} height={2.4} rx={0.2} fill="url(#pa-metal)" />
          <circle cx={3} cy={-0.5} r={0.6} fill="#0b0e10" />
          <rect x={0.5} y={0.6} width={5} height={3.6} rx={0.2} fill="#1b1e21" />
          <Txt x={3} y={2.7} s={0.55}>N-FET</Txt>
        </g>
      );
    case "potentiometer": {
      const pos = Math.min(1, Math.max(0, Number(c.props.position ?? 0.5)));
      const ang = (-135 + 270 * pos) * (Math.PI / 180);
      return (
        <g>
          <Legs xs={pinXs} from={4} to={h} />
          <rect x={0.4} y={0} width={5.2} height={4.6} rx={0.4} fill="#2a5db0" />
          <circle cx={3} cy={2.2} r={2} fill="url(#pa-metal)" stroke="#5b636b" strokeWidth={0.08} />
          <circle cx={3} cy={2.2} r={1.35} fill="#1b1e21" />
          <line x1={3} y1={2.2} x2={3 + Math.sin(ang) * 1.2} y2={2.2 - Math.cos(ang) * 1.2} stroke="#f4f6f8" strokeWidth={0.22} strokeLinecap="round" />
        </g>
      );
    }
    case "rgb-led":
      return (
        <g>
          <Legs xs={pinXs} from={3.6} to={h} />
          <path d="M1.6 3.9 V2.2 A2.4 2.4 0 0 1 6.4 2.2 V3.9 Z" fill="#e9eef2" opacity={0.85} stroke="#9aa5ae" strokeWidth={0.06} />
          <circle cx={3.2} cy={2.4} r={0.35} fill="#ff3b3b" /><circle cx={4} cy={2.1} r={0.35} fill="#2fdc6a" /><circle cx={4.8} cy={2.4} r={0.35} fill="#3d7bff" />
          <path d="M1.6 3.9 V2.2 A2.4 2.4 0 0 1 6.4 2.2 V3.9 Z" fill="url(#pa-dome)" />
        </g>
      );
    case "servo":
      return (
        <g>
          <path d={`M${pinXs[0]} ${h} V6 M${pinXs[1]} ${h} V6 M${pinXs[2]} ${h} V6`} stroke="none" />
          {[["#6b3a1a", 0], ["#d0312d", 1], ["#f08a1c", 2]].map(([col, i]) => <path key={i} d={`M${pinXs[i as number]} ${h} C${pinXs[i as number]} 6.5 ${6.4 + (i as number) * 0.4} 6.2 ${6.4 + (i as number) * 0.4} 5.2`} stroke={col as string} strokeWidth={0.28} fill="none" />)}
          <rect x={0.2} y={1.6} width={w - 0.4} height={1.2} rx={0.2} fill="#2a64c9" />
          <circle cx={0.9} cy={2.2} r={0.3} fill="#0b0e10" /><circle cx={w - 0.9} cy={2.2} r={0.3} fill="#0b0e10" />
          <rect x={2} y={0} width={w - 4} height={5.4} rx={0.4} fill="#2f6fd6" opacity={0.95} />
          <Sheen x={2} y={0} w={w - 4} h={5.4} rx={0.4} />
          <circle cx={4.6} cy={2.6} r={1.5} fill="#e9eef2" />
          <path d="M4.6 1.9 L10 2.25 L10 2.95 L4.6 3.3 Z" fill="#f4f6f8" stroke="#b9c0c7" strokeWidth={0.05} />
          <circle cx={4.6} cy={2.6} r={0.35} fill="#9aa5ae" />
          <Txt x={9.8} y={4.6} s={0.55}>micro servo</Txt>
        </g>
      );
    case "oled-i2c":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f4fa8" />
          <rect x={0.9} y={1.6} width={w - 1.8} height={5.6} rx={0.2} fill="#05080a" />
          <Txt x={w / 2} y={3.6} s={0.75} fill="#7fd8ff" mono>HELLO</Txt>
          <Txt x={w / 2} y={4.9} s={0.75} fill="#7fd8ff" mono>(o_o)</Txt>
          <Txt x={w / 2} y={6.6} s={0.45} fill="#7fd8ff" mono>128x64</Txt>
        </g>
      );
    case "seven-segment": {
      const seg = (d: string, k: number) => <path key={k} d={d} fill="#ff3b3b" opacity={0.85} />;
      const ox = w / 2 - 2.4, oy = 0.8;
      return (
        <g>
          <Legs xs={pinXs} from={10.6} to={h} />
          <rect x={w / 2 - 4.2} y={0} width={8.4} height={10.6} rx={0.3} fill="#e9eef2" />
          <rect x={w / 2 - 3.8} y={0.3} width={7.6} height={10} rx={0.2} fill="#1b1e21" />
          {[
            `M${ox + 0.6} ${oy} h3.2 l-0.4 0.6 h-2.4 Z`, `M${ox + 4} ${oy + 0.3} v3.8 l-0.6 0.3 v-3.4 Z`, `M${ox + 4} ${oy + 4.8} v3.8 l-0.6 -0.4 v-3.1 Z`,
            `M${ox + 0.6} ${oy + 9} h3.2 l-0.4 -0.6 h-2.4 Z`, `M${ox + 0.2} ${oy + 4.8} v3.8 l0.6 -0.4 v-3.1 Z`, `M${ox + 0.2} ${oy + 0.3} v3.8 l0.6 0.3 v-3.4 Z`,
            `M${ox + 0.7} ${oy + 4.5} h3 l-0.3 0.3 h-2.4 Z`,
          ].map(seg)}
          <circle cx={ox + 5} cy={oy + 9} r={0.35} fill="#ff3b3b" opacity={0.85} />
        </g>
      );
    }
    case "neopixel-ring": {
      const cx = w / 2, cy = 5.2;
      const cols = ["#ff3b3b", "#ff9d1c", "#ffd400", "#2fdc6a", "#22b8c9", "#3d7bff", "#8a4fcf", "#e86fa5", "#ff3b3b", "#ffd400", "#2fdc6a", "#3d7bff"];
      return (
        <g>
          <Legs xs={pinXs} from={9.6} to={h} />
          <circle cx={cx} cy={cy} r={5} fill="#15181b" />
          <circle cx={cx} cy={cy} r={2.9} fill="#1c1f22" stroke="#0b0e10" strokeWidth={0.1} />
          <circle cx={cx} cy={cy} r={2.2} fill="var(--bg, #0e1114)" />
          {cols.map((col, i) => {
            const a = (i / 12) * Math.PI * 2;
            const x = cx + Math.sin(a) * 3.95, y = cy - Math.cos(a) * 3.95;
            return <g key={i}><rect x={x - 0.6} y={y - 0.6} width={1.2} height={1.2} rx={0.15} fill="#f4f6f8" /><circle cx={x} cy={y} r={0.38} fill={col} /></g>;
          })}
        </g>
      );
    }
    case "lcd-i2c":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f7a3a" />
          <rect x={1.6} y={1.2} width={w - 3.2} height={7.6} rx={0.3} fill="#15181b" />
          <rect x={2.4} y={2.2} width={w - 4.8} height={5.4} rx={0.2} fill="#9bd14b" />
          <Txt x={3} y={4.3} s={1.2} fill="#24420f" anchor="start" mono>Hello, maker!</Txt>
          <Txt x={3} y={6.6} s={1.2} fill="#24420f" anchor="start" mono>16x2 LCD  I2C</Txt>
        </g>
      );
    case "ultrasonic":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f57b8" />
          {[4.5, w - 4.5].map((x) => (
            <g key={x}>
              <circle cx={x} cy={4.2} r={3.3} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
              <circle cx={x} cy={4.2} r={2.5} fill="url(#pa-mesh)" />
            </g>
          ))}
          <rect x={w / 2 - 0.9} y={1.2} width={1.8} height={0.8} rx={0.3} fill="url(#pa-metal)" />
          <Txt x={w / 2} y={7.6} s={0.6}>T        R</Txt>
        </g>
      );
    case "pir":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f7a3a" />
          <circle cx={w / 2} cy={5.4} r={4.6} fill="#f2f2ef" stroke="#c8c8c2" strokeWidth={0.1} />
          {[3.6, 2.6, 1.6].map((r) => <circle key={r} cx={w / 2} cy={5.4} r={r} fill="none" stroke="#d6d6d0" strokeWidth={0.12} />)}
          <path d={`M${w / 2 - 4.6} 5.4 H${w / 2 + 4.6} M${w / 2} 0.8 V10`} stroke="#d6d6d0" strokeWidth={0.12} />
          <circle cx={w / 2} cy={5.4} r={4.6} fill="url(#pa-dome)" opacity={0.6} />
        </g>
      );
    case "tof-vl53l1x":
      return (
        <g>
          <Legs xs={pinXs} from={7.6} to={h} />
          <Pcb w={w} h={8} color="#1f4fa8" />
          <rect x={w / 2 - 1.4} y={2.6} width={2.8} height={2} rx={0.3} fill="#16181b" />
          <circle cx={w / 2 - 0.6} cy={3.6} r={0.35} fill="#7a2f8f" /><circle cx={w / 2 + 0.6} cy={3.6} r={0.35} fill="#7a2f8f" />
          <Txt x={w / 2} y={6.4} s={0.5}>VL53L1X</Txt>
        </g>
      );
    case "esc":
      return (
        <g>
          <Legs xs={pinXs} from={7.4} to={h} />
          <rect x={0.4} y={0.4} width={w - 0.8} height={7.2} rx={0.8} fill="#2a2f35" />
          <rect x={1.2} y={1.4} width={w - 2.4} height={3} rx={0.3} fill="#3a7bd5" opacity={0.8} />
          <Txt x={w / 2} y={3.3} s={0.8}>ESC</Txt>
          <Txt x={w / 2} y={6} s={0.55} fill="#c7ccd1">{Number(c.props.amps ?? 30)} A</Txt>
        </g>
      );
    case "brushless-motor":
      return (
        <g>
          <Legs xs={pinXs} from={7.4} to={h} />
          <circle cx={w / 2} cy={3.8} r={3.6} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.1} />
          <circle cx={w / 2} cy={3.8} r={1.6} fill="#c0392b" />
          <circle cx={w / 2} cy={3.8} r={0.4} fill="#d7dce1" />
          <Txt x={w / 2} y={-0.4} s={0.5} fill="var(--text-muted)">{Number(c.props.kv ?? 2400)} KV</Txt>
        </g>
      );
    case "imu-mpu6050":
      return (
        <g>
          <Legs xs={pinXs} from={7.6} to={h} />
          <Pcb w={w} h={8} color="#1f4fa8" />
          <rect x={w / 2 - 1.6} y={2.4} width={3.2} height={3.2} rx={0.2} fill="#16181b" />
          <Txt x={w / 2} y={4.25} s={0.45} fill="#c7ccd1">MPU</Txt>
          <Txt x={w / 2} y={4.85} s={0.4} fill="#c7ccd1">6050</Txt>
          <Txt x={2.6} y={1.6} s={0.55}>GY-521</Txt>
          <path d={`M${w - 3.2} 2.6 h2 M${w - 2.2} 1.6 v2`} stroke="#f4f6f8" strokeWidth={0.12} />
          <Txt x={w - 2.2} y={5.2} s={0.4}>X Y</Txt>
        </g>
      );
    case "dht11":
      return (
        <g>
          <Legs xs={pinXs} from={8.4} to={h} />
          <rect x={0.8} y={0} width={w - 1.6} height={8.6} rx={0.4} fill="#2f8fd8" />
          {Array.from({ length: 4 }, (_, r) => Array.from({ length: 3 }, (_, k) => <rect key={`${r}-${k}`} x={1.6 + k * 1.75} y={0.8 + r * 1.6} width={1.2} height={1.0} rx={0.15} fill="#1b4f7a" />))}
          <Txt x={w / 2} y={7.9} s={0.55}>DHT11</Txt>
          <Sheen x={0.8} y={0} w={w - 1.6} h={8.6} rx={0.4} />
        </g>
      );
    case "soil-moisture":
      return (
        <g>
          <rect x={0.6} y={0} width={2.4} height={11} rx={0.2} fill="#1f57b8" />
          <rect x={w - 3} y={0} width={2.4} height={11} rx={0.2} fill="#1f57b8" />
          <path d="M0.6 0 h2.4 l-1.2 -1.5 Z" fill="#1f57b8" /><path d={`M${w - 3} 0 h2.4 l-1.2 -1.5 Z`} fill="#1f57b8" />
          <rect x={1.3} y={0.5} width={1} height={10} fill="#c9a227" opacity={0.9} />
          <rect x={w - 2.3} y={0.5} width={1} height={10} fill="#c9a227" opacity={0.9} />
          <rect x={0} y={10.4} width={w} height={h - 10.8} rx={0.3} fill="#1f57b8" />
          <Txt x={w / 2} y={13} s={0.55}>SOIL</Txt>
        </g>
      );
    case "ir-receiver":
      return (
        <g>
          <Legs xs={pinXs} from={3.8} to={h} />
          <rect x={0.6} y={0.6} width={4.8} height={3.4} rx={0.3} fill="#1b1e21" />
          <circle cx={3} cy={2.1} r={1.25} fill="#2a2e33" />
          <circle cx={3} cy={2.1} r={1.25} fill="url(#pa-dome)" opacity={0.6} />
        </g>
      );
    case "gas-sensor":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f57b8" />
          <circle cx={w / 2} cy={4.4} r={3.7} fill="#c96f1c" />
          <circle cx={w / 2} cy={4.4} r={3.0} fill="url(#pa-mesh)" stroke="url(#pa-metal)" strokeWidth={0.3} />
          <Txt x={w / 2} y={8.8} s={0.55}>MQ-2</Txt>
        </g>
      );
    case "joystick":
      return (
        <g>
          <Pcb w={w} h={h} color="#2b2f33" />
          <rect x={1.8} y={0.8} width={w - 3.6} height={8.4} rx={0.4} fill="#15181b" />
          <circle cx={w / 2} cy={5} r={3.4} fill="#30353b" stroke="#0b0e10" strokeWidth={0.1} />
          {Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2; return <circle key={i} cx={w / 2 + Math.cos(a) * 2.6} cy={5 + Math.sin(a) * 2.6} r={0.22} fill="#1b1e21" />; })}
          <circle cx={w / 2} cy={5} r={3.4} fill="url(#pa-dome)" opacity={0.5} />
        </g>
      );
    case "keypad": {
      const keys = ["1", "2", "3", "A", "4", "5", "6", "B", "7", "8", "9", "C", "*", "0", "#", "D"];
      return (
        <g>
          {pinXs.map((x, i) => <rect key={i} x={x - 0.45} y={14.6} width={0.9} height={h - 14.6} fill={["#1a1a1a", "#7a4a1e", "#d0312d", "#f08a1c", "#f2d21b", "#2e9e45", "#2f6fd6", "#8a4fcf"][i]} opacity={0.85} />)}
          <rect x={0.4} y={0} width={w - 0.8} height={15} rx={0.4} fill="#16191c" />
          {keys.map((k, i) => {
            const x = 1.2 + (i % 4) * 4, y = 0.8 + Math.floor(i / 4) * 3.5;
            const fn = "ABCD".includes(k);
            return <g key={k}><rect x={x} y={y} width={3.2} height={2.8} rx={0.4} fill={fn ? "#d0312d" : k === "*" || k === "#" ? "#2f6fd6" : "#f2f2ef"} /><Txt x={x + 1.6} y={y + 1.85} s={1.1} fill={fn || k === "*" || k === "#" ? "#fff" : "#1b1e21"}>{k}</Txt></g>;
          })}
        </g>
      );
    }
    case "tft-ili9341":
      return (
        <g>
          <Pcb w={w} h={h} color="#b3242c" />
          <rect x={2} y={1.2} width={w - 4} height={h - 5.6} rx={0.3} fill="#050607" stroke="#2a2e33" strokeWidth={0.1} />
          <rect x={2.8} y={1.9} width={w - 5.6} height={h - 7.2} fill="#0d1a26" />
          <rect x={2.8} y={1.9} width={w - 5.6} height={h - 7.2} fill="url(#pa-dome)" opacity={0.25} />
          <Txt x={w / 2} y={h / 2 - 1} s={0.9} fill="#7fd8ff" mono>320 × 240</Txt>
          <Txt x={w / 2} y={h / 2 + 0.4} s={0.6} fill="#7fd8ff" mono>ILI9341</Txt>
          <rect x={w / 2 - 4} y={h - 4.2} width={8} height={1} fill="#c98a1e" opacity={0.9} />
        </g>
      );
    case "sd-module":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f57b8" />
          <rect x={2.5} y={1} width={9} height={7.2} rx={0.3} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <rect x={3.5} y={2} width={7} height={5.2} rx={0.2} fill="#1b1e21" />
          <Txt x={7} y={5} s={0.7} fill="#9aa5ae">microSD</Txt>
        </g>
      );
    case "i2s-amp":
      return (
        <g>
          <Pcb w={w} h={h} color="#2b2f6b" holes={false} />
          <rect x={w / 2 - 2.6} y={1.6} width={3.4} height={3.4} rx={0.2} fill="#15181b" />
          <Txt x={w / 2 - 0.9} y={3.5} s={0.45} fill="#9aa5ae">98357</Txt>
          <rect x={w - 5} y={0.8} width={4.2} height={4} rx={0.2} fill="#2e9e45" />
          <circle cx={w - 3.9} cy={2.8} r={0.6} fill="url(#pa-metal)" /><circle cx={w - 1.9} cy={2.8} r={0.6} fill="url(#pa-metal)" />
          <Txt x={4} y={3.4} s={0.55}>I²S AMP</Txt>
        </g>
      );
    case "relay":
      return (
        <g>
          <Pcb w={w} h={h} color="#1f57b8" />
          <rect x={5.2} y={0.9} width={w - 6} height={6.4} rx={0.3} fill="#2f6fd6" stroke="#163466" strokeWidth={0.1} />
          <Sheen x={5.2} y={0.9} w={w - 6} h={6.4} />
          <Txt x={5.2 + (w - 6) / 2} y={3.6} s={0.6}>RELAY</Txt>
          <Txt x={5.2 + (w - 6) / 2} y={4.6} s={0.5}>5 V coil</Txt>
          <circle cx={2} cy={4} r={0.45} fill="#d0312d" />
          <rect x={0.8} y={5.2} width={3} height={1.4} rx={0.2} fill="#1b1e21" />
        </g>
      );
    case "motor-driver":
      return (
        <g>
          <Pcb w={w} h={h} color="#b8252d" />
          <rect x={w / 2 - 4} y={0.4} width={8} height={7.2} fill="#15181b" />
          {Array.from({ length: 7 }, (_, i) => <rect key={i} x={w / 2 - 3.6 + i * 1.15} y={0.6} width={0.5} height={6.8} fill="#2b2f33" />)}
          {[1.2, w - 4.2].map((x) => <g key={x}><rect x={x} y={2.2} width={3} height={5} rx={0.2} fill="#2f6fd6" /><circle cx={x + 1.5} cy={3.6} r={0.5} fill="url(#pa-metal)" /><circle cx={x + 1.5} cy={5.6} r={0.5} fill="url(#pa-metal)" /></g>)}
          <Txt x={w / 2} y={9.5} s={0.7}>L298N DUAL H-BRIDGE</Txt>
          <rect x={w / 2 - 3} y={10.2} width={6} height={1.5} rx={0.2} fill="#2f6fd6" />
        </g>
      );
    default:
      return <g><Pcb w={w} h={h} color="#1f4f3a" /></g>;
  }
}

function boardArt(def: ComponentDef, w: number, h: number): ReactNode {
  const headers = (
    <>
      <rect x={-0.55} y={1} width={1.1} height={h - 2} rx={0.15} fill="#15181b" />
      {def.id !== "m5stack-cores3" && <rect x={w - 0.55} y={1} width={1.1} height={h - 2} rx={0.15} fill="#15181b" />}
    </>
  );
  switch (def.id) {
    case "arduino-uno-r3":
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={0.8} fill="#0b7a8a" stroke="#05363d" strokeWidth={0.12} />
          <Sheen x={0} y={0} w={w} h={h} rx={0.8} />
          <rect x={3.6} y={-1.6} width={4.6} height={4.2} rx={0.2} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <rect x={9.4} y={-1.2} width={3.6} height={4.4} rx={0.3} fill="#15181b" />
          <rect x={6.2} y={h * 0.42} width={3.6} height={h * 0.46} rx={0.2} fill="#15181b" />
          <circle cx={8} cy={h * 0.42 + 0.6} r={0.35} fill="#2b2f33" />
          {Array.from({ length: 14 }, (_, i) => <g key={i}><rect x={5.8} y={h * 0.42 + 0.5 + i * (h * 0.46 - 1) / 13} width={0.4} height={0.3} fill={LEG} /><rect x={9.8} y={h * 0.42 + 0.5 + i * (h * 0.46 - 1) / 13} width={0.4} height={0.3} fill={LEG} /></g>)}
          <ellipse cx={8} cy={h * 0.36} rx={1} ry={0.45} fill="url(#pa-metal)" />
          <rect x={4.8} y={5.6} width={1.2} height={1.2} rx={0.2} fill="url(#pa-metal)" /><circle cx={5.4} cy={6.2} r={0.4} fill="#d0312d" />
          <Txt x={8} y={h * 0.25} s={1.4}>UNO</Txt>
          <Txt x={8} y={h * 0.25 + 1.1} s={0.6} fill="#bfe6eb">R3</Txt>
          {headers}
        </g>
      );
    case "raspberry-pi-pico":
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={0.5} fill="#1f8a43" stroke="#0c3d1d" strokeWidth={0.12} />
          <Sheen x={0} y={0} w={w} h={h} rx={0.5} />
          <rect x={6.4} y={-0.8} width={3.2} height={2.4} rx={0.3} fill="url(#pa-metal)" />
          <rect x={w / 2 - 2.4} y={h / 2 - 2.4} width={4.8} height={4.8} rx={0.2} fill="#15181b" />
          <Txt x={w / 2} y={h / 2 + 0.25} s={0.55} fill="#9aa5ae">RP2040</Txt>
          <rect x={w / 2 - 1.6} y={h * 0.22} width={3.2} height={1.6} rx={0.2} fill="#15181b" />
          <circle cx={w / 2} cy={h * 0.14} r={0.7} fill="#f2f2ef" stroke="#9aa5ae" strokeWidth={0.08} />
          <Txt x={w / 2} y={h * 0.8} s={0.7}>Pico</Txt>
          {headers}
        </g>
      );
    case "xiao-esp32s3-sense": {
      // Front: black PCB, silver shield over the ESP32-S3, USB-C at the top, castellated pads.
      // The Sense camera board stacks on the back; its camera module and lens stick out above.
      const pads = Array.from({ length: 7 }, (_, i) => 2 + i * 2);
      return (
        <g>
          <rect x={4.6} y={-6.2} width={6.8} height={5.2} rx={0.4} fill="#1b1e21" />
          <rect x={5.6} y={-5.6} width={4.8} height={4.0} rx={0.3} fill="#2b2f33" stroke="#0b0d10" strokeWidth={0.1} />
          <circle cx={8} cy={-3.6} r={1.55} fill="#0b0d10" stroke="url(#pa-metal)" strokeWidth={0.35} />
          <circle cx={8} cy={-3.6} r={0.95} fill="#1a2440" />
          <circle cx={7.6} cy={-4} r={0.3} fill="#9fb4ff" opacity={0.8} />
          <rect x={7} y={-1.2} width={2} height={1.6} fill="#c98a1e" opacity={0.9} />
          <rect x={0} y={0} width={w} height={h} rx={0.9} fill="#15181b" stroke="#000" strokeWidth={0.12} />
          <Sheen x={0} y={0} w={w} h={h} rx={0.9} />
          {pads.flatMap((y) => [<path key={`l${y}`} d={`M0 ${y - 0.75} h0.9 a0.75 0.75 0 0 1 0 1.5 h-0.9 Z`} fill="url(#pa-gold)" />, <path key={`r${y}`} d={`M${w} ${y - 0.75} h-0.9 a0.75 0.75 0 0 0 0 1.5 h0.9 Z`} fill="url(#pa-gold)" />])}
          <rect x={5.6} y={-1} width={4.8} height={2.6} rx={0.9} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <rect x={6.6} y={-0.4} width={2.8} height={0.9} rx={0.45} fill="#20252a" />
          <rect x={3.4} y={3.2} width={9.2} height={7.6} rx={0.3} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <Txt x={8} y={6.6} s={0.75} fill="#30363c">ESP32-S3R8</Txt>
          <Txt x={8} y={7.7} s={0.45} fill="#5b636b">8MB · 8MB PSRAM</Txt>
          <rect x={3.4} y={11.6} width={1.4} height={1} rx={0.2} fill="#f2f2ef" /><rect x={11.2} y={11.6} width={1.4} height={1} rx={0.2} fill="#f2f2ef" />
          <circle cx={6.2} cy={12.1} r={0.3} fill="#ffb347" /><circle cx={9.8} cy={12.1} r={0.3} fill="#ff4d4d" />
          <path d={`M4.6 ${h - 2} h6.8`} stroke="#9aa5ae" strokeWidth={0.12} />
          <Txt x={8} y={h - 0.8} s={0.75}>XIAO S3 Sense</Txt>
        </g>
      );
    }
    case "esp32-s3-devkitc-1":
      return (
        <g>
          <rect x={0} y={0} width={w} height={h} rx={0.6} fill="#1b1e21" stroke="#000" strokeWidth={0.12} />
          <rect x={3.4} y={-2.8} width={9.2} height={3.4} rx={0.2} fill="#15181b" stroke="#2b2f33" strokeWidth={0.1} />
          <path d="M4 -2.2 h1.2 v2 h1.2 v-2 h1.2 v2 h1.2 v-2 h1.2 v2 h1.2 v-2" fill="none" stroke="#c9a227" strokeWidth={0.18} />
          <rect x={3.4} y={0.6} width={9.2} height={h * 0.42} rx={0.2} fill="url(#pa-metal)" stroke="#6b737b" strokeWidth={0.08} />
          <Txt x={w / 2} y={0.6 + h * 0.21} s={0.9} fill="#30363c">ESP32-S3</Txt>
          <Txt x={w / 2} y={0.6 + h * 0.21 + 1} s={0.5} fill="#5b636b">WROOM-1</Txt>
          {[4.6, 9.4].map((x) => <rect key={x} x={x} y={h - 1.4} width={2.2} height={2.2} rx={0.5} fill="url(#pa-metal)" />)}
          {[5, 10.4].map((x) => <rect key={x} x={x} y={h * 0.66} width={1.2} height={1.2} rx={0.2} fill="url(#pa-metal)" />)}
          <circle cx={8} cy={h * 0.6} r={0.45} fill="#f4f6f8" />
          {headers}
        </g>
      );
    case "m5stack-cores3":
      return (
        <g>
          <rect x={-0.4} y={0} width={4} height={h} rx={0.3} fill="#15181b" />
          <rect x={3.2} y={0} width={w - 3.2} height={Math.min(h, w + 2)} rx={1.2} fill="#30353b" stroke="#0b0e10" strokeWidth={0.12} />
          <rect x={4.4} y={1.6} width={w - 5.6} height={Math.min(h, w + 2) * 0.62} rx={0.3} fill="#05080a" />
          <circle cx={4.4 + (w - 5.6) * 0.33} cy={1.6 + Math.min(h, w + 2) * 0.27} r={0.9} fill="#7fd8ff" />
          <circle cx={4.4 + (w - 5.6) * 0.67} cy={1.6 + Math.min(h, w + 2) * 0.27} r={0.9} fill="#7fd8ff" />
          <path d={`M${4.4 + (w - 5.6) * 0.38} ${1.6 + Math.min(h, w + 2) * 0.45} q${(w - 5.6) * 0.12} 1 ${(w - 5.6) * 0.24} 0`} stroke="#7fd8ff" strokeWidth={0.3} fill="none" strokeLinecap="round" />
          <Txt x={3.2 + (w - 3.2) / 2} y={Math.min(h, w + 2) - 1} s={0.7} fill="#9aa5ae">CoreS3</Txt>
        </g>
      );
    default:
      return <rect x={0} y={0} width={w} height={h} rx={0.8} fill="#232a33" />;
  }
}

function breadboardArt(w: number, h: number, columns: number): ReactNode {
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={0.6} fill="#ecebe4" stroke="#c9c7bc" strokeWidth={0.1} />
      <rect x={0.3} y={9.1} width={w - 0.6} height={0.8} rx={0.2} fill="#d5d3c8" />
      <line x1={1.2} y1={0.35} x2={w - 1.2} y2={0.35} stroke="#d0312d" strokeWidth={0.12} />
      <line x1={1.2} y1={2.65} x2={w - 1.2} y2={2.65} stroke="#2f6fd6" strokeWidth={0.12} />
      <line x1={1.2} y1={16.35} x2={w - 1.2} y2={16.35} stroke="#2f6fd6" strokeWidth={0.12} />
      <line x1={1.2} y1={18.65} x2={w - 1.2} y2={18.65} stroke="#d0312d" strokeWidth={0.12} />
      <Txt x={0.6} y={1.25} s={0.6} fill="#d0312d">+</Txt><Txt x={0.6} y={2.3} s={0.6} fill="#2f6fd6">−</Txt>
      <Txt x={0.6} y={17.3} s={0.6} fill="#2f6fd6">−</Txt><Txt x={0.6} y={18.3} s={0.6} fill="#d0312d">+</Txt>
      {"abcdefghij".split("").map((r, i) => <Txt key={r} x={1.1} y={(i < 5 ? 4 + i : 6 + i) + 0.22} s={0.5} fill="#8a887d">{r}</Txt>)}
      {Array.from({ length: columns }, (_, i) => i + 1).filter((col) => col === 1 || col % 5 === 0).map((col) => (
        <g key={col}><Txt x={1 + col} y={3.3} s={0.45} fill="#8a887d">{col}</Txt><Txt x={1 + col} y={16.1} s={0.45} fill="#8a887d">{col}</Txt></g>
      ))}
    </g>
  );
}

/** Light from an LED, sized and faded by its simulated current (full at about 20 mA). */
function Glow({ cx, cy, color, current }: { cx: number; cy: number; color: string; current: number }) {
  const k = Math.min(1, Math.max(0, current / 0.02));
  if (k < 0.01) return null;
  return (
    <g pointerEvents="none" data-testid="led-glow">
      <circle cx={cx} cy={cy} r={1.2 + 2.6 * k} fill={color} opacity={0.18 + 0.3 * k} style={{ filter: "blur(0.6px)" }} />
      <circle cx={cx} cy={cy} r={0.9} fill="#fff" opacity={0.25 + 0.6 * k} />
    </g>
  );
}

export function PartArt({ c, def, glow }: { c: CircuitComponent; def: ComponentDef; glow?: (pin?: string) => number }) {
  const art = <PartArtInner c={c} def={def} />;
  if (!glow) return art;
  const e = def.electrical;
  if (e.kind === "led") return <g>{art}<Glow cx={0.95} cy={0.2} color={LED_FILL[String(c.props.color ?? "red")] ?? "#ff3b3b"} current={glow()} /></g>;
  if (c.type === "rgb-led") return <g>{art}{[["R", "#ff3b3b", 3.2, 2.4], ["G", "#2fdc6a", 4, 2.1], ["B", "#3d7bff", 4.8, 2.4]].map(([pin, col, x, y]) => <Glow key={pin as string} cx={x as number} cy={y as number} color={col as string} current={glow(pin as string)} />)}</g>;
  if (c.type === "seven-segment") {
    const L = partLayout(c.type);
    const total = ["a", "b", "c", "d", "e", "f", "g", "DP"].reduce((n, p) => n + glow(p), 0);
    return <g>{art}<Glow cx={L.w / 2} cy={5} color="#ff3b3b" current={total / 3} /></g>;
  }
  return art;
}

function PartArtInner({ c, def }: { c: CircuitComponent; def: ComponentDef }) {
  const L = partLayout(c.type);
  const e = def.electrical;
  if (e.kind === "breadboard") return <>{breadboardArt(L.w, L.h, e.columns)}</>;
  if (e.kind === "board") return <>{boardArt(def, L.w, L.h)}</>;
  if (L.pins.length === 2) return <>{twoPin(c, def, L.w)}</>;
  const art = moduleArt(c, L.w, L.h, L.pins.length, L.pins.map((p) => p.x));
  const hasPcbHeader = ["tft-ili9341", "sd-module", "i2s-amp", "oled-i2c", "lcd-i2c", "ultrasonic", "pir", "gas-sensor", "joystick", "relay", "motor-driver", "soil-moisture"].includes(c.type);
  return <g>{art}{hasPcbHeader && <Header w={L.w} h={L.h} n={L.pins.length} />}</g>;
}

/**
 * How far each part's drawing reaches above its layout box (grid units), so its name can be
 * placed clear of it. Keep in step with the drawings above.
 */
export const ART_TOP: Record<string, number> = {
  "coreless-motor": 3.4, "lipo-1s": 2.4, "brushless-motor": 0.8, electrolytic: 2.6, "tilt-switch": 1.6, speaker: 1.4, "battery-aa": 5.6, "coin-cell": 0.6, battery: 3.6, motor: 2.8,
  "vibration-motor": 1.0, npn: 0.4, mosfet: 1.6, "arduino-uno-r3": 1.6, "raspberry-pi-pico": 0.8, "xiao-esp32s3-sense": 6.2, "esp32-s3-devkitc-1": 2.8,
};
