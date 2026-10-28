/**
 * Events between the windows. The toolbar owns the state; canvases draw and report back;
 * Rust forwards global hotkeys and tray clicks to the toolbar.
 */

export const TOOLBAR_LABEL = "toolbar";

// Toolbar → canvases
export const TOOL_STATE = "tool-state"; // ToolState, broadcast
export const CANVAS_COMMAND = "canvas-command"; // CanvasCommand, broadcast or to one canvas
export type CanvasCommand = { type: "undo" } | { type: "redo" } | { type: "clear" } | { type: "drop-redo" };

// Canvases → toolbar
export const CANVAS_READY = "canvas-ready"; // label
export const HISTORY_PUSH = "history-push"; // label: that canvas recorded an undoable change
export const CANVAS_STATUS = "canvas-status"; // CanvasStatus
export const REQUEST = "request"; // Action from a key pressed while the canvas had focus
export interface CanvasStatus {
  label: string;
  strokes: number;
}

// Rust → toolbar
export const TOGGLE_DRAW = "toggle-draw";
export const EXIT_DRAW = "exit-draw";
export const TRAY = "tray"; // menu item id
export const REVEAL = "reveal";
export const CANVAS_CLOSED = "canvas-closed"; // label
