// Browser preview only: stands in for the Rust side so a Trazo page runs in a plain browser
// frame. Events go through the host page (dev/host.ts), which relays them to every frame.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Args = Record<string, any>;

export function fakeTauri(label: string): void {
  mockWindows(label);
  const handlers = new Map<string, number[]>();
  const internals = (window as any).__TAURI_INTERNALS__;

  window.addEventListener("message", ({ data: m }) => {
    if (m?.type !== "trazo-event" || (m.target && m.target !== label)) return;
    for (const id of handlers.get(m.event) ?? []) {
      internals.runCallback(id, { event: m.event, id, payload: m.payload });
    }
  });

  const toHost = (message: Args) => window.parent.postMessage(message, "*");
  const viewport = () => ({ x: 0, y: 0, width: window.parent.innerWidth, height: window.parent.innerHeight });

  mockIPC((cmd: string, args: Args = {}) => {
    switch (cmd) {
      case "plugin:event|listen":
        handlers.set(args.event, [...(handlers.get(args.event) ?? []), args.handler]);
        return args.handler;
      case "plugin:event|emit":
        return toHost({ type: "trazo-event", event: args.event, payload: args.payload });
      case "plugin:event|emit_to":
        return toHost({ type: "trazo-event", event: args.event, payload: args.payload, target: args.target?.label });
      case "list_monitors":
        return [{ bounds: viewport(), workArea: viewport(), scale: window.devicePixelRatio }];
      case "set_frame":
        return toHost({ type: "trazo-frame", label, ...args });
      case "set_drawing":
        return toHost({ type: "trazo-drawing", active: args.active });
      case "plugin:menu|new":
        return [Math.floor(Math.random() * 1e9), "preview"];
      default:
        return null; // window show/hide, focus hand-off, menu popup: nothing to do in a browser
    }
  });
}
