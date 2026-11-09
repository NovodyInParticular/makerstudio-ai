// One-time tool: converts a TrueType font into the JSON format three.js reads (typeface format).
// Usage: node scripts/make-font.mjs <font.ttf> <out.json>
// Only printable Latin characters are kept so the file stays small.
import opentype from "opentype.js";
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const font = opentype.parse(readFileSync(input).buffer);
const scale = 1000 / font.unitsPerEm;
const r = (n) => Math.round(n * scale);
const chars = [];
for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
for (let c = 160; c <= 255; c++) chars.push(String.fromCharCode(c));
chars.push("€", "°", "Ω", "µ", "±", "×");

const glyphs = {};
for (const ch of chars) {
  const glyph = font.charToGlyph(ch);
  if (!glyph || glyph.index === 0) continue;
  const parts = [];
  // Typeface format lists the end point first, then the control points.
  for (const cmd of glyph.path.commands) {
    if (cmd.type === "M") parts.push("m", r(cmd.x), r(cmd.y));
    else if (cmd.type === "L") parts.push("l", r(cmd.x), r(cmd.y));
    else if (cmd.type === "Q") parts.push("q", r(cmd.x), r(cmd.y), r(cmd.x1), r(cmd.y1));
    else if (cmd.type === "C") parts.push("b", r(cmd.x), r(cmd.y), r(cmd.x1), r(cmd.y1), r(cmd.x2), r(cmd.y2));
  }
  const box = glyph.getBoundingBox();
  glyphs[ch] = { ha: r(glyph.advanceWidth ?? 0), x_min: r(box.x1), x_max: r(box.x2), o: parts.join(" ") };
}

writeFileSync(output, JSON.stringify({
  glyphs,
  familyName: font.names.fontFamily?.en ?? "Font",
  ascender: r(font.ascender),
  descender: r(font.descender),
  underlinePosition: r(font.tables.post.underlinePosition),
  underlineThickness: r(font.tables.post.underlineThickness),
  boundingBox: { xMin: r(font.tables.head.xMin), yMin: r(font.tables.head.yMin), xMax: r(font.tables.head.xMax), yMax: r(font.tables.head.yMax) },
  resolution: 1000,
  original_font_information: { license: "SIL Open Font License 1.1 (see NotoSans-OFL.txt)", source: "Noto Sans Bold" },
}));
console.log(`${Object.keys(glyphs).length} glyphs written to ${output}`);
