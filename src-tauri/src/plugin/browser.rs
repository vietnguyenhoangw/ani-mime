//! Host side of the Quick Coffee plugin's `browser` capability: URL validation,
//! the persisted per-plugin `url-hotkeys.json`, and registration of each
//! binding as a global shortcut that opens its URL in the chosen browser.

use crate::plugin::loader::plugin_dir;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single hotkey → URL mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Binding {
    pub accelerator: String,
    pub url: String,
}

/// The full set of URL-hotkeys for one plugin, plus the browser they open in.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlHotkeys {
    #[serde(default)]
    pub browser_bundle_id: Option<String>,
    #[serde(default)]
    pub bindings: Vec<Binding>,
}

/// Per-binding outcome returned to the plugin UI so it can flag conflicts.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BindingResult {
    pub accelerator: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Only `http`/`https` URLs may be bound or opened — never `file:`,
/// `javascript:`, or custom app schemes.
pub fn is_allowed_url(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://")
}

/// `~/.ani-mime/plugins/<id>/url-hotkeys.json` (host-owned, sibling to the
/// plugin's own files; removed automatically when the plugin is uninstalled).
pub fn url_hotkeys_path(id: &str) -> std::io::Result<PathBuf> {
    Ok(plugin_dir(id)?.join("url-hotkeys.json"))
}

/// Load the persisted set (empty default if the file is missing or unreadable).
pub fn load(id: &str) -> UrlHotkeys {
    let path = match url_hotkeys_path(id) {
        Ok(p) => p,
        Err(_) => return UrlHotkeys::default(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => UrlHotkeys::default(),
    }
}

/// Persist the set (best-effort; creates the plugin dir if needed).
pub fn save(id: &str, hk: &UrlHotkeys) -> std::io::Result<()> {
    let path = url_hotkeys_path(id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(hk)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(&path, json)
}

use std::collections::HashMap;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Register every binding in `hk` as a global shortcut that opens its URL in
/// `hk.browser_bundle_id`. Returns a per-binding result so the UI can show
/// conflicts. Duplicates within the set and non-http(s) URLs are rejected
/// (reported, not registered). Existing bindings for the same accelerator are
/// dropped first so re-registration is idempotent.
pub fn register(app: &tauri::AppHandle, hk: &UrlHotkeys) -> Vec<BindingResult> {
    let mut results = Vec::with_capacity(hk.bindings.len());
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();

    for b in &hk.bindings {
        let accel = b.accelerator.trim();
        if accel.is_empty() {
            results.push(BindingResult {
                accelerator: b.accelerator.clone(),
                ok: false,
                error: Some("empty accelerator".into()),
            });
            continue;
        }
        if !seen.insert(accel) {
            results.push(BindingResult {
                accelerator: b.accelerator.clone(),
                ok: false,
                error: Some("duplicate accelerator in set".into()),
            });
            continue;
        }
        if !is_allowed_url(&b.url) {
            results.push(BindingResult {
                accelerator: b.accelerator.clone(),
                ok: false,
                error: Some("url must be http(s)".into()),
            });
            continue;
        }

        let _ = app.global_shortcut().unregister(accel);
        let bundle = hk.browser_bundle_id.clone();
        let url = b.url.clone();
        let res = app.global_shortcut().on_shortcut(accel, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                crate::platform::open_url_in(bundle.as_deref(), &url);
            }
        });
        match res {
            Ok(_) => {
                crate::app_log!("[quick-coffee] bound {} -> {}", accel, b.url);
                results.push(BindingResult {
                    accelerator: b.accelerator.clone(),
                    ok: true,
                    error: None,
                });
            }
            Err(e) => results.push(BindingResult {
                accelerator: b.accelerator.clone(),
                ok: false,
                error: Some(e.to_string()),
            }),
        }
    }
    results
}

/// Unregister every accelerator currently persisted for plugin `id`
/// (best-effort). Called on disable/uninstall and before re-registering.
pub fn unregister_plugin(app: &tauri::AppHandle, id: &str) {
    let hk = load(id);
    for b in &hk.bindings {
        let accel = b.accelerator.trim();
        if accel.is_empty() {
            continue;
        }
        if let Err(e) = app.global_shortcut().unregister(accel) {
            crate::app_warn!("[quick-coffee] could not unregister {}: {}", accel, e);
        }
    }
}

/// Replace plugin `id`'s entire binding set: drop the old shortcuts, register
/// the new ones, persist, and return per-binding results.
pub fn set_hotkeys(app: &tauri::AppHandle, id: &str, hk: UrlHotkeys) -> Vec<BindingResult> {
    unregister_plugin(app, id);
    let results = register(app, &hk);
    if let Err(e) = save(id, &hk) {
        crate::app_warn!("[quick-coffee] could not persist url-hotkeys for {}: {}", id, e);
    }
    results
}

/// On startup, re-register the persisted URL-hotkeys for every enabled plugin
/// (so item hotkeys work after a restart with no window opened).
pub fn register_all_enabled(
    app: &tauri::AppHandle,
    plugins: &HashMap<String, crate::plugin::loader::PluginRecord>,
) {
    for (id, rec) in plugins {
        if !rec.enabled {
            continue;
        }
        let hk = load(id);
        if !hk.bindings.is_empty() {
            let _ = register(app, &hk);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_http_and_https_only() {
        assert!(is_allowed_url("http://example.com"));
        assert!(is_allowed_url("https://example.com"));
        assert!(is_allowed_url("  HTTPS://Example.com  "));
        assert!(!is_allowed_url("file:///etc/passwd"));
        assert!(!is_allowed_url("javascript:alert(1)"));
        assert!(!is_allowed_url("ftp://example.com"));
        assert!(!is_allowed_url(""));
    }

    #[test]
    fn url_hotkeys_json_round_trips() {
        let hk = UrlHotkeys {
            browser_bundle_id: Some("com.google.Chrome".into()),
            bindings: vec![Binding {
                accelerator: "CmdOrCtrl+Shift+G".into(),
                url: "https://github.com".into(),
            }],
        };
        let json = serde_json::to_string(&hk).unwrap();
        assert!(json.contains("browserBundleId"));
        let back: UrlHotkeys = serde_json::from_str(&json).unwrap();
        assert_eq!(back.browser_bundle_id.as_deref(), Some("com.google.Chrome"));
        assert_eq!(back.bindings, hk.bindings);
    }

    #[test]
    fn empty_json_deserializes_to_default() {
        let back: UrlHotkeys = serde_json::from_str("{}").unwrap();
        assert!(back.browser_bundle_id.is_none());
        assert!(back.bindings.is_empty());
    }
}
