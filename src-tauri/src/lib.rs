#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod discovery;
mod helpers;
mod logger;
mod platform;
mod server;
mod setup;
mod state;
mod updater;
mod watchdog;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

use crate::state::AppState;

const VISIT_DURATION_SECS: u64 = 15;

#[tauri::command]
fn get_logs() -> Vec<logger::LogEntry> {
    logger::read_log_file(1000)
}

#[tauri::command]
fn clear_logs() {
    logger::clear_log_file();
}

#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) {
    if let Ok(log_dir) = app.path().app_log_dir() {
        let _ = std::process::Command::new("open").arg(&log_dir).spawn();
    }
}

#[tauri::command]
fn set_dev_mode(enabled: bool, app: tauri::AppHandle) {
    crate::app_log!("[dev] dev-mode-changed -> {}", enabled);
    let _ = app.emit("dev-mode-changed", enabled);
}

#[tauri::command]
fn scenario_override(status: Option<String>, app: tauri::AppHandle) {
    match &status {
        Some(s) => {
            crate::app_log!("[scenario] override -> {}", s);
            let _ = app.emit("scenario-override", serde_json::json!({ "status": s }));
        }
        None => {
            crate::app_log!("[scenario] override cleared");
            let _ = app.emit("scenario-override", serde_json::Value::Null);
        }
    }
}

#[tauri::command]
fn preview_dialog(dialog_id: String, app: tauri::AppHandle) {
    use crate::setup::shell::macos_dialog;

    std::thread::spawn(move || {
        let current = env!("CARGO_PKG_VERSION");

        match dialog_id.as_str() {
            // --- Update dialogs ---
            "update_available" => {
                let script = format!(
                    "display alert \"Ani-Mime v99.0.0 Available\" message \"You are currently on v{}.\\n\\nA new version is ready with improvements and bug fixes.\\nTap Changelog to see what is new.\" buttons {{\"Later\", \"Changelog\", \"Update Now\"}} default button \"Update Now\"",
                    current,
                );
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output();
            }
            "update_up_to_date" => {
                let script = format!(
                    "display alert \"You are up to date\" message \"Ani-Mime v{} is the latest version.\" buttons {{\"OK\"}} default button \"OK\"",
                    current,
                );
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output();
            }
            "update_failed" => {
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg("display alert \"Update Check Failed\" message \"Could not reach GitHub. Please check your internet connection.\" buttons {\"OK\"} default button \"OK\"")
                    .output();
            }

            // --- Setup dialogs ---
            "setup_shell_single" => {
                macos_dialog(
                    "Ani-Mime Setup",
                    "zsh detected. Ani-Mime needs to add a hook to ~/.zshrc to track terminal activity.\n\nAllow setup?",
                    &["Yes", "Skip"],
                );
            }
            "setup_shell_multiple" => {
                let script = r#"choose from list {"zsh", "bash", "fish", "All"} with title "Ani-Mime Setup" with prompt "Multiple shells detected. Select which ones to set up for terminal tracking:" with multiple selections allowed"#;
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(script)
                    .output();
            }
            "setup_claude" => {
                macos_dialog(
                    "Ani-Mime Setup",
                    "Ani-Mime also supports Claude Code! Your mascot can react in real-time when Claude is thinking or using tools.\n\nThis will add lightweight hooks to ~/.claude/settings.json.\n\nWould you like to enable it?",
                    &["Yes", "Skip"],
                );
            }
            "setup_complete" => {
                macos_dialog(
                    "Ani-Mime",
                    "Setup complete!\n\nPlease open a new terminal tab or window for the tracking to take effect.",
                    &["OK"],
                );
            }
            "setup_no_shells" => {
                macos_dialog(
                    "Ani-Mime",
                    "No supported shell found (zsh, bash, or fish).\n\nPlease install one and restart the app.",
                    &["OK"],
                );
            }
            "setup_no_selected" => {
                macos_dialog(
                    "Ani-Mime",
                    "Ani-Mime requires at least one shell (zsh, bash, or fish) to be configured for terminal tracking.\n\nThe app will now close.\nRestart Ani-Mime when you're ready to set up.",
                    &["OK"],
                );
            }

            // --- Speech bubbles (emit events to frontend) ---
            "bubble_welcome" => {
                let _ = app.emit("status-changed", "idle");
            }
            "bubble_task_completed" => {
                let _ = app.emit("task-completed", serde_json::json!({ "duration_secs": 5 }));
            }
            "bubble_discovery_hint" => {
                let _ = app.emit("discovery-hint", "no_peers");
            }

            // --- Persistent bubbles for scenario testing (no auto-hide) ---
            id if id.starts_with("bubble_persist:") => {
                let message = id.strip_prefix("bubble_persist:").unwrap_or("Hello!");
                let _ = app.emit("bubble-preview", message);
            }

            _ => {
                crate::app_warn!("[preview] unknown dialog_id: {}", dialog_id);
            }
        }

        crate::app_log!("[preview] triggered dialog: {}", dialog_id);
    });
}

#[tauri::command]
fn request_local_network() {
    crate::app_log!("[app] requesting Local Network permission");
    // Trigger the Bonjour API — if the app hasn't been prompted yet, macOS will
    // show the Local Network permission dialog now.
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| platform::macos::trigger_local_network_prompt());
    }
    // Also open System Settings as fallback — if the user previously denied,
    // the Bonjour call won't re-prompt and they need to toggle it manually.
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork")
        .spawn();
}

#[tauri::command]
fn set_dock_visible(visible: bool, app: tauri::AppHandle) {
    crate::app_log!("[app] set_dock_visible -> {}", visible);
    platform::macos::set_dock_visibility(&app, visible);
}

#[tauri::command]
fn set_tray_visible(visible: bool, app: tauri::AppHandle) {
    crate::app_log!("[app] set_tray_visible -> {}", visible);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_visible(visible);
    }
}

#[tauri::command]
fn open_superpower(app: tauri::AppHandle) -> Result<(), String> {
    crate::app_log!("[app] opening superpower tool");
    if let Some(win) = app.get_webview_window("superpower") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    } else {
        crate::app_error!("[app] superpower window not found");
    }
    Ok(())
}

#[tauri::command]
fn start_visit(
    peer_id: String,
    nickname: String,
    pet: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::app_log!("[visit] starting visit to peer={} as {} ({})", peer_id, nickname, pet);

    let (ip, port, my_instance) = {
        let st = state.lock().unwrap();

        if st.visiting.is_some() {
            crate::app_warn!("[visit] already visiting someone, rejecting");
            return Err("Already visiting someone".to_string());
        }

        let instance = st.discovery_instance.clone();

        match st.peers.get(&peer_id) {
            Some(peer) => {
                crate::app_log!("[visit] target peer: {} at {}:{}", peer.nickname, peer.ip, peer.port);
                (peer.ip.clone(), peer.port, instance)
            }
            None => {
                crate::app_error!("[visit] peer not found: {}", peer_id);
                return Err("Peer not found".to_string());
            }
        }
    };

    let body = serde_json::json!({
        "instance_name": my_instance,
        "pet": pet,
        "nickname": nickname,
        "duration_secs": VISIT_DURATION_SECS,
    });

    let base = crate::helpers::format_http_host(&ip, port);
    let url = format!("{}/visit", base);
    crate::app_log!("[visit] sending POST {}", url);

    let send_result = std::thread::spawn({
        let url = url.clone();
        let body = body.clone();
        move || {
            ureq::post(&url)
                .send_json(&body)
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }).join().map_err(|_| {
        crate::app_error!("[visit] send thread panicked");
        "Thread panicked".to_string()
    })?;

    if let Err(ref e) = send_result {
        crate::app_error!("[visit] HTTP request failed: {}", e);
    }
    send_result.map_err(|e| format!("Failed to send visit: {}", e))?;

    crate::app_log!("[visit] visit request accepted by peer");

    {
        let mut st = state.lock().unwrap();
        st.visiting = Some(peer_id.clone());
    }

    if let Err(e) = app.emit("dog-away", true) {
        crate::app_error!("[visit] failed to emit dog-away: {}", e);
    }

    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    let nickname_clone = nickname.clone();
    std::thread::spawn(move || {
        crate::app_log!("[visit] dog away, returning in {}s", VISIT_DURATION_SECS);
        std::thread::sleep(std::time::Duration::from_secs(VISIT_DURATION_SECS));

        // Send visit-end to peer — use instance_name as stable identifier
        let my_instance_clone = {
            let st = state_clone.lock().unwrap();
            st.discovery_instance.clone()
        };
        let end_body = serde_json::json!({ "instance_name": my_instance_clone, "nickname": nickname_clone });
        match {
            let st = state_clone.lock().unwrap();
            st.peers.get(&peer_id).cloned().ok_or(())
        } {
            Ok(peer_info) => {
                let end_base = crate::helpers::format_http_host(&peer_info.ip, peer_info.port);
                let end_url = format!("{}/visit-end", end_base);
                crate::app_log!("[visit] sending visit-end to {}", end_url);
                if let Err(e) = ureq::post(&end_url).send_json(&end_body) {
                    crate::app_error!("[visit] failed to send visit-end: {}", e);
                }
            }
            Err(_) => {
                crate::app_warn!("[visit] peer {} no longer in peer list, skipping visit-end", peer_id);
            }
        }

        let mut st = state_clone.lock().unwrap();
        st.visiting = None;
        drop(st);

        if let Err(e) = app_clone.emit("dog-away", false) {
            crate::app_error!("[visit] failed to emit dog-away(false): {}", e);
        }
        crate::app_log!("[visit] dog returned home");
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .level_for("tauri", log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Info)
                .level_for("mdns_sd", log::LevelFilter::Warn)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .max_file_size(1_000_000)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![start_visit, get_logs, clear_logs, open_log_dir, open_superpower, set_dev_mode, scenario_override, preview_dialog, set_dock_visible, set_tray_visible, request_local_network])
        .setup(|app| {
            crate::app_log!("[app] starting Ani-Mime v{}", env!("CARGO_PKG_VERSION"));

            // Tell our log reader where to find the log file
            if let Ok(log_dir) = app.path().app_log_dir() {
                logger::set_log_path(log_dir.join("ani-mime.log"));
            }

            platform::macos::setup_macos_window(app);
            crate::app_log!("[app] macOS window configured");

            // Build native macOS menu bar
            let app_menu = SubmenuBuilder::new(app, "Ani-Mime")
                .item(&PredefinedMenuItem::about(app, Some("About Ani-Mime"), None)?)
                .separator()
                .item(&MenuItemBuilder::with_id("settings", "Settings...").accelerator("Cmd+,").build(app)?)
                .item(&MenuItemBuilder::with_id("check-update", "Check for Updates...").build(app)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Ani-Mime"))?)
                .build()?;

            let menu = MenuBuilder::new(app).item(&app_menu).build()?;
            app.set_menu(menu)?;
            crate::app_log!("[app] menu bar created");

            // Handle menu events
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                match event.id().as_ref() {
                    "settings" => {
                        crate::app_log!("[app] settings menu clicked");
                        if let Some(win) = handle.get_webview_window("settings") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "check-update" => {
                        crate::app_log!("[app] check for updates menu clicked");
                        updater::check_for_updates_manual(handle.clone());
                    }
                    _ => {}
                }
            });

            // Build system tray icon
            let tray_show = MenuItemBuilder::with_id("tray-show", "Show Ani-Mime").build(app)?;
            let tray_settings = MenuItemBuilder::with_id("tray-settings", "Settings...").build(app)?;
            let tray_quit = PredefinedMenuItem::quit(app, Some("Quit Ani-Mime"))?;

            let tray_menu = MenuBuilder::new(app)
                .item(&tray_show)
                .item(&tray_settings)
                .separator()
                .item(&tray_quit)
                .build()?;

            let tray_icon = app.default_window_icon().cloned()
                .expect("default window icon missing");

            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .tooltip("Ani-Mime")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "tray-show" => {
                            crate::app_log!("[app] tray: show clicked");
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "tray-settings" => {
                            crate::app_log!("[app] tray: settings clicked");
                            if let Some(win) = app.get_webview_window("settings") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            crate::app_log!("[app] tray icon created");

            // Apply saved preferences
            {
                let app_data_dir = app.path().app_data_dir()?;
                let store_path = app_data_dir.join("settings.json");
                if store_path.exists() {
                    if let Ok(content) = std::fs::read_to_string(&store_path) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if json.get("hideDock").and_then(|v| v.as_bool()).unwrap_or(false) {
                                crate::app_log!("[app] restoring dock-hidden preference");
                                platform::macos::set_dock_visibility(app.handle(), false);
                            }
                            if json.get("hideTray").and_then(|v| v.as_bool()).unwrap_or(false) {
                                crate::app_log!("[app] restoring tray-hidden preference");
                                if let Some(tray) = app.tray_by_id("main-tray") {
                                    let _ = tray.set_visible(false);
                                }
                            }
                        }
                    }
                }
            }

            // Hide settings and superpower windows on close instead of destroying them
            for label in &["settings", "superpower"] {
                if let Some(win) = app.get_webview_window(label) {
                    let win_clone = win.clone();
                    let label_owned = label.to_string();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = win_clone.hide();
                            crate::app_log!("[app] {} window hidden", label_owned);
                        }
                    });
                }
            }

            // Auto-setup shell hooks + Claude Code hooks on first launch
            let setup_handle = app.handle().clone();
            let resource_dir = app.path().resource_dir().unwrap();
            crate::app_log!("[app] resource dir: {}", resource_dir.display());
            setup::auto_setup(resource_dir, setup_handle);

            // Check for updates in background
            updater::check_for_updates(app.handle().clone());

            let app_state = Arc::new(Mutex::new(AppState {
                sessions: HashMap::new(),
                current_ui: "searching".to_string(),
                idle_since: 0,
                sleeping: false,
                peers: HashMap::new(),
                visitors: Vec::new(),
                visiting: None,
                discovery_instance: String::new(),
                discovery_addrs: Vec::new(),
                discovery_port: 0,
                pet: String::new(),
                nickname: String::new(),
                started_at: crate::helpers::now_secs(),
                tasks_completed_today: 0,
                total_busy_secs_today: 0,
                longest_task_today_secs: 0,
                last_task_duration_secs: 0,
                usage_day: crate::helpers::now_secs() / 86400,
            }));

            app.manage(app_state.clone());
            crate::app_log!("[app] state initialized");

            server::start_http_server(app.handle().clone(), app_state.clone());
            watchdog::start_watchdog(app.handle().clone(), app_state.clone());

            // Start mDNS peer discovery
            let discovery_handle = app.handle().clone();
            let discovery_state = app_state.clone();
            std::thread::spawn(move || {
                // Give the store plugin time to initialize
                std::thread::sleep(std::time::Duration::from_millis(500));

                let app_data_dir = discovery_handle.path().app_data_dir().unwrap();
                let store_path = app_data_dir.join("settings.json");
                crate::app_log!("[app] loading settings from {}", store_path.display());

                let (nickname, pet) = if store_path.exists() {
                    match std::fs::read_to_string(&store_path) {
                        Ok(content) => {
                            match serde_json::from_str::<serde_json::Value>(&content) {
                                Ok(json) => {
                                    let n = json["nickname"].as_str().unwrap_or("Anonymous").to_string();
                                    let p = json["pet"].as_str().unwrap_or("rottweiler").to_string();
                                    crate::app_log!("[app] loaded identity: nickname={}, pet={}", n, p);
                                    (n, p)
                                }
                                Err(e) => {
                                    crate::app_error!("[app] failed to parse settings.json: {}", e);
                                    ("Anonymous".to_string(), "rottweiler".to_string())
                                }
                            }
                        }
                        Err(e) => {
                            crate::app_error!("[app] failed to read settings.json: {}", e);
                            ("Anonymous".to_string(), "rottweiler".to_string())
                        }
                    }
                } else {
                    crate::app_log!("[app] no settings file, using defaults");
                    ("Anonymous".to_string(), "rottweiler".to_string())
                };

                {
                    let mut st = discovery_state.lock().unwrap();
                    st.pet = pet.clone();
                    st.nickname = nickname.clone();
                }

                // Trigger macOS Local Network permission via Apple's DNS-SD API.
                // mdns-sd uses raw sockets which bypass Bonjour, so macOS never prompts.
                #[cfg(target_os = "macos")]
                platform::macos::trigger_local_network_prompt();

                discovery::start_discovery(discovery_handle, discovery_state, nickname, pet);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
