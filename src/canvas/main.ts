import "./canvas.css";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { actionForKey } from "../shared/keys";
import {
  CANVAS_COMMAND,
  CANVAS_READY,
  CANVAS_STATUS,
  HISTORY_PUSH,
  REQUEST,
  TOOLBAR_LABEL,
  TOOL_STATE,
  type CanvasCommand,
  type CanvasStatus,
} from "../shared/protocol";
import { COLORS, nextBadgeNumber, widthOf, type ToolState } from "../shared/tools";
import { cursorFor } from "./cursor";
import { Drawing } from "./history";
import { LaserTrail } from "./laser";
import { buildBadge, buildInk, buildShape, drawStroke, hits, type Point, type Sample, type Stroke } from "./strokes";

const win = getCurrentWebviewWindow();
const label = win.label;

// Two layers: finished ink (repainted only when strokes change) and a live layer for the
// stroke being drawn and the laser, which is cheap to clear every frame.
const inkCanvas = document.getElementById("ink") as HTMLCanvasElement;
const liveCanvas = document.getElementById("live") as HTMLCanvasElement;
const ink = inkCanvas.getContext("2d")!;
const live = liveCanvas.getContext("2d")!;

let tools: ToolState = { tool: "pointer", shape: "arrow", color: COLORS[0], size: 1, inkHidden: false, nextNumber: 1 };
const drawing = new Drawing();
const laser = new LaserTrail();

type Gesture =
  | { kind: "ink"; tool: "pen" | "highlighter"; samples: Sample[]; pressure: boolean }
  | { kind: "shape"; from: Point; to: Point; shift: boolean }
  | { kind: "erase"; last: Point; hit: Set<Stroke> }
  | { kind: "badge"; at: Point };
let gesture: Gesture | null = null;

const width = () => widthOf(tools.tool, tools.size);

// ── Painting ─────────────────────────────────────────────────────────────────

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  for (const [canvas, ctx] of [
    [inkCanvas, ink],
    [liveCanvas, live],
  ] as const) {
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  repaint();
  requestFrame();
}

function repaint(skip?: Set<Stroke>): void {
  ink.clearRect(0, 0, innerWidth, innerHeight);
  for (const s of drawing.strokes) if (!skip?.has(s)) drawStroke(ink, s);
}

/** Shift turns lines and arrows to 15° steps, rectangles into squares, ellipses into circles. */
function shapeEnd(g: Extract<Gesture, { kind: "shape" }>): Point {
  if (!g.shift) return g.to;
  const dx = g.to.x - g.from.x;
  const dy = g.to.y - g.from.y;
  if (tools.shape === "rect" || tools.shape === "ellipse") {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: g.from.x + Math.sign(dx) * d, y: g.from.y + Math.sign(dy) * d };
  }
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.hypot(dx, dy);
  return { x: g.from.x + Math.cos(angle) * length, y: g.from.y + Math.sin(angle) * length };
}

function strokeFor(g: Gesture, done: boolean): Stroke | null {
  if (g.kind === "ink") return buildInk(g.tool, tools.color, width(), g.samples, g.pressure, done);
  if (g.kind === "shape") return buildShape(tools.shape, tools.color, width(), g.from, shapeEnd(g));
  if (g.kind === "badge") return buildBadge(badgeNumber(), tools.color, width(), g.at);
  return null;
}

let frameRequested = false;
function requestFrame(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(paintLive);
}

function paintLive(now: number): void {
  frameRequested = false;
  live.clearRect(0, 0, innerWidth, innerHeight);
  const preview = gesture && strokeFor(gesture, false);
  if (preview) drawStroke(live, preview);
  if (laser.draw(live, tools.color, widthOf("laser", tools.size), now)) requestFrame();
}

// ── Reporting to the toolbar ─────────────────────────────────────────────────

const numbersOnScreen = () => drawing.strokes.flatMap((s) => (s.kind === "badge" ? [s.number] : []));

/**
 * The toolbar's count runs across every screen; the local check covers a second click
 * landing before the toolbar's update does, so two badges never share a number.
 */
const badgeNumber = () => Math.max(tools.nextNumber, nextBadgeNumber(numbersOnScreen()));

function report(): void {
  void emitTo<CanvasStatus>(TOOLBAR_LABEL, CANVAS_STATUS, {
    label,
    strokes: drawing.strokes.length,
    highestNumber: nextBadgeNumber(numbersOnScreen()) - 1,
  });
}

function recorded(): void {
  void emitTo(TOOLBAR_LABEL, HISTORY_PUSH, label);
  report();
}

// ── Input ────────────────────────────────────────────────────────────────────

const pointOf = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });
const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? e.pressure : 0.5);

/** All the samples the OS delivered since the last event, for smooth fast strokes. */
function samplesOf(e: PointerEvent): PointerEvent[] {
  const list = e.getCoalescedEvents?.();
  return list && list.length > 0 ? list : [e];
}

/** Marks every stroke the eraser touches between two points (sampled so fast swipes count). */
function eraseAlong(g: Extract<Gesture, { kind: "erase" }>, from: Point, to: Point): void {
  const radius = widthOf("eraser", tools.size) / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2)));
  let touched = false;
  for (const s of drawing.strokes) {
    if (g.hit.has(s)) continue;
    for (let i = 1; i <= steps; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      if (hits(s, p, radius)) {
        g.hit.add(s);
        touched = true;
        break;
      }
    }
  }
  if (touched) repaint(g.hit);
}

function finish(): void {
  const g = gesture;
  gesture = null;
  if (!g) return;
  if (g.kind === "erase") {
    if (drawing.remove(g.hit)) recorded();
  } else {
    const tooSmall = g.kind === "shape" && Math.hypot(g.to.x - g.from.x, g.to.y - g.from.y) < 3;
    const stroke = strokeFor(g, true);
    if (stroke && !tooSmall) {
      drawing.add(stroke);
      drawStroke(ink, stroke);
      recorded();
    }
  }
  requestFrame();
}

liveCanvas.addEventListener("pointerdown", (e) => {
  // The barrel/back eraser of a stylus erases whatever tool is selected.
  const stylusEraser = e.pointerType === "pen" && (e.button === 5 || (e.buttons & 32) !== 0);
  if (tools.tool === "pointer" || (e.button !== 0 && !stylusEraser)) return;
  liveCanvas.setPointerCapture(e.pointerId);
  const p = pointOf(e);
  if (stylusEraser || tools.tool === "eraser") {
    gesture = { kind: "erase", last: p, hit: new Set() };
    eraseAlong(gesture, p, p);
  } else if (tools.tool === "pen" || tools.tool === "highlighter") {
    gesture = { kind: "ink", tool: tools.tool, samples: [[p.x, p.y, pressureOf(e)]], pressure: e.pointerType === "pen" };
  } else if (tools.tool === "shape") {
    gesture = { kind: "shape", from: p, to: p, shift: e.shiftKey };
  } else if (tools.tool === "number") {
    // Follows the pointer until release, so it can be nudged into place.
    gesture = { kind: "badge", at: p };
  }
  requestFrame();
});

liveCanvas.addEventListener("pointermove", (e) => {
  // The laser follows the pointer without clicking: point, don't draw.
  if (tools.tool === "laser") {
    for (const s of samplesOf(e)) laser.add(s.clientX, s.clientY);
    return requestFrame();
  }
  const g = gesture;
  if (!g) return;
  if (g.kind === "ink") {
    for (const s of samplesOf(e)) g.samples.push([s.clientX, s.clientY, pressureOf(s)]);
  } else if (g.kind === "shape") {
    g.to = pointOf(e);
    g.shift = e.shiftKey;
  } else if (g.kind === "badge") {
    g.at = pointOf(e);
  } else {
    for (const s of samplesOf(e)) {
      const p = pointOf(s);
      eraseAlong(g, g.last, p);
      g.last = p;
    }
  }
  requestFrame();
});

liveCanvas.addEventListener("pointerup", finish);
liveCanvas.addEventListener("pointercancel", finish);
window.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.key === "Shift" && gesture?.kind === "shape") {
    gesture.shift = true;
    return requestFrame();
  }
  const action = actionForKey(e);
  if (!action) return;
  e.preventDefault();
  void emitTo(TOOLBAR_LABEL, REQUEST, action);
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift" && gesture?.kind === "shape") {
    gesture.shift = false;
    requestFrame();
  }
});

// ── Messages from the toolbar ────────────────────────────────────────────────

void win.listen<ToolState>(TOOL_STATE, ({ payload }) => {
  if (gesture && payload.tool !== tools.tool) finish();
  tools = payload;
  document.body.classList.toggle("ink-hidden", tools.inkHidden);
  document.body.style.cursor = cursorFor(tools);
  requestFrame();
});

void win.listen<CanvasCommand>(CANVAS_COMMAND, ({ payload }) => {
  switch (payload.type) {
    case "undo":
    case "redo":
      if (payload.type === "undo" ? drawing.undo() : drawing.redo()) {
        repaint();
        report();
      }
      break;
    case "clear":
      if (drawing.remove(drawing.strokes)) {
        repaint();
        recorded();
      }
      break;
    case "drop-redo":
      drawing.dropRedo();
      break;
  }
});

window.addEventListener("resize", resize);
resize();
void emitTo(TOOLBAR_LABEL, CANVAS_READY, label);
