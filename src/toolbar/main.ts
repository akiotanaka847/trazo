import "./toolbar.css";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Action } from "../shared/keys";
import { isMac, nativeScale } from "../shared/platform";
import {
  CANVAS_CLOSED,
  CANVAS_COMMAND,
  CANVAS_READY,
  CANVAS_STATUS,
  EXIT_DRAW,
  HISTORY_PUSH,
  REQUEST,
  REVEAL,
  TOGGLE_DRAW,
  TOOL_STATE,
  TRAY,
  type CanvasCommand,
  type CanvasStatus,
} from "../shared/protocol";
import {
  COLORS,
  SHAPES,
  isDrawTool,
  isInkTool,
  nextBadgeNumber,
  type SizeIndex,
  type Tool,
  type ToolState,
} from "../shared/tools";
import {
  centerOf,
  glide,
  listMonitors,
  MARGIN,
  monitorAt,
  placeOnEdge,
  primaryMonitor,
  resolveDock,
  setFrame,
  type Edge,
  type MonitorInfo,
  type Orientation,
  type Rect,
  type Size,
} from "./dock";
import { openMoreMenu } from "./menu";
import { load, save } from "./state";
import { ToolbarView } from "./view";

const win = getCurrentWebviewWindow();
const bar = document.getElementById("bar")!;
document.documentElement.classList.toggle("mac", isMac);

const state = load();
let visible = false;
/** Canvas labels in the order they recorded undoable changes (canvases are per monitor). */
const undoStack: string[] = [];
const redoStack: string[] = [];
const strokeCounts = new Map<string, number>();
/** Highest numbered badge on each canvas: numbering runs across every screen. */
const highestNumbers = new Map<string, number>();

const view = new ToolbarView(bar, {
  pickTool,
  pickColor: (color) => setTools({ color }),
  cycleSize: () => setTools({ size: ((state.tools.size + 1) % 3) as SizeIndex }),
  undo,
  clear,
  more,
  toggleDraw,
  handleDown: startDrag,
});

function render(): void {
  view.render({
    tools: state.tools,
    lastDrawTool: state.lastDrawTool,
    layout: state.layout,
    canUndo: undoStack.length > 0,
    hasInk: [...strokeCounts.values()].some((n) => n > 0),
  });
}

// ── Tools ────────────────────────────────────────────────────────────────────

function setTools(patch: Partial<ToolState>): void {
  const before = state.tools;
  const next = { ...before, ...patch };
  if (isInkTool(next.tool)) state.lastDrawTool = next.tool;
  // Picking a drawing tool brings hidden ink back: drawing blind is never what you want.
  if (isDrawTool(next.tool) && patch.tool) next.inkHidden = false;
  state.tools = next;
  void emit(TOOL_STATE, next);
  if (isDrawTool(next.tool) !== isDrawTool(before.tool)) {
    void invoke("set_drawing", { active: isDrawTool(next.tool) });
  }
  save(state);
  render();
}

function pickTool(tool: Tool): void {
  if (tool === "shape" && state.tools.tool === "shape") {
    const i = SHAPES.indexOf(state.tools.shape);
    setTools({ shape: SHAPES[(i + 1) % SHAPES.length] });
  } else {
    setTools({ tool });
  }
}

/** Placing, undoing, erasing or clearing a badge on any screen moves the shared count. */
function syncNextNumber(): void {
  const next = nextBadgeNumber(highestNumbers.values());
  if (next !== state.tools.nextNumber) setTools({ nextNumber: next });
}

function toggleDraw(): void {
  setTools({ tool: isDrawTool(state.tools.tool) ? "pointer" : state.lastDrawTool });
}

function apply(action: Action): void {
  switch (action.type) {
    case "tool":
      return setTools(action.shape ? { tool: action.tool, shape: action.shape } : { tool: action.tool });
    case "cycle-shape":
      return pickTool("shape");
    case "color":
      return setTools({ color: COLORS[action.index] });
    case "size":
      return setTools({ size: Math.min(2, Math.max(0, state.tools.size + action.delta)) as SizeIndex });
    case "undo":
      return undo();
    case "redo":
      return redo();
    case "clear":
      return clear();
    case "exit":
      return setTools({ tool: "pointer" });
  }
}

// ── History: each step is routed back to the canvas (monitor) that made it ───

function command(label: string | null, cmd: CanvasCommand): void {
  void (label ? emitTo(label, CANVAS_COMMAND, cmd) : emit(CANVAS_COMMAND, cmd));
}

function undo(): void {
  const label = undoStack.pop();
  if (!label) return;
  redoStack.push(label);
  command(label, { type: "undo" });
  render();
}

function redo(): void {
  const label = redoStack.pop();
  if (!label) return;
  undoStack.push(label);
  command(label, { type: "redo" });
  render();
}

function clear(): void {
  command(null, { type: "clear" });
}

// ── Placement ────────────────────────────────────────────────────────────────

/** The window's current frame, in native units. */
let frame: Rect | null = null;
let dragging = false;
let layoutQueue = Promise.resolve();

function barSize(): Size {
  const r = bar.getBoundingClientRect();
  const s = nativeScale();
  return { width: Math.ceil(r.width * s), height: Math.ceil(r.height * s) };
}

function firstFrame(monitors: MonitorInfo[], size: Size, margin: number): Rect {
  const { x, y } = state.layout;
  if (x !== null && y !== null) return { x, y, ...size };
  const area = primaryMonitor(monitors).workArea;
  return { x: area.x + area.width - size.width - margin, y: area.y + (area.height - size.height) / 2, ...size };
}

/**
 * Fits the window to the bar and sticks it to its edge. `keep` says which point of the
 * old frame the new one stays on: its top-left (the handle stays under the mouse when
 * collapsing) or its center (a bar that just flipped orientation turns in place).
 */
function relayout(animate: boolean, keep: "start" | "center" = "start"): Promise<void> {
  layoutQueue = layoutQueue
    .then(async () => {
      const monitors = await listMonitors();
      if (monitors.length === 0) return;
      const size = barSize();
      const margin = MARGIN * nativeScale();
      const from = frame ?? firstFrame(monitors, size, margin);
      const c = centerOf(from);
      const anchor = keep === "center" ? { x: c.x - size.width / 2, y: c.y - size.height / 2 } : from;
      const area = monitorAt(monitors, c).workArea;
      const to = placeOnEdge(state.layout.edge, anchor, size, area, margin);
      if (animate && frame) {
        await setFrame({ x: anchor.x, y: anchor.y, ...size });
        await glide({ x: anchor.x, y: anchor.y, ...size }, to);
      } else {
        await setFrame(to);
      }
      frame = to;
      state.layout.x = to.x;
      state.layout.y = to.y;
      save(state);
    })
    .catch((e) => console.error("Trazo: could not place the toolbar", e));
  return layoutQueue;
}

function startDrag(e: PointerEvent): void {
  if (e.button !== 0 || !frame) return;
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  const s = nativeScale();
  const origin = frame;
  const start = { x: e.screenX, y: e.screenY };
  let moved = false;
  let next: Rect | null = null;
  let raf = 0;

  const move = (ev: PointerEvent) => {
    const dx = (ev.screenX - start.x) * s;
    const dy = (ev.screenY - start.y) * s;
    if (!moved && Math.hypot(dx, dy) < 4 * s) return;
    moved = dragging = true;
    bar.classList.add("dragging");
    next = { ...origin, x: origin.x + dx, y: origin.y + dy };
    raf ||= requestAnimationFrame(() => {
      raf = 0;
      if (next) {
        frame = next;
        void setFrame(next);
      }
    });
  };

  const up = async () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    if (!moved) return toggleCollapsed();
    cancelAnimationFrame(raf);
    if (next) frame = next;
    dragging = false;
    bar.classList.remove("dragging");

    const dropped = frame!;
    const monitors = await listMonitors();
    const area = monitorAt(monitors, centerOf(dropped)).workArea;
    const dock = resolveDock(dropped, area, state.layout.orientation);
    const flipped = dock.orientation !== state.layout.orientation;
    state.layout.edge = dock.edge;
    state.layout.orientation = dock.orientation;
    render();
    await relayout(true, flipped ? "center" : "start");
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

function toggleCollapsed(): void {
  state.layout.collapsed = !state.layout.collapsed;
  save(state);
  render();
}

function setOrientation(orientation: Orientation): void {
  state.layout.orientation = orientation;
  render();
  void relayout(true, "center");
}

function setEdge(edge: Edge): void {
  state.layout.edge = edge;
  if (edge === "left" || edge === "right") state.layout.orientation = "vertical";
  if (edge === "top" || edge === "bottom") state.layout.orientation = "horizontal";
  render();
  void relayout(true, "center");
}

async function setVisible(show: boolean): Promise<void> {
  visible = show;
  if (show) {
    await relayout(false);
    await win.show();
  } else {
    // A hidden toolbar can't take you out of drawing mode, so leave it first.
    if (isDrawTool(state.tools.tool)) setTools({ tool: "pointer" });
    await win.hide();
  }
}

// ── Menus ────────────────────────────────────────────────────────────────────

async function more(): Promise<void> {
  await openMoreMenu({
    layout: state.layout,
    tools: state.tools,
    canRedo: redoStack.length > 0,
    setOrientation,
    setEdge,
    redo,
    toggleInk: () => setTools({ inkHidden: !state.tools.inkHidden }),
    toggleCapture: () => {
      state.layout.hideFromCapture = !state.layout.hideFromCapture;
      save(state);
      void win.setContentProtected(state.layout.hideFromCapture);
    },
    quit: () => void invoke("quit"),
  });
  void invoke("restore_focus");
}

function onTray(id: string): void {
  switch (id) {
    case "toggle-draw":
      void (visible ? Promise.resolve() : setVisible(true)).then(toggleDraw);
      break;
    case "toggle-toolbar":
      void setVisible(!visible);
      break;
    case "toggle-ink":
      setTools({ inkHidden: !state.tools.inkHidden });
      break;
    case "clear":
      clear();
      break;
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────────

// In pointer mode a click on the toolbar shouldn't leave the presentation without focus.
// (Bubbling to the document runs after the button's own handler has updated the state.)
document.addEventListener("click", (e) => {
  if ((e.target as Element).closest(".more")) return; // restores once its menu closes
  if (!isDrawTool(state.tools.tool)) void invoke("restore_focus");
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

void win.listen<string>(CANVAS_READY, ({ payload: label }) => {
  strokeCounts.set(label, strokeCounts.get(label) ?? 0);
  void emitTo(label, TOOL_STATE, state.tools);
});
void win.listen<string>(HISTORY_PUSH, ({ payload: label }) => {
  undoStack.push(label);
  if (redoStack.length) {
    redoStack.length = 0;
    command(null, { type: "drop-redo" });
  }
  render();
});
void win.listen<CanvasStatus>(CANVAS_STATUS, ({ payload }) => {
  strokeCounts.set(payload.label, payload.strokes);
  highestNumbers.set(payload.label, payload.highestNumber);
  syncNextNumber();
  render();
});
void win.listen<string>(CANVAS_CLOSED, ({ payload: label }) => {
  strokeCounts.delete(label);
  highestNumbers.delete(label);
  syncNextNumber();
  for (const stack of [undoStack, redoStack]) {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i] === label) stack.splice(i, 1);
  }
  render();
});
void win.listen<Action>(REQUEST, ({ payload }) => apply(payload));
void win.listen(TOGGLE_DRAW, () => onTray("toggle-draw"));
void win.listen(EXIT_DRAW, () => setTools({ tool: "pointer" }));
void win.listen<string>(TRAY, ({ payload }) => onTray(payload));
void win.listen(REVEAL, () => setVisible(true));

async function start(): Promise<void> {
  render();
  void emit(TOOL_STATE, state.tools);
  if (state.layout.hideFromCapture) await win.setContentProtected(true);
  await setVisible(true);
  new ResizeObserver(() => {
    if (visible && !dragging) void relayout(false);
  }).observe(bar);
}

void start();

// Browser preview (dev/): lets the harness flip what the native menu would.
if (import.meta.env.DEV) Object.assign(window, { trazo: { setEdge, setOrientation, state } });
