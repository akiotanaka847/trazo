import {
  ArrowUpRight,
  Circle,
  CircleDot,
  createElement,
  Ellipsis,
  EllipsisVertical,
  Eraser,
  GripHorizontal,
  GripVertical,
  Highlighter,
  MousePointer2,
  Pen,
  Slash,
  Square,
  Trash2,
  Undo2,
  type IconNode,
} from "lucide";
import { t } from "../shared/i18n";
import { CLEAR_KEY, SHAPE_KEYS, TOOL_KEYS, UNDO_KEY } from "../shared/keys";
import { COLORS, TOOLS, textOn, type InkTool, type ShapeKind, type Tool, type ToolState } from "../shared/tools";
import type { Layout } from "./state";

export interface ViewState {
  tools: ToolState;
  lastDrawTool: InkTool;
  layout: Layout;
  canUndo: boolean;
  hasInk: boolean;
}

export interface ViewHandlers {
  pickTool(tool: Tool): void;
  pickColor(color: string): void;
  cycleSize(): void;
  undo(): void;
  clear(): void;
  more(): void;
  toggleDraw(): void;
  handleDown(e: PointerEvent): void;
}

/** The numbers tool has no icon: its button shows the badge the next click will drop. */
const TOOL_ICONS: Record<Exclude<Tool, "shape" | "number">, IconNode> = {
  pointer: MousePointer2,
  pen: Pen,
  highlighter: Highlighter,
  laser: CircleDot,
  eraser: Eraser,
};
const SHAPE_ICONS: Record<ShapeKind, IconNode> = {
  arrow: ArrowUpRight,
  rect: Square,
  ellipse: Circle,
  line: Slash,
};
const DOT_SIZES = [4, 7, 11];
/** Tools that lay down colored ink, so they show the current color under their icon. */
const INKED: ReadonlySet<Tool> = new Set(["pen", "highlighter", "laser", "shape"]);

const iconFor = (tool: Exclude<Tool, "number">, shape: ShapeKind) =>
  tool === "shape" ? SHAPE_ICONS[shape] : TOOL_ICONS[tool];

function icon(node: IconNode): SVGElement {
  return createElement(node, { "aria-hidden": "true" });
}

function button(className: string, label: string, onClick?: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = label;
  b.setAttribute("aria-label", label);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function toolLabel(tool: Tool, shape: ShapeKind): string {
  if (tool === "number") return `${t.number} (${TOOL_KEYS.number}) · ${t.numberHint}`;
  if (tool !== "shape") return `${t[tool]} (${TOOL_KEYS[tool]})`;
  const key = SHAPE_KEYS[shape];
  return `${t[shape]}${key ? ` (${key})` : ""} · ${t.shapeHint} (${TOOL_KEYS.shape})`;
}

/**
 * The toolbar's DOM. Rebuilt only when its structure changes (orientation, collapsed);
 * every other update just patches classes and attributes, so hover states and the
 * drag handle's pointer capture survive.
 */
export class ToolbarView {
  private structure = "";
  private tools = new Map<Tool, HTMLButtonElement>();
  private swatches: HTMLButtonElement[] = [];
  private size?: HTMLButtonElement;
  private undo?: HTMLButtonElement;
  private clear?: HTMLButtonElement;
  private toggle?: HTMLButtonElement;
  private handle?: HTMLButtonElement;
  private icons = new Map<HTMLButtonElement, IconNode>();

  constructor(
    private root: HTMLElement,
    private on: ViewHandlers,
  ) {}

  render(s: ViewState): void {
    const structure = `${s.layout.orientation}:${s.layout.collapsed}`;
    if (structure !== this.structure) {
      this.build(s);
      this.structure = structure;
    }
    this.patch(s);
  }

  private setIcon(b: HTMLButtonElement, node: IconNode): void {
    if (this.icons.get(b) === node) return;
    this.icons.set(b, node);
    b.querySelector("svg, .num")?.remove();
    b.prepend(icon(node));
  }

  private setBadge(b: HTMLButtonElement, n: number): void {
    this.icons.delete(b);
    b.querySelector("svg")?.remove();
    let badge = b.querySelector<HTMLElement>(".num");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "num";
      b.prepend(badge);
    }
    badge.textContent = String(n);
  }

  /** Icon for most tools; the live next-number badge for the numbers tool. */
  private paintTool(b: HTMLButtonElement, tool: Tool, s: ViewState): void {
    if (tool === "number") this.setBadge(b, s.tools.nextNumber);
    else this.setIcon(b, iconFor(tool, s.tools.shape));
  }

  private separator(): HTMLElement {
    const sep = document.createElement("div");
    sep.className = "sep";
    sep.setAttribute("role", "separator");
    return sep;
  }

  private build(s: ViewState): void {
    const { orientation, collapsed } = s.layout;
    const vertical = orientation === "vertical";
    this.root.className = `bar ${orientation}${collapsed ? " collapsed" : ""}`;
    this.root.replaceChildren();
    this.tools.clear();
    this.icons.clear();
    this.swatches = [];

    this.handle = button("handle", collapsed ? t.handleCollapsed : t.handle);
    this.handle.append(icon(vertical ? GripHorizontal : GripVertical));
    this.handle.addEventListener("pointerdown", (e) => this.on.handleDown(e));
    this.root.append(this.handle);

    if (collapsed) {
      this.toggle = button("tool", t.drawToggle, () => this.on.toggleDraw());
      this.root.append(this.toggle);
      return;
    }

    const tools = document.createElement("div");
    tools.className = "group";
    for (const tool of TOOLS) {
      const b = button(tool === "shape" ? "tool variants" : "tool", "", () => this.on.pickTool(tool));
      this.tools.set(tool, b);
      tools.append(b);
    }

    const colors = document.createElement("div");
    colors.className = "colors";
    COLORS.forEach((color, i) => {
      const b = button("swatch", `${t.colors[i]} (${i + 1})`, () => this.on.pickColor(color));
      b.style.setProperty("--c", color);
      this.swatches.push(b);
      colors.append(b);
    });

    this.size = button("size", "", () => this.on.cycleSize());
    this.size.append(document.createElement("span"));

    this.undo = button("", `${t.undo} (${UNDO_KEY})`, () => this.on.undo());
    this.undo.append(icon(Undo2));
    this.clear = button("", `${t.clear} (${CLEAR_KEY})`, () => this.on.clear());
    this.clear.append(icon(Trash2));
    const more = button("more", t.more, () => this.on.more());
    more.append(icon(vertical ? Ellipsis : EllipsisVertical));

    this.root.append(
      tools,
      this.separator(),
      colors,
      this.size,
      this.separator(),
      this.undo,
      this.clear,
      this.separator(),
      more,
    );
  }

  private patch(s: ViewState): void {
    const { tool, shape, color, size } = s.tools;
    this.root.style.setProperty("--ink", color);
    this.root.style.setProperty("--ink-text", textOn(color));

    if (this.toggle) {
      const shown = tool === "pointer" ? s.lastDrawTool : tool;
      this.paintTool(this.toggle, shown, s);
      this.toggle.classList.toggle("active", tool !== "pointer");
      this.toggle.classList.toggle("inked", INKED.has(shown));
    }

    for (const [name, b] of this.tools) {
      this.paintTool(b, name, s);
      b.classList.toggle("active", name === tool);
      b.classList.toggle("inked", name === tool && INKED.has(name));
      b.title = toolLabel(name, shape);
      b.setAttribute("aria-label", b.title);
      b.setAttribute("aria-pressed", String(name === tool));
    }

    this.swatches.forEach((b, i) => {
      const selected = COLORS[i] === color;
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", String(selected));
    });

    if (this.size) {
      this.size.style.setProperty("--d", `${DOT_SIZES[size]}px`);
      this.size.title = `${t.size}: ${t.sizes[size]} ([ ])`;
      this.size.setAttribute("aria-label", this.size.title);
    }
    if (this.undo) this.undo.disabled = !s.canUndo;
    if (this.clear) this.clear.disabled = !s.hasInk;
  }
}
