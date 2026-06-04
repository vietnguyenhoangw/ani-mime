# Plugin system (mini-app extensions)

**Date:** 2026-05-08
**Status:** Draft (pending review)
**Owner:** vietnguyenhoangw

## Problem

Ani-Mime is a focused desktop mascot today, but several useful "mini-app" features (translator, music-player controller, screenshot tool, paperclip-style helper) would each grow the binary and clutter the UI if shipped inline. We want users to keep a small base app and opt into individual features they care about — Chrome-extension / VS-Code-extension style.

Current state: no plugin infrastructure exists. All features are first-class modules compiled into the Tauri binary.

## Goals

- Let users install / enable / disable / uninstall third-party plugins from a `.zip` file via a Plugin Manager UI in Settings.
- Each plugin is a self-contained "mini-app" with its own UI, optional global hotkey, and isolated storage — no plugin can read another plugin's data or call host commands it has not declared.
- Adding a plugin must not require rebuilding ani-mime. Plugins ship and version independently.
- Base app size growth from the plugin infrastructure stays under ~300 KB. No plugins are bundled into the host installer.
- Plugin authors use a standard web stack (HTML / CSS / JS, with an optional Vite + React + TypeScript template) and a typed `@ani-mime/plugin-sdk`.

## Non-goals (v1)

- Permission prompts at install time. v1 grants every declared capability; permission UI lands in v1.1.
- Marketplace / curated index of plugins. v1 is local-`.zip`-only; URL install and a hosted directory are deferred.
- Auto-update of installed plugins.
- Plugin signing / verification.
- Hot-reload dev mode for plugin authors. v1 ships a `package` script that produces a `.zip`; iterative dev story is v1.1.
- Native (`.dylib` / `.so`) plugins.
- Plugin-to-plugin communication or shared state.
- Capabilities beyond `window`, `hotkey`, and `storage`. Clipboard, network, screenshot, notifications, and OS media keys are deferred and added one-at-a-time as separate, smaller specs.

## Design

### Architecture overview

```
Settings → Plugin Manager UI (React)
              │
              ▼ install_plugin / uninstall_plugin / set_plugin_enabled
        ┌─────────────────────────────┐
        │ Host (Rust)                 │
        │  plugin/loader.rs           │  ← unzip, manifest parse, lifecycle
        │  plugin/runtime.rs          │  ← WebView spawn, hotkey wiring
        │  plugin/gateway.rs          │  ← plugin_call dispatcher (gated)
        │  plugin/protocol.rs         │  ← `plugin://` URI scheme handler
        └─────────────────────────────┘
              │ creates per-plugin
              ▼
        ┌─────────────────────────────┐
        │ Plugin WebView (one per     │
        │ enabled plugin, lazy)       │
        │  index.html + assets        │
        │  window.ani SDK (injected)  │
        │    └─ invoke('plugin_call',  │
        │         { id, capability,    │
        │           method, args })    │
        └─────────────────────────────┘
```

The host owns all OS-facing surface. Plugin WebViews can only reach the OS by going through `plugin_call`, which checks the calling plugin's manifest before dispatching.

### Repo layout

Two repositories. Plugins are **never** bundled into the ani-mime release artifact.

```
vietnguyenhoangw/ani-mime              ← host app
  src-tauri/src/plugin/                ← loader, runtime, gateway, protocol
  src/components/PluginManager.tsx     ← Settings panel
  packages/plugin-sdk/                 ← @ani-mime/plugin-sdk (workspace pkg, npm-published)

vietnguyenhoangw/ani-mime-plugins      ← official plugins monorepo
  plugins/translator/
  plugins/screenshot/
  plugins/paperclip/
  scripts/build-plugin.ts              ← produces <id>-<version>.zip per release tag
```

The SDK lives in the host repo so its TypeScript types stay version-locked with the `window.ani` runtime that the host injects. Publishing it to npm lets community plugin authors `bun add @ani-mime/plugin-sdk` without depending on the host repo.

### Plugin format (on disk after install)

```
~/.ani-mime/plugins/<id>/
├── manifest.json
├── index.html              ← entry, loaded by `plugin://<id>/index.html`
├── assets/
│   ├── main.js
│   └── style.css
├── icon.png                ← optional, shown in Plugin Manager
└── data/
    └── store.json          ← per-plugin storage, written by storage.set()
```

Distribution `.zip` is the same tree minus `data/` (which is created on first run).

### Manifest schema

```jsonc
{
  "id": "quick-translate",          // [a-z0-9-]+, used as directory name + WebView label
  "name": "Quick Translate",         // display name
  "version": "0.1.0",                // semver
  "description": "Translate selected text",
  "author": "github-handle",
  "entry": "index.html",             // path inside plugin dir; must resolve under it
  "icon": "icon.png",                // optional
  "hotkey": "CmdOrCtrl+Shift+T",     // optional; tauri-plugin-global-shortcut format
  "capabilities": ["window", "hotkey", "storage"],
  "window": {
    "width": 480,
    "height": 320,
    "resizable": false,
    "alwaysOnTop": true,
    "transparent": false,
    "decorations": true
  }
}
```

Validation rules (enforced at install time, install fails with a user-visible error if any rule is broken):

- `id` matches `^[a-z][a-z0-9-]*$`, length ≤ 64.
- `version` parses as semver.
- `entry` resolves to a regular file inside the plugin dir after canonicalization (no `..`, no symlinks escaping the dir).
- Every entry in `capabilities` is from the v1 allowlist: `window`, `hotkey`, `storage`.
- `hotkey`, when present, parses via `tauri-plugin-global-shortcut`'s parser.
- `window.width` / `window.height` are positive integers ≤ 1920 / 1080.

### Plugin lifecycle

| Operation | Trigger | Effect |
|---|---|---|
| Install | User clicks "Install plugin…" → file dialog → `.zip` | Unzip to temp → validate manifest → on conflict, prompt overwrite/cancel → move to `~/.ani-mime/plugins/<id>/` → insert into `AppState.plugins` with `enabled: true` → register hotkey → emit `plugins-changed` |
| Enable | Toggle in Plugin Manager | Register hotkey → emit `plugins-changed`. WebView is **not** spawned until the hotkey fires (lazy) |
| Disable | Toggle in Plugin Manager | Unregister hotkey → close WebView if open → emit `plugins-changed`. Plugin files and storage are preserved |
| Uninstall | "Uninstall" button → confirm dialog | Disable first → delete `~/.ani-mime/plugins/<id>/` recursively → remove from `AppState.plugins` → emit `plugins-changed` |

On host startup, the loader scans `~/.ani-mime/plugins/`, validates each manifest, populates `AppState.plugins`, and registers hotkeys for enabled plugins. A plugin whose manifest fails revalidation is loaded into state with `status: "error"` and a reason string, surfaced in the Plugin Manager.

### Host modules (new)

All under `src-tauri/src/plugin/`:

| File | Responsibility |
|---|---|
| `mod.rs` | Public surface for `lib.rs` (init, command wrappers) |
| `loader.rs` | Filesystem scan, install/uninstall, manifest parsing + validation, zip extraction |
| `manifest.rs` | `Manifest` struct + serde + validation rules |
| `runtime.rs` | WebView spawn / show / hide / close; SDK initialization script; lazy creation on hotkey |
| `gateway.rs` | `plugin_call` dispatcher; capability check; per-capability handlers (`window_*`, `storage_*`) |
| `protocol.rs` | `plugin://` URI scheme registration; path canonicalization; rejects access for disabled plugins |
| `hotkey.rs` | Wraps `tauri-plugin-global-shortcut`; tracks combo→plugin_id; reports conflicts |

`AppState` gains:

```rust
pub plugins: HashMap<String, PluginRecord>,
// PluginRecord { manifest, enabled, status: Loaded|Error(String), webview_label: Option<String> }
```

New Tauri commands in `lib.rs` (registered alongside existing ones):

- `install_plugin_from_dialog() -> Result<PluginRecord, String>`
- `uninstall_plugin(id: String) -> Result<(), String>`
- `set_plugin_enabled(id: String, enabled: bool) -> Result<(), String>`
- `get_plugins() -> Vec<PluginRecord>`
- `plugin_call(plugin_id: String, capability: String, method: String, args: serde_json::Value) -> Result<serde_json::Value, String>`

### Frontend (new)

| File | Responsibility |
|---|---|
| `src/components/PluginManager.tsx` | Settings tab content: install button, list of plugins, per-plugin enable/uninstall controls, error display |
| `src/hooks/usePlugins.ts` | Calls `get_plugins`, listens for `plugins-changed`, exposes `install` / `uninstall` / `setEnabled` |
| `src/types/plugin.ts` | TypeScript mirrors of `Manifest` and `PluginRecord` |
| `src/styles/plugin-manager.css` | Component styles |

Settings sidebar gains a new entry **Plugins** between existing tabs. All UI elements use `data-testid` per project convention (`plugin-card-<id>`, `install-plugin-btn`, etc.).

### `window.ani` SDK (v1)

Injected into every plugin WebView at init via `WebviewWindowBuilder::initialization_script`:

```ts
window.ani = {
  window: {
    show(): Promise<void>;
    hide(): Promise<void>;
    resize(w: number, h: number): Promise<void>;
    close(): Promise<void>;
  },
  hotkey: {
    // No runtime methods in v1. Hotkey is declared in manifest and managed by host.
    // Reserved namespace; methods (register/unregister) ship in v1.1.
  },
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  },
};
```

Every method is a thin wrapper over `__TAURI_INTERNALS__.invoke('plugin_call', { capability, method, args })`. The plugin id is **not** passed from JS — the host derives it from the calling WebView's label, so a plugin cannot impersonate another.

The SDK package (`@ani-mime/plugin-sdk`) ships TypeScript declarations matching this shape plus a thin runtime helper for plugin authors who want type-safe wrappers (`import { storage } from '@ani-mime/plugin-sdk'`). The runtime helper ultimately just forwards to `window.ani`.

### Data flow: hotkey trigger

```
1. User presses Cmd+Shift+T
2. tauri-plugin-global-shortcut → hotkey.rs callback
3. Look up plugin id from combo registry
4. If plugin disabled → ignore
5. If plugin's WebView doesn't exist:
     a. WebviewWindowBuilder::new(app, "<id>", WebviewUrl::External(plugin://<id>/index.html))
     b. Apply manifest.window settings
     c. Set capability config: only plugin_call + standard webview perms
     d. initialization_script injects window.ani
6. webview.show() + set_focus()
```

### Data flow: plugin_call

```
plugin JS: window.ani.storage.set("foo", 42)
  → invoke('plugin_call', { capability: 'storage', method: 'set', args: { key: 'foo', value: 42 } })
host gateway.rs::plugin_call:
  1. Resolve plugin_id from window label (NOT from JS args)
  2. Look up PluginRecord; if missing or disabled → Err("plugin not enabled")
  3. If 'storage' not in manifest.capabilities → Err("capability not declared")
  4. Dispatch to storage::set(plugin_id, key, value)
       → writes to ~/.ani-mime/plugins/<id>/data/store.json
  5. Return Ok(serde_json::Value::Null)
```

### `plugin://` URI scheme

Registered via `tauri::Builder::register_uri_scheme_protocol`. Resolution rules:

- URL must be `plugin://<id>/<path>`.
- `<id>` must exist in `AppState.plugins` and be `enabled`.
- `<path>` is joined to `~/.ani-mime/plugins/<id>/`, then canonicalized; the canonical path must still be inside the plugin dir, otherwise return 403.
- File must exist and be a regular file.
- Content-Type derived from extension (standard mime mapping).

The default Content-Security-Policy for plugin windows allows only `plugin://` for scripts/styles/images and forbids inline scripts unless the plugin opts in via a manifest field (deferred to v1.1; for v1, inline is allowed because plugins are user-installed and trusted).

### Security model (v1)

| Threat | Mitigation |
|---|---|
| Plugin calls arbitrary host command | Plugin window's Tauri capability config grants only `plugin_call`. All other commands return permission-denied |
| Plugin reads another plugin's storage | Gateway derives plugin_id from window label; `storage::*` paths are scoped per id |
| Manifest path-traversal (`"entry": "../../etc/passwd"`) | Loader canonicalizes and rejects entries outside the plugin dir |
| `.zip` extraction zip-slip | Use a zip crate that defends against `..` in archive entries (e.g., `async_zip` with path-safe extraction); also check after extraction |
| Two plugins claim the same hotkey | Second registration fails; second plugin's `status` becomes `Error("hotkey conflict: <combo>")` and is shown in the UI. First-registered wins |
| Plugin id collision on install | Install prompt: overwrite, rename, or cancel |
| Plugin loads remote scripts | Default CSP forbids `https:` script-src; plugin must bundle deps |
| User installs a malicious plugin | Out of scope for v1 (no signing, no permissions UI). Documented limitation; v1.1 adds the permission prompt to make capabilities visible at install time |

### Error handling

User-visible (in Plugin Manager):

- Manifest invalid → install fails, dialog shows the validation error (specific field).
- Plugin id collision → modal asks to overwrite or rename.
- Hotkey conflict → install succeeds, plugin appears with a warning badge: "Hotkey already in use".
- Entry HTML missing on launch → WebView not spawned, status flips to `Error`, Plugin Manager shows reason.
- Plugin JS throws / WebView crashes → close WebView, log via `app_error!`, leave plugin enabled (next hotkey press tries again).

Logged via existing `app_log!` / `app_warn!` / `app_error!` macros under the `[plugin]` tag.

### Testing

**Unit (Rust, in-tree `#[cfg(test)]`):**

- `manifest::parse` — valid manifest, missing fields, bad id pattern, bad semver, unknown capability.
- `manifest::canonicalize_entry` — accepts in-dir entry, rejects `..`, rejects symlink-escape (use a tempdir).
- `gateway::plugin_call` — capability allowed → dispatches; capability not declared → error; plugin disabled → error; plugin missing → error.
- `storage::*` — round-trip, scoped per plugin id.
- `protocol::resolve` — in-dir path → ok; `../etc/passwd` → 403; disabled plugin → 403.

**Unit (frontend, Vitest + RTL):**

- `usePlugins` calls `get_plugins` on mount, updates on `plugins-changed`.
- `PluginManager` renders the empty state, the installed list, and the error badge.

**E2E (Playwright, mocked Tauri):**

- `__MOCK_DIALOG_RESULT__` returns a fixture `.zip` path; install flow shows the new plugin in the list.
- Toggle enable/disable updates the row.
- Uninstall flow with confirm dialog removes the row.

**Manual smoke (cannot be automated in v1):**

- Install a real plugin `.zip`, press its hotkey, verify the WebView opens, exercise `storage.set` / `storage.get`, close on Esc.
- Install conflicting hotkeys; verify second one shows the conflict warning.

### C3 architecture changes

The `c3-1` Rust Backend container gains a new component, `plugin-system`, owning `src-tauri/src/plugin/**`. The `c3-2` React Frontend container gains `plugin-manager` for `src/components/PluginManager.tsx`, `src/hooks/usePlugins.ts`, `src/types/plugin.ts`, `src/styles/plugin-manager.css`. New refs: `plugin-manager → plugin-system` (Tauri commands). New rule: "Plugin code in `src-tauri/src/plugin/**` MUST NOT call other backend modules directly except via `AppState`." All registration happens through `c3x` during implementation; no direct `.c3/` edits.

## File-system layout summary

```
~/.ani-mime/
├── setup-done                 (existing)
├── settings.json              (existing — tauri-plugin-store)
├── mcp/                       (existing)
└── plugins/                   ← new
    └── <plugin-id>/
        ├── manifest.json
        ├── index.html
        ├── assets/
        ├── icon.png
        └── data/store.json
```

## Estimated scope

Roughly 2–3 weeks of one-developer time, broken into approximately:

| Slice | Estimate |
|---|---|
| Loader + manifest + protocol handler + tests | ~3 days |
| Runtime (WebView spawn, SDK injection) + gateway + capability dispatcher + tests | ~3 days |
| Hotkey wiring + lifecycle integration + AppState plumbing | ~2 days |
| Plugin Manager UI (Settings tab, install/uninstall flows) + e2e | ~2 days |
| `@ani-mime/plugin-sdk` package + types + npm publish | ~1 day |
| `ani-mime-plugins` repo bootstrap + first reference plugin (translator) end-to-end | ~2 days |
| Docs (CLAUDE.md update, plugin-author guide, ARCHITECTURE.md update) | ~1 day |
| Buffer for review / fixes | ~3 days |

## Open questions

1. **Hotkey re-registration on settings change**: should disabling a plugin free the combo immediately, or hold it until next launch? *Proposal: free immediately, matching every other toggle in the app.*
2. **Default CSP for inline scripts**: v1 allows `'unsafe-inline'` since plugins are user-trusted. Confirm this is acceptable; revisit in v1.1 with the permission UI.
3. **Plugin uninstall preserves `data/`?** v1 deletes everything (matching uninstall expectations). Add an "Uninstall but keep data" option later if anyone asks.
4. **Where does `@ani-mime/plugin-sdk` get published — personal scope or new org?** Decide before we publish v0.1.0; doesn't block implementation.

## Future work (post-v1)

- Permission prompts at install time (capability list shown to user, opt-in per capability).
- Capabilities: `clipboard`, `network` (proxied + per-host allowlist), `notifications`, `screenshot`, `media-keys`, `events` (subscribe to host events like `status-changed`).
- Hot-reload dev mode: manifest field `"devUrl": "http://localhost:5174"` overrides `entry` when host is running in dev.
- Plugin auto-update: manifest `update_url` pointing to a GitHub release feed.
- Plugin signing.
- Curated plugin index inside the app.
