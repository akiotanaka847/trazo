import { getStroke, type StrokeOptions } from "perfect-freehand";
import { textOn, type ShapeKind } from "../shared/tools";

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

/** A numbered badge (1, 2, 3…) centered where it was dropped; `width` is its diameter. */
export interface BadgeStroke extends Base {
  kind: "badge";
  number: number;
  center: Point;
}

/** Typed text; `at` is the top-left corner of its first line and `width` its font size. */
export interface TextStroke extends Base {
  kind: "text";
  text: string;
  at: Point;
}

export type Stroke = InkStroke | ShapeStroke | BadgeStroke | TextStroke;

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

export function buildBadge(number: number, color: string, diameter: number, center: Point): BadgeStroke {
  const r = diameter / 2 + 2; // the white halo sits outside the colored disc
  const box = { minX: center.x - r, minY: center.y - r, maxX: center.x + r, maxY: center.y + r };
  return { kind: "badge", number, color, width: diameter, center, box };
}

function drawBadge(ctx: CanvasRenderingContext2D, s: BadgeStroke): void {
  const { x, y } = s.center;
  const r = s.width / 2;
  const disc = (radius: number) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  };
  // A white halo and a faint dark hairline keep any color readable on any background.
  disc(r + 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.stroke();
  disc(r);
  ctx.fillStyle = s.color;
  ctx.fill();
  const label = String(s.number);
  const scale = label.length === 1 ? 1.15 : label.length === 2 ? 0.95 : 0.72;
  ctx.font = `600 ${Math.round(r * scale)}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = textOn(s.color);
  ctx.fillText(label, x, y + r * 0.07);
}

/** Font shared by the painted text and the box it is typed in, so saving never shifts it. */
export const textFont = (size: number) => `600 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
export const lineHeight = (size: number) => Math.round(size * 1.25);
/** A halo in the opposite tone (dark around yellow, white around red) keeps text readable anywhere. */
export const textHalo = (color: string) => (textOn(color) === "#ffffff" ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.55)");
const haloWidth = (size: number) => Math.max(2, size * 0.16);

/** The widest line of `text` in CSS pixels. */
export function measureText(text: string, size: number): number {
  probe.font = textFont(size);
  return Math.max(0, ...text.split("\n").map((line) => probe.measureText(line).width));
}

export function buildText(text: string, color: string, size: number, at: Point): TextStroke {
  const pad = haloWidth(size) / 2;
  const lines = text.split("\n").length;
  const box = {
    minX: at.x - pad,
    minY: at.y - pad,
    maxX: at.x + measureText(text, size) + pad,
    maxY: at.y + lines * lineHeight(size) + pad,
  };
  return { kind: "text", text, color, width: size, at, box };
}

function drawText(ctx: CanvasRenderingContext2D, s: TextStroke): void {
  const lh = lineHeight(s.width);
  ctx.font = textFont(s.width);
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = haloWidth(s.width);
  ctx.strokeStyle = textHalo(s.color);
  s.text.split("\n").forEach((line, i) => {
    const y = s.at.y + i * lh + lh / 2;
    ctx.strokeText(line, s.at.x, y);
    ctx.fillText(line, s.at.x, y);
  });
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.save();
  ctx.fillStyle = s.color;
  if (s.kind === "badge") {
    drawBadge(ctx, s);
  } else if (s.kind === "text") {
    drawText(ctx, s);
  } else if (s.kind === "ink") {
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
  if (s.kind === "badge") {
    return Math.hypot(p.x - s.center.x, p.y - s.center.y) <= s.width / 2 + 2 + radius;
  }
  if (s.kind === "text") return true; // inside its box, which already counts the radius

  probe.lineCap = "round";
  probe.lineJoin = "round";
  if (s.kind === "ink") {
    probe.lineWidth = radius * 2;
    return probe.isPointInPath(s.outline, p.x, p.y) || probe.isPointInStroke(s.outline, p.x, p.y);
  }
  probe.lineWidth = s.width + radius * 2;
  return probe.isPointInStroke(s.path, p.x, p.y) || (s.head !== null && probe.isPointInPath(s.head, p.x, p.y));
}
