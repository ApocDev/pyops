// PyOps desktop shell. The whole app (UI + backend) is the Nitro server; this shell
// runs that server and shows it in a window.
//   - dev:   `beforeDevCommand` starts the server (see tauri.conf.json); we just wait
//            for it and open the window.
//   - bundle: we start the server ourselves via the vendored `node` sidecar against
//            the bundled `.output`, with the data/migrations/mod dirs passed in.
use std::net::TcpStream;
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

// External `<a>` clicks (incl. target=_blank, which on_navigation alone misses)
// become a same-frame navigation, which the on_navigation hook cancels and hands to
// the system browser — so links like the GitHub button open in the user's browser
// instead of hijacking the app window.
const EXTERNAL_LINKS_SCRIPT: &str = r#"
window.addEventListener('click', function (e) {
  var a = e.target && e.target.closest && e.target.closest('a[href]');
  if (a && /^https?:\/\//i.test(a.href) && a.origin !== window.location.origin) {
    e.preventDefault();
    window.location.href = a.href;
  }
}, true);
"#;

use std::sync::Mutex;
use tauri_plugin_updater::UpdaterExt;
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const PORT: u16 = 34115;

/// Holds the sidecar server process so it can be killed when the app exits.
#[cfg(not(debug_assertions))]
struct ServerChild(Mutex<Option<CommandChild>>);

/// Block until something accepts connections on the port, or time out.
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// Open the main window (hidden) pointed at the local server, revealing it only once
/// the first page has painted — so the user never sees a blank webview while the
/// server boots / server-renders.
fn open_main_window(app: &tauri::AppHandle) {
    let url = format!("http://localhost:{PORT}");
    // First-run size, wide enough for the desktop nav even with fractional display
    // scaling (the inline bar collapses to a hamburger below 1400 CSS px, and a 1.25x
    // scale makes the CSS viewport ~physical/1.25; the Deck's ~1280 intentionally
    // stays collapsed). After the first run, the window-state plugin restores whatever
    // size/position the user left it at. Title carries the version (tauri.conf.json).
    let title = format!("PyOps v{}", app.package_info().version);
    let nav_handle = app.clone();
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
        .title(title)
        .inner_size(1800.0, 1100.0)
        .min_inner_size(900.0, 600.0)
        .visible(false)
        .initialization_script(EXTERNAL_LINKS_SCRIPT)
        .on_navigation(move |url| {
            // Stay on the local server; send any other web link to the system browser.
            let is_local = matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
            if matches!(url.scheme(), "http" | "https") && !is_local {
                let _ = nav_handle.opener().open_url(url.as_str(), None::<&str>);
                return false;
            }
            true
        })
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build();
    // Restore the user's last size/position (a no-op on first run). The window-state
    // plugin saves it again on exit.
    if let Ok(w) = win {
        let _ = w.restore_state(StateFlags::all());
    }
}

/// Holds the update found by `updater_check` so `updater_install` can consume it.
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

/// Update metadata handed to the web UI (which renders its own toast + changelog).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Download progress, streamed to the UI over a channel so it can show a bar.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum DownloadEvent {
    Progress {
        chunk_length: usize,
        content_length: Option<u64>,
    },
    Finished,
}

/// Check GitHub for a newer release. Returns its metadata (and stashes the pending
/// update for `updater_install`), or `null` if current / the check failed. The web UI
/// calls this on launch, guarded by `window.isTauri`, so a plain browser never does.
#[tauri::command]
async fn updater_check(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Download + install the pending update (streaming progress), then relaunch. The
/// signature verifies against the baked-in public key inside `download_and_install`.
#[tauri::command]
async fn updater_install(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    on_event: tauri::ipc::Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no pending update".to_string())?;
    let on_finish = on_event.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = on_event.send(DownloadEvent::Progress {
                    chunk_length,
                    content_length,
                });
            },
            move || {
                let _ = on_finish.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

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

    let app = tauri::Builder::default()
        // Must be the first plugin: a second launch focuses the existing window and
        // exits before setup() spawns another server, so we never collide on the port.
        // (Multiple instances / multiple open projects is tracked in #41.)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![updater_check, updater_install])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Bundled build: start the server via the vendored node sidecar. The data
            // dir is the per-OS app-data dir; migrations + mod source are bundled
            // resources. (In dev the server is already up from beforeDevCommand.)
            #[cfg(not(debug_assertions))]
            {
                let server_entry =
                    app.path().resolve("output/server/index.mjs", BaseDirectory::Resource)?;
                let drizzle = app.path().resolve("drizzle", BaseDirectory::Resource)?;
                let mod_dir = app.path().resolve("mod", BaseDirectory::Resource)?;
                let data_dir = app.path().app_data_dir()?;
                std::fs::create_dir_all(&data_dir).ok();

                let (mut rx, child) = app
                    .shell()
                    .sidecar("node")?
                    .arg(server_entry.to_string_lossy().to_string())
                    .env("PORT", PORT.to_string())
                    .env("HOST", "127.0.0.1")
                    .env("PYOPS_DATA_DIR", data_dir.to_string_lossy().to_string())
                    .env("PYOPS_MIGRATIONS_DIR", drizzle.to_string_lossy().to_string())
                    .env("PYOPS_MOD_DIR", mod_dir.to_string_lossy().to_string())
                    .spawn()?;
                app.manage(ServerChild(Mutex::new(Some(child))));
                // keep the pipe drained so the child never blocks on a full stdout
                tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            }

            // The web UI drives the update check (calls `updater_check` on launch when
            // it detects it's inside the desktop shell), so nothing to spawn here.

            // Wait for the server off the main thread, then open the window on it.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                wait_for_port(PORT, Duration::from_secs(90));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || open_main_window(&h));
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_handle, event| {
        if let RunEvent::Exit = event {
            #[cfg(not(debug_assertions))]
            if let Some(state) = _handle.try_state::<ServerChild>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
