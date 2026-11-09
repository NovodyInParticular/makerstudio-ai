// Text shapes: turns characters into flat outlines using the bundled Noto Sans Bold font.

import { Vector2, type Shape } from "three";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import fontData from "./fonts/noto-sans-bold.typeface.json";

const font = new Font(fontData as never);
export const CURVE_SEGMENTS = 6;

/** Height of a capital "H" for a font size of 1, so "size" can mean real letter height in mm. */
const CAP_RATIO = (() => {
  const shapes = font.generateShapes("H", 1);
  let max = 0;
  for (const shape of shapes) for (const p of shape.getPoints()) max = Math.max(max, p.y);
  return max > 0 ? max : 0.714;
})();

export interface TextOutline {
  shapes: Shape[];
  /** Offset that centres the text on the origin. */
  offset: Vector2;
  width: number;
  height: number;
}

export function textOutline(text: string, size: number): TextOutline {
  const shapes = font.generateShapes(text, size / CAP_RATIO);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    for (const p of shape.getPoints(CURVE_SEGMENTS)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { shapes: [], offset: new Vector2(), width: 0, height: 0 };
  return { shapes, offset: new Vector2(-(minX + maxX) / 2, -(minY + maxY) / 2), width: maxX - minX, height: maxY - minY };
}

/** All outlines and holes as flat polygons (for the Boolean engine), already centred. */
export function textPolygons(text: string, size: number): [number, number][][] {
  const { shapes, offset } = textOutline(text, size);
  const polygons: [number, number][][] = [];
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(CURVE_SEGMENTS);
    for (const contour of [outer, ...holes]) {
      polygons.push(contour.map((p) => [p.x + offset.x, p.y + offset.y]));
    }
  }
  return polygons;
}

export function hasGlyphs(text: string): boolean {
  return textOutline(text, 10).shapes.length > 0;
}
