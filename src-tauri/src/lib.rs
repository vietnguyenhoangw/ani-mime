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

use crate::state::AppState;

const VISIT_DURATION_SECS: u64 = 15;

#[tauri::command]
fn get_logs() -> Vec<logger::LogEntry> {
    logger::get_all_logs()
}

#[tauri::command]
fn clear_logs() {
    logger::clear_logs();
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

    let (ip, port) = {
        let st = state.lock().unwrap();

        if st.visiting.is_some() {
            crate::app_warn!("[visit] already visiting someone, rejecting");
            return Err("Already visiting someone".to_string());
        }

        match st.peers.get(&peer_id) {
            Some(peer) => {
                crate::app_log!("[visit] target peer: {} at {}:{}", peer.nickname, peer.ip, peer.port);
                (peer.ip.clone(), peer.port)
            }
            None => {
                crate::app_error!("[visit] peer not found: {}", peer_id);
                return Err("Peer not found".to_string());
            }
        }
    };

    let body = serde_json::json!({
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

        // Send visit-end to peer
        let end_body = serde_json::json!({ "nickname": nickname_clone });
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![start_visit, get_logs, clear_logs, open_superpower, scenario_override, updater::update_now, updater::skip_version])
        .setup(|app| {
            crate::app_log!("[app] starting Ani-Mime v{}", env!("CARGO_PKG_VERSION"));

            platform::macos::setup_macos_window(app);
            crate::app_log!("[app] macOS window configured");

            // Build native macOS menu bar
            let app_menu = SubmenuBuilder::new(app, "Ani-Mime")
                .item(&PredefinedMenuItem::about(app, Some("About Ani-Mime"), None)?)
                .separator()
                .item(&MenuItemBuilder::with_id("settings", "Settings...").accelerator("Cmd+,").build(app)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Ani-Mime"))?)
                .build()?;

            let menu = MenuBuilder::new(app).item(&app_menu).build()?;
            app.set_menu(menu)?;
            crate::app_log!("[app] menu bar created");

            // Handle menu events
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == "settings" {
                    crate::app_log!("[app] settings menu clicked");
                    if let Some(win) = handle.get_webview_window("settings") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            });

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

                discovery::start_discovery(discovery_handle, discovery_state, nickname, pet);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
