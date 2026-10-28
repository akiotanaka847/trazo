//! AppKit settings Tauri doesn't expose: the window level and Spaces behaviour that let an
//! overlay float above the menu bar, the Dock and other apps' full-screen presentations.

use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

/// Must run on the main thread.
pub fn float_above_everything(window: &tauri::WebviewWindow, level: isize) {
    let Ok(ptr) = window.ns_window() else { return };
    // SAFETY: `ns_window` is the live NSWindow behind this Tauri window, and callers only
    // touch it from the main thread.
    let ns_window = unsafe { &*ptr.cast::<NSWindow>() };
    ns_window.setLevel(level);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    ns_window.setHidesOnDeactivate(false);
}
