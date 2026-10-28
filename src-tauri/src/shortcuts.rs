//! Global hotkeys: Ctrl+Alt+D toggles drawing from any app, and Esc is grabbed only while
//! drawing, as an exit that still works if the canvas somehow lost keyboard focus.

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::overlay::TOOLBAR;

fn toggle() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD)
}

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let name = if *shortcut == toggle() {
                "toggle-draw"
            } else if *shortcut == escape() {
                "exit-draw"
            } else {
                return;
            };
            let _ = app.emit_to(TOOLBAR, name, ());
        })
        .build()
}

pub fn register_toggle(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().register(toggle()) {
        eprintln!("Trazo: could not register Ctrl+Alt+D ({e})");
    }
}

pub fn set_escape(app: &AppHandle, grab: bool) {
    let shortcuts = app.global_shortcut();
    let result = if grab { shortcuts.register(escape()) } else { shortcuts.unregister(escape()) };
    if let Err(e) = result {
        eprintln!("Trazo: could not toggle the Esc shortcut ({e})");
    }
}
