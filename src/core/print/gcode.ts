// Reads sliced G-code (Bambu Studio output) for the print preview: the summary in the header
// (time, filament, layers) and the extrusion paths, grouped by feature type and by layer so the
// preview can show layers 1..n of each feature with a single draw range.
//
// Coordinates stay in printer (bed) coordinates, millimetres.

export interface GcodeSummary {
  /** Total estimated print time in seconds, or null when the header does not say. */
  seconds: number | null;
  layers: number | null;
  filamentGrams: number | null;
  filamentMm: number | null;
  maxZ: number | null;
}

export interface FeaturePaths {
  name: string;
  /** Segment end points: x1 y1 z1 x2 y2 z2 per segment. */
  positions: Float32Array;
  /** layerEnds[i] = number of this feature's segments in layers 0..i. */
  layerEnds: Uint32Array;
}

export interface ToolpathPreview {
  features: FeaturePaths[];
  /** Height of each layer's top, mm. */
  layerZ: Float32Array;
  layerCount: number;
  segments: number;
  /** Set when the print was too big to preview whole: layers from here on are not shown. */
  truncatedAtLayer: number | null;
  /** Box around every previewed segment in printer coordinates (min x, y, z, max x, y, z), or null when there are none. */
  bounds: [number, number, number, number, number, number] | null;
}

export interface FeatureStyle {
  color: string;
  label: string;
}

/** Colours for the feature types Bambu Studio writes (`; FEATURE: ...`). Unknown types use OTHER_FEATURE. */
export const FEATURE_STYLES: Record<string, FeatureStyle> = {
  "Outer wall": { color: "#ff8a3d", label: "Outer wall" },
  "Inner wall": { color: "#ffd166", label: "Inner wall" },
  "Overhang wall": { color: "#4cc9f0", label: "Overhang wall" },
  "Sparse infill": { color: "#b5485d", label: "Infill" },
  "Internal solid infill": { color: "#9d6bff", label: "Solid infill" },
  "Top surface": { color: "#ff4d6d", label: "Top surface" },
  "Bottom surface": { color: "#7a8cff", label: "Bottom surface" },
  "Bridge": { color: "#3aa0ff", label: "Bridge" },
  "Internal Bridge": { color: "#3aa0ff", label: "Internal bridge" },
  "Gap infill": { color: "#f4f4f4", label: "Gap infill" },
  "Floating vertical shell": { color: "#c0a6ff", label: "Floating shell" },
  "Support": { color: "#2fd6a3", label: "Support" },
  "Support interface": { color: "#1f9e7a", label: "Support interface" },
  "Support transition": { color: "#6cdbb8", label: "Support transition" },
  "Skirt": { color: "#5ec8c8", label: "Skirt" },
  "Brim": { color: "#5ec8c8", label: "Brim" },
  "Ironing": { color: "#ff9ecf", label: "Ironing" },
  "Prime tower": { color: "#8a9199", label: "Prime tower" },
};
export const OTHER_FEATURE: FeatureStyle = { color: "#9aa5ae", label: "Other" };

export function featureStyle(name: string): FeatureStyle {
  return FEATURE_STYLES[name] ?? { ...OTHER_FEATURE, label: name || OTHER_FEATURE.label };
}

/** "1d 2h 3m 4s" (any of the parts) to seconds. */
export function parseDuration(text: string): number | null {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) {
    found = true;
    total += Number(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2] as "d" | "h" | "m" | "s"];
  }
  return found ? total : null;
}

/** Short human time: "45 s", "12 min", "3 h 05 min", "1 d 2 h". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const HEADER_LIMIT = 64 * 1024;

/** Reads the summary from the header block at the top of the G-code. */
export function readGcodeSummary(text: string): GcodeSummary {
  const head = text.slice(0, HEADER_LIMIT);
  const num = (re: RegExp) => {
    const m = head.match(re);
    return m ? Number(m[1]) : null;
  };
  // Bambu: "; model printing time: 11m 59s; total estimated time: 12m 18s" (both on one line).
  const time = head.match(/total estimated time:\s*([^\n;]+)/) ?? head.match(/^;\s*estimated printing time[^=:]*[=:]\s*([^\n;]+)/m);
  return {
    seconds: time ? parseDuration(time[1]!) : null,
    layers: num(/^;\s*total layer number:\s*(\d+)/m),
    filamentGrams: num(/^;\s*total filament weight \[g\]\s*:\s*([\d.]+)/m),
    filamentMm: num(/^;\s*total filament length \[mm\]\s*:\s*([\d.]+)/m),
    maxZ: num(/^;\s*max_z_height:\s*([\d.]+)/m),
  };
}

class Growable {
  data = new Float32Array(1 << 12);
  length = 0;
  push6(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (this.length + 6 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const o = this.length;
    this.data[o] = a; this.data[o + 1] = b; this.data[o + 2] = c;
    this.data[o + 3] = d; this.data[o + 4] = e; this.data[o + 5] = f;
    this.length += 6;
  }
}

interface FeatureBuild {
  name: string;
  buf: Growable;
  /** Segment counts at the end of each finished layer. */
  ends: number[];
}

/** Reads one letter's number from a G-code command line, or NaN. */
function word(line: string, letter: string): number {
  // Fast path: find " X" (commands are space separated); comments were cut off already.
  let i = line.indexOf(letter, 1);
  while (i > 0) {
    const before = line.charCodeAt(i - 1);
    if (before === 32 || before === 9) {
      let j = i + 1;
      while (j < line.length && line.charCodeAt(j) !== 32 && line.charCodeAt(j) !== 9) j++;
      return Number(line.slice(i + 1, j));
    }
    i = line.indexOf(letter, i + 1);
  }
  return NaN;
}

const DEFAULT_MAX_SEGMENTS = 3_000_000;
const ARC_STEP_MM = 0.5;

/**
 * Collects the extrusion moves after the machine start code, by feature and layer.
 * Moves before the first `; CHANGE_LAYER` (purge line, calibration) and after
 * `; MACHINE_END_GCODE_START` are left out, as slicers' own previews do.
 */
export function parseToolpaths(text: string, options: { maxSegments?: number } = {}): ToolpathPreview {
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const features = new Map<string, FeatureBuild>();
  const layerZ: number[] = [];
  let layer = -1;
  let feature: FeatureBuild | null = null;
  let featureName = "";
  let x = 0, y = 0, z = 0, e = 0;
  let absoluteXyz = true;
  let relativeE = false;
  let segments = 0;
  let truncatedAtLayer: number | null = null;
  let done = false;
  let b0 = Infinity, b1 = Infinity, b2 = Infinity, b3 = -Infinity, b4 = -Infinity, b5 = -Infinity;

  const featureFor = (name: string): FeatureBuild => {
    let f = features.get(name);
    if (!f) {
      f = { name, buf: new Growable(), ends: new Array<number>(Math.max(layer, 0)).fill(0) };
      features.set(name, f);
    }
    return f;
  };
  const endLayer = () => {
    if (layer < 0) return;
    for (const f of features.values()) {
      while (f.ends.length < layer) f.ends.push(f.ends.length ? f.ends[f.ends.length - 1]! : 0);
      f.ends.push(f.buf.length / 6);
    }
  };
  const addSegment = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    if (truncatedAtLayer !== null) return;
    if (segments >= maxSegments) {
      truncatedAtLayer = layer;
      return;
    }
    feature ??= featureFor(featureName);
    feature.buf.push6(x1, y1, z1, x2, y2, z2);
    segments++;
    if (x1 < b0) b0 = x1; if (x2 < b0) b0 = x2; if (y1 < b1) b1 = y1; if (y2 < b1) b1 = y2; if (z1 < b2) b2 = z1; if (z2 < b2) b2 = z2;
    if (x1 > b3) b3 = x1; if (x2 > b3) b3 = x2; if (y1 > b4) b4 = y1; if (y2 > b4) b4 = y2; if (z1 > b5) b5 = z1; if (z2 > b5) b5 = z2;
  };

  let start = 0;
  const n = text.length;
  while (start < n && !done) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = n;
    const first = text.charCodeAt(start);
    if (first === 59 /* ; */) {
      const line = text.slice(start, end);
      if (line.startsWith("; CHANGE_LAYER")) {
        endLayer();
        layer++;
        layerZ.push(z);
        feature = null; // features are looked up again per layer so `ends` stay aligned
        if (featureName) feature = featureFor(featureName);
      } else if (line.startsWith("; Z_HEIGHT:")) {
        if (layer >= 0) layerZ[layer] = Number(line.slice(11).trim());
      } else if (line.startsWith("; FEATURE:")) {
        featureName = line.slice(10).trim();
        feature = layer >= 0 ? featureFor(featureName) : null;
      } else if (line.startsWith("; MACHINE_END_GCODE_START")) {
        done = true;
      }
    } else if (first === 71 /* G */ || first === 77 /* M */) {
      let line = text.slice(start, end);
      const semi = line.indexOf(";");
      if (semi >= 0) line = line.slice(0, semi);
      line = line.trimEnd();
      const sp = line.indexOf(" ");
      const cmd = sp < 0 ? line : line.slice(0, sp);
      if (cmd === "G1" || cmd === "G0" || cmd === "G2" || cmd === "G3") {
        const wx = word(line, "X"), wy = word(line, "Y"), wz = word(line, "Z"), we = word(line, "E");
        const nx = Number.isNaN(wx) ? x : absoluteXyz ? wx : x + wx;
        const ny = Number.isNaN(wy) ? y : absoluteXyz ? wy : y + wy;
        const nz = Number.isNaN(wz) ? z : absoluteXyz ? wz : z + wz;
        let extruding = false;
        if (!Number.isNaN(we)) {
          extruding = relativeE ? we > 0 : we > e;
          e = relativeE ? e + we : we;
        }
        const moved = nx !== x || ny !== y;
        if (extruding && layer >= 0 && cmd !== "G0") {
          if (cmd === "G1") {
            if (moved) addSegment(x, y, z, nx, ny, nz);
          } else {
            const i = word(line, "I"), j = word(line, "J");
            if (!Number.isNaN(i) || !Number.isNaN(j)) arc(x, y, z, nx, ny, nz, Number.isNaN(i) ? 0 : i, Number.isNaN(j) ? 0 : j, cmd === "G2", addSegment);
            else if (moved) addSegment(x, y, z, nx, ny, nz);
          }
        }
        x = nx; y = ny; z = nz;
      } else if (cmd === "G90") absoluteXyz = true;
      else if (cmd === "G91") absoluteXyz = false;
      else if (cmd === "M82") relativeE = false;
      else if (cmd === "M83") relativeE = true;
      else if (cmd === "G92") {
        const we = word(line, "E");
        if (!Number.isNaN(we)) e = we;
        const wx = word(line, "X"), wy = word(line, "Y"), wz = word(line, "Z");
        if (!Number.isNaN(wx)) x = wx;
        if (!Number.isNaN(wy)) y = wy;
        if (!Number.isNaN(wz)) z = wz;
      }
    }
    start = end + 1;
  }
  endLayer();

  const layerCount = Math.max(layer + 1, 0);
  const out: FeaturePaths[] = [];
  for (const f of features.values()) {
    if (f.buf.length === 0) continue;
    while (f.ends.length < layerCount) f.ends.push(f.ends.length ? f.ends[f.ends.length - 1]! : 0);
    out.push({ name: f.name, positions: f.buf.data.slice(0, f.buf.length), layerEnds: Uint32Array.from(f.ends) });
  }
  const bounds: ToolpathPreview["bounds"] = segments > 0 ? [b0, b1, b2, b3, b4, b5] : null;
  return { features: out, layerZ: Float32Array.from(layerZ), layerCount, segments, truncatedAtLayer, bounds };
}

/** Splits an arc move into short straight segments. I/J are the centre's offset from the start. */
function arc(
  x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
  i: number, j: number, clockwise: boolean,
  add: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => void,
) {
  const cx = x1 + i, cy = y1 + j;
  const r = Math.hypot(i, j);
  if (r < 1e-6) {
    add(x1, y1, z1, x2, y2, z2);
    return;
  }
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let a2 = Math.atan2(y2 - cy, x2 - cx);
  let sweep = a2 - a1;
  const full = Math.abs(x2 - x1) < 1e-6 && Math.abs(y2 - y1) < 1e-6;
  if (full) sweep = clockwise ? -2 * Math.PI : 2 * Math.PI;
  else if (clockwise && sweep >= 0) sweep -= 2 * Math.PI;
  else if (!clockwise && sweep <= 0) sweep += 2 * Math.PI;
  a2 = a1 + sweep;
  const steps = Math.min(64, Math.max(2, Math.ceil((Math.abs(sweep) * r) / ARC_STEP_MM)));
  let px = x1, py = y1, pz = z1;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const a = a1 + sweep * t;
    const nx = k === steps && !full ? x2 : cx + r * Math.cos(a);
    const ny = k === steps && !full ? y2 : cy + r * Math.sin(a);
    const nz = z1 + (z2 - z1) * t;
    add(px, py, pz, nx, ny, nz);
    px = nx; py = ny; pz = nz;
  }
}

/** The highest layer index (0-based) whose top is at or below the given height. */
export function layerAtHeight(layerZ: Float32Array, height: number): number {
  let lo = 0, hi = layerZ.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (layerZ[mid]! <= height + 1e-6) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
