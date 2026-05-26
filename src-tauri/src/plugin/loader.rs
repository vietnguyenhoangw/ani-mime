//! Filesystem ops: dirs, zip extraction, install/uninstall, startup scan.

use std::path::PathBuf;
use serde::Serialize;
use crate::plugin::manifest::Manifest;

/// State of a plugin in `AppState.plugins`. Returned to the frontend
/// over the `get_plugins` Tauri command.
#[derive(Clone, Debug, Serialize)]
pub struct PluginRecord {
    pub manifest: Manifest,
    pub enabled: bool,
    pub status: PluginStatus,
    /// Set when a WebView is currently spawned for this plugin (Slice 2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webview_label: Option<String>,
}

/// Either `Loaded` (manifest valid, files present) or `Error(reason)`
/// (manifest revalidation failed at scan time).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "reason")]
pub enum PluginStatus {
    Loaded,
    Error(String),
}

/// Returns `~/.ani-mime/plugins/`.
pub fn plugins_root() -> std::io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    Ok(home.join(".ani-mime").join("plugins"))
}

/// Returns `~/.ani-mime/plugins/<id>/`.
pub fn plugin_dir(id: &str) -> std::io::Result<PathBuf> {
    Ok(plugins_root()?.join(id))
}

/// Returns `~/.ani-mime/plugins/<id>/data/` — created lazily by callers.
pub fn plugin_data_dir(id: &str) -> std::io::Result<PathBuf> {
    Ok(plugin_dir(id)?.join("data"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_root_is_under_home_ani_mime() {
        let root = plugins_root().expect("home dir available");
        assert!(root.ends_with(".ani-mime/plugins"), "got {:?}", root);
    }

    #[test]
    fn plugin_dir_appends_id() {
        let dir = plugin_dir("translator").expect("home dir available");
        assert!(dir.ends_with(".ani-mime/plugins/translator"), "got {:?}", dir);
    }

    #[test]
    fn plugin_data_dir_appends_data() {
        let dir = plugin_data_dir("translator").expect("home dir available");
        assert!(
            dir.ends_with(".ani-mime/plugins/translator/data"),
            "got {:?}",
            dir
        );
    }
}
