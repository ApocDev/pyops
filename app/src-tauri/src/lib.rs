#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // webkit2gtk on Wayland raises "Error 71 (Protocol error)" and its DMABUF renderer
  // glitches on some GPU/compositor combos, so force XWayland + the non-DMABUF path.
  // Must be set before GTK initializes; only fill in what the user hasn't overridden.
  #[cfg(target_os = "linux")]
  {
    if std::env::var_os("GDK_BACKEND").is_none() {
      std::env::set_var("GDK_BACKEND", "x11");
    }
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
      std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
  }

  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
