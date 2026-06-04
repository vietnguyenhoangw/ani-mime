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
