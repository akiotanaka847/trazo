import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { ShapeKind } from "../shared/tools";

export interface Point {
  x: number;
  y: number;
}

/** A raw input sample: x, y and pen pressure (0 to 1). */
export type Sample = [number, number, number];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Base {
  color: string;
  width: number;
  box: Box;
}

/** Freehand ink, stored as the filled outline perfect-freehand computes around the samples. */
export interface InkStroke extends Base {
  kind: "ink";
  tool: "pen" | "highlighter";
  outline: Path2D;
}

/** Geometric shapes are stroked paths; arrows add a filled head. */
export interface ShapeStroke extends Base {
  kind: "shape";
  path: Path2D;
  head: Path2D | null;
}

export type Stroke = InkStroke | ShapeStroke;

const HIGHLIGHTER_ALPHA = 0.38;

function inkOptions(tool: InkStroke["tool"], width: number, realPressure: boolean, done: boolean): StrokeOptions {
  if (tool === "highlighter") {
    return { size: width, thinning: 0, smoothing: 0.6, streamline: 0.55, simulatePressure: false, last: done };
  }
  return {
    size: width,
    // A real stylus gets expressive width; a mouse gets a calmer, more even line.
    thinning: realPressure ? 0.6 : 0.35,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !realPressure,
    last: done,
  };
}

/** Closed outline through the midpoints of its vertices: smooth without extra points. */
function outlinePath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [sx, sy] = mid(outline[0], outline[1]);
  path.moveTo(sx, sy);
  for (let i = 1; i <= n; i++) {
    const p = outline[i % n];
    const [mx, my] = mid(p, outline[(i + 1) % n]);
    path.quadraticCurveTo(p[0], p[1], mx, my);
  }
  path.closePath();
  return path;
}

function boxOf(points: number[][], pad = 0): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    box.minX = Math.min(box.minX, x - pad);
    box.minY = Math.min(box.minY, y - pad);
    box.maxX = Math.max(box.maxX, x + pad);
    box.maxY = Math.max(box.maxY, y + pad);
  }
  return box;
}

export function buildInk(
  tool: InkStroke["tool"],
  color: string,
  width: number,
  samples: Sample[],
  realPressure: boolean,
  done: boolean,
): InkStroke {
  const outline = getStroke(samples, inkOptions(tool, width, realPressure, done));
  return { kind: "ink", tool, color, width, outline: outlinePath(outline), box: boxOf(outline) };
}

function roundedRect(path: Path2D, a: Point, b: Point, radius: number): void {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const r = Math.min(radius, w / 2, h / 2);
  path.moveTo(x + r, y);
  path.arcTo(x + w, y, x + w, y + h, r);
  path.arcTo(x + w, y + h, x, y + h, r);
  path.arcTo(x, y + h, x, y, r);
  path.arcTo(x, y, x + w, y, r);
  path.closePath();
}

export function buildShape(shape: ShapeKind, color: string, width: number, from: Point, to: Point): ShapeStroke {
  const path = new Path2D();
  let head: Path2D | null = null;
  let reach = width;

  switch (shape) {
    case "line":
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
      break;
    case "rect":
      roundedRect(path, from, to, Math.min(10, width * 2));
      break;
    case "ellipse": {
      const rx = Math.max(Math.abs(to.x - from.x) / 2, 0.5);
      const ry = Math.max(Math.abs(to.y - from.y) / 2, 0.5);
      path.ellipse((from.x + to.x) / 2, (from.y + to.y) / 2, rx, ry, 0, 0, Math.PI * 2);
      break;
    }
    case "arrow": {
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const headLength = Math.min(Math.max(12, width * 3.6), length * 0.6);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const spread = Math.PI / 7;
      // The shaft stops inside the head so its round cap never pokes out of the tip.
      path.moveTo(from.x, from.y);
      path.lineTo(to.x - Math.cos(angle) * headLength * 0.8, to.y - Math.sin(angle) * headLength * 0.8);
      head = new Path2D();
      head.moveTo(to.x, to.y);
      head.lineTo(to.x - headLength * Math.cos(angle - spread), to.y - headLength * Math.sin(angle - spread));
      head.lineTo(to.x - headLength * Math.cos(angle + spread), to.y - headLength * Math.sin(angle + spread));
      head.closePath();
      reach += headLength;
      break;
    }
  }

  const box = boxOf(
    [
      [from.x, from.y],
      [to.x, to.y],
    ],
    reach,
  );
  return { kind: "shape", color, width, path, head, box };
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.save();
  ctx.fillStyle = s.color;
  if (s.kind === "ink") {
    if (s.tool === "highlighter") ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    ctx.fill(s.outline);
  } else {
    ctx.strokeStyle = s.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s.width;
    ctx.stroke(s.path);
    if (s.head) {
      ctx.fill(s.head);
      // A thin stroke with round joins softens the arrowhead's corners.
      ctx.lineWidth = Math.max(1, s.width * 0.6);
      ctx.stroke(s.head);
    }
  }
  ctx.restore();
}

/** Detached context used only for geometry queries (identity transform, CSS pixels). */
const probe = document.createElement("canvas").getContext("2d")!;

/** Whether an eraser of `radius` centered at `p` touches the stroke. */
export function hits(s: Stroke, p: Point, radius: number): boolean {
  const b = s.box;
  if (p.x < b.minX - radius || p.x > b.maxX + radius || p.y < b.minY - radius || p.y > b.maxY + radius) {
    return false;
  }
  probe.lineCap = "round";
  probe.lineJoin = "round";
  if (s.kind === "ink") {
    probe.lineWidth = radius * 2;
    return probe.isPointInPath(s.outline, p.x, p.y) || probe.isPointInStroke(s.outline, p.x, p.y);
  }
  probe.lineWidth = s.width + radius * 2;
  return probe.isPointInStroke(s.path, p.x, p.y) || (s.head !== null && probe.isPointInPath(s.head, p.x, p.y));
}
