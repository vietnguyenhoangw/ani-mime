//! Global-shortcut registration for plugins.
//!
//! A plugin's manifest `hotkey` (e.g. `"CmdOrCtrl+Shift+V"`) is registered as
//! an OS-global shortcut while the plugin is enabled; pressing it launches the
//! plugin's WebView. Registrations are added on install/enable/startup and
//! removed on disable/uninstall.

use crate::plugin::loader::PluginRecord;
use std::collections::HashMap;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Register `accelerator` to launch plugin `id`, returning any error
/// (parse failure or the combo already being taken). Idempotent — any
/// existing binding for the accelerator is dropped first.
pub fn try_register(app: &tauri::AppHandle, id: &str, accelerator: &str) -> Result<(), String> {
    let _ = app.global_shortcut().unregister(accelerator);

    let id_owned = id.to_string();
    let app_cb = app.clone();
    app.global_shortcut()
        .on_shortcut(accelerator, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(e) = crate::plugin::runtime::launch_plugin_webview(&app_cb, &id_owned) {
                    crate::app_warn!("[hotkey] launch {} failed: {}", id_owned, e);
                }
            }
        })
        .map_err(|e| e.to_string())
}

/// Register `accelerator` to launch plugin `id`. Failures are logged, not
/// fatal (used on startup/install where we don't surface errors).
pub fn register(app: &tauri::AppHandle, id: &str, accelerator: &str) {
    match try_register(app, id, accelerator) {
        Ok(_) => crate::app_log!("[hotkey] {} -> {}", accelerator, id),
        Err(e) => crate::app_warn!(
            "[hotkey] could not register {} for {}: {}",
            accelerator,
            id,
            e
        ),
    }
}

/// Remove the binding for `accelerator` (best effort).
pub fn unregister(app: &tauri::AppHandle, accelerator: &str) {
    if let Err(e) = app.global_shortcut().unregister(accelerator) {
        crate::app_warn!("[hotkey] could not unregister {}: {}", accelerator, e);
    }
}

/// Convenience: register the hotkey for a single record if it is enabled and
/// declares a non-empty hotkey.
pub fn register_record(app: &tauri::AppHandle, rec: &PluginRecord) {
    if !rec.enabled {
        return;
    }
    if let Some(hk) = manifest_hotkey(rec) {
        register(app, &rec.manifest.id, &hk);
    }
}

/// Register hotkeys for every enabled plugin that declares one (startup).
pub fn register_enabled(app: &tauri::AppHandle, plugins: &HashMap<String, PluginRecord>) {
    for rec in plugins.values() {
        register_record(app, rec);
    }
}

/// The plugin's effective hotkey (manifest value or applied user override),
/// if non-empty.
pub fn manifest_hotkey(rec: &PluginRecord) -> Option<String> {
    rec.manifest
        .hotkey
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

// --- User hotkey overrides ---------------------------------------------------
//
// Users can reassign a plugin's launch hotkey without touching the plugin's
// own `manifest.json`. Overrides live in `~/.ani-mime/plugin-hotkeys.json`
// (a `{ "<plugin-id>": "<accelerator>" }` map) and are applied on top of the
// scanned manifests at startup.

/// `~/.ani-mime/plugin-hotkeys.json`.
pub fn overrides_path() -> std::io::Result<std::path::PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    Ok(home.join(".ani-mime").join("plugin-hotkeys.json"))
}

/// Load the id→accelerator override map (best effort).
pub fn load_overrides() -> HashMap<String, String> {
    let path = match overrides_path() {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

/// Persist a single override (best effort).
pub fn save_override(id: &str, accelerator: &str) {
    let mut map = load_overrides();
    map.insert(id.to_string(), accelerator.to_string());
    if let Ok(path) = overrides_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&map) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Apply persisted overrides onto the scanned plugin records, replacing each
/// matched plugin's `manifest.hotkey` so the effective hotkey is what the
/// rest of the app (registration + UI) sees.
pub fn apply_overrides(plugins: &mut HashMap<String, PluginRecord>) {
    for (id, accel) in load_overrides() {
        if let Some(rec) = plugins.get_mut(&id) {
            rec.manifest.hotkey = if accel.trim().is_empty() {
                None
            } else {
                Some(accel)
            };
        }
    }
}
