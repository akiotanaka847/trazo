//! The two kinds of windows Trazo floats over the desktop: one transparent canvas per
//! monitor, and a single small toolbar that always stays above them.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{focus, shortcuts};

pub const TOOLBAR: &str = "toolbar";
const CANVAS_PREFIX: &str = "canvas_";

/// macOS window levels. Canvases sit above the menu bar and the Dock (NSStatusWindowLevel);
/// the toolbar sits one level higher so a focused canvas can never cover it.
#[cfg(target_os = "macos")]
const CANVAS_LEVEL: isize = 25;
#[cfg(target_os = "macos")]
const TOOLBAR_LEVEL: isize = 26;

#[derive(Default)]
pub struct OverlayState {
    drawing: AtomicBool,
}

/// A rectangle in "native units": points on macOS (the only space that stays continuous
/// across displays with different scale factors), physical pixels everywhere else.
#[derive(Clone, Copy, Serialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    fn from_physical(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Self {
        let s = if cfg!(target_os = "macos") { scale } else { 1.0 };
        Rect {
            x: x as f64 / s,
            y: y as f64 / s,
            width: width as f64 / s,
            height: height as f64 / s,
        }
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    bounds: Rect,
    work_area: Rect,
    scale: f64,
}

fn bounds(m: &Monitor) -> Rect {
    let (p, s) = (m.position(), m.size());
    Rect::from_physical(p.x, p.y, s.width, s.height, m.scale_factor())
}

fn work_area(m: &Monitor) -> Rect {
    let a = m.work_area();
    Rect::from_physical(a.position.x, a.position.y, a.size.width, a.size.height, m.scale_factor())
}

fn canvas_label(m: &Monitor) -> String {
    let (p, s) = (m.position(), m.size());
    format!("{CANVAS_PREFIX}{}_{}_{}_{}", p.x, p.y, s.width, s.height)
}

fn canvases(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(CANVAS_PREFIX))
        .map(|(_, window)| window)
        .collect()
}

/// Size first, then position: whichever corner AppKit keeps fixed while resizing, the last
/// call pins the top-left where we want it.
fn place(window: &WebviewWindow, r: Rect) -> tauri::Result<()> {
    if cfg!(target_os = "macos") {
        window.set_size(tauri::LogicalSize::new(r.width, r.height))?;
        window.set_position(tauri::LogicalPosition::new(r.x, r.y))
    } else {
        let size = tauri::PhysicalSize::new(r.width.round() as u32, r.height.round() as u32);
        window.set_size(size)?;
        window.set_position(tauri::PhysicalPosition::new(r.x.round() as i32, r.y.round() as i32))
    }
}

fn create_canvas(app: &AppHandle, monitor: &Monitor, drawing: bool) -> tauri::Result<()> {
    let url = WebviewUrl::App("canvas.html".into());
    let window = WebviewWindowBuilder::new(app, canvas_label(monitor), url)
        .title("Trazo")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .focused(false)
        .visible(false)
        .build()?;
    place(&window, bounds(monitor))?;
    window.set_ignore_cursor_events(!drawing)?;
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        window.run_on_main_thread(move || crate::macos::float_above_everything(&w, CANVAS_LEVEL))?;
    }
    window.show()
}

/// Makes the canvases match the connected monitors: one per display, created or closed as
/// screens come and go. Canvases that stay keep their drawings.
pub fn sync(app: &AppHandle) -> tauri::Result<()> {
    let drawing = app.state::<OverlayState>().drawing.load(Ordering::Relaxed);
    let monitors = app.available_monitors()?;
    let wanted: Vec<String> = monitors.iter().map(canvas_label).collect();
    for window in canvases(app) {
        if !wanted.iter().any(|label| label == window.label()) {
            let _ = app.emit_to(TOOLBAR, "canvas-closed", window.label());
            window.destroy()?;
        }
    }
    for monitor in &monitors {
        if app.get_webview_window(&canvas_label(monitor)).is_none() {
            create_canvas(app, monitor, drawing)?;
        }
    }
    Ok(())
}

pub fn create_toolbar(app: &AppHandle) -> tauri::Result<()> {
    let url = WebviewUrl::App("toolbar.html".into());
    let builder = WebviewWindowBuilder::new(app, TOOLBAR, url)
        .title("Trazo")
        .inner_size(44.0, 320.0)
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        // Clicking the toolbar must not pull keyboard focus away from the canvas (or, on
        // Windows, from the presentation behind it).
        .focusable(false)
        .focused(false)
        // The page shows it once it has measured itself and moved to its saved spot.
        .visible(false);

    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        builder
            .shadow(true)
            .theme(Some(tauri::Theme::Dark))
            .effects(
                EffectsBuilder::new()
                    .effect(Effect::HudWindow)
                    // Our app is almost never the active one; keep the blur from greying out.
                    .state(EffectState::Active)
                    .radius(12.0)
                    .build(),
            )
    };
    #[cfg(not(target_os = "macos"))]
    let builder = builder.shadow(false);

    let _window = builder.build()?;
    #[cfg(target_os = "macos")]
    crate::macos::float_above_everything(&_window, TOOLBAR_LEVEL);
    Ok(())
}

pub fn reveal_toolbar(app: &AppHandle) {
    let _ = app.emit_to(TOOLBAR, "reveal", ());
}

fn canvas_under_cursor(app: &AppHandle) -> Option<WebviewWindow> {
    let cursor = app.cursor_position().ok()?;
    // tao reports the macOS cursor in the primary display's pixels; bring it back to points.
    let scale = if cfg!(target_os = "macos") {
        app.primary_monitor().ok().flatten().map_or(1.0, |m| m.scale_factor())
    } else {
        1.0
    };
    let (x, y) = (cursor.x / scale, cursor.y / scale);
    let monitors = app.available_monitors().ok()?;
    monitors
        .iter()
        .find(|m| bounds(m).contains(x, y))
        .and_then(|m| app.get_webview_window(&canvas_label(m)))
        .or_else(|| canvases(app).into_iter().next())
}

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| MonitorInfo { bounds: bounds(m), work_area: work_area(m), scale: m.scale_factor() })
        .collect())
}

/// Moves and resizes a window in one call (native units), so the toolbar never shows a frame
/// at its new size in its old place when it flips orientation or collapses.
#[tauri::command]
pub fn set_frame(window: WebviewWindow, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    place(&window, Rect { x, y, width, height }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_canvases(app: AppHandle) -> Result<(), String> {
    sync(&app).map_err(|e| e.to_string())
}

/// Drawing: canvases catch the mouse and the one under the cursor takes keyboard focus.
/// Pointer mode: clicks fall through to the apps below and focus goes back to them.
#[tauri::command]
pub async fn set_drawing(app: AppHandle, active: bool) -> Result<(), String> {
    let was_drawing = app.state::<OverlayState>().drawing.swap(active, Ordering::Relaxed);
    if active {
        // A display plugged in since the last stroke should be drawable too.
        sync(&app).map_err(|e| e.to_string())?;
    }
    for window in canvases(&app) {
        window.set_ignore_cursor_events(!active).map_err(|e| e.to_string())?;
    }
    if active {
        if !was_drawing {
            focus::remember();
        }
        if let Some(canvas) = canvas_under_cursor(&app) {
            canvas.set_focus().map_err(|e| e.to_string())?;
        }
        // On Windows every overlay is "topmost" and the last one focused wins; macOS orders
        // them by window level instead.
        #[cfg(not(target_os = "macos"))]
        if let Some(toolbar) = app.get_webview_window(TOOLBAR) {
            let _ = toolbar.set_always_on_top(true);
        }
        shortcuts::set_escape(&app, true);
    } else {
        shortcuts::set_escape(&app, false);
        if was_drawing {
            focus::restore(&app);
        }
    }
    Ok(())
}

/// Clicking the toolbar in pointer mode activates Trazo on macOS; hand focus straight back
/// so the presentation keeps receiving the arrow keys.
#[tauri::command]
pub fn restore_focus(app: AppHandle) {
    if !app.state::<OverlayState>().drawing.load(Ordering::Relaxed) {
        focus::restore(&app);
    }
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
