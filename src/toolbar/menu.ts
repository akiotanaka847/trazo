import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { t } from "../shared/i18n";
import { TOGGLE_SHORTCUT } from "../shared/platform";
import type { ToolState } from "../shared/tools";
import type { Edge, Orientation } from "./dock";
import type { Layout } from "./state";

export interface MoreMenu {
  layout: Layout;
  tools: ToolState;
  canRedo: boolean;
  setOrientation(orientation: Orientation): void;
  setEdge(edge: Edge): void;
  redo(): void;
  toggleInk(): void;
  toggleCapture(): void;
  quit(): void;
}

const EDGES: readonly Edge[] = ["right", "left", "top", "bottom", "float"];

/**
 * A native menu rather than an HTML popover: it can spill outside the toolbar's tiny
 * window, and it looks like the rest of the OS.
 */
export async function openMoreMenu(m: MoreMenu): Promise<void> {
  const check = (text: string, checked: boolean, action: () => void) =>
    CheckMenuItem.new({ text, checked, action });
  const separator = () => PredefinedMenuItem.new({ item: "Separator" });

  const orientation = await Submenu.new({
    text: t.orientation,
    items: await Promise.all([
      check(t.vertical, m.layout.orientation === "vertical", () => m.setOrientation("vertical")),
      check(t.horizontal, m.layout.orientation === "horizontal", () => m.setOrientation("horizontal")),
    ]),
  });
  const position = await Submenu.new({
    text: t.position,
    items: await Promise.all(EDGES.map((edge) => check(t[edge], m.layout.edge === edge, () => m.setEdge(edge)))),
  });

  const menu = await Menu.new({
    items: [
      orientation,
      position,
      await separator(),
      await MenuItem.new({ text: t.redo, enabled: m.canRedo, action: m.redo }),
      await check(t.hideInk, m.tools.inkHidden, m.toggleInk),
      await check(t.hideFromCapture, m.layout.hideFromCapture, m.toggleCapture),
      await separator(),
      await MenuItem.new({ text: `${t.shortcut}: ${TOGGLE_SHORTCUT}`, enabled: false }),
      await MenuItem.new({ text: t.quit, action: m.quit }),
    ],
  });
  await menu.popup();
}
