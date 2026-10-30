export type Tool = "pointer" | "pen" | "highlighter" | "laser" | "shape" | "text" | "number" | "recolor" | "eraser";
export type DrawTool = Exclude<Tool, "pointer">;
export type ShapeKind = "arrow" | "rect" | "ellipse" | "line";
export type SizeIndex = 0 | 1 | 2;

export const TOOLS: readonly Tool[] = ["pointer", "pen", "highlighter", "laser", "shape", "text", "number", "recolor", "eraser"];
export const SHAPES: readonly ShapeKind[] = ["arrow", "rect", "ellipse", "line"];
/** The palette's original six colors; each swatch can be changed and keeps its key (1 to 6). */
export const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#1c1c1e", "#ffffff"] as const;
/** Suggestions in the color panel, chosen to complement the palette: orange, pink, purple, cyan, brown, gray. */
export const MORE_COLORS = ["#ff9500", "#ff2d55", "#af52de", "#5ac8fa", "#a2845e", "#8e8e93"] as const;

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/**
 * Stroke width in CSS pixels for the thin / medium / thick setting of each tool (badge
 * diameter for numbers, font size for text, brush diameter for the eraser and recolor).
 */
const WIDTHS: Record<DrawTool, readonly [number, number, number]> = {
  pen: [3, 6, 12],
  highlighter: [16, 26, 40],
  laser: [6, 9, 14],
  shape: [3, 5, 9],
  text: [18, 28, 44],
  number: [20, 26, 34],
  recolor: [10, 20, 36],
  eraser: [16, 32, 64],
};

/** Everything a canvas needs to know to turn the next gesture into ink. */
export interface ToolState {
  tool: Tool;
  shape: ShapeKind;
  color: string;
  size: SizeIndex;
  inkHidden: boolean;
  /** What the next numbered badge will say. */
  nextNumber: number;
}

export const isDrawTool = (tool: Tool): tool is DrawTool => tool !== "pointer";

/** Tools that put new color on screen; the draw toggle resumes the last one (never an editing tool). */
export type InkTool = Exclude<DrawTool, "eraser" | "recolor">;
export const isInkTool = (tool: Tool): tool is InkTool => isDrawTool(tool) && tool !== "eraser" && tool !== "recolor";

export function widthOf(tool: Tool, size: SizeIndex): number {
  return WIDTHS[isDrawTool(tool) ? tool : "pen"][size];
}

/**
 * The number the next badge gets: one above the highest badge on any screen. Undoing the
 * last badge gives its number back; erasing one in the middle never makes a number repeat.
 */
export function nextBadgeNumber(onScreen: Iterable<number>): number {
  let highest = 0;
  for (const n of onScreen) highest = Math.max(highest, n);
  return highest + 1;
}

/** Near-black or white, whichever reads better on top of `hex` (e.g. a yellow badge). */
export function textOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const luma = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return luma > 0.62 ? "#1c1c1e" : "#ffffff";
}
