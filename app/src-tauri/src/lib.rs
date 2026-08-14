// PyOps desktop shell. The whole app (UI + backend) is the Nitro server; this shell
// runs that server and shows it in a window.
//   - dev:   `beforeDevCommand` starts the server (see tauri.conf.json); we just wait
//            for it and open the window.
//   - bundle: we start the server ourselves via the vendored `node` sidecar against
//            the bundled `.output`, with the data/migrations/mod dirs passed in.
//            Everything the server prints (plus launcher lifecycle lines) goes to
//            `server.log` in the data dir, so a failed startup on a user's machine
//            is debuggable from the one file the diagnostic page points at.
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

#[cfg(not(debug_assertions))]
use std::io::Write as _;
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use tauri::path::BaseDirectory;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

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

const PORT: u16 = 34115;

/// Holds the sidecar server process so it can be killed when the app exits.
#[cfg(not(debug_assertions))]
struct ServerChild(Mutex<Option<CommandChild>>);

/// `server.log` in the data dir: launcher lifecycle lines (stamped with seconds
/// since launch) interleaved with the server's own stdout/stderr, verbatim. One log
/// per launch — the previous one is kept as `server.log.old`. This file exists so
/// user bug reports are debuggable without a terminal, so it must never take the app
/// down with it: a failed create just disables logging.
#[cfg(not(debug_assertions))]
#[derive(Clone)]
struct ServerLog {
    file: Arc<Mutex<Option<std::fs::File>>>,
    start: Instant,
}

#[cfg(not(debug_assertions))]
impl ServerLog {
    fn create(dir: &std::path::Path) -> (Self, std::path::PathBuf) {
        let path = dir.join("server.log");
        let _ = std::fs::rename(&path, dir.join("server.log.old"));
        let log = Self {
            file: Arc::new(Mutex::new(std::fs::File::create(&path).ok())),
            start: Instant::now(),
        };
        (log, path)
    }

    /// One line of the server's own output, verbatim.
    fn output(&self, line: &[u8]) {
        if let Some(f) = self.file.lock().unwrap().as_mut() {
            let _ = f.write_all(line);
            let _ = f.write_all(b"\n");
        }
    }

    /// A launcher-side lifecycle line.
    fn line(&self, msg: &str) {
        let t = self.start.elapsed().as_secs_f32();
        if let Some(f) = self.file.lock().unwrap().as_mut() {
            let _ = writeln!(f, "[launcher +{t:.1}s] {msg}");
        }
    }
}

/// The page shown when the local server didn't come up in time: says what happened
/// in user terms and points at the log file to attach to a bug report. The launcher
/// keeps polling the port behind it and swaps in the app the moment the server is
/// reachable (first launches can be slow — e.g. antivirus scanning the fresh
/// install), so the page also self-heals.
fn error_page_url(log_path: Option<&str>) -> String {
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    };
    let diagnostics = match log_path {
        Some(p) => format!(
            "<p>If it keeps failing, this log file records what the server said — \
             please attach it to a bug report:</p><p><code>{}</code></p>",
            escape(p)
        ),
        None => "<p>Check the terminal running the dev server for errors.</p>".to_string(),
    };
    let html = format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>PyOps</title><style>
:root{{color-scheme:dark}}
body{{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#111418;color:#e6e6e6;font:15px/1.55 system-ui,sans-serif}}
main{{max-width:36rem;padding:2rem}}
h1{{font-size:1.15rem;margin:0 0 .75rem}}
p{{margin:.5rem 0;color:#b6bcc4}}
code{{user-select:all;background:#1c2127;padding:.15rem .4rem;font-size:.85em;word-break:break-all}}
button{{margin-top:1rem;background:#2563eb;border:0;color:#fff;font:inherit;padding:.5rem 1rem;cursor:pointer}}
</style></head><body><main>
<h1>PyOps couldn't reach its local server</h1>
<p>The app runs a local server in the background, and it hasn't come up yet. This
window keeps checking and loads the app automatically the moment the server is
reachable — on a first launch that can take a while.</p>
<p>If nothing happens for a few minutes, close the app and start it again.</p>
{diagnostics}
<button onclick="window.location.replace('http://localhost:{PORT}')">Retry now</button>
</main></body></html>"#
    );
    format!("data:text/html;base64,{}", BASE64.encode(html))
}

/// Open the app window (label "main") at `url`. Normally hidden until the first page
/// has painted — so the user never sees a blank webview while the server
/// server-renders — but the diagnostic page opens visible immediately.
fn open_window(app: &tauri::AppHandle, url: String, visible: bool) {
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
        .visible(visible)
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

// The self-updater is the standard tauri-plugin-updater + tauri-plugin-process,
// driven from the web UI via their JS APIs (guarded by `window.isTauri`). The window
// loads the app over HTTP, so that content is "remote" to Tauri and the capability
// grants it `updater:default` + `process:default` (see capabilities/default.json).

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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Set when the server process dies (or never spawns) — lets the port
            // wait below bail out immediately instead of sitting through the full
            // timeout on a server that will never come up.
            let server_exited = Arc::new(AtomicBool::new(false));
            #[cfg(debug_assertions)]
            let log_path: Option<String> = None;

            // Bundled build: start the server via the vendored node sidecar. The data
            // dir is the per-OS app-data dir; migrations + mod source are bundled
            // resources. (In dev the server is already up from beforeDevCommand.)
            #[cfg(not(debug_assertions))]
            let (server_log, log_path) = {
                // Tauri can resolve resources to `\\?\C:\…` extended-length paths on
                // Windows; Node itself copes, but not every library does — pass the
                // plain form to the sidecar.
                let server_entry = dunce::simplified(
                    &app.path()
                        .resolve("output/server/index.mjs", BaseDirectory::Resource)?,
                )
                .to_path_buf();
                let drizzle =
                    dunce::simplified(&app.path().resolve("drizzle", BaseDirectory::Resource)?)
                        .to_path_buf();
                let mod_dir =
                    dunce::simplified(&app.path().resolve("mod", BaseDirectory::Resource)?)
                        .to_path_buf();
                let data_dir = dunce::simplified(&app.path().app_data_dir()?).to_path_buf();
                std::fs::create_dir_all(&data_dir).ok();

                let (server_log, log_file) = ServerLog::create(&data_dir);
                server_log.line(&format!(
                    "PyOps v{} launching server",
                    app.package_info().version
                ));
                server_log.line(&format!("entry: {}", server_entry.display()));
                server_log.line(&format!("data dir: {}", data_dir.display()));

                let spawned = app.shell().sidecar("node").and_then(|cmd| {
                    cmd.arg(server_entry.to_string_lossy().to_string())
                        .env("PORT", PORT.to_string())
                        .env("HOST", "127.0.0.1")
                        // The server watches its piped stdin and exits on EOF, so it
                        // dies with this process even on paths that skip RunEvent::Exit
                        // (the updater's install step kills the app without it, which
                        // left an orphaned node.exe locking files mid-update).
                        .env("PYOPS_EXIT_ON_STDIN_CLOSE", "1")
                        .env("PYOPS_DATA_DIR", data_dir.to_string_lossy().to_string())
                        .env(
                            "PYOPS_MIGRATIONS_DIR",
                            drizzle.to_string_lossy().to_string(),
                        )
                        .env("PYOPS_MOD_DIR", mod_dir.to_string_lossy().to_string())
                        .spawn()
                });
                match spawned {
                    Ok((mut rx, child)) => {
                        app.manage(ServerChild(Mutex::new(Some(child))));
                        let log = server_log.clone();
                        let exited = server_exited.clone();
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                                        log.output(&line)
                                    }
                                    CommandEvent::Error(e) => {
                                        log.line(&format!("server process error: {e}"))
                                    }
                                    CommandEvent::Terminated(p) => {
                                        log.line(&format!(
                                            "server exited (code {:?}, signal {:?})",
                                            p.code, p.signal
                                        ));
                                        exited.store(true, Ordering::Relaxed);
                                    }
                                    _ => {}
                                }
                            }
                        });
                    }
                    Err(e) => {
                        server_log.line(&format!("failed to spawn the server: {e}"));
                        server_exited.store(true, Ordering::Relaxed);
                    }
                }
                (server_log, Some(log_file.display().to_string()))
            };

            // The web UI drives the update via the updater/process plugins on launch
            // (guarded by window.isTauri), so nothing to spawn here.

            // Wait for the server off the main thread: open the app window when the
            // port answers, or the diagnostic page if the server died / timed out.
            // The page isn't a dead end — we keep polling and load the app the
            // moment the server shows up late (slow first launches are real, e.g.
            // antivirus scanning the fresh install).
            let handle = app.handle().clone();
            let exited = server_exited.clone();
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(90);
                let ready = loop {
                    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                        break true;
                    }
                    if exited.load(Ordering::Relaxed) || Instant::now() >= deadline {
                        break false;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                };
                if ready {
                    #[cfg(not(debug_assertions))]
                    server_log.line("server ready, opening the app");
                    let h = handle.clone();
                    let _ = handle.run_on_main_thread(move || {
                        open_window(&h, format!("http://localhost:{PORT}"), false)
                    });
                    return;
                }
                #[cfg(not(debug_assertions))]
                server_log.line("server not reachable, showing the diagnostic page");
                let url = error_page_url(log_path.as_deref());
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || open_window(&h, url, true));
                loop {
                    if TcpStream::connect(("127.0.0.1", PORT)).is_ok() {
                        #[cfg(not(debug_assertions))]
                        server_log.line("server came up late, loading the app");
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.eval(&format!(
                                "window.location.replace('http://localhost:{PORT}')"
                            ));
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
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
