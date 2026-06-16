# Quick Coffee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `quick-coffee` ani-mime plugin that lets the user assign a system-wide hotkey to a website URL, opening it in a chosen browser (macOS) with no window shown, even after an app restart.

**Architecture:** A sandboxed plugin (`plugins/quick-coffee/`) provides the CRUD/management UI, and a new trusted host capability `browser` (in `src-tauri/`) enumerates browsers, opens URLs, and **owns the per-item global shortcuts** — persisted to `url-hotkeys.json` and re-registered on startup. The plugin pushes the full active binding set to the host on every change (full-set replace).

**Tech Stack:** Rust (Tauri 2, `tauri-plugin-global-shortcut`), plain HTML/JS plugin served over the `plugin://` scheme, Vitest for the one extractable frontend helper.

**Spec:** `docs/superpowers/specs/2026-06-16-quick-coffee-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src-tauri/src/plugin/manifest.rs` | Add `"browser"` to `ALLOWED_CAPABILITIES` |
| `src-tauri/src/platform/{mod,macos,linux}.rs` | `list_browsers()` + `open_url_in()` facade |
| `src-tauri/src/plugin/browser.rs` | **New** — URL validation, `UrlHotkeys` persistence, global-shortcut register/unregister |
| `src-tauri/src/plugin/mod.rs` | Register the `browser` module |
| `src-tauri/src/plugin/runtime.rs` | Add `browser` namespace to `ANI_SDK_JS` |
| `src-tauri/src/plugin/gateway.rs` | Dispatch the `"browser"` capability (list/open/setHotkeys) |
| `src-tauri/src/lib.rs` | Startup re-registration; unregister on disable/uninstall |
| `plugins/quick-coffee/manifest.json` | **New** — plugin manifest |
| `plugins/quick-coffee/accelerator.js` | **New** — `eventToAccelerator()` helper (ESM, unit-tested) |
| `plugins/quick-coffee/accelerator.test.js` | **New** — Vitest test for the helper |
| `plugins/quick-coffee/index.html` | **New** — management UI |
| `plugins/quick-coffee/README.md` | **New** — plugin readme |

**Commands used throughout:**
- Backend type/test: `cd src-tauri && cargo test browser` (or `cargo test` for all), `cargo check`
- Frontend test: `bun run test` (Vitest)

---

## Task 1: Add the `browser` capability constant

**Files:**
- Modify: `src-tauri/src/plugin/manifest.rs` (the `ALLOWED_CAPABILITIES` const ~line 7, and its tests)

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/plugin/manifest.rs`:

```rust
    #[test]
    fn browser_is_an_allowed_capability() {
        assert!(ALLOWED_CAPABILITIES.contains(&"browser"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test browser_is_an_allowed_capability`
Expected: FAIL (assertion fails — `browser` not yet in the list).

- [ ] **Step 3: Add the capability**

In `src-tauri/src/plugin/manifest.rs`, change:

```rust
pub const ALLOWED_CAPABILITIES: &[&str] =
    &["window", "hotkey", "storage", "clipboard", "translate", "selection"];
```

to:

```rust
pub const ALLOWED_CAPABILITIES: &[&str] =
    &["window", "hotkey", "storage", "clipboard", "translate", "selection", "browser"];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test browser_is_an_allowed_capability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/manifest.rs
git commit -m "feat(plugin): allow the browser capability"
```

---

## Task 2: Platform facade — enumerate browsers and open a URL in one

No unit tests here (system-dependent); verified by `cargo check` and manual run. macOS uses a curated bundle-id list filtered by `mdfind`; Linux returns none and opens the default.

**Files:**
- Modify: `src-tauri/src/platform/macos.rs`
- Modify: `src-tauri/src/platform/linux.rs`
- Modify: `src-tauri/src/platform/mod.rs`

- [ ] **Step 1: Add macOS implementation**

Append to `src-tauri/src/platform/macos.rs`:

```rust
/// Curated list of browser bundle ids → display names probed at enumeration
/// time. Names are hardcoded so we never need LaunchServices name resolution.
const BROWSER_CANDIDATES: &[(&str, &str)] = &[
    ("com.apple.Safari", "Safari"),
    ("com.google.Chrome", "Google Chrome"),
    ("com.google.Chrome.canary", "Chrome Canary"),
    ("org.mozilla.firefox", "Firefox"),
    ("com.microsoft.edgemac", "Microsoft Edge"),
    ("company.thebrowser.Browser", "Arc"),
    ("com.brave.Browser", "Brave"),
    ("com.operasoftware.Opera", "Opera"),
    ("com.vivaldi.Vivaldi", "Vivaldi"),
];

/// Return `(bundle_id, display_name)` for each candidate browser actually
/// installed, detected via Spotlight. Best-effort: if `mdfind` fails the
/// candidate is treated as absent.
pub fn list_browsers() -> Vec<(String, String)> {
    BROWSER_CANDIDATES
        .iter()
        .filter(|(id, _)| bundle_installed(id))
        .map(|(id, name)| (id.to_string(), name.to_string()))
        .collect()
}

fn bundle_installed(bundle_id: &str) -> bool {
    let query = format!("kMDItemCFBundleIdentifier == '{}'", bundle_id);
    match std::process::Command::new("mdfind").arg(&query).output() {
        Ok(out) => !out.stdout.is_empty(),
        Err(_) => false,
    }
}

/// Open `url` in the browser with `bundle_id`, or the OS default when `None`.
/// The URL is passed as a separate argument (no shell), so it cannot inject.
pub fn open_url_in(bundle_id: Option<&str>, url: &str) {
    let mut cmd = std::process::Command::new("open");
    if let Some(id) = bundle_id {
        cmd.arg("-b").arg(id);
    }
    cmd.arg(url);
    if let Err(e) = cmd.spawn() {
        crate::app_error!("[platform] open url in browser failed: {}", e);
    }
}
```

- [ ] **Step 2: Add Linux implementation**

Append to `src-tauri/src/platform/linux.rs`:

```rust
/// Linux v1 does not enumerate specific browsers — the picker is macOS-only.
pub fn list_browsers() -> Vec<(String, String)> {
    Vec::new()
}

/// Linux ignores `bundle_id` and opens in the OS default browser.
pub fn open_url_in(_bundle_id: Option<&str>, url: &str) {
    open_url(url);
}
```

- [ ] **Step 3: Export both from the facade**

In `src-tauri/src/platform/mod.rs`, add `list_browsers, open_url_in` to BOTH the macOS and Linux `pub use` lists. The macOS block becomes:

```rust
#[cfg(target_os = "macos")]
pub use macos::{
    list_browsers, open_local_network_settings, open_path, open_url, open_url_in,
    run_update_command, set_dock_visibility, set_window_movable, setup_main_window,
    show_choose_list, show_dialog,
};
```

Apply the identical change (add `list_browsers,` and `open_url_in,`) to the `#[cfg(target_os = "linux")]` `pub use linux::{...}` block.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (warnings about unused functions are fine until Task 6 wires them in).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/platform/
git commit -m "feat(platform): list installed browsers and open a URL in a chosen one"
```

---

## Task 3: `browser.rs` — URL validation and `UrlHotkeys` persistence

**Files:**
- Create: `src-tauri/src/plugin/browser.rs`
- Modify: `src-tauri/src/plugin/mod.rs`

- [ ] **Step 1: Register the module**

In `src-tauri/src/plugin/mod.rs`, add (keeping the list alphabetical):

```rust
pub mod browser;
```

right after `pub mod clipboard;` — actually before it, so the line order is:

```rust
pub mod browser;
pub mod clipboard;
pub mod gateway;
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/plugin/browser.rs` with ONLY the types, the two pure functions stubbed to fail, and the tests:

```rust
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
        // camelCase field name on disk.
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
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test browser::`
Expected: PASS (these functions are fully implemented above — the "failing" stage was confirming compilation + the round-trip serde contract). If any fail, fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugin/browser.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(plugin): browser.rs URL validation and url-hotkeys persistence"
```

---

## Task 4: `browser.rs` — register/unregister global shortcuts

The actual `on_shortcut` wiring mirrors `hotkey.rs`. The register loop dedupes within the set, validates URLs, and reports per-binding results. No unit test (needs an `AppHandle` + the global-shortcut plugin); verified by `cargo check` and the manual run in Task 11.

**Files:**
- Modify: `src-tauri/src/plugin/browser.rs`

- [ ] **Step 1: Add the registration functions**

Append to `src-tauri/src/plugin/browser.rs` (above the `#[cfg(test)]` block):

```rust
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles. (`register`/`set_hotkeys` are unused until Task 6/7 — unused-warnings are fine.)

- [ ] **Step 3: Run the existing browser tests still pass**

Run: `cd src-tauri && cargo test browser::`
Expected: PASS (the Task 3 tests are unaffected).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugin/browser.rs
git commit -m "feat(plugin): register/unregister url-hotkeys as global shortcuts"
```

---

## Task 5: Add the `browser` namespace to the injected SDK

**Files:**
- Modify: `src-tauri/src/plugin/runtime.rs` (the `ANI_SDK_JS` const and its tests)

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/plugin/runtime.rs`:

```rust
    #[test]
    fn sdk_script_exposes_browser_namespace() {
        assert!(ANI_SDK_JS.contains("browser:"));
        assert!(ANI_SDK_JS.contains("setHotkeys"));
        assert!(ANI_SDK_JS.contains("invoke('browser', 'list')"));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test sdk_script_exposes_browser_namespace`
Expected: FAIL (`browser:` not present).

- [ ] **Step 3: Add the namespace**

In `src-tauri/src/plugin/runtime.rs`, inside the `window.ani = { ... }` object literal in `ANI_SDK_JS`, add a `browser` namespace after the `selection` namespace (insert a comma after the `selection` block's closing brace):

```javascript
    selection: {
      read: function () { return invoke('selection', 'read'); }
    },
    browser: {
      list:       function () { return invoke('browser', 'list'); },
      open:       function (url, bundleId) { return invoke('browser', 'open', { url: url, bundleId: bundleId }); },
      setHotkeys: function (bundleId, bindings) { return invoke('browser', 'setHotkeys', { bundleId: bundleId, bindings: bindings }); }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test sdk_script_exposes_browser_namespace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/runtime.rs
git commit -m "feat(plugin): expose window.ani.browser SDK namespace"
```

---

## Task 6: Dispatch the `browser` capability in the gateway

**Files:**
- Modify: `src-tauri/src/plugin/gateway.rs`

- [ ] **Step 1: Add the dispatch arm**

In `src-tauri/src/plugin/gateway.rs`, inside the `match capability.as_str() { ... }`, add a new arm BEFORE the final `other =>` arm:

```rust
        "browser" => {
            let app = window.app_handle();
            match method.as_str() {
                "list" => {
                    let browsers: Vec<serde_json::Value> = crate::platform::list_browsers()
                        .into_iter()
                        .map(|(bundle_id, name)| {
                            serde_json::json!({ "bundleId": bundle_id, "name": name })
                        })
                        .collect();
                    Ok(serde_json::json!(browsers))
                }
                "open" => {
                    let url = arg_str(&args, "url")?;
                    if !crate::plugin::browser::is_allowed_url(&url) {
                        return Err("url must be http(s)".into());
                    }
                    let bundle_id = args.get("bundleId").and_then(|v| v.as_str());
                    crate::platform::open_url_in(bundle_id, &url);
                    Ok(serde_json::Value::Null)
                }
                "setHotkeys" => {
                    let browser_bundle_id = args
                        .get("bundleId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let bindings: Vec<crate::plugin::browser::Binding> = args
                        .get("bindings")
                        .and_then(|v| serde_json::from_value(v.clone()).ok())
                        .ok_or_else(|| "missing or invalid 'bindings' array".to_string())?;
                    let hk = crate::plugin::browser::UrlHotkeys {
                        browser_bundle_id,
                        bindings,
                    };
                    let results = crate::plugin::browser::set_hotkeys(&app, &id, hk);
                    serde_json::to_value(results).map_err(|e| e.to_string())
                }
                other => Err(format!("unknown browser method '{}'", other)),
            }
        }
```

- [ ] **Step 2: Add a gating test**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/plugin/gateway.rs`:

```rust
    #[test]
    fn browser_capability_gating() {
        let allowed = record(&["browser"], true);
        assert!(capability_allowed(&allowed, "browser").is_ok());

        let undeclared = record(&["window"], true);
        assert!(capability_allowed(&undeclared, "browser").is_err());

        let disabled = record(&["browser"], false);
        assert!(capability_allowed(&disabled, "browser").is_err());
    }
```

- [ ] **Step 3: Run tests + compile**

Run: `cd src-tauri && cargo test gateway::` then `cargo check`
Expected: PASS and compiles.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugin/gateway.rs
git commit -m "feat(plugin): dispatch the browser capability (list/open/setHotkeys)"
```

---

## Task 7: Wire startup re-registration and disable/uninstall cleanup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Re-register URL-hotkeys on startup**

In `src-tauri/src/lib.rs`, in the startup-scan block (~line 842), the launch hotkeys are registered like this:

```rust
                    if let Ok(guard) = app_state.lock() {
                        plugin::hotkey::register_enabled(app.handle(), &guard.plugins);
                    }
```

Change it to also register URL-hotkeys under the same lock:

```rust
                    if let Ok(guard) = app_state.lock() {
                        plugin::hotkey::register_enabled(app.handle(), &guard.plugins);
                        plugin::browser::register_all_enabled(app.handle(), &guard.plugins);
                    }
```

- [ ] **Step 2: Unregister on uninstall**

In `fn uninstall_plugin` (~line 468), after the launch hotkey is unregistered (the `if let Some(hk) = hotkey { plugin::hotkey::unregister(&app, &hk); }` block, ~line 490), add:

```rust
    plugin::browser::unregister_plugin(&app, &id);
```

(Place it before `let _ = app.emit("plugins-changed", ());`.)

- [ ] **Step 3: Toggle on enable/disable**

In `fn set_ani_plugin_enabled` (~line 499), the existing code registers/unregisters the launch hotkey based on `enabled`. In the **enable** branch (where `plugin::hotkey::register(&app, &id, hk)` runs), add after it:

```rust
        // Re-register persisted URL-hotkeys for this plugin.
        let hk = plugin::browser::load(&id);
        if !hk.bindings.is_empty() {
            let _ = plugin::browser::register(&app, &hk);
        }
```

In the **disable** branch (where the launch hotkey is unregistered and the window closed), add:

```rust
        plugin::browser::unregister_plugin(&app, &id);
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors.

- [ ] **Step 5: Run the whole backend test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(plugin): startup re-register + disable/uninstall cleanup for url-hotkeys"
```

---

## Task 8: Plugin manifest

**Files:**
- Create: `plugins/quick-coffee/manifest.json`

- [ ] **Step 1: Write the manifest**

Create `plugins/quick-coffee/manifest.json`:

```json
{
  "id": "quick-coffee",
  "name": "Quick Coffee",
  "version": "0.1.0",
  "description": "Assign a global hotkey to a website. Press it anywhere, your browser opens the page.",
  "author": "ani-mime",
  "entry": "index.html",
  "hotkey": "CmdOrCtrl+Shift+K",
  "capabilities": ["window", "browser", "storage"],
  "window": {
    "width": 560,
    "height": 540,
    "resizable": true,
    "alwaysOnTop": true,
    "decorations": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/quick-coffee/manifest.json
git commit -m "feat(quick-coffee): plugin manifest"
```

---

## Task 9: `eventToAccelerator` helper + Vitest test

**Files:**
- Create: `plugins/quick-coffee/accelerator.js`
- Create: `plugins/quick-coffee/accelerator.test.js`

- [ ] **Step 1: Write the failing test**

Create `plugins/quick-coffee/accelerator.test.js`:

```js
import { describe, it, expect } from "vitest";
import { eventToAccelerator } from "./accelerator.js";

const ev = (over) => ({
  metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "", ...over,
});

describe("eventToAccelerator", () => {
  it("maps meta/ctrl to CmdOrCtrl and uppercases letters", () => {
    expect(eventToAccelerator(ev({ metaKey: true, shiftKey: true, key: "g" })))
      .toBe("CmdOrCtrl+Shift+G");
    expect(eventToAccelerator(ev({ ctrlKey: true, key: "k" })))
      .toBe("CmdOrCtrl+K");
  });

  it("supports Alt and function/named keys", () => {
    expect(eventToAccelerator(ev({ altKey: true, key: "F1" }))).toBe("Alt+F1");
    expect(eventToAccelerator(ev({ metaKey: true, key: "ArrowUp" })))
      .toBe("CmdOrCtrl+Up");
  });

  it("returns null when only modifiers are pressed", () => {
    expect(eventToAccelerator(ev({ metaKey: true, key: "Meta" }))).toBeNull();
    expect(eventToAccelerator(ev({ shiftKey: true, key: "Shift" }))).toBeNull();
  });

  it("requires at least one modifier", () => {
    expect(eventToAccelerator(ev({ key: "g" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test accelerator`
Expected: FAIL (cannot import `eventToAccelerator` — module/file does not exist).

- [ ] **Step 3: Write the helper**

Create `plugins/quick-coffee/accelerator.js`:

```js
// Pure helper: turn a keydown event into a Tauri global-shortcut accelerator
// string (e.g. "CmdOrCtrl+Shift+G"), or null if the combo is incomplete.
// Exported as an ESM module so it can be unit-tested; index.html imports it.

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);

// Named keys that Tauri spells differently from the DOM `key` value.
const KEY_ALIASES = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  Escape: "Esc",
};

export function eventToAccelerator(e) {
  if (MODIFIER_KEYS.has(e.key)) return null; // only a modifier held

  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null; // require at least one modifier

  let key = KEY_ALIASES[e.key] || e.key;
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test accelerator`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/quick-coffee/accelerator.js plugins/quick-coffee/accelerator.test.js
git commit -m "feat(quick-coffee): eventToAccelerator helper with tests"
```

---

## Task 10: Management UI (`index.html`)

No unit test (DOM glue verified manually in Task 11). Every interactive element gets a `data-testid`.

**Files:**
- Create: `plugins/quick-coffee/index.html`

- [ ] **Step 1: Write the UI**

Create `plugins/quick-coffee/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quick Coffee</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 16px; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
    .row input[type="text"] { flex: 1; padding: 6px 8px; }
    .hotkey-field { min-width: 140px; padding: 6px 8px; cursor: pointer; text-align: center; border: 1px dashed #888; border-radius: 4px; }
    .hotkey-field.capturing { border-style: solid; }
    .status { font-size: 11px; min-width: 70px; }
    .status.ok { color: #2e9e44; }
    .status.err { color: #e03131; }
    button { padding: 6px 10px; cursor: pointer; }
    .browser-bar { margin-bottom: 16px; display: flex; gap: 8px; align-items: center; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { border-bottom: 1px solid rgba(128,128,128,.25); padding: 8px 0; }
  </style>
</head>
<body>
  <h1>☕ Quick Coffee</h1>

  <div class="browser-bar">
    <label for="browser-select">Open in:</label>
    <select id="browser-select" data-testid="browser-select"></select>
  </div>

  <ul id="item-list" data-testid="item-list"></ul>

  <div class="row">
    <button id="add-item-btn" data-testid="add-item-btn">+ Add site</button>
  </div>

  <script type="module">
    import { eventToAccelerator } from "./accelerator.js";

    const STORE_KEY = "quickCoffee";
    let state = { browserBundleId: null, items: [] };

    const $ = (id) => document.getElementById(id);
    const uid = () => "i" + Math.random().toString(36).slice(2, 10);

    async function load() {
      const saved = await window.ani.storage.get(STORE_KEY);
      if (saved && typeof saved === "object") {
        state.browserBundleId = saved.browserBundleId ?? null;
        state.items = Array.isArray(saved.items) ? saved.items : [];
      }
    }

    async function persistAndRegister() {
      await window.ani.storage.set(STORE_KEY, state);
      const bindings = state.items
        .filter((it) => it.accelerator && it.url)
        .map((it) => ({ accelerator: it.accelerator, url: it.url }));
      const results = await window.ani.browser.setHotkeys(state.browserBundleId, bindings);
      applyResults(results);
    }

    function applyResults(results) {
      const byAccel = {};
      (results || []).forEach((r) => { byAccel[r.accelerator] = r; });
      state.items.forEach((it) => {
        const badge = document.querySelector(`[data-testid="status-${it.id}"]`);
        if (!badge) return;
        const r = it.accelerator ? byAccel[it.accelerator] : null;
        if (!it.accelerator || !it.url) { badge.textContent = ""; badge.className = "status"; }
        else if (r && r.ok) { badge.textContent = "registered"; badge.className = "status ok"; }
        else { badge.textContent = r ? (r.error || "conflict") : "—"; badge.className = "status err"; }
      });
    }

    async function renderBrowsers() {
      const sel = $("browser-select");
      const browsers = await window.ani.browser.list();
      sel.innerHTML = "";
      const def = document.createElement("option");
      def.value = ""; def.textContent = "Default browser";
      sel.appendChild(def);
      browsers.forEach((b) => {
        const o = document.createElement("option");
        o.value = b.bundleId; o.textContent = b.name;
        sel.appendChild(o);
      });
      sel.value = state.browserBundleId || "";
      sel.onchange = async () => {
        state.browserBundleId = sel.value || null;
        await persistAndRegister();
      };
    }

    function renderItems() {
      const list = $("item-list");
      list.innerHTML = "";
      state.items.forEach((it) => list.appendChild(renderItem(it)));
    }

    function renderItem(it) {
      const li = document.createElement("li");
      li.dataset.testid = `item-${it.id}`;

      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("input");
      label.type = "text"; label.placeholder = "Label"; label.value = it.label || "";
      label.dataset.testid = `label-${it.id}`;
      label.oninput = () => { it.label = label.value; };
      label.onblur = () => persistAndRegister();

      const url = document.createElement("input");
      url.type = "text"; url.placeholder = "https://..."; url.value = it.url || "";
      url.dataset.testid = `url-${it.id}`;
      url.oninput = () => { it.url = url.value; };
      url.onblur = () => persistAndRegister();

      const hk = document.createElement("div");
      hk.className = "hotkey-field"; hk.tabIndex = 0;
      hk.dataset.testid = `hotkey-${it.id}`;
      hk.textContent = it.accelerator || "Click, then press keys";
      hk.onkeydown = (e) => {
        e.preventDefault();
        const accel = eventToAccelerator(e);
        if (accel) {
          it.accelerator = accel;
          hk.textContent = accel;
          hk.classList.remove("capturing");
          persistAndRegister();
        }
      };
      hk.onfocus = () => hk.classList.add("capturing");
      hk.onblur = () => hk.classList.remove("capturing");

      const open = document.createElement("button");
      open.textContent = "Open"; open.dataset.testid = `open-${it.id}`;
      open.onclick = () => { if (it.url) window.ani.browser.open(it.url, state.browserBundleId); };

      const del = document.createElement("button");
      del.textContent = "✕"; del.dataset.testid = `delete-${it.id}`;
      del.setAttribute("aria-label", "Delete item");
      del.onclick = async () => {
        state.items = state.items.filter((x) => x.id !== it.id);
        renderItems();
        await persistAndRegister();
      };

      const status = document.createElement("span");
      status.className = "status"; status.dataset.testid = `status-${it.id}`;

      row.append(label, url, hk, open, del, status);
      li.appendChild(row);
      return li;
    }

    $("add-item-btn").onclick = () => {
      state.items.push({ id: uid(), label: "", url: "", accelerator: "" });
      renderItems();
    };

    (async function init() {
      await load();
      await renderBrowsers();
      renderItems();
      applyResults([]); // clear badges until first save
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add plugins/quick-coffee/index.html
git commit -m "feat(quick-coffee): management UI"
```

---

## Task 11: README + manual end-to-end verification

**Files:**
- Create: `plugins/quick-coffee/README.md`

- [ ] **Step 1: Write the README**

Create `plugins/quick-coffee/README.md`:

```markdown
# Quick Coffee ☕

Assign a system-wide hotkey to any website. Press it anywhere and your chosen
browser opens the page — no window needed.

## Usage

1. Launch Quick Coffee (default `Cmd/Ctrl+Shift+K`, or from the Plugin Manager).
2. Pick the browser to open links in (macOS lists installed browsers; other
   platforms use the OS default).
3. Add a site: give it a label and URL, click the hotkey field, and press the
   key combo you want.
4. Press that combo from anywhere — the site opens in a new tab.

Hotkeys keep working after you close this window and after restarting the app.
URLs must be `http`/`https`. A combo already taken by another shortcut shows a
"conflict" badge.
```

- [ ] **Step 2: Build/run the app and verify end-to-end**

Run: `bun run tauri dev`

Verify, in order:
1. Open the Plugin Manager (Settings → Plugins), install `quick-coffee` (zip the `plugins/quick-coffee` dir, or use the existing dev install path), enable it.
2. Press `Cmd+Shift+K` — the Quick Coffee window opens.
3. The browser `<select>` lists your installed browsers (macOS) and "Default browser".
4. Add a site (e.g. label "GitHub", url `https://github.com`), assign `Cmd+Shift+G` — badge shows "registered".
5. Close the window. Press `Cmd+Shift+G` — GitHub opens in the chosen browser.
6. Quit and relaunch the app (do NOT open the window). Press `Cmd+Shift+G` — GitHub still opens (startup re-registration works).
7. Try assigning a combo already in use — badge shows "conflict"/error.
8. Try a `file://` URL via the field — `setHotkeys` rejects it (badge error).
9. Disable the plugin in the Plugin Manager — `Cmd+Shift+G` no longer opens GitHub.

Expected: every step behaves as described. If any fails, debug with `superpowers:systematic-debugging` before continuing.

- [ ] **Step 3: Run the full test suites**

Run: `cd src-tauri && cargo test` then (from repo root) `bun run test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/quick-coffee/README.md
git commit -m "docs(quick-coffee): readme + verified end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** browser picker (Task 2/6/10), per-item global hotkeys host-owned (Task 4/7), full-set replace (Task 4 `set_hotkeys`), persistence + startup re-register (Task 3/4/7), scheme validation (Task 3/6), launch hotkey opens window (manifest, Task 8 — uses existing `hotkey.rs` path), CRUD UI with `data-testid`s (Task 10), keydown→accelerator extracted + tested (Task 9), Rust tests for validation/persistence/gating/SDK (Tasks 1/3/5/6). All spec sections map to a task.
- **Type consistency:** `UrlHotkeys { browser_bundle_id, bindings }`, `Binding { accelerator, url }`, `BindingResult { accelerator, ok, error }` are used identically across `browser.rs`, `gateway.rs`, and the JS payloads (`bundleId`/`bindings`/`accelerator`/`url`, with serde `camelCase` on `UrlHotkeys`). `set_hotkeys`/`register`/`unregister_plugin`/`register_all_enabled`/`load`/`save`/`is_allowed_url` names match between definition (Task 3/4) and call sites (Task 6/7).
- **No `tauri.conf.json` change:** built-in plugins are install-only (not bundled), matching `translate`/`clipboard`.
```
