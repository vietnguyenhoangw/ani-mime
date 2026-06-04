//! Global-shortcut registration for plugins.
//!
//! A plugin's manifest `hotkey` (e.g. `"CmdOrCtrl+Shift+V"`) is registered as
//! an OS-global shortcut while the plugin is enabled; pressing it launches the
//! plugin's WebView. Registrations are added on install/enable/startup and
//! removed on disable/uninstall.

use crate::plugin::loader::PluginRecord;
use std::collections::HashMap;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Register `accelerator` to launch plugin `id`. Idempotent — any existing
/// binding for the accelerator is dropped first. Failures (e.g. the combo is
/// already taken system-wide) are logged, not fatal.
pub fn register(app: &tauri::AppHandle, id: &str, accelerator: &str) {
    let _ = app.global_shortcut().unregister(accelerator);

    let id_owned = id.to_string();
    let app_cb = app.clone();
    let res = app
        .global_shortcut()
        .on_shortcut(accelerator, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(e) = crate::plugin::runtime::launch_plugin_webview(&app_cb, &id_owned) {
                    crate::app_warn!("[hotkey] launch {} failed: {}", id_owned, e);
                }
            }
        });

    match res {
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

/// The plugin's hotkey if it declares a non-empty one.
pub fn manifest_hotkey(rec: &PluginRecord) -> Option<String> {
    rec.manifest
        .hotkey
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}
