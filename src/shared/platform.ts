export const isMac = navigator.userAgent.includes("Mac");

/** Global hotkey registered by the Rust side (src-tauri/src/shortcuts.rs). */
export const TOGGLE_SHORTCUT = isMac ? "⌃⌥D" : "Ctrl+Alt+D";

/**
 * Native screen units per CSS pixel. Rust places windows in points on macOS and in physical
 * pixels on Windows (see `Rect` in overlay.rs).
 */
export const nativeScale = () => (isMac ? 1 : window.devicePixelRatio);

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
