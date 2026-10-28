import { invoke } from "@tauri-apps/api/core";
import { prefersReducedMotion } from "../shared/platform";

export type Orientation = "vertical" | "horizontal";
export type Edge = "left" | "right" | "top" | "bottom" | "float";

/** In native units: points on macOS, physical pixels on Windows (see overlay.rs). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Size = Pick<Rect, "width" | "height">;
export type Point = Pick<Rect, "x" | "y">;

export interface MonitorInfo {
  bounds: Rect;
  /** The screen minus the menu bar, the Dock or the taskbar. */
  workArea: Rect;
  scale: number;
}

/** Gap between a docked toolbar and the screen edge, in CSS pixels. */
export const MARGIN = 10;

export const listMonitors = () => invoke<MonitorInfo[]>("list_monitors");

export const setFrame = (r: Rect) =>
  invoke<void>("set_frame", { x: r.x, y: r.y, width: r.width, height: r.height });

export const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** The monitor under a point, or the closest one if the point fell off every screen. */
export function monitorAt(monitors: MonitorInfo[], p: Point): MonitorInfo {
  let best = monitors[0];
  let bestDistance = Infinity;
  for (const m of monitors) {
    const b = m.bounds;
    const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width));
    const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
    if (dx * dx + dy * dy < bestDistance) {
      best = m;
      bestDistance = dx * dx + dy * dy;
    }
  }
  return best;
}

/** The main display has its origin at (0, 0) on both macOS and Windows. */
export const primaryMonitor = (monitors: MonitorInfo[]) =>
  monitors.find((m) => m.bounds.x === 0 && m.bounds.y === 0) ?? monitors[0];

/**
 * Where a toolbar of `size` sits on `edge` of `area`, as close as possible to `anchor`
 * (the top-left it should keep along that edge). Always fully inside the work area.
 */
export function placeOnEdge(edge: Edge, anchor: Point, size: Size, area: Rect, margin: number): Rect {
  const minX = area.x + margin;
  const minY = area.y + margin;
  const maxX = area.x + area.width - size.width - margin;
  const maxY = area.y + area.height - size.height - margin;
  const x = clamp(anchor.x, minX, maxX);
  const y = clamp(anchor.y, minY, maxY);
  switch (edge) {
    case "left":
      return { x: minX, y, ...size };
    case "right":
      return { x: maxX, y, ...size };
    case "top":
      return { x, y: minY, ...size };
    case "bottom":
      return { x, y: maxY, ...size };
    case "float":
      return { x, y, ...size };
  }
}

/**
 * Where a panel of `size` opens beside the toolbar `bar`: on the side that faces the middle
 * of the screen (left of a bar on the right edge, below one at the top), centered on the
 * `anchor` button that opened it, and always fully inside the work area.
 */
export function placeBeside(
  bar: Rect,
  anchor: Rect,
  orientation: Orientation,
  size: Size,
  area: Rect,
  gap: number,
): Rect {
  const b = centerOf(bar);
  const a = centerOf(anchor);
  const middle = centerOf(area);
  const minX = area.x + gap;
  const minY = area.y + gap;
  const maxX = area.x + area.width - size.width - gap;
  const maxY = area.y + area.height - size.height - gap;
  if (orientation === "vertical") {
    const x = b.x > middle.x ? bar.x - gap - size.width : bar.x + bar.width + gap;
    return { x: clamp(x, minX, maxX), y: clamp(a.y - size.height / 2, minY, maxY), ...size };
  }
  const y = b.y > middle.y ? bar.y - gap - size.height : bar.y + bar.height + gap;
  return { x: clamp(a.x - size.width / 2, minX, maxX), y: clamp(y, minY, maxY), ...size };
}

/**
 * Decides where the toolbar lands when the user lets go of it after dragging it.
 *
 * @param drop        the toolbar's rectangle at the moment it was released
 * @param area        work area of the monitor it was dropped on
 * @param orientation the orientation it had while being dragged
 * @returns the edge to stick to ("float" = stay exactly where it was dropped) and the
 *          orientation to switch to. The caller animates the bar into place.
 */
export function resolveDock(
  drop: Rect,
  area: Rect,
  orientation: Orientation,
): { edge: Edge; orientation: Orientation } {
  // TODO(tú): decide el "imán" de la barra. Hoy nunca se pega a un borde.
  void area;
  void drop;
  return { edge: "float", orientation };
}

let motion = 0;

/**
 * The next animation frame, or a timer tick if frames are paused (WebKit stops them for a
 * window it thinks is hidden). Without the fallback a stalled glide would block every
 * later relayout queued behind it.
 */
function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    const raf = requestAnimationFrame(resolve);
    setTimeout(() => {
      cancelAnimationFrame(raf);
      resolve(performance.now());
    }, 34);
  });
}

/** Glides the window from one spot to another (ease-out), cancelling any glide in flight. */
export async function glide(from: Rect, to: Rect, ms = 180): Promise<void> {
  const id = ++motion;
  if (ms <= 0 || prefersReducedMotion()) return setFrame(to);
  const start = performance.now();
  for (;;) {
    const now = await nextFrame();
    if (id !== motion) return;
    const t = Math.min(1, (now - start) / ms);
    const k = 1 - (1 - t) ** 3;
    await setFrame({
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      width: to.width,
      height: to.height,
    });
    if (t === 1) return;
  }
}
