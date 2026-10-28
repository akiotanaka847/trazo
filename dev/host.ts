// Browser preview only: plays the window manager. Relays events between the frames, moves the
// toolbar and panel frames where `set_frame` asks, shows and hides them, and lets clicks
// through the canvas in pointer mode.
const canvas = document.getElementById("canvas") as HTMLIFrameElement;
const toolbar = document.getElementById("toolbar") as HTMLIFrameElement;
const panel = document.getElementById("panel") as HTMLIFrameElement;
const frames: Record<string, HTMLIFrameElement> = { toolbar, panel };

window.addEventListener("message", ({ data: m }) => {
  switch (m?.type) {
    case "trazo-event":
      for (const frame of [canvas, toolbar, panel]) frame.contentWindow?.postMessage(m, "*");
      break;
    case "trazo-visible":
      // Like a hidden native window, a hidden frame keeps its layout so its page can measure itself.
      if (frames[m.label]) frames[m.label].style.visibility = m.visible ? "visible" : "hidden";
      break;
    case "trazo-frame":
      if (!frames[m.label]) break;
      Object.assign(frames[m.label].style, {
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
