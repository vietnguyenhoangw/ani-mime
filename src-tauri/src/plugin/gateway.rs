//! The `plugin_call` gateway: the single command every `window.ani` method
//! routes through. Derives the plugin id from the calling window label,
//! enforces declared capabilities, and dispatches to storage / window ops.

use crate::plugin::loader::{plugin_data_dir, PluginRecord, PluginStatus};
use crate::plugin::runtime::id_from_label;
use crate::state::AppState;
use crate::plugin::storage;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Returns `Ok` only if the plugin is enabled and declares `capability`.
pub fn capability_allowed(record: &PluginRecord, capability: &str) -> Result<(), String> {
    if !record.enabled {
        return Err("plugin not enabled".into());
    }
    if !record.manifest.capabilities.iter().any(|c| c == capability) {
        return Err(format!("capability '{}' not declared by plugin", capability));
    }
    Ok(())
}

/// The single command all `window.ani` calls route through.
///
/// `window` is injected by Tauri and identifies the *calling* WebView —
/// the plugin id is derived from its label, never trusted from `args`,
/// so a plugin cannot act as another. Dispatches:
///   - capability "storage": method get|set|delete  → per-plugin store.json
///   - capability "window":  method show|hide|resize|close → the caller window
#[tauri::command]
pub fn plugin_call(
    window: tauri::WebviewWindow,
    capability: String,
    method: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = id_from_label(window.label())
        .ok_or_else(|| "plugin_call invoked from a non-plugin window".to_string())?;

    // Snapshot the record, then drop the lock before doing IO / window ops.
    let record = {
        let state = window.state::<Arc<Mutex<AppState>>>();
        let guard = state.lock().map_err(|_| "state lock poisoned")?;
        guard
            .plugins
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("plugin '{}' not installed", id))?
    };
    if let PluginStatus::Error(reason) = &record.status {
        return Err(format!("plugin in error state: {}", reason));
    }
    capability_allowed(&record, &capability)?;

    match capability.as_str() {
        "storage" => {
            let data_dir = plugin_data_dir(&id).map_err(|e| e.to_string())?;
            match method.as_str() {
                "get" => {
                    let key = arg_str(&args, "key")?;
                    storage::get(&data_dir, &key).map_err(|e| e.to_string())
                }
                "set" => {
                    let key = arg_str(&args, "key")?;
                    let value = args.get("value").cloned().unwrap_or(serde_json::Value::Null);
                    storage::set(&data_dir, &key, &value).map_err(|e| e.to_string())?;
                    Ok(serde_json::Value::Null)
                }
                "delete" => {
                    let key = arg_str(&args, "key")?;
                    storage::delete(&data_dir, &key).map_err(|e| e.to_string())?;
                    Ok(serde_json::Value::Null)
                }
                other => Err(format!("unknown storage method '{}'", other)),
            }
        }
        "window" => {
            match method.as_str() {
                "show" => window.show().map_err(|e| e.to_string())?,
                "hide" => window.hide().map_err(|e| e.to_string())?,
                "close" => window.close().map_err(|e| e.to_string())?,
                "resize" => {
                    let w = arg_u32(&args, "width")?;
                    let h = arg_u32(&args, "height")?;
                    window
                        .set_size(tauri::LogicalSize::new(w as f64, h as f64))
                        .map_err(|e| e.to_string())?;
                }
                other => return Err(format!("unknown window method '{}'", other)),
            }
            Ok(serde_json::Value::Null)
        }
        other => Err(format!("unknown capability '{}'", other)),
    }
}

fn arg_str(args: &serde_json::Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("missing string arg '{}'", key))
}

fn arg_u32(args: &serde_json::Value, key: &str) -> Result<u32, String> {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .ok_or_else(|| format!("missing numeric arg '{}'", key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::loader::{PluginRecord, PluginStatus};
    use crate::plugin::manifest::{Manifest, WindowConfig};

    fn record(caps: &[&str], enabled: bool) -> PluginRecord {
        PluginRecord {
            manifest: Manifest {
                id: "demo".into(),
                name: "Demo".into(),
                version: "0.1.0".into(),
                description: String::new(),
                author: String::new(),
                entry: "index.html".into(),
                icon: None,
                hotkey: None,
                capabilities: caps.iter().map(|s| s.to_string()).collect(),
                window: WindowConfig {
                    width: 100,
                    height: 100,
                    resizable: false,
                    always_on_top: true,
                    transparent: false,
                    decorations: true,
                },
            },
            enabled,
            status: PluginStatus::Loaded,
            webview_label: None,
        }
    }

    #[test]
    fn allows_declared_capability() {
        let rec = record(&["window", "storage"], true);
        assert!(capability_allowed(&rec, "storage").is_ok());
        assert!(capability_allowed(&rec, "window").is_ok());
    }

    #[test]
    fn rejects_undeclared_capability() {
        let rec = record(&["window"], true);
        assert!(capability_allowed(&rec, "storage").is_err());
    }

    #[test]
    fn rejects_when_disabled() {
        let rec = record(&["storage"], false);
        assert!(capability_allowed(&rec, "storage").is_err());
    }
}
