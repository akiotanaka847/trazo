// Browser preview only: plays the window manager. Relays events between the frames, moves the
// toolbar frame where `set_frame` asks, and lets clicks through the canvas in pointer mode.
const canvas = document.getElementById("canvas") as HTMLIFrameElement;
const toolbar = document.getElementById("toolbar") as HTMLIFrameElement;

window.addEventListener("message", ({ data: m }) => {
  switch (m?.type) {
    case "trazo-event":
      for (const frame of [canvas, toolbar]) frame.contentWindow?.postMessage(m, "*");
      break;
    case "trazo-frame":
      Object.assign(toolbar.style, {
        left: `${m.x}px`,
        top: `${m.y}px`,
        width: `${m.width}px`,
        height: `${m.height}px`,
      });
      break;
    case "trazo-drawing":
      canvas.style.pointerEvents = m.active ? "auto" : "none";
      break;
  }
});
