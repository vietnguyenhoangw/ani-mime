//! Manifest schema, parsing, and validation.

use serde::{Deserialize, Serialize};

/// Capability strings allowed in v1. Any other entry in
/// `Manifest.capabilities` rejects the manifest at validation time.
pub const ALLOWED_CAPABILITIES: &[&str] = &["window", "hotkey", "storage"];

pub const MAX_WINDOW_WIDTH: u32 = 1920;
pub const MAX_WINDOW_HEIGHT: u32 = 1080;
pub const MAX_ID_LEN: usize = 64;

/// Top-level manifest as parsed from `manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    pub entry: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub hotkey: Option<String>,
    pub capabilities: Vec<String>,
    pub window: WindowConfig,
}

/// Window settings the host applies when spawning the plugin's WebView
/// (used by Slice 2; parsed and validated here so install fails early).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowConfig {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub resizable: bool,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default)]
    pub transparent: bool,
    #[serde(default = "default_true")]
    pub decorations: bool,
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest_json() -> &'static str {
        r#"{
            "id": "quick-translate",
            "name": "Quick Translate",
            "version": "0.1.0",
            "description": "Translate selected text",
            "author": "github-handle",
            "entry": "index.html",
            "hotkey": "CmdOrCtrl+Shift+T",
            "capabilities": ["window", "hotkey", "storage"],
            "window": {
                "width": 480,
                "height": 320,
                "resizable": false,
                "alwaysOnTop": true,
                "transparent": false,
                "decorations": true
            }
        }"#
    }

    #[test]
    fn parses_full_manifest() {
        let m: Manifest = serde_json::from_str(sample_manifest_json()).expect("parses");
        assert_eq!(m.id, "quick-translate");
        assert_eq!(m.name, "Quick Translate");
        assert_eq!(m.version, "0.1.0");
        assert_eq!(m.entry, "index.html");
        assert_eq!(m.hotkey.as_deref(), Some("CmdOrCtrl+Shift+T"));
        assert_eq!(m.capabilities, vec!["window", "hotkey", "storage"]);
        assert_eq!(m.window.width, 480);
        assert_eq!(m.window.height, 320);
        assert!(!m.window.resizable);
        assert!(m.window.always_on_top);
    }

    #[test]
    fn description_and_author_default_to_empty() {
        let json = r#"{
            "id": "x",
            "name": "X",
            "version": "0.1.0",
            "entry": "i.html",
            "capabilities": [],
            "window": { "width": 100, "height": 100 }
        }"#;
        let m: Manifest = serde_json::from_str(json).expect("parses");
        assert_eq!(m.description, "");
        assert_eq!(m.author, "");
        assert!(m.hotkey.is_none());
        assert!(m.icon.is_none());
    }

    #[test]
    fn window_defaults_apply() {
        let json = r#"{
            "id": "x",
            "name": "X",
            "version": "0.1.0",
            "entry": "i.html",
            "capabilities": [],
            "window": { "width": 100, "height": 100 }
        }"#;
        let m: Manifest = serde_json::from_str(json).expect("parses");
        assert!(m.window.always_on_top, "always_on_top defaults to true");
        assert!(m.window.decorations, "decorations defaults to true");
        assert!(!m.window.transparent);
        assert!(!m.window.resizable);
    }

    #[test]
    fn missing_required_field_fails() {
        let json = r#"{ "name": "X", "version": "0.1.0", "entry": "i.html",
                       "capabilities": [], "window": { "width": 1, "height": 1 } }"#;
        let result: Result<Manifest, _> = serde_json::from_str(json);
        assert!(result.is_err(), "missing id should fail");
    }
}
