//! Keyboard focus hand-off. Drawing needs a canvas focused (Esc, undo, tool keys, the custom
//! cursor); the moment we go back to pointer mode, the app the user was presenting from gets
//! its focus back so the arrow keys keep advancing slides.

pub use imp::{init, remember, restore};

#[cfg(target_os = "macos")]
mod imp {
    use block2::RcBlock;
    use objc2_app_kit::{
        NSApplicationActivationOptions, NSRunningApplication, NSWorkspace,
        NSWorkspaceDidActivateApplicationNotification,
    };
    use objc2_foundation::{NSNotification, NSOperationQueue};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicI32, Ordering};

    /// PID of the last app other than Trazo that was frontmost.
    static LAST_APP: AtomicI32 = AtomicI32::new(0);

    fn note_frontmost() {
        let own = std::process::id() as i32;
        if let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() {
            let pid = app.processIdentifier();
            if pid != own {
                LAST_APP.store(pid, Ordering::Relaxed);
            }
        }
    }

    /// Our toolbar is a regular window, so a click on it activates Trazo before any of our
    /// code runs; asking "who was frontmost?" at that point would answer "us". Track
    /// activations as they happen instead.
    pub fn init() {
        note_frontmost();
        let block = RcBlock::new(|_: NonNull<NSNotification>| note_frontmost());
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        // SAFETY: the block runs on the main queue and only reads thread-safe AppKit state.
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidActivateApplicationNotification),
                None,
                Some(&NSOperationQueue::mainQueue()),
                &block,
            )
        };
        // Observes for the whole life of the process.
        std::mem::forget(observer);
    }

    pub fn remember() {}

    pub fn restore(app: &tauri::AppHandle) {
        let _ = app.run_on_main_thread(|| {
            let pid = LAST_APP.load(Ordering::Relaxed);
            if pid <= 0 {
                return;
            }
            if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
                app.activateWithOptions(NSApplicationActivationOptions::empty());
            }
        });
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    static LAST_WINDOW: AtomicIsize = AtomicIsize::new(0);

    pub fn init() {}

    /// The toolbar never takes focus on Windows, so whatever is in the foreground right
    /// before a canvas grabs it is the window to give it back to.
    pub fn remember() {
        // SAFETY: plain Win32 queries with valid out-pointers.
        unsafe {
            let hwnd = GetForegroundWindow();
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
            if pid != std::process::id() {
                LAST_WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
            }
        }
    }

    pub fn restore(_app: &tauri::AppHandle) {
        let raw = LAST_WINDOW.load(Ordering::Relaxed);
        if raw != 0 {
            // SAFETY: a stale handle just makes the call fail.
            unsafe {
                let _ = SetForegroundWindow(HWND(raw as *mut _));
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    pub fn init() {}
    pub fn remember() {}
    pub fn restore(_app: &tauri::AppHandle) {}
}
