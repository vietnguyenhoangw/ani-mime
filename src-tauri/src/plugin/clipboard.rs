//! OS clipboard monitor + history.
//!
//! A background thread polls the OS clipboard (~800ms) via `arboard` while at
//! least one enabled plugin declares the `clipboard` capability. New text is
//! pushed onto a capped, deduped history in `AppState.clipboard_history` and
//! persisted to `~/.ani-mime/clipboard-history.json` so it survives restarts.
//! Plugins read it through the `clipboard` capability in the `plugin_call`
//! gateway. Capture only runs while a `clipboard`-capable plugin is enabled.

use crate::state::AppState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// Maximum number of clipboard entries kept.
pub const MAX_ENTRIES: usize = 20;

/// Skip capturing very large clipboard payloads (e.g. big file/image text
/// dumps) so the history file stays small. 256 KiB of UTF-8 text.
const MAX_ENTRY_BYTES: usize = 256 * 1024;

/// Insert `text` at the front of `history` with global dedup + cap.
///
/// If `text` already exists it is moved to the front (most-recent-first,
/// like a real clipboard manager). The list is then truncated to
/// `MAX_ENTRIES`. Returns `true` if `history` changed.
pub fn push_entry(history: &mut Vec<String>, text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    // Already the most recent → nothing to do.
    if history.first().map(|s| s.as_str()) == Some(text) {
        return false;
    }
    history.retain(|s| s != text);
    history.insert(0, text.to_string());
    if history.len() > MAX_ENTRIES {
        history.truncate(MAX_ENTRIES);
    }
    true
}

/// `~/.ani-mime/clipboard-history.json`.
pub fn history_path() -> std::io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    Ok(home.join(".ani-mime").join("clipboard-history.json"))
}

/// Load persisted history (best effort — a missing/corrupt file is empty).
pub fn load_history() -> Vec<String> {
    let path = match history_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Persist history (best effort). Creates `~/.ani-mime` if needed.
pub fn save_history(history: &[String]) {
    let path = match history_path() {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(history) {
        let _ = std::fs::write(&path, json);
    }
}

/// True if any installed plugin is enabled AND declares the `clipboard`
/// capability — i.e. clipboard capture is currently demanded.
pub fn capture_demanded(state: &AppState) -> bool {
    plugins_demand_clipboard(&state.plugins)
}

/// Pure form of [`capture_demanded`] over just the plugins map (testable
/// without constructing a full `AppState`).
fn plugins_demand_clipboard(
    plugins: &std::collections::HashMap<String, crate::plugin::loader::PluginRecord>,
) -> bool {
    plugins
        .values()
        .any(|rec| rec.enabled && rec.manifest.capabilities.iter().any(|c| c == "clipboard"))
}

/// Spawn the background clipboard monitor. Runs for the life of the app but
/// only reads the OS clipboard while `capture_demanded` is true.
pub fn start_clipboard_monitor(app: tauri::AppHandle, state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                crate::app_warn!("[clipboard] monitor disabled: {}", e);
                return;
            }
        };
        crate::app_log!("[clipboard] monitor started");

        // Seed `last` with whatever's already on the clipboard so we don't
        // re-capture the pre-existing value on first tick.
        let mut last: Option<String> = clipboard.get_text().ok();

        loop {
            std::thread::sleep(Duration::from_millis(800));

            // Only touch the OS clipboard while a clipboard plugin is enabled.
            let demanded = match state.lock() {
                Ok(g) => capture_demanded(&g),
                Err(_) => continue,
            };
            if !demanded {
                continue;
            }

            let text = match clipboard.get_text() {
                Ok(t) => t,
                Err(_) => continue, // empty or non-text clipboard
            };
            if text.is_empty() || text.len() > MAX_ENTRY_BYTES {
                continue;
            }
            if last.as_deref() == Some(text.as_str()) {
                continue;
            }
            last = Some(text.clone());

            let changed = {
                let mut guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                push_entry(&mut guard.clipboard_history, &text)
            };
            if changed {
                let snapshot = state.lock().map(|g| g.clipboard_history.clone()).unwrap_or_default();
                save_history(&snapshot);
                let _ = app.emit("clipboard-changed", ());
            }
        }
    });
}

/// Write `text` to the OS clipboard (used by the `clipboard.copy` gateway
/// method). The monitor will re-capture it and move it to the front.
pub fn write_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_adds_newest_first() {
        let mut h = Vec::new();
        assert!(push_entry(&mut h, "a"));
        assert!(push_entry(&mut h, "b"));
        assert_eq!(h, vec!["b", "a"]);
    }

    #[test]
    fn push_ignores_empty() {
        let mut h = Vec::new();
        assert!(!push_entry(&mut h, ""));
        assert!(h.is_empty());
    }

    #[test]
    fn push_skips_consecutive_duplicate() {
        let mut h = vec!["a".to_string()];
        assert!(!push_entry(&mut h, "a"));
        assert_eq!(h, vec!["a"]);
    }

    #[test]
    fn push_moves_existing_to_front() {
        let mut h = vec!["b".to_string(), "a".to_string()];
        assert!(push_entry(&mut h, "a"));
        assert_eq!(h, vec!["a", "b"]);
    }

    #[test]
    fn push_caps_at_max_entries() {
        let mut h = Vec::new();
        for i in 0..(MAX_ENTRIES + 5) {
            push_entry(&mut h, &format!("item-{}", i));
        }
        assert_eq!(h.len(), MAX_ENTRIES);
        // Newest kept, oldest dropped.
        assert_eq!(h[0], format!("item-{}", MAX_ENTRIES + 4));
        assert!(!h.iter().any(|s| s == "item-0"));
    }

    #[test]
    fn capture_demanded_requires_enabled_clipboard_plugin() {
        use crate::plugin::loader::{PluginRecord, PluginStatus};
        use crate::plugin::manifest::{Manifest, WindowConfig};
        use std::collections::HashMap;

        fn rec(caps: &[&str], enabled: bool) -> PluginRecord {
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
                        width: 1,
                        height: 1,
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

        let mut plugins: HashMap<String, PluginRecord> = HashMap::new();
        assert!(!plugins_demand_clipboard(&plugins));

        plugins.insert("demo".into(), rec(&["window"], true));
        assert!(!plugins_demand_clipboard(&plugins), "no clipboard capability");

        plugins.insert("demo".into(), rec(&["clipboard"], false));
        assert!(!plugins_demand_clipboard(&plugins), "disabled plugin");

        plugins.insert("demo".into(), rec(&["clipboard"], true));
        assert!(plugins_demand_clipboard(&plugins), "enabled clipboard plugin");
    }
}
