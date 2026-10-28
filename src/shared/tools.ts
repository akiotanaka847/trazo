export type Tool = "pointer" | "pen" | "highlighter" | "laser" | "shape" | "eraser";
export type DrawTool = Exclude<Tool, "pointer">;
export type ShapeKind = "arrow" | "rect" | "ellipse" | "line";
export type SizeIndex = 0 | 1 | 2;

export const TOOLS: readonly Tool[] = ["pointer", "pen", "highlighter", "laser", "shape", "eraser"];
export const SHAPES: readonly ShapeKind[] = ["arrow", "rect", "ellipse", "line"];
export const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#1c1c1e", "#ffffff"] as const;

/** Stroke width in CSS pixels for the thin / medium / thick setting of each tool. */
const WIDTHS: Record<DrawTool, readonly [number, number, number]> = {
  pen: [3, 6, 12],
  highlighter: [16, 26, 40],
  laser: [6, 9, 14],
  shape: [3, 5, 9],
  eraser: [16, 32, 64],
};

/** Everything a canvas needs to know to turn the next gesture into ink. */
export interface ToolState {
  tool: Tool;
  shape: ShapeKind;
  color: string;
  size: SizeIndex;
  inkHidden: boolean;
}

export const isDrawTool = (tool: Tool): tool is DrawTool => tool !== "pointer";

/** Tools that put color on screen; the draw toggle resumes the last one (never the eraser). */
export type InkTool = Exclude<DrawTool, "eraser">;
export const isInkTool = (tool: Tool): tool is InkTool => isDrawTool(tool) && tool !== "eraser";

export function widthOf(tool: Tool, size: SizeIndex): number {
  return WIDTHS[isDrawTool(tool) ? tool : "pen"][size];
}
