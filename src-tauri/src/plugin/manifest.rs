//! Manifest schema, parsing, and validation.

use serde::{Deserialize, Serialize};

/// Capability strings allowed in v1. Any other entry in
/// `Manifest.capabilities` rejects the manifest at validation time.
pub const ALLOWED_CAPABILITIES: &[&str] =
    &["window", "hotkey", "storage", "clipboard", "translate", "selection", "browser"];

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

/// Validation errors surfaced to the user at install time.
#[derive(Debug, Clone)]
pub enum ManifestError {
    InvalidJson(String),
    InvalidId(String),
    InvalidVersion(String),
    UnknownCapability(String),
    InvalidWindow(String),
    InvalidEntry(String),
    EntryEscape(String),
    EntryNotFound(String),
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(m) => write!(f, "invalid manifest JSON: {}", m),
            Self::InvalidId(m) => write!(f, "invalid id: {}", m),
            Self::InvalidVersion(m) => write!(f, "invalid version: {}", m),
            Self::UnknownCapability(c) => write!(f, "unknown capability: {}", c),
            Self::InvalidWindow(m) => write!(f, "invalid window config: {}", m),
            Self::InvalidEntry(m) => write!(f, "invalid entry: {}", m),
            Self::EntryEscape(m) => write!(f, "entry escapes plugin dir: {}", m),
            Self::EntryNotFound(m) => write!(f, "entry not found: {}", m),
        }
    }
}

impl std::error::Error for ManifestError {}

impl Manifest {
    /// Validate every field that can be checked without filesystem access.
    /// Entry-path canonicalization is a separate step (`canonicalize_entry`)
    /// because it needs the unpacked plugin dir.
    pub fn validate(&self) -> Result<(), ManifestError> {
        validate_id(&self.id)?;
        validate_version(&self.version)?;
        validate_capabilities(&self.capabilities)?;
        validate_window(&self.window)?;
        if self.entry.trim().is_empty() {
            return Err(ManifestError::InvalidEntry("entry is empty".into()));
        }
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), ManifestError> {
    if id.is_empty() {
        return Err(ManifestError::InvalidId("id is empty".into()));
    }
    if id.len() > MAX_ID_LEN {
        return Err(ManifestError::InvalidId(format!(
            "id longer than {} chars",
            MAX_ID_LEN
        )));
    }
    let mut chars = id.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(ManifestError::InvalidId(format!(
            "id must start with lowercase ASCII letter, got '{}'",
            first
        )));
    }
    for c in chars {
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(ManifestError::InvalidId(format!(
                "id may only contain [a-z0-9-], got '{}'",
                c
            )));
        }
    }
    Ok(())
}

fn validate_version(v: &str) -> Result<(), ManifestError> {
    semver::Version::parse(v).map_err(|e| ManifestError::InvalidVersion(e.to_string()))?;
    Ok(())
}

fn validate_capabilities(caps: &[String]) -> Result<(), ManifestError> {
    for c in caps {
        if !ALLOWED_CAPABILITIES.contains(&c.as_str()) {
            return Err(ManifestError::UnknownCapability(c.clone()));
        }
    }
    Ok(())
}

fn validate_window(w: &WindowConfig) -> Result<(), ManifestError> {
    if w.width == 0 || w.height == 0 {
        return Err(ManifestError::InvalidWindow(
            "width and height must be positive".into(),
        ));
    }
    if w.width > MAX_WINDOW_WIDTH {
        return Err(ManifestError::InvalidWindow(format!(
            "width > {}",
            MAX_WINDOW_WIDTH
        )));
    }
    if w.height > MAX_WINDOW_HEIGHT {
        return Err(ManifestError::InvalidWindow(format!(
            "height > {}",
            MAX_WINDOW_HEIGHT
        )));
    }
    Ok(())
}

use std::path::{Path, PathBuf};

/// Resolve `entry` (a relative path inside `plugin_dir`) to a canonical
/// `PathBuf`, refusing any result that escapes `plugin_dir`.
///
/// Returns `EntryNotFound` if the file does not exist, `EntryEscape`
/// if the canonical path leaves `plugin_dir`.
pub fn canonicalize_entry(plugin_dir: &Path, entry: &str) -> Result<PathBuf, ManifestError> {
    if entry.trim().is_empty() {
        return Err(ManifestError::InvalidEntry("entry is empty".into()));
    }
    if Path::new(entry).is_absolute() {
        return Err(ManifestError::EntryEscape(entry.into()));
    }
    let plugin_dir_canonical = plugin_dir
        .canonicalize()
        .map_err(|e| ManifestError::EntryNotFound(format!("plugin dir: {}", e)))?;
    let joined = plugin_dir_canonical.join(entry);
    let canonical = joined
        .canonicalize()
        .map_err(|_| ManifestError::EntryNotFound(entry.into()))?;
    if !canonical.starts_with(&plugin_dir_canonical) {
        return Err(ManifestError::EntryEscape(entry.into()));
    }
    Ok(canonical)
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

    fn minimal_manifest() -> Manifest {
        Manifest {
            id: "ok-id".to_string(),
            name: "Ok".to_string(),
            version: "0.1.0".to_string(),
            description: String::new(),
            author: String::new(),
            entry: "i.html".to_string(),
            icon: None,
            hotkey: None,
            capabilities: vec!["window".to_string()],
            window: WindowConfig {
                width: 480,
                height: 320,
                resizable: false,
                always_on_top: true,
                transparent: false,
                decorations: true,
            },
        }
    }

    #[test]
    fn validate_accepts_well_formed() {
        let m = minimal_manifest();
        assert!(m.validate().is_ok());
    }

    #[test]
    fn validate_rejects_uppercase_id() {
        let mut m = minimal_manifest();
        m.id = "BadId".to_string();
        assert!(matches!(m.validate(), Err(ManifestError::InvalidId(_))));
    }

    #[test]
    fn validate_rejects_id_starting_with_digit() {
        let mut m = minimal_manifest();
        m.id = "1plugin".to_string();
        assert!(matches!(m.validate(), Err(ManifestError::InvalidId(_))));
    }

    #[test]
    fn validate_rejects_empty_id() {
        let mut m = minimal_manifest();
        m.id = "".to_string();
        assert!(matches!(m.validate(), Err(ManifestError::InvalidId(_))));
    }

    #[test]
    fn validate_rejects_overlong_id() {
        let mut m = minimal_manifest();
        m.id = "a".repeat(MAX_ID_LEN + 1);
        assert!(matches!(m.validate(), Err(ManifestError::InvalidId(_))));
    }

    #[test]
    fn validate_rejects_bad_semver() {
        let mut m = minimal_manifest();
        m.version = "not-a-version".to_string();
        assert!(matches!(m.validate(), Err(ManifestError::InvalidVersion(_))));
    }

    #[test]
    fn validate_rejects_unknown_capability() {
        let mut m = minimal_manifest();
        m.capabilities = vec!["window".to_string(), "espionage".to_string()];
        assert!(matches!(m.validate(), Err(ManifestError::UnknownCapability(_))));
    }

    #[test]
    fn validate_rejects_zero_window_width() {
        let mut m = minimal_manifest();
        m.window.width = 0;
        assert!(matches!(m.validate(), Err(ManifestError::InvalidWindow(_))));
    }

    #[test]
    fn validate_rejects_oversized_window() {
        let mut m = minimal_manifest();
        m.window.width = MAX_WINDOW_WIDTH + 1;
        assert!(matches!(m.validate(), Err(ManifestError::InvalidWindow(_))));
    }

    use tempfile::TempDir;

    fn touch(dir: &std::path::Path, rel: &str) -> std::path::PathBuf {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&p, b"").unwrap();
        p
    }

    #[test]
    fn canonicalize_entry_accepts_file_in_dir() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), "index.html");
        let resolved = canonicalize_entry(tmp.path(), "index.html").expect("ok");
        assert!(resolved.ends_with("index.html"));
        assert!(resolved.starts_with(tmp.path().canonicalize().unwrap()));
    }

    #[test]
    fn canonicalize_entry_accepts_nested_file() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), "assets/sub/page.html");
        let resolved = canonicalize_entry(tmp.path(), "assets/sub/page.html").expect("ok");
        assert!(resolved.ends_with("assets/sub/page.html"));
    }

    #[test]
    fn canonicalize_entry_rejects_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        touch(tmp.path(), "index.html");
        let err = canonicalize_entry(tmp.path(), "../outside").unwrap_err();
        assert!(matches!(err, ManifestError::EntryEscape(_) | ManifestError::EntryNotFound(_)));
    }

    #[test]
    fn canonicalize_entry_rejects_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let err = canonicalize_entry(tmp.path(), "/etc/passwd").unwrap_err();
        assert!(matches!(err, ManifestError::EntryEscape(_) | ManifestError::EntryNotFound(_)));
    }

    #[test]
    fn canonicalize_entry_rejects_missing_file() {
        let tmp = TempDir::new().unwrap();
        let err = canonicalize_entry(tmp.path(), "does-not-exist.html").unwrap_err();
        assert!(matches!(err, ManifestError::EntryNotFound(_)));
    }

    #[test]
    fn translate_is_an_allowed_capability() {
        assert!(ALLOWED_CAPABILITIES.contains(&"translate"));
    }

    #[test]
    fn selection_is_an_allowed_capability() {
        assert!(ALLOWED_CAPABILITIES.contains(&"selection"));
    }

    #[test]
    fn browser_is_an_allowed_capability() {
        assert!(ALLOWED_CAPABILITIES.contains(&"browser"));
    }
}
