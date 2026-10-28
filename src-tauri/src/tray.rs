//! Menu-bar (macOS) / system-tray (Windows) icon. Every item except Quit is forwarded to the
//! toolbar, which owns the app state.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::overlay::TOOLBAR;

/// macOS paints a template image in the menu bar's own color (white when dark, black when
/// light). Windows draws tray pixels as they are, so a black glyph would vanish on its dark
/// taskbar: it gets the color app icon instead.
#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/32x32.png");

struct Labels {
    draw: &'static str,
    toolbar: &'static str,
    ink: &'static str,
    clear: &'static str,
    quit: &'static str,
}

fn labels() -> Labels {
    let spanish = sys_locale::get_locale().is_some_and(|locale| locale.starts_with("es"));
    if spanish {
        Labels {
            draw: "Dibujar",
            toolbar: "Mostrar u ocultar la barra",
            ink: "Mostrar u ocultar los trazos",
            clear: "Borrar todo",
            quit: "Salir de Trazo",
        }
    } else {
        Labels {
            draw: "Draw",
            toolbar: "Show or hide the toolbar",
            ink: "Show or hide drawings",
            clear: "Clear all",
            quit: "Quit Trazo",
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let t = labels();
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "toggle-draw", t.draw, true, Some("Ctrl+Alt+D"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle-toolbar", t.toolbar, true, None::<&str>)?,
            &MenuItem::with_id(app, "toggle-ink", t.ink, true, None::<&str>)?,
            &MenuItem::with_id(app, "clear", t.clear, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", t.quit, true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id("trazo")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Trazo")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            id => {
                let _ = app.emit_to(TOOLBAR, "tray", id.to_string());
            }
        })
        .build(app)?;
    Ok(())
}
