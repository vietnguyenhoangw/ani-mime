# Plugin System — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make installed plugins actually run — spawn a per-plugin WebView from its `plugin://<id>/<entry>` files, inject a `window.ani` SDK, and route all SDK calls through one gated `plugin_call` command (window control + per-plugin storage).

**Architecture:** Slice 1 already delivered the backend foundation (manifest parsing, install/uninstall, startup scan, `plugin://` protocol, and the `install_plugin_from_dialog` / `uninstall_plugin` / `set_ani_plugin_enabled` / `get_plugins` commands). Slice 2 adds two new files under `src-tauri/src/plugin/` — `runtime.rs` (WebView spawn + SDK script + label↔id helpers) and `gateway.rs` (the `plugin_call` dispatcher + capability check) — plus `storage.rs` (per-plugin JSON store). A new Tauri capability file grants `plugin-*` windows the minimal permission set. A temporary `launch_plugin` command lets us trigger a plugin without a hotkey (Slice 3) or UI (Slice 4).

**Tech Stack:** Rust (Tauri 2: `WebviewWindowBuilder`, `WebviewUrl::CustomProtocol`, `initialization_script`), `serde_json` for the storage file and `plugin_call` args, `tempfile` for filesystem tests (already a dev-dep from Slice 1). Tests live in-tree under `#[cfg(test)] mod tests` per the project pattern.

**Spec:** `docs/superpowers/specs/2026-05-08-plugin-system-design.md`

---

## Test conventions

- All tests in this slice are platform-independent pure functions or tempdir filesystem tests. Use plain `#[cfg(test)]` (no `#[cfg(target_os = "macos")]` gate).
- WebView spawning itself cannot run headlessly, so it is **not** unit-tested; it is covered by the manual smoke test in Task 7. Everything *around* the spawn (label mapping, capability check, storage, SDK script contents) is unit-tested.
- Tests that touch the filesystem use `tempfile::TempDir` so they don't pollute `~/.ani-mime/`.
- Run all plugin tests with: `cd src-tauri && cargo test plugin::`
- Lint/type check: `cd src-tauri && cargo check`

## Existing surface this slice builds on (do not re-create)

From `src-tauri/src/plugin/`:

- `manifest::Manifest { id, name, version, description, author, entry, icon, hotkey, capabilities: Vec<String>, window: WindowConfig }`
- `manifest::WindowConfig { width: u32, height: u32, resizable: bool, always_on_top: bool, transparent: bool, decorations: bool }`
- `loader::PluginRecord { manifest: Manifest, enabled: bool, status: PluginStatus, webview_label: Option<String> }`
- `loader::PluginStatus::{Loaded, Error(String)}`
- `loader::plugin_dir(id) -> io::Result<PathBuf>` → `~/.ani-mime/plugins/<id>/`
- `loader::plugin_data_dir(id) -> io::Result<PathBuf>` → `~/.ani-mime/plugins/<id>/data/`
- `protocol::handle_plugin_protocol(...)` registered as the `plugin` URI scheme in `lib.rs::run()`
- `AppState.plugins: HashMap<String, PluginRecord>` (state lives behind `Arc<Mutex<AppState>>`, fetched with `app.state::<Arc<Mutex<AppState>>>()`)

## File layout produced by this slice

```
src-tauri/
├── capabilities/
│   └── plugin.json                         (new — capability for plugin-* windows)
└── src/
    ├── lib.rs                              (modified — 2 new commands in invoke_handler)
    └── plugin/
        ├── mod.rs                          (modified — pub mod runtime/gateway/storage)
        ├── storage.rs                      (new — per-plugin JSON store + tests)
        ├── runtime.rs                      (new — label↔id, SDK script, webview spawn + tests)
        └── gateway.rs                      (new — capability check + plugin_call + tests)
```

## Known limitation accepted for this slice (matches spec security table)

In this Tauri setup, application commands registered via `generate_handler` are callable from **any** window, including plugin windows — Tauri's capability ACL gates only `core:`/plugin commands, not app commands. A determined malicious plugin could therefore invoke e.g. `uninstall_plugin` directly rather than through `window.ani`. The spec explicitly scopes "user installs a malicious plugin" **out of v1** (no signing, no permission UI yet). Slice 2 does **not** add per-command caller guards; that hardening lands with the permission UI (v1.1) and is recorded in the open-questions section below. The protections this slice *does* enforce: plugin identity is derived from the window label (not from JS-supplied args, so no cross-plugin impersonation), storage is scoped per plugin id, and the SDK only exposes declared capabilities.

---

## Task 1: Add the `plugin-*` window capability

A plugin WebView is created at runtime with a `plugin-<id>` label. The existing `capabilities/default.json` is scoped to the fixed labels `["main","settings","superpower","peer-list"]`, so a plugin window would have **zero** capabilities and its JS could not use the Tauri IPC bridge at all. This task grants `plugin-*` windows the minimal set needed: enough `core:default` to invoke `plugin_call`. Window mutations (show/hide/resize/close) happen Rust-side inside `plugin_call`, so no extra `core:window:*` JS permissions are required.

**Files:**
- Create: `src-tauri/capabilities/plugin.json`

- [ ] **Step 1: Create the capability file**

Create `src-tauri/capabilities/plugin.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "plugin",
  "description": "Minimal capabilities for plugin webviews (plugin-* labels). Window control and storage are mediated by the plugin_call command, not granted directly here.",
  "windows": ["plugin-*"],
  "permissions": [
    "core:default",
    "core:event:default"
  ]
}
```

- [ ] **Step 2: Verify the capability schema is accepted**

Run: `cd src-tauri && cargo check`
Expected: clean exit. Tauri's build script validates capability files; a malformed `windows` glob or unknown permission identifier would fail the build here.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/capabilities/plugin.json
git commit -m "feat(plugin): add plugin-* window capability"
```

---

## Task 2: Storage module — per-plugin JSON store

`window.ani.storage` persists to `~/.ani-mime/plugins/<id>/data/store.json`, a flat JSON object. This task implements pure filesystem functions that take a `data_dir` (so tests use a tempdir) — the gateway resolves the real dir via `loader::plugin_data_dir(id)` in Task 4.

**Files:**
- Create: `src-tauri/src/plugin/storage.rs`
- Modify: `src-tauri/src/plugin/mod.rs`
- Test: `src-tauri/src/plugin/storage.rs` (in-tree `#[cfg(test)] mod tests`)

- [ ] **Step 1: Register the module in `mod.rs`**

In `src-tauri/src/plugin/mod.rs`, add `pub mod storage;` after the existing `pub mod protocol;` line. The file's `pub use` lines stay as they are. Resulting module declarations:

```rust
pub mod loader;
pub mod manifest;
pub mod protocol;
pub mod storage;

pub use loader::PluginRecord;
pub use manifest::Manifest;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/plugin/storage.rs` with the doc comment, a `use` block, and the tests (the functions they call don't exist yet, so this won't compile — that's the failing state):

```rust
//! Per-plugin key/value storage backed by `<data_dir>/store.json`.
//!
//! The store is a flat JSON object. All functions take the plugin's
//! `data_dir` explicitly so they are pure and testable; callers
//! (the `plugin_call` gateway) pass `loader::plugin_data_dir(id)`.

use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

fn store_path(data_dir: &Path) -> PathBuf {
    data_dir.join("store.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn get_missing_key_returns_null() {
        let dir = TempDir::new().unwrap();
        assert_eq!(get(dir.path(), "nope").unwrap(), Value::Null);
    }

    #[test]
    fn set_then_get_round_trips() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "count", &serde_json::json!(42)).unwrap();
        assert_eq!(get(dir.path(), "count").unwrap(), serde_json::json!(42));
    }

    #[test]
    fn set_creates_data_dir_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("does/not/exist/yet");
        set(&nested, "k", &serde_json::json!("v")).unwrap();
        assert!(nested.join("store.json").is_file());
        assert_eq!(get(&nested, "k").unwrap(), serde_json::json!("v"));
    }

    #[test]
    fn set_overwrites_existing_key() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "k", &serde_json::json!(1)).unwrap();
        set(dir.path(), "k", &serde_json::json!(2)).unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), serde_json::json!(2));
    }

    #[test]
    fn set_preserves_other_keys() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "a", &serde_json::json!(1)).unwrap();
        set(dir.path(), "b", &serde_json::json!(2)).unwrap();
        assert_eq!(get(dir.path(), "a").unwrap(), serde_json::json!(1));
        assert_eq!(get(dir.path(), "b").unwrap(), serde_json::json!(2));
    }

    #[test]
    fn delete_removes_key() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "k", &serde_json::json!("v")).unwrap();
        delete(dir.path(), "k").unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), Value::Null);
    }

    #[test]
    fn delete_missing_key_is_ok() {
        let dir = TempDir::new().unwrap();
        delete(dir.path(), "nope").unwrap();
    }

    #[test]
    fn corrupt_store_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        std::fs::write(store_path(dir.path()), b"not json").unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), Value::Null);
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test plugin::storage`
Expected: FAIL to **compile** — `cannot find function get`/`set`/`delete` in this scope.

- [ ] **Step 4: Implement the store functions**

Insert these functions into `src-tauri/src/plugin/storage.rs` directly after the `store_path` function (above the `#[cfg(test)]` block):

```rust
/// Read the whole store as a JSON object. A missing or corrupt file
/// reads as an empty object (never errors) so a bad write can't brick
/// the plugin.
fn read_store(data_dir: &Path) -> Map<String, Value> {
    let path = store_path(data_dir);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Value>(&s)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

fn write_store(data_dir: &Path, map: &Map<String, Value>) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let json = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .unwrap_or_else(|_| "{}".to_string());
    std::fs::write(store_path(data_dir), json)
}

/// Return the value for `key`, or `Value::Null` if absent.
pub fn get(data_dir: &Path, key: &str) -> std::io::Result<Value> {
    Ok(read_store(data_dir).get(key).cloned().unwrap_or(Value::Null))
}

/// Set `key` to `value`, creating the data dir and store file as needed.
pub fn set(data_dir: &Path, key: &str, value: &Value) -> std::io::Result<()> {
    let mut map = read_store(data_dir);
    map.insert(key.to_string(), value.clone());
    write_store(data_dir, &map)
}

/// Remove `key`. Removing an absent key is a no-op success.
pub fn delete(data_dir: &Path, key: &str) -> std::io::Result<()> {
    let mut map = read_store(data_dir);
    if map.remove(key).is_some() {
        write_store(data_dir, &map)?;
    }
    Ok(())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test plugin::storage`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/plugin/storage.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(plugin): per-plugin JSON storage module"
```

---

## Task 3: Runtime module — label↔id helpers and the SDK script

This task adds `runtime.rs` with the pure helpers that map between a plugin id and its WebView label (`plugin-<id>`), plus the `window.ani` SDK JavaScript injected into every plugin WebView. The WebView-spawning function comes in Task 5 (after the gateway exists). Splitting it this way keeps each task small and lets us unit-test the label mapping and the SDK script contents first.

**Files:**
- Create: `src-tauri/src/plugin/runtime.rs`
- Modify: `src-tauri/src/plugin/mod.rs`
- Test: `src-tauri/src/plugin/runtime.rs` (in-tree tests)

- [ ] **Step 1: Register the module in `mod.rs`**

In `src-tauri/src/plugin/mod.rs`, add `pub mod runtime;` so the declarations read:

```rust
pub mod loader;
pub mod manifest;
pub mod protocol;
pub mod runtime;
pub mod storage;

pub use loader::PluginRecord;
pub use manifest::Manifest;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/plugin/runtime.rs` with the doc comment and tests only:

```rust
//! Plugin WebView runtime: id↔label mapping, the injected `window.ani`
//! SDK script, and the spawn function used by the `launch_plugin` command.

/// Prefix applied to every plugin WebView label so plugin windows are
/// distinguishable from the app's fixed windows (main/settings/etc.).
pub const LABEL_PREFIX: &str = "plugin-";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_for_id_prefixes() {
        assert_eq!(webview_label_for_id("translator"), "plugin-translator");
    }

    #[test]
    fn id_from_label_strips_prefix() {
        assert_eq!(id_from_label("plugin-translator"), Some("translator".to_string()));
    }

    #[test]
    fn id_from_label_rejects_non_plugin_label() {
        assert_eq!(id_from_label("settings"), None);
        assert_eq!(id_from_label("main"), None);
    }

    #[test]
    fn label_round_trips() {
        let id = "quick-translate";
        let label = webview_label_for_id(id);
        assert_eq!(id_from_label(&label).as_deref(), Some(id));
    }

    #[test]
    fn sdk_script_exposes_window_ani_namespaces() {
        assert!(ANI_SDK_JS.contains("window.ani"));
        assert!(ANI_SDK_JS.contains("storage"));
        assert!(ANI_SDK_JS.contains("window:"));
        // SDK routes everything through the single gated command.
        assert!(ANI_SDK_JS.contains("plugin_call"));
        // Uses the always-present internals bridge (withGlobalTauri is off).
        assert!(ANI_SDK_JS.contains("__TAURI_INTERNALS__"));
    }

    #[test]
    fn sdk_script_declares_all_storage_methods() {
        assert!(ANI_SDK_JS.contains("get:"));
        assert!(ANI_SDK_JS.contains("set:"));
        assert!(ANI_SDK_JS.contains("delete:"));
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test plugin::runtime`
Expected: FAIL to compile — `cannot find function webview_label_for_id` / `id_from_label` / `cannot find value ANI_SDK_JS`.

- [ ] **Step 4: Implement the helpers and SDK script**

Insert directly after the `LABEL_PREFIX` constant (above the `#[cfg(test)]` block):

```rust
/// `"translator"` → `"plugin-translator"`.
pub fn webview_label_for_id(id: &str) -> String {
    format!("{}{}", LABEL_PREFIX, id)
}

/// `"plugin-translator"` → `Some("translator")`; non-plugin labels → `None`.
pub fn id_from_label(label: &str) -> Option<String> {
    label.strip_prefix(LABEL_PREFIX).map(|s| s.to_string())
}

/// JavaScript injected into every plugin WebView before its own scripts
/// run. Defines `window.ani`, whose methods all funnel through the single
/// `plugin_call` command so the host can enforce declared capabilities.
/// `withGlobalTauri` is off in this app, so we call the always-injected
/// `window.__TAURI_INTERNALS__.invoke` rather than `window.__TAURI__`.
pub const ANI_SDK_JS: &str = r#"
;(function () {
  function invoke(capability, method, args) {
    return window.__TAURI_INTERNALS__.invoke('plugin_call', {
      capability: capability,
      method: method,
      args: args || {}
    });
  }

  window.ani = {
    window: {
      show: function () { return invoke('window', 'show'); },
      hide: function () { return invoke('window', 'hide'); },
      resize: function (width, height) { return invoke('window', 'resize', { width: width, height: height }); },
      close: function () { return invoke('window', 'close'); }
    },
    hotkey: {},
    storage: {
      get: function (key) { return invoke('storage', 'get', { key: key }); },
      set: function (key, value) { return invoke('storage', 'set', { key: key, value: value }); },
      delete: function (key) { return invoke('storage', 'delete', { key: key }); }
    }
  };

  // Default: Escape closes the plugin window unless the plugin handled it.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      window.ani.window.close();
    }
  });
})();
"#;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test plugin::runtime`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/plugin/runtime.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(plugin): runtime label helpers and window.ani SDK script"
```

---

## Task 4: Gateway — capability check and the `plugin_call` command

This task adds `gateway.rs`. It has two parts: a pure `capability_allowed` function (unit-tested) and the `plugin_call` Tauri command (not unit-tested — it needs a live `WebviewWindow` — but kept thin so almost all logic lives in tested helpers). The command derives the plugin id from the **calling window's label**, never from JS args, then checks the manifest before dispatching to storage or window operations.

**Files:**
- Create: `src-tauri/src/plugin/gateway.rs`
- Modify: `src-tauri/src/plugin/mod.rs`
- Test: `src-tauri/src/plugin/gateway.rs` (in-tree tests for `capability_allowed`)

- [ ] **Step 1: Register the module in `mod.rs`**

In `src-tauri/src/plugin/mod.rs`, add `pub mod gateway;` (alphabetical, before `loader`):

```rust
pub mod gateway;
pub mod loader;
pub mod manifest;
pub mod protocol;
pub mod runtime;
pub mod storage;

pub use loader::PluginRecord;
pub use manifest::Manifest;
```

- [ ] **Step 2: Write the failing test for `capability_allowed`**

Create `src-tauri/src/plugin/gateway.rs` with the doc comment and tests:

```rust
//! The `plugin_call` gateway: the single command every `window.ani` method
//! routes through. Derives the plugin id from the calling window label,
//! enforces declared capabilities, and dispatches to storage / window ops.

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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd src-tauri && cargo test plugin::gateway`
Expected: FAIL to compile — `cannot find function capability_allowed`.

- [ ] **Step 4: Implement `capability_allowed`**

Insert at the top of `src-tauri/src/plugin/gateway.rs`, directly under the doc comment (above the `#[cfg(test)]` block):

```rust
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src-tauri && cargo test plugin::gateway`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit the tested helper**

```bash
git add src-tauri/src/plugin/gateway.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(plugin): gateway capability_allowed check"
```

- [ ] **Step 7: Add the `plugin_call` command**

Append to `src-tauri/src/plugin/gateway.rs`, after `capability_allowed` (still above the test module):

```rust
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
```

- [ ] **Step 8: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean exit. (`plugin_call` is registered in Task 6; until then it's an unused public function, which only warns.)

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/plugin/gateway.rs
git commit -m "feat(plugin): plugin_call dispatcher for storage + window ops"
```

---

## Task 5: WebView spawn function

Now that the gateway and SDK script exist, add the function that actually builds a plugin WebView. It resolves the plugin's entry and window config from `AppState`, builds a `plugin://<id>/<entry>` WebView with the SDK injected, records the live label on the `PluginRecord`, and clears it when the window is destroyed. If the window is already open it just shows + focuses it (idempotent re-launch).

**Files:**
- Modify: `src-tauri/src/plugin/runtime.rs`

- [ ] **Step 1: Add imports to `runtime.rs`**

At the top of `src-tauri/src/plugin/runtime.rs`, directly under the module doc comment (before `LABEL_PREFIX`), add:

```rust
use crate::plugin::loader::PluginStatus;
use crate::state::AppState;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
```

- [ ] **Step 2: Add the spawn function**

Insert `launch_plugin_webview` after the `ANI_SDK_JS` constant (above the `#[cfg(test)]` block):

```rust
/// Spawn (or re-focus) the WebView for plugin `id`.
///
/// Idempotent: if the window already exists it is shown and focused.
/// Otherwise it is built from `plugin://<id>/<entry>`, sized from the
/// manifest, with `ANI_SDK_JS` injected. The live label is recorded on
/// the `PluginRecord` and cleared on window destroy.
pub fn launch_plugin_webview(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let label = webview_label_for_id(id);

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    // Read entry + window config from state, then release the lock.
    let (entry, wcfg) = {
        let state = app.state::<Arc<Mutex<AppState>>>();
        let guard = state.lock().map_err(|_| "state lock poisoned")?;
        let rec = guard
            .plugins
            .get(id)
            .ok_or_else(|| format!("plugin '{}' not installed", id))?;
        if !rec.enabled {
            return Err("plugin not enabled".into());
        }
        if let PluginStatus::Error(reason) = &rec.status {
            return Err(format!("plugin in error state: {}", reason));
        }
        (rec.manifest.entry.clone(), rec.manifest.window.clone())
    };

    let url = format!("plugin://{}/{}", id, entry);
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid plugin url '{}': {}", url, e))?;

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(parsed))
        .title(&label)
        .inner_size(wcfg.width as f64, wcfg.height as f64)
        .resizable(wcfg.resizable)
        .always_on_top(wcfg.always_on_top)
        .decorations(wcfg.decorations)
        .transparent(wcfg.transparent)
        .visible(true)
        .initialization_script(ANI_SDK_JS)
        .build()
        .map_err(|e| format!("failed to build plugin window: {}", e))?;

    {
        let state = app.state::<Arc<Mutex<AppState>>>();
        let mut guard = state.lock().map_err(|_| "state lock poisoned")?;
        if let Some(rec) = guard.plugins.get_mut(id) {
            rec.webview_label = Some(label.clone());
        }
    }

    // Clear the recorded label when the window is destroyed so a later
    // launch rebuilds it instead of trying to reuse a dead label.
    let app_for_event = app.clone();
    let id_for_event = id.to_string();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = app_for_event.try_state::<Arc<Mutex<AppState>>>() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(rec) = guard.plugins.get_mut(&id_for_event) {
                        rec.webview_label = None;
                    }
                }
            }
        }
    });

    crate::app_log!("[plugin] launched webview for {}", id);
    Ok(())
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean exit (warnings about `launch_plugin_webview` being unused are fine until Task 6).

- [ ] **Step 4: Run the runtime tests again (no regression)**

Run: `cd src-tauri && cargo test plugin::runtime`
Expected: PASS (still 6 tests — the spawn function isn't unit-tested).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/runtime.rs
git commit -m "feat(plugin): launch_plugin_webview spawns per-plugin window"
```

---

## Task 6: Register commands and the launch entry point

Wire `plugin_call` and a temporary `launch_plugin` command into the Tauri builder. `launch_plugin` is the trigger for this slice (Slice 3 replaces the caller with a hotkey, Slice 4 with a UI button).

**Files:**
- Modify: `src-tauri/src/lib.rs` (add `launch_plugin` command + extend `invoke_handler`)

- [ ] **Step 1: Add the `launch_plugin` command**

In `src-tauri/src/lib.rs`, directly after the `get_plugins` command (ends at the line `}` following `out.sort_by(...)`, around line 502), add:

```rust
/// Temporary launch entry point for Slice 2 — spawns a plugin's WebView by id.
/// Slice 3 will call `plugin::runtime::launch_plugin_webview` from the hotkey
/// handler and Slice 4 from the Plugin Manager UI; this command remains useful
/// for manual testing and "open" buttons.
#[tauri::command]
fn launch_plugin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    plugin::runtime::launch_plugin_webview(&app, &id)
}
```

- [ ] **Step 2: Extend the `invoke_handler` macro**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![...]` list (the long line ending in `..., set_ani_plugin_enabled, get_plugins])`) and append the two new commands so it ends:

```rust
..., install_plugin_from_dialog, uninstall_plugin, set_ani_plugin_enabled, get_plugins, launch_plugin, plugin::gateway::plugin_call])
```

(Only the tail changes — add `, launch_plugin, plugin::gateway::plugin_call` immediately before the closing `]`.)

- [ ] **Step 3: Verify the whole backend compiles**

Run: `cd src-tauri && cargo check`
Expected: clean exit, no unused-function warnings for `plugin_call` or `launch_plugin_webview` (both are now referenced).

- [ ] **Step 4: Run the full plugin test suite (no regression)**

Run: `cd src-tauri && cargo test plugin::`
Expected: PASS — Slice 1 tests + the new storage (8), runtime (6), gateway (3) tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(plugin): register plugin_call + launch_plugin commands"
```

---

## Task 7: Manual smoke test and docs

WebView spawning, SDK injection, and the IPC round-trip can't be asserted in `cargo test`, so verify them by hand with a tiny throwaway plugin, then document the new SDK and runtime in `CLAUDE.md`.

**Files:**
- Modify: `CLAUDE.md` (extend the MCP/plugin notes)
- (No source changes — this is verification + docs)

- [ ] **Step 1: Build a smoke-test plugin**

Create a temp plugin on disk (not committed). Run these commands:

```bash
mkdir -p ~/.ani-mime/plugins/smoketest
cat > ~/.ani-mime/plugins/smoketest/manifest.json <<'JSON'
{
  "id": "smoketest",
  "name": "Smoke Test",
  "version": "0.1.0",
  "entry": "index.html",
  "capabilities": ["window", "storage"],
  "window": { "width": 360, "height": 240, "resizable": true }
}
JSON
cat > ~/.ani-mime/plugins/smoketest/index.html <<'HTML'
<!doctype html><html><body style="font-family:sans-serif;padding:12px">
<h3>Smoke Test</h3>
<button id="save">storage.set count++</button>
<button id="resize">resize 480x320</button>
<button id="close">close</button>
<pre id="out">loading…</pre>
<script>
async function refresh() {
  const n = await window.ani.storage.get('count');
  document.getElementById('out').textContent = 'count = ' + JSON.stringify(n);
}
document.getElementById('save').onclick = async () => {
  const n = (await window.ani.storage.get('count')) || 0;
  await window.ani.storage.set('count', n + 1);
  refresh();
};
document.getElementById('resize').onclick = () => window.ani.window.resize(480, 320);
document.getElementById('close').onclick = () => window.ani.window.close();
refresh();
</script>
</body></html>
HTML
```

- [ ] **Step 2: Run the app and launch the plugin**

Run: `bun run tauri dev`

Wait for the window, then trigger the launch. The simplest path with no UI yet: open the Superpower Tool window's devtools console (or the main window's) and run:

```js
window.__TAURI_INTERNALS__.invoke('launch_plugin', { id: 'smoketest' })
```

Expected: a 360×240 "Smoke Test" window appears showing `count = null`.

- [ ] **Step 3: Verify the SDK round-trips**

In the smoke-test window:
- Click **storage.set count++** a few times → `count` increments and persists. Confirm the file:
  `cat ~/.ani-mime/plugins/smoketest/data/store.json` → shows `{ "count": N }`.
- Click **resize 480x320** → the window resizes.
- Press **Escape** (or click **close**) → the window closes.
- Re-run the `launch_plugin` invoke → the window re-opens (label was cleared on destroy), and `count` is restored from disk.

Record the result (pass/fail per bullet) in your task notes.

- [ ] **Step 4: Clean up the smoke plugin**

```bash
rm -rf ~/.ani-mime/plugins/smoketest
```

- [ ] **Step 5: Document the SDK + runtime in `CLAUDE.md`**

In `CLAUDE.md`, under the existing backend module table in the "Backend (`src-tauri/src/`)" section, the `plugin/` directory now owns more. Add these rows to that table (or to the plugin sub-list if one exists), keeping the existing style:

```markdown
| `plugin/runtime.rs` | Spawns a per-plugin WebView (`plugin://<id>/<entry>`), injects the `window.ani` SDK, maps plugin id ↔ `plugin-<id>` window label |
| `plugin/gateway.rs` | `plugin_call` command — the single gated entry point for `window.ani`; checks declared capabilities, dispatches to storage / window ops |
| `plugin/storage.rs` | Per-plugin key/value store at `~/.ani-mime/plugins/<id>/data/store.json` |
```

Then add a bullet to the "Important Details" list:

```markdown
- Plugin WebViews are created at runtime (`plugin::runtime::launch_plugin_webview`), labeled `plugin-<id>`, and granted the `plugin` capability (`src-tauri/capabilities/plugin.json`, scoped to the `plugin-*` glob). All `window.ani` calls route through the single `plugin_call` command, which derives the plugin id from the calling window label — never from JS args — so plugins cannot impersonate each other. Window control (show/hide/resize/close) and per-plugin storage are mediated by `plugin_call`; the `launch_plugin` command is the temporary trigger until the hotkey (Slice 3) and Plugin Manager UI (Slice 4) land.
```

- [ ] **Step 6: Verify docs and commit**

Run: `cd src-tauri && cargo test plugin:: && cargo check` (final green check)
Expected: PASS + clean.

```bash
git add CLAUDE.md
git commit -m "docs(plugin): document Slice 2 runtime, gateway, storage, SDK"
```

---

## End-of-slice verification

After all tasks, run the full checks:

- [ ] `cd src-tauri && cargo test plugin::` — all plugin tests pass (Slice 1 + storage 8 + runtime 6 + gateway 3).
- [ ] `cd src-tauri && cargo check` — clean, no warnings about unused plugin functions.
- [ ] `npx tsc --noEmit` (from repo root) — frontend type check unaffected (no frontend changes this slice).
- [ ] Manual smoke (Task 7) passed: window spawns, storage round-trips and persists across re-launch, resize works, Escape/close works.

## What's NOT in Slice 2 (deferred)

| Item | Slice |
|---|---|
| Global hotkey registration → launch on shortcut; unregister on disable | 3 |
| Frontend Plugin Manager UI (install/enable/uninstall/launch buttons) + C3 registration | 4 |
| `@ani-mime/plugin-sdk` npm package + TypeScript types for `window.ani` | 5 |
| `ani-mime-plugins` repo + first real reference plugin | 6 |
| Permission prompts at install + per-command caller guards (hardening) | post-v1 |
| Capabilities beyond window/hotkey/storage (clipboard, network, notifications, screenshot, events) | post-v1 |
| Close-on-blur behavior | post-v1 (Escape-to-close ships in this slice) |

## Open questions to resolve before later slices

1. **Ungated app commands.** As noted in the limitation section, a plugin window can call any app command directly, bypassing the SDK. Closing this needs either (a) a `guard::assert_not_plugin(&window)` check added to sensitive commands, or (b) moving plugin-management commands behind a capability the plugin window lacks. Decide when building the permission UI (v1.1). For v1 this matches the spec's "malicious plugin out of scope".
2. **WebView teardown policy.** Slice 2 destroys the window on `close()` (next launch rebuilds + reinjects the SDK; storage persists on disk so no state is lost). If startup latency on re-open becomes noticeable, revisit hide-instead-of-destroy with a separate idle-eviction timer. No action needed unless measured.
3. **`webview_label` serialization.** It is `#[serde(skip_serializing_if = "Option::is_none")]`, so `get_plugins` omits it when no window is open. Confirm the Slice 4 UI treats "field absent" and "null" identically when deciding whether to show a "running" indicator.
