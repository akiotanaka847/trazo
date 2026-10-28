mod focus;
#[cfg(target_os = "macos")]
mod macos;
mod overlay;
mod shortcuts;
mod tray;

pub fn run() {
    tauri::Builder::default()
        // A second launch would stack a second set of overlays: wake the first one instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            overlay::reveal_toolbar(app)
        }))
        .plugin(shortcuts::plugin())
        .manage(overlay::OverlayState::default())
        .invoke_handler(tauri::generate_handler![
            overlay::list_monitors,
            overlay::set_frame,
            overlay::set_drawing,
            overlay::sync_canvases,
            overlay::restore_focus,
            overlay::quit,
        ])
        .setup(|app| {
            // Menu-bar utility: no Dock icon, and it can float over other apps' full-screen Spaces.
            // Debug builds keep the Dock icon with TRAZO_DOCK=1, so UI-automation tools that only
            // list regular apps can drive it.
            #[cfg(target_os = "macos")]
            if !(cfg!(debug_assertions) && std::env::var_os("TRAZO_DOCK").is_some()) {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            focus::init();
            overlay::sync(app.handle())?;
            overlay::create_toolbar(app.handle())?;
            tray::create(app.handle())?;
            shortcuts::register_toggle(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Trazo");
}
