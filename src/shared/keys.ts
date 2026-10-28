import type { ShapeKind, Tool } from "./tools";
import { isMac } from "./platform";

export type Action =
  | { type: "tool"; tool: Tool; shape?: ShapeKind }
  | { type: "cycle-shape" }
  | { type: "color"; index: number }
  | { type: "size"; delta: 1 | -1 }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  | { type: "exit" };

export const TOOL_KEYS: Record<Tool, string> = {
  pointer: "V",
  pen: "P",
  highlighter: "H",
  laser: "L",
  shape: "S",
  number: "N",
  eraser: "E",
};

export const SHAPE_KEYS: Record<ShapeKind, string | null> = {
  arrow: "A",
  rect: "R",
  ellipse: "O",
  line: null,
};

const mod = isMac ? "⌘" : "Ctrl+";
export const UNDO_KEY = `${mod}Z`;
export const CLEAR_KEY = isMac ? "⌫" : "Supr";

/** Shortcuts shared by the toolbar and the canvases (a canvas forwards them to the toolbar). */
export function actionForKey(e: KeyboardEvent): Action | null {
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (key === "z") return { type: e.shiftKey ? "redo" : "undo" };
    if (key === "y") return { type: "redo" };
    return null;
  }
  if (e.altKey) return null;
  if (key === "escape") return { type: "exit" };
  if (key === "backspace" || key === "delete") return { type: "clear" };
  if (key === "[") return { type: "size", delta: -1 };
  if (key === "]") return { type: "size", delta: 1 };
  if (/^[1-6]$/.test(key)) return { type: "color", index: Number(key) - 1 };
  if (key === "s") return { type: "cycle-shape" };
  for (const [shape, k] of Object.entries(SHAPE_KEYS)) {
    if (k?.toLowerCase() === key) return { type: "tool", tool: "shape", shape: shape as ShapeKind };
  }
  for (const [tool, k] of Object.entries(TOOL_KEYS)) {
    if (k.toLowerCase() === key) return { type: "tool", tool: tool as Tool };
  }
  return null;
}
