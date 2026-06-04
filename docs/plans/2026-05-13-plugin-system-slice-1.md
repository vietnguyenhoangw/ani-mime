# Plugin System — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the host-side foundation of the plugin system: install/uninstall plugins from a `.zip`, scan installed plugins at startup, serve plugin files via a `plugin://` URI scheme, and expose Tauri commands for the UI to come. **No WebView spawning, no hotkeys, no frontend, no SDK** — those are Slices 2–6.

**Architecture:** A new `src-tauri/src/plugin/` module owns four files (`manifest.rs`, `loader.rs`, `protocol.rs`, `mod.rs`). Manifests are validated at install time and on every startup scan. Plugin files live under `~/.ani-mime/plugins/<id>/`. The `plugin://<id>/<path>` URI scheme reads files from disk after a path-traversal check. `AppState` gains a `plugins: HashMap<String, PluginRecord>` field; the rest of the app stays untouched.

**Tech Stack:** Rust (Tauri 2), `zip` crate for archive extraction, `semver` for version parsing, `tempfile` for tests, `serde` for the manifest schema. Tests live in-tree under `#[cfg(test)] mod tests` per the project pattern (see `src-tauri/src/proc_scan.rs`).

**Spec:** `docs/superpowers/specs/2026-05-08-plugin-system-design.md`

---

## Test conventions

- All tests in this slice are platform-independent. Use plain `#[cfg(test)]` (no `#[cfg(target_os = "macos")]` gate).
- Tests that touch the filesystem use `tempfile::TempDir` so they don't pollute `~/.ani-mime/`.
- Run all tests with: `cd src-tauri && cargo test plugin::`
- Lint check: `cd src-tauri && cargo check`

## File layout produced by this slice

```
src-tauri/
├── Cargo.toml                              (modified — 3 new deps)
└── src/
    ├── lib.rs                              (modified — mod plugin, commands, startup scan, protocol)
    ├── state.rs                            (modified — plugins HashMap field)
    └── plugin/
        ├── mod.rs                          (new — re-exports + scan_plugins)
        ├── manifest.rs                     (new — Manifest, validation, canonicalize_entry)
        ├── loader.rs                       (new — dirs, install, uninstall, zip extraction)
        └── protocol.rs                     (new — plugin:// handler + helpers)
```

---

## Task 1: Add Cargo dependencies and create empty plugin module

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/plugin/mod.rs`
- Create: `src-tauri/src/plugin/manifest.rs`
- Create: `src-tauri/src/plugin/loader.rs`
- Create: `src-tauri/src/plugin/protocol.rs`
- Modify: `src-tauri/src/lib.rs:5-18` (add `mod plugin;`)

- [ ] **Step 1: Add dependencies to Cargo.toml**

Append these three lines under `[dependencies]` (after `urlencoding = "2"`):

```toml
zip = "2"
semver = "1"
tempfile = "3"
```

- [ ] **Step 2: Create empty plugin module files**

Create `src-tauri/src/plugin/mod.rs`:

```rust
//! Plugin system (mini-app extensions).
//!
//! Slice 1 scope: manifest parsing, filesystem operations
//! (install/uninstall, startup scan), and the `plugin://` URI
//! scheme handler. No WebView, no hotkeys, no UI yet.

pub mod loader;
pub mod manifest;
pub mod protocol;

pub use loader::PluginRecord;
pub use manifest::Manifest;
```

Create empty `src-tauri/src/plugin/manifest.rs`:

```rust
//! Manifest schema, parsing, and validation.
```

Create empty `src-tauri/src/plugin/loader.rs`:

```rust
//! Filesystem ops: dirs, zip extraction, install/uninstall, startup scan.
```

Create empty `src-tauri/src/plugin/protocol.rs`:

```rust
//! `plugin://<id>/<path>` URI scheme handler.
```

- [ ] **Step 3: Register the module in `lib.rs`**

In `src-tauri/src/lib.rs` find the `mod` declarations (lines 5–18) and add `mod plugin;` in alphabetical order, between `mod logger;` and `mod platform;`:

```rust
mod logger;
mod platform;
mod plugin;
mod proc_scan;
```

- [ ] **Step 4: Verify the project compiles**

Run: `cd src-tauri && cargo check`
Expected: clean exit; possibly warnings about unused modules (fine for now).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/plugin/ src-tauri/src/lib.rs
git commit -m "chore(plugin): scaffold module with zip/semver/tempfile deps"
```

---

## Task 2: Plugin directory helpers

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`

These helpers centralize the on-disk layout so every other function can rely on a single source of truth.

- [ ] **Step 1: Write failing tests**

Replace the contents of `src-tauri/src/plugin/loader.rs` with:

```rust
//! Filesystem ops: dirs, zip extraction, install/uninstall, startup scan.

use std::path::PathBuf;

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
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test plugin::loader -- --nocapture`
Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/plugin/loader.rs
git commit -m "feat(plugin): add plugin directory path helpers"
```

---

## Task 3: Manifest struct + serde parsing

**Files:**
- Modify: `src-tauri/src/plugin/manifest.rs`

- [ ] **Step 1: Write failing test for happy-path parsing**

Replace the contents of `src-tauri/src/plugin/manifest.rs` with:

```rust
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
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test plugin::manifest -- --nocapture`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/plugin/manifest.rs
git commit -m "feat(plugin): add Manifest struct with serde parsing"
```

---

## Task 4: Manifest validation rules

**Files:**
- Modify: `src-tauri/src/plugin/manifest.rs`

Implements the validation rules from the spec: id pattern, semver, capability allowlist, window size bounds.

- [ ] **Step 1: Write failing tests**

Append to the `tests` module in `src-tauri/src/plugin/manifest.rs` (just before the closing `}` of `mod tests`):

```rust
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
```

- [ ] **Step 2: Run tests to confirm they fail to compile**

Run: `cd src-tauri && cargo test plugin::manifest`
Expected: FAIL — `cannot find type ManifestError in this scope` and missing `validate` method.

- [ ] **Step 3: Implement `ManifestError` and `Manifest::validate`**

Add the error type and validation impl to `src-tauri/src/plugin/manifest.rs` (insert before the `#[cfg(test)]` block):

```rust
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
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::manifest`
Expected: all 13 tests (4 from Task 3 + 9 new) pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/manifest.rs
git commit -m "feat(plugin): add manifest validation rules"
```

---

## Task 5: Entry path canonicalization

**Files:**
- Modify: `src-tauri/src/plugin/manifest.rs`

Resolves the manifest's `entry` field against the unpacked plugin directory, rejecting any path that escapes the dir via `..` or symlinks.

- [ ] **Step 1: Write failing tests**

Append to the `tests` module in `src-tauri/src/plugin/manifest.rs`:

```rust
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
```

- [ ] **Step 2: Run tests — should fail to compile**

Run: `cd src-tauri && cargo test plugin::manifest`
Expected: FAIL — `cannot find function canonicalize_entry`.

- [ ] **Step 3: Implement `canonicalize_entry`**

Add to `src-tauri/src/plugin/manifest.rs` (before the `#[cfg(test)]` block):

```rust
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
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::manifest`
Expected: all 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/manifest.rs
git commit -m "feat(plugin): add canonicalize_entry with path-escape defense"
```

---

## Task 6: `PluginRecord` type + AppState integration

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/lib.rs`

The frontend will receive `PluginRecord` over Tauri commands, so it derives `Serialize`. The `webview_label` field is set by Slice 2 and stays `None` for now.

- [ ] **Step 1: Add types in `loader.rs`**

Insert at the top of `src-tauri/src/plugin/loader.rs` (after the existing `use` line and module doc):

```rust
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
```

- [ ] **Step 2: Add `plugins` field to `AppState`**

In `src-tauri/src/state.rs`, add an import line near the top (after the existing imports):

```rust
use crate::plugin::PluginRecord;
```

Then add a new field at the end of the `AppState` struct (after `last_sessions_fingerprint: u64`):

```rust
    /// Installed plugins, keyed by manifest `id`. Populated at startup by
    /// `plugin::loader::scan_plugins` and mutated by install/uninstall.
    pub plugins: HashMap<String, PluginRecord>,
```

- [ ] **Step 3: Initialize the field in `AppState` construction**

`AppState` is constructed in `src-tauri/src/lib.rs`. Find the construction (search for `current_ui: "disconnected"` or similar) and add to the struct literal:

```bash
grep -n "current_ui:" src-tauri/src/lib.rs
```

Add a line `plugins: HashMap::new(),` immediately after `last_sessions_fingerprint: 0,` in that struct literal.

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: clean exit (some unused-warnings expected).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/loader.rs src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(plugin): add PluginRecord type and AppState plugins field"
```

---

## Task 7: Safe zip extraction with zip-slip defense

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`

The `zip` crate's `ZipFile::enclosed_name()` rejects entries with `..`, but we double-check the canonical path is inside `dest_dir` defensively (same pattern Tauri's own asset protocol uses).

- [ ] **Step 1: Write failing tests**

Append to `src-tauri/src/plugin/loader.rs` (at the bottom of the file, **not** inside an existing `mod tests`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// Build a zip containing the given (path, content) entries.
    fn build_zip(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        for (name, content) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(content).unwrap();
        }
        w.finish().unwrap();
        f
    }

    #[test]
    fn extract_zip_safe_writes_files() {
        let zip = build_zip(&[
            ("manifest.json", b"{}"),
            ("index.html", b"<html></html>"),
            ("assets/main.js", b"console.log(1)"),
        ]);
        let dest = TempDir::new().unwrap();
        extract_zip_safe(zip.path(), dest.path()).expect("ok");
        assert!(dest.path().join("manifest.json").is_file());
        assert!(dest.path().join("index.html").is_file());
        assert!(dest.path().join("assets/main.js").is_file());
        assert_eq!(
            std::fs::read(dest.path().join("index.html")).unwrap(),
            b"<html></html>"
        );
    }

    #[test]
    fn extract_zip_safe_blocks_parent_traversal() {
        let zip = build_zip(&[("../escape.txt", b"oops")]);
        let dest = TempDir::new().unwrap();
        let result = extract_zip_safe(zip.path(), dest.path());
        assert!(matches!(result, Err(ExtractError::UnsafePath(_))));
        let parent = dest.path().parent().unwrap();
        assert!(!parent.join("escape.txt").exists());
    }

    #[test]
    fn extract_zip_safe_blocks_absolute_path() {
        let zip = build_zip(&[("/tmp/escape.txt", b"oops")]);
        let dest = TempDir::new().unwrap();
        let result = extract_zip_safe(zip.path(), dest.path());
        assert!(matches!(result, Err(ExtractError::UnsafePath(_))));
    }

    #[test]
    fn extract_zip_safe_creates_intermediate_dirs() {
        let zip = build_zip(&[("a/b/c/d.txt", b"x")]);
        let dest = TempDir::new().unwrap();
        extract_zip_safe(zip.path(), dest.path()).expect("ok");
        assert!(dest.path().join("a/b/c/d.txt").is_file());
    }
}
```

- [ ] **Step 2: Run tests — should fail to compile**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: FAIL — `cannot find function extract_zip_safe` and `cannot find type ExtractError`.

- [ ] **Step 3: Implement `extract_zip_safe` and `ExtractError`**

Insert into `src-tauri/src/plugin/loader.rs` (above the existing `#[cfg(test)]` block):

```rust
use std::path::Path;

#[derive(Debug)]
pub enum ExtractError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    UnsafePath(String),
}

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::Zip(e) => write!(f, "zip error: {}", e),
            Self::UnsafePath(p) => write!(f, "unsafe entry path: {}", p),
        }
    }
}

impl std::error::Error for ExtractError {}

impl From<std::io::Error> for ExtractError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<zip::result::ZipError> for ExtractError {
    fn from(e: zip::result::ZipError) -> Self {
        Self::Zip(e)
    }
}

/// Extract `zip_path` into `dest_dir`, rejecting any entry whose
/// resolved path escapes `dest_dir`. `dest_dir` must already exist.
pub fn extract_zip_safe(zip_path: &Path, dest_dir: &Path) -> Result<(), ExtractError> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let dest_canonical = dest_dir.canonicalize()?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        // enclosed_name rejects ".." and absolute paths; treat None as unsafe.
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| ExtractError::UnsafePath(entry.name().to_string()))?
            .to_path_buf();

        let out_path = dest_canonical.join(&rel);

        // Defensive: confirm the parent of out_path is inside dest_canonical,
        // even after symlink resolution of intermediate components.
        if !out_path.starts_with(&dest_canonical) {
            return Err(ExtractError::UnsafePath(entry.name().to_string()));
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: 4 new extraction tests + 3 dir tests = 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/loader.rs
git commit -m "feat(plugin): add zip-slip-safe archive extraction"
```

---

## Task 8: `install_plugin_from_zip`

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`

Staging strategy: unzip into `~/.ani-mime/plugins/.staging-<nanos>/`, validate, then atomically rename to `~/.ani-mime/plugins/<id>/`. Staging is a sibling of the final dest so rename is same-filesystem.

To keep tests hermetic (they shouldn't touch `~/.ani-mime/`), `install_plugin_from_zip` accepts a `plugins_root` parameter. The Tauri command wrapper in Task 12 passes `plugins_root()`.

- [ ] **Step 1: Write failing tests**

Append inside the existing `mod tests` block in `src-tauri/src/plugin/loader.rs`:

```rust
    fn minimal_manifest_json(id: &str) -> String {
        format!(
            r#"{{
                "id": "{id}",
                "name": "Test",
                "version": "0.1.0",
                "entry": "index.html",
                "capabilities": ["window"],
                "window": {{ "width": 100, "height": 100 }}
            }}"#
        )
    }

    fn build_plugin_zip(id: &str, extra: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let manifest = minimal_manifest_json(id);
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(manifest.as_bytes()).unwrap();
        w.start_file("index.html", opts).unwrap();
        w.write_all(b"<html></html>").unwrap();
        for (name, content) in extra {
            w.start_file(*name, opts).unwrap();
            w.write_all(content).unwrap();
        }
        w.finish().unwrap();
        f
    }

    #[test]
    fn install_plugin_extracts_and_validates() {
        let zip = build_plugin_zip("translator", &[]);
        let root = TempDir::new().unwrap();
        let manifest = install_plugin_from_zip(zip.path(), root.path()).expect("ok");
        assert_eq!(manifest.id, "translator");
        assert!(root.path().join("translator/manifest.json").is_file());
        assert!(root.path().join("translator/index.html").is_file());
        // Staging dir should be gone after success.
        let staging_remnants: Vec<_> = std::fs::read_dir(root.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".staging-"))
            .collect();
        assert!(staging_remnants.is_empty(), "staging not cleaned up");
    }

    #[test]
    fn install_plugin_rejects_id_collision() {
        let root = TempDir::new().unwrap();
        let zip1 = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip1.path(), root.path()).expect("first install ok");

        let zip2 = build_plugin_zip("translator", &[]);
        let err = install_plugin_from_zip(zip2.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::AlreadyInstalled(_)));
    }

    #[test]
    fn install_plugin_rejects_missing_manifest() {
        // Build a zip without manifest.json
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("index.html", opts).unwrap();
        w.write_all(b"<html></html>").unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::ManifestMissing));
    }

    #[test]
    fn install_plugin_rejects_invalid_manifest() {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(br#"{"id": "BadID", "name":"X", "version":"0.1.0", "entry":"i.html", "capabilities":[], "window":{"width":1,"height":1}}"#).unwrap();
        w.start_file("i.html", opts).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::Manifest(_)));
    }

    #[test]
    fn install_plugin_rejects_missing_entry_file() {
        // Build a zip with a manifest that points at a missing entry.
        let manifest_json = r#"{
            "id": "x",
            "name": "X",
            "version": "0.1.0",
            "entry": "missing.html",
            "capabilities": [],
            "window": { "width": 100, "height": 100 }
        }"#;
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(manifest_json.as_bytes()).unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::Manifest(_)));
    }
```

- [ ] **Step 2: Run tests — should fail to compile**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: FAIL — `cannot find function install_plugin_from_zip`, `cannot find type InstallError`.

- [ ] **Step 3: Implement install logic**

Append to `src-tauri/src/plugin/loader.rs` (above the `#[cfg(test)]` block):

```rust
use crate::plugin::manifest::{canonicalize_entry, ManifestError};

#[derive(Debug)]
pub enum InstallError {
    Io(std::io::Error),
    Extract(ExtractError),
    ManifestMissing,
    Manifest(ManifestError),
    AlreadyInstalled(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::Extract(e) => write!(f, "extract failed: {}", e),
            Self::ManifestMissing => write!(f, "manifest.json missing from zip"),
            Self::Manifest(e) => write!(f, "{}", e),
            Self::AlreadyInstalled(id) => write!(f, "plugin '{}' already installed", id),
        }
    }
}

impl std::error::Error for InstallError {}

impl From<std::io::Error> for InstallError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<ExtractError> for InstallError {
    fn from(e: ExtractError) -> Self {
        Self::Extract(e)
    }
}
impl From<ManifestError> for InstallError {
    fn from(e: ManifestError) -> Self {
        Self::Manifest(e)
    }
}

/// Install a plugin from `zip_path` into `plugins_root` (typically
/// the value returned by `plugins_root()`, but tests pass a tempdir).
///
/// Steps: stage in sibling dir → validate → atomic rename to final dest.
pub fn install_plugin_from_zip(
    zip_path: &Path,
    plugins_root: &Path,
) -> Result<Manifest, InstallError> {
    std::fs::create_dir_all(plugins_root)?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging = plugins_root.join(format!(".staging-{}", nanos));
    std::fs::create_dir(&staging)?;

    let result = (|| -> Result<Manifest, InstallError> {
        extract_zip_safe(zip_path, &staging)?;

        let manifest_path = staging.join("manifest.json");
        if !manifest_path.is_file() {
            return Err(InstallError::ManifestMissing);
        }
        let manifest_json = std::fs::read_to_string(&manifest_path)?;
        let manifest: Manifest = serde_json::from_str(&manifest_json)
            .map_err(|e| InstallError::Manifest(ManifestError::InvalidJson(e.to_string())))?;
        manifest.validate()?;
        // Confirms the entry exists inside the staged dir.
        canonicalize_entry(&staging, &manifest.entry)?;

        let dest = plugins_root.join(&manifest.id);
        if dest.exists() {
            return Err(InstallError::AlreadyInstalled(manifest.id.clone()));
        }
        std::fs::rename(&staging, &dest)?;
        Ok(manifest)
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: 12 passed (5 new install tests + 7 from prior tasks).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/loader.rs
git commit -m "feat(plugin): install_plugin_from_zip with staging + validation"
```

---

## Task 9: `uninstall_plugin`

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`

- [ ] **Step 1: Write failing tests**

Append inside `mod tests` in `src-tauri/src/plugin/loader.rs`:

```rust
    #[test]
    fn uninstall_plugin_removes_dir() {
        let root = TempDir::new().unwrap();
        let zip = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip.path(), root.path()).expect("install");
        assert!(root.path().join("translator").is_dir());

        uninstall_plugin("translator", root.path()).expect("uninstall");
        assert!(!root.path().join("translator").exists());
    }

    #[test]
    fn uninstall_plugin_errors_when_missing() {
        let root = TempDir::new().unwrap();
        let err = uninstall_plugin("nope", root.path()).unwrap_err();
        assert!(matches!(err, UninstallError::NotInstalled(_)));
    }

    #[test]
    fn uninstall_plugin_rejects_path_escape_id() {
        let root = TempDir::new().unwrap();
        let err = uninstall_plugin("../etc", root.path()).unwrap_err();
        // Either NotInstalled (after we refuse to compute the path) or
        // an explicit Invalid error works; the key assertion is we did
        // NOT delete anything outside `root`.
        assert!(!matches!(err, UninstallError::Io(_)));
        assert!(root.path().parent().unwrap().join("etc").exists() == false);
    }
```

- [ ] **Step 2: Run — should fail to compile**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: FAIL — `cannot find function uninstall_plugin`.

- [ ] **Step 3: Implement uninstall**

Append to `src-tauri/src/plugin/loader.rs` (above the `#[cfg(test)]` block):

```rust
#[derive(Debug)]
pub enum UninstallError {
    Io(std::io::Error),
    NotInstalled(String),
    InvalidId(String),
}

impl std::fmt::Display for UninstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::NotInstalled(id) => write!(f, "plugin '{}' not installed", id),
            Self::InvalidId(id) => write!(f, "invalid plugin id: {}", id),
        }
    }
}

impl std::error::Error for UninstallError {}

impl From<std::io::Error> for UninstallError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Remove the plugin's directory entirely. Caller is responsible for
/// updating AppState (Task 12).
pub fn uninstall_plugin(id: &str, plugins_root: &Path) -> Result<(), UninstallError> {
    // Defensive: refuse ids that contain path separators or "..".
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == ".." || id == "." {
        return Err(UninstallError::InvalidId(id.into()));
    }
    let dir = plugins_root.join(id);
    if !dir.is_dir() {
        return Err(UninstallError::NotInstalled(id.into()));
    }
    // Final safety check: the path must still be inside plugins_root after
    // canonicalization. Catches symlinks pointing outside.
    let dir_canonical = dir.canonicalize()?;
    let root_canonical = plugins_root.canonicalize()?;
    if !dir_canonical.starts_with(&root_canonical) {
        return Err(UninstallError::InvalidId(id.into()));
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/loader.rs
git commit -m "feat(plugin): add uninstall_plugin with id-safety check"
```

---

## Task 10: `scan_plugins` — startup scan

**Files:**
- Modify: `src-tauri/src/plugin/loader.rs`

On host startup, populate `AppState.plugins` from disk. A plugin whose manifest fails revalidation is loaded with `status: Error(reason)` and reported to the UI so the user can uninstall it.

- [ ] **Step 1: Write failing tests**

Append inside `mod tests` in `src-tauri/src/plugin/loader.rs`:

```rust
    #[test]
    fn scan_plugins_returns_empty_for_missing_root() {
        let root = TempDir::new().unwrap();
        let missing = root.path().join("does-not-exist");
        let records = scan_plugins(&missing);
        assert!(records.is_empty());
    }

    #[test]
    fn scan_plugins_finds_installed() {
        let root = TempDir::new().unwrap();
        let zip = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip.path(), root.path()).expect("install");

        let records = scan_plugins(root.path());
        assert_eq!(records.len(), 1);
        let rec = records.get("translator").unwrap();
        assert_eq!(rec.manifest.id, "translator");
        assert!(rec.enabled, "scanned plugins default to enabled");
        assert!(matches!(rec.status, PluginStatus::Loaded));
        assert!(rec.webview_label.is_none());
    }

    #[test]
    fn scan_plugins_marks_broken_manifest_as_error() {
        let root = TempDir::new().unwrap();
        let plugin_dir = root.path().join("broken");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("manifest.json"), b"not json").unwrap();

        let records = scan_plugins(root.path());
        // We can't key by id because the manifest didn't parse; we key by dir name.
        let rec = records.get("broken").expect("present");
        assert!(matches!(rec.status, PluginStatus::Error(_)));
    }

    #[test]
    fn scan_plugins_ignores_staging_dirs() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join(".staging-123")).unwrap();
        let records = scan_plugins(root.path());
        assert!(records.is_empty());
    }
```

- [ ] **Step 2: Run — should fail to compile**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: FAIL — `cannot find function scan_plugins`.

- [ ] **Step 3: Implement scan**

Append to `src-tauri/src/plugin/loader.rs` (above the `#[cfg(test)]` block):

```rust
use std::collections::HashMap;

/// Scan `plugins_root` for installed plugins. Returns a map keyed by
/// the directory name (which equals the manifest `id` for valid plugins,
/// or whatever the dir is called for broken plugins). Plugins whose
/// manifest parses but fails validation are returned with
/// `PluginStatus::Error(reason)` so the UI can show them.
///
/// Hidden directories (names starting with '.') are skipped — this
/// excludes `.staging-*` dirs from in-progress installs.
pub fn scan_plugins(plugins_root: &Path) -> HashMap<String, PluginRecord> {
    let mut out = HashMap::new();
    let entries = match std::fs::read_dir(plugins_root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if dir_name.starts_with('.') {
            continue;
        }

        match load_plugin_dir(&path) {
            Ok(manifest) => {
                out.insert(
                    manifest.id.clone(),
                    PluginRecord {
                        manifest,
                        enabled: true,
                        status: PluginStatus::Loaded,
                        webview_label: None,
                    },
                );
            }
            Err(reason) => {
                // Synthesize a placeholder Manifest so the UI has something
                // to render; the real manifest didn't load.
                let placeholder = Manifest {
                    id: dir_name.clone(),
                    name: dir_name.clone(),
                    version: "0.0.0".to_string(),
                    description: String::new(),
                    author: String::new(),
                    entry: String::new(),
                    icon: None,
                    hotkey: None,
                    capabilities: Vec::new(),
                    window: crate::plugin::manifest::WindowConfig {
                        width: 1,
                        height: 1,
                        resizable: false,
                        always_on_top: false,
                        transparent: false,
                        decorations: true,
                    },
                };
                out.insert(
                    dir_name,
                    PluginRecord {
                        manifest: placeholder,
                        enabled: false,
                        status: PluginStatus::Error(reason),
                        webview_label: None,
                    },
                );
            }
        }
    }
    out
}

/// Read + parse + validate a single plugin directory's manifest.json.
fn load_plugin_dir(plugin_dir: &Path) -> Result<Manifest, String> {
    let manifest_path = plugin_dir.join("manifest.json");
    let json = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("manifest.json: {}", e))?;
    let manifest: Manifest = serde_json::from_str(&json)
        .map_err(|e| format!("manifest.json parse: {}", e))?;
    manifest.validate().map_err(|e| e.to_string())?;
    canonicalize_entry(plugin_dir, &manifest.entry).map_err(|e| e.to_string())?;
    Ok(manifest)
}
```

You also need to import `WindowConfig` into `loader.rs`. Add this near the top imports:

```rust
use crate::plugin::manifest::WindowConfig;
```

(If `WindowConfig` isn't `pub` in `manifest.rs`, make it `pub` — the struct definition already starts with `pub struct WindowConfig`, so it's exported.)

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test plugin::loader`
Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/loader.rs
git commit -m "feat(plugin): add scan_plugins for startup discovery"
```

---

## Task 11: `plugin://` URI scheme handler

**Files:**
- Modify: `src-tauri/src/plugin/protocol.rs`

Splits cleanly into two pure-ish helpers (testable directly) and one Tauri-bound wrapper (tested via integration in Task 13's manual smoke).

- [ ] **Step 1: Write failing tests for the helpers**

Replace contents of `src-tauri/src/plugin/protocol.rs`:

```rust
//! `plugin://<id>/<path>` URI scheme handler.

use std::path::{Path, PathBuf};

/// MIME type for a path, derived from extension. Plain-text fallback
/// keeps WebView from refusing unknown types.
pub fn mime_from_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ref e) if e == "html" || e == "htm" => "text/html",
        Some(ref e) if e == "js" || e == "mjs" => "application/javascript",
        Some(ref e) if e == "css" => "text/css",
        Some(ref e) if e == "json" => "application/json",
        Some(ref e) if e == "png" => "image/png",
        Some(ref e) if e == "jpg" || e == "jpeg" => "image/jpeg",
        Some(ref e) if e == "svg" => "image/svg+xml",
        Some(ref e) if e == "gif" => "image/gif",
        Some(ref e) if e == "webp" => "image/webp",
        Some(ref e) if e == "woff" => "font/woff",
        Some(ref e) if e == "woff2" => "font/woff2",
        Some(ref e) if e == "ttf" => "font/ttf",
        Some(ref e) if e == "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

#[derive(Debug)]
pub enum ResolveError {
    InvalidPath,
    NotFound,
    Escape,
}

/// Resolve a request path (relative, e.g. "index.html" or "assets/main.js")
/// against `plugin_dir` and return the canonical PathBuf, refusing any
/// path that escapes `plugin_dir`.
pub fn resolve_plugin_file(plugin_dir: &Path, request_path: &str) -> Result<PathBuf, ResolveError> {
    let trimmed = request_path.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err(ResolveError::InvalidPath);
    }
    if Path::new(trimmed).is_absolute() {
        return Err(ResolveError::Escape);
    }
    let plugin_dir_canonical = plugin_dir.canonicalize().map_err(|_| ResolveError::NotFound)?;
    let joined = plugin_dir_canonical.join(trimmed);
    let canonical = joined.canonicalize().map_err(|_| ResolveError::NotFound)?;
    if !canonical.starts_with(&plugin_dir_canonical) {
        return Err(ResolveError::Escape);
    }
    if !canonical.is_file() {
        return Err(ResolveError::NotFound);
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::write;
    use tempfile::TempDir;

    #[test]
    fn mime_html() {
        assert_eq!(mime_from_path(Path::new("a/b/index.html")), "text/html");
        assert_eq!(mime_from_path(Path::new("INDEX.HTM")), "text/html");
    }

    #[test]
    fn mime_javascript() {
        assert_eq!(mime_from_path(Path::new("main.js")), "application/javascript");
        assert_eq!(mime_from_path(Path::new("mod.mjs")), "application/javascript");
    }

    #[test]
    fn mime_unknown_falls_back_to_octet_stream() {
        assert_eq!(mime_from_path(Path::new("a.xyz")), "application/octet-stream");
        assert_eq!(mime_from_path(Path::new("README")), "application/octet-stream");
    }

    #[test]
    fn resolve_in_dir_file() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path().join("index.html"), b"x").unwrap();
        let r = resolve_plugin_file(tmp.path(), "index.html").expect("ok");
        assert!(r.ends_with("index.html"));
    }

    #[test]
    fn resolve_nested_file() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("assets")).unwrap();
        write(tmp.path().join("assets/main.js"), b"y").unwrap();
        let r = resolve_plugin_file(tmp.path(), "assets/main.js").expect("ok");
        assert!(r.ends_with("assets/main.js"));
    }

    #[test]
    fn resolve_strips_leading_slash() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path().join("index.html"), b"x").unwrap();
        let r = resolve_plugin_file(tmp.path(), "/index.html").expect("ok");
        assert!(r.ends_with("index.html"));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "../etc").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound | ResolveError::Escape));
    }

    #[test]
    fn resolve_rejects_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "/etc/passwd").unwrap_err();
        assert!(matches!(err, ResolveError::Escape));
    }

    #[test]
    fn resolve_rejects_missing_file() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "no-such-file").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound));
    }

    #[test]
    fn resolve_rejects_directory() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("subdir")).unwrap();
        let err = resolve_plugin_file(tmp.path(), "subdir").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound));
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test plugin::protocol`
Expected: 11 passed.

- [ ] **Step 3: Add the Tauri-bound handler at the bottom of `protocol.rs` (outside the test mod)**

Append above the `#[cfg(test)]` block:

```rust
use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use tauri::http::{Request, Response, StatusCode};
use tauri::Manager;

use crate::plugin::loader::plugin_dir;
use crate::state::AppState;

/// Tauri URI scheme handler for `plugin://<id>/<path>`.
///
/// On macOS/Linux, `uri.host()` returns the plugin id and `uri.path()`
/// returns "/<path>". On Windows, Tauri rewrites to `http://plugin.localhost/<id>/<path>`;
/// that branch isn't covered in this slice (ani-mime's primary target is macOS).
pub fn handle_plugin_protocol(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let plugin_id = match uri.host() {
        Some(h) if !h.is_empty() => h.to_string(),
        _ => return status(StatusCode::BAD_REQUEST, b"missing plugin id"),
    };
    let request_path = uri.path();

    // Check the plugin is installed and enabled.
    let state = app.state::<Arc<Mutex<AppState>>>();
    let plugin_dir_path = {
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return status(StatusCode::INTERNAL_SERVER_ERROR, b"state lock poisoned"),
        };
        let record = match guard.plugins.get(&plugin_id) {
            Some(r) => r,
            None => return status(StatusCode::NOT_FOUND, b"plugin not installed"),
        };
        if !record.enabled {
            return status(StatusCode::FORBIDDEN, b"plugin disabled");
        }
        match plugin_dir(&plugin_id) {
            Ok(p) => p,
            Err(_) => return status(StatusCode::INTERNAL_SERVER_ERROR, b"plugin dir resolve failed"),
        }
    };

    match resolve_plugin_file(&plugin_dir_path, request_path) {
        Ok(file_path) => match std::fs::read(&file_path) {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime_from_path(&file_path))
                .header("Access-Control-Allow-Origin", "null")
                .body(Cow::Owned(bytes))
                .unwrap(),
            Err(_) => status(StatusCode::NOT_FOUND, b"read failed"),
        },
        Err(ResolveError::Escape) => status(StatusCode::FORBIDDEN, b"path escape"),
        Err(ResolveError::NotFound) => status(StatusCode::NOT_FOUND, b"not found"),
        Err(ResolveError::InvalidPath) => status(StatusCode::BAD_REQUEST, b"invalid path"),
    }
}

fn status(code: StatusCode, msg: &'static [u8]) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .body(Cow::Borrowed(msg))
        .unwrap()
}
```

- [ ] **Step 4: Run all plugin tests**

Run: `cd src-tauri && cargo test plugin::`
Expected: all previous tests still pass; `cargo check` clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/protocol.rs
git commit -m "feat(plugin): add plugin:// protocol handler with path-escape defense"
```

---

## Task 12: Tauri commands + invoke_handler registration

**Files:**
- Modify: `src-tauri/src/lib.rs`

Adds four `#[tauri::command]` wrappers per CLAUDE.md convention. Each wrapper delegates to `plugin::*` for the domain logic.

- [ ] **Step 1: Find the invoke_handler line**

```bash
grep -n "invoke_handler" src-tauri/src/lib.rs
```

You should see the line around `:438` registering existing commands.

- [ ] **Step 2: Add new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find a good insertion point — anywhere between existing `#[tauri::command]` definitions in the file. Add this block:

```rust
// --- Plugin system (Slice 1) ---

#[tauri::command]
fn install_plugin_from_dialog(app: tauri::AppHandle) -> Result<plugin::PluginRecord, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<std::path::PathBuf>>();
    app.dialog()
        .file()
        .add_filter("Plugin", &["zip"])
        .pick_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });
    let zip_path = match rx.recv() {
        Ok(Some(p)) => p,
        _ => return Err("install canceled".into()),
    };

    let root = plugin::loader::plugins_root().map_err(|e| e.to_string())?;
    let manifest = plugin::loader::install_plugin_from_zip(&zip_path, &root)
        .map_err(|e| e.to_string())?;

    let record = plugin::PluginRecord {
        manifest: manifest.clone(),
        enabled: true,
        status: plugin::loader::PluginStatus::Loaded,
        webview_label: None,
    };

    let state = app.state::<Arc<Mutex<AppState>>>();
    {
        let mut guard = state.lock().map_err(|_| "state lock poisoned")?;
        guard.plugins.insert(manifest.id.clone(), record.clone());
    }
    let _ = app.emit("plugins-changed", ());
    crate::app_log!("[plugin] installed {} v{}", manifest.id, manifest.version);
    Ok(record)
}

#[tauri::command]
fn uninstall_plugin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = plugin::loader::plugins_root().map_err(|e| e.to_string())?;
    plugin::loader::uninstall_plugin(&id, &root).map_err(|e| e.to_string())?;

    let state = app.state::<Arc<Mutex<AppState>>>();
    {
        let mut guard = state.lock().map_err(|_| "state lock poisoned")?;
        guard.plugins.remove(&id);
    }
    let _ = app.emit("plugins-changed", ());
    crate::app_log!("[plugin] uninstalled {}", id);
    Ok(())
}

#[tauri::command]
fn set_ani_plugin_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    // Slice 1: flag-flip only. Hotkey unregister / WebView close land in Slice 3.
    let state = app.state::<Arc<Mutex<AppState>>>();
    {
        let mut guard = state.lock().map_err(|_| "state lock poisoned")?;
        match guard.plugins.get_mut(&id) {
            Some(rec) => rec.enabled = enabled,
            None => return Err(format!("plugin '{}' not installed", id)),
        }
    }
    let _ = app.emit("plugins-changed", ());
    Ok(())
}

#[tauri::command]
fn get_plugins(app: tauri::AppHandle) -> Vec<plugin::PluginRecord> {
    let state = app.state::<Arc<Mutex<AppState>>>();
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<plugin::PluginRecord> = guard.plugins.values().cloned().collect();
    out.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    out
}
```

Name choice: `set_ani_plugin_enabled` (not `set_plugin_enabled`) to avoid collision with `claude_config::set_plugin_enabled`.

- [ ] **Step 3: Register the commands in invoke_handler**

Find the `tauri::generate_handler![...]` invocation (around `lib.rs:438`) and add four entries at the end before the closing bracket:

```rust
install_plugin_from_dialog,
uninstall_plugin,
set_ani_plugin_enabled,
get_plugins
```

- [ ] **Step 4: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: clean (possibly some unused-warning).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(plugin): expose install/uninstall/set-enabled/list Tauri commands"
```

---

## Task 13: Wire startup scan + protocol handler

**Files:**
- Modify: `src-tauri/src/lib.rs`

Last task. Runs the scan at startup, registers the `plugin://` URI scheme on the Tauri builder, and emits `plugins-changed` once the scan completes so the (future) frontend hook fires.

- [ ] **Step 1: Register the URI scheme on the Builder**

In `src-tauri/src/lib.rs::run()`, find the `tauri::Builder::default()` chain. The `register_uri_scheme_protocol` call must come **before** `.setup(...)`. Add the registration:

```rust
        .register_uri_scheme_protocol("plugin", |app, request| {
            crate::plugin::protocol::handle_plugin_protocol(app, request)
        })
```

Place it right after `tauri::Builder::default()` and before any `.plugin(...)` calls (or interleaved — order between `register_uri_scheme_protocol` and `.plugin(...)` doesn't matter; the constraint is "before `.setup`").

- [ ] **Step 2: Run the startup scan inside `.setup(...)`**

In the `.setup(|app| { ... })` block (around `lib.rs:439`), add **near the top** (after the `let app_handle = app.handle().clone();` style preamble — match what's already there):

```rust
            // --- Plugin system: startup scan ---
            match plugin::loader::plugins_root() {
                Ok(root) => {
                    let records = plugin::loader::scan_plugins(&root);
                    let count = records.len();
                    {
                        let state = app.state::<Arc<Mutex<AppState>>>();
                        if let Ok(mut guard) = state.lock() {
                            guard.plugins = records;
                        }
                    }
                    crate::app_log!("[plugin] startup scan: {} installed", count);
                    let _ = app.emit("plugins-changed", ());
                }
                Err(e) => {
                    crate::app_warn!("[plugin] could not determine plugins root: {}", e);
                }
            }
```

- [ ] **Step 3: Verify compilation**

Run: `cd src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Run full plugin test suite**

Run: `cd src-tauri && cargo test plugin::`
Expected: all tests pass. Per-module counts: `plugin::manifest` 18, `plugin::loader` 19, `plugin::protocol` 11 — total 48.

- [ ] **Step 5: Manual smoke test**

Run the app: `bun run tauri dev`

Then in a second terminal, build a fixture plugin and install it via the Tauri command (this verifies end-to-end without UI):

```bash
# Build a fixture plugin .zip
mkdir -p /tmp/fixture-plugin
cat > /tmp/fixture-plugin/manifest.json <<'EOF'
{
  "id": "smoketest",
  "name": "Smoke Test",
  "version": "0.1.0",
  "entry": "index.html",
  "capabilities": [],
  "window": { "width": 200, "height": 100 }
}
EOF
echo "<h1>hello</h1>" > /tmp/fixture-plugin/index.html
cd /tmp/fixture-plugin && zip -r /tmp/smoketest.zip . && cd -
```

In the running app's devtools console (right-click → Inspect on the mascot window):

```javascript
// Install
await window.__TAURI_INTERNALS__.invoke('install_plugin_from_dialog')
// → file dialog appears; pick /tmp/smoketest.zip
// → returns { manifest: { id: "smoketest", ... }, enabled: true, status: { type: "Loaded" } }

// List
await window.__TAURI_INTERNALS__.invoke('get_plugins')
// → [{ manifest: { id: "smoketest", ... }, ... }]

// Disable
await window.__TAURI_INTERNALS__.invoke('set_ani_plugin_enabled', { id: "smoketest", enabled: false })

// Re-list — enabled should now be false
await window.__TAURI_INTERNALS__.invoke('get_plugins')

// Uninstall
await window.__TAURI_INTERNALS__.invoke('uninstall_plugin', { id: "smoketest" })

// Confirm gone
await window.__TAURI_INTERNALS__.invoke('get_plugins')
// → []
```

Also confirm the protocol works: after installing but before uninstall, navigate to `plugin://smoketest/index.html` in a separate browser tab (the URL is intercepted only inside Tauri WebViews; for a host-side check, you can curl the Tauri devserver). The clean check is to confirm the file exists at `~/.ani-mime/plugins/smoketest/index.html` and that the next slice's WebView will load it.

Verify the log file shows:

```
grep "\[plugin\]" ~/Library/Logs/<bundle-id>/ani-mime.log
# → [plugin] startup scan: 0 installed
# → [plugin] installed smoketest v0.1.0
# → [plugin] uninstalled smoketest
```

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(plugin): register plugin:// scheme and scan on startup"
```

---

## Verification

After every task, you ran the relevant `cargo test`. At the end of Slice 1, do these checks:

- [ ] `cd src-tauri && cargo test plugin::` — all plugin tests pass
- [ ] `cd src-tauri && cargo check` — no errors, warnings reviewed
- [ ] `npx tsc --noEmit` — frontend type check still clean (no frontend changes in this slice, should be unaffected)
- [ ] Manual smoke from Task 13 Step 5 completed end-to-end
- [ ] `git log --oneline` shows 13 commits, one per task

## What's NOT in Slice 1 (deferred to later slices)

| Item | Slice |
|---|---|
| WebView spawn for a plugin | 2 |
| `window.ani` SDK injection | 2 |
| `plugin_call` gateway + capability dispatch | 2 |
| Hotkey registration + unregister on disable | 3 |
| Frontend Plugin Manager UI | 4 |
| `@ani-mime/plugin-sdk` npm package | 5 |
| `ani-mime-plugins` repo + first reference plugin | 6 |
| `data/store.json` reads/writes (storage capability impl) | 2 |
| C3 component registration via `c3x` | 4 (when frontend lands) |

## Open questions to resolve before Slice 2 starts

1. The spec's WebView label scheme: `webview_label: Option<String>` — Slice 2 will populate it. Plan to use the plugin id itself as the label (`format!("plugin-{}", id)`) for traceability.
2. Whether `set_ani_plugin_enabled` (currently flag-only) should bubble an event distinct from `plugins-changed` for Slice 3's hotkey side effects. **Suggestion: keep one event; Slice 3 reads enabled state before re/unregistering.**
