# Quick Coffee — Hotkey for Quick Web Access

**Date:** 2026-06-16
**Status:** Design approved, pending implementation plan

## Summary

A new ani-mime plugin, **Quick Coffee**, that lets the user assign a system-wide
hotkey to a website URL. Pressing an item's hotkey opens its URL in a
user-selected browser — with no window shown — even when the plugin's
management window is closed and after an app restart.

This is **a plugin plus a new host capability**, not a pure sandboxed plugin:
because each item's hotkey must work while the plugin's WebView is closed, the
action cannot be handled by plugin JavaScript (it isn't running then). The
trusted Rust host owns the global shortcut, persists the bindings, and opens the
URL itself.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hotkey model | **True per-item global hotkeys** | Each item opens its URL directly, no launcher palette. |
| Hotkey ownership | **Host-owned, declaratively set (Approach A)** | Plugin pushes the full set via a capability; host persists + re-registers on startup. Mirrors the existing `plugin-hotkeys.json` override pattern in `hotkey.rs`. |
| Browser selection | **Plugin-level, macOS picker for v1** | One browser for all items. macOS enumerates real browsers; Linux/WSL2 falls back to the OS default. |
| Item schema | `{ label, url, accelerator }` | Browser is not per-item. |
| Set semantics | **Full-set replace** | `setHotkeys` replaces the plugin's entire binding set — no UI/host drift, no incremental add/remove. |
| Launch hotkey | **Opens the management window** | Consistent with every other plugin and the Plugin Manager "launch" button. |

## Architecture

```
Launch hotkey (manifest)        ──► opens Quick Coffee management window (CRUD + browser picker)
Per-item global hotkeys (host)  ──► host opens URL in chosen browser, NO window
```

- **Plugin side** (sandboxed JS, `plugins/quick-coffee/`): the management UI.
  Edits items, picks the browser, and on every change pushes the full active set
  to the host via the new capability.
- **Host side** (trusted Rust, new `src-tauri/src/plugin/browser.rs`): enumerates
  browsers, opens URLs, and owns the per-item global shortcuts — persisted and
  re-registered on startup.

## Data model

**Plugin store** (`~/.ani-mime/plugins/quick-coffee/data/store.json`, via the
existing `storage` capability — the editing source of truth):

```json
{
  "browserBundleId": "com.google.Chrome",
  "items": [
    { "id": "uuid", "label": "GitHub", "url": "https://github.com", "accelerator": "CmdOrCtrl+Shift+G" }
  ]
}
```

**Host file** (`~/.ani-mime/plugins/quick-coffee/url-hotkeys.json`, written only
through the capability — the registration source of truth, read at startup):

```json
{
  "browserBundleId": "com.google.Chrome",
  "bindings": [
    { "accelerator": "CmdOrCtrl+Shift+G", "url": "https://github.com" }
  ]
}
```

- `browserBundleId: null` = OS default browser.
- Browser is **plugin-level**; items are `{ label, url, accelerator }`.
- The plugin store is what the UI edits; the host file is what the host
  registers. The plugin keeps them in sync by calling `setHotkeys` on every
  change. Slight duplication, but it keeps the trusted host decoupled from the
  plugin's free-form storage schema.

## New `browser` capability (host)

1. Add `"browser"` to `ALLOWED_CAPABILITIES` in `manifest.rs`.
2. Add the `browser` namespace to `ANI_SDK_JS` in `runtime.rs`:
   ```js
   window.ani.browser = {
     list:       function () { /* -> [{ bundleId, name }] */ },
     open:       function (url, bundleId) { /* open url in browser (or default) */ },
     setHotkeys: function (bundleId, bindings) { /* -> [{ accelerator, ok, error? }] */ }
   }
   ```
3. Handle capability `"browser"` in `gateway.rs`:
   - **`list`** → `[{ bundleId, name }]`.
     - macOS: LaunchServices handlers for the `http` scheme, resolved to display
       names. Fallback: probe a known browser list (Safari, Chrome, Chromium,
       Firefox, Edge, Arc, Brave, Opera, Vivaldi) by bundle id / install path.
     - Linux: returns `[]` (default-only).
   - **`open`** → opens `url` via `open -b <bundleId> <url>` (or the OS default
     if no `bundleId`). Backs the per-row "open now" / test button.
   - **`setHotkeys`** → replaces this plugin's whole binding set: unregister old,
     validate, register each global shortcut, persist `url-hotkeys.json`, return
     per-binding `{ accelerator, ok, error? }` so the UI can flag conflicts.

## Hotkey lifecycle (`plugin/browser.rs`)

- **On `setHotkeys`**: drop the plugin's previous URL-shortcuts, register the new
  ones (each callback runs `open_in(bundleId, url)`), persist the file, return
  per-binding results.
- **On startup** (`lib.rs::run`): after launch-hotkeys are registered, read each
  enabled plugin's `url-hotkeys.json` and re-register — so item hotkeys fire
  after a restart with no window ever opened.
- **On disable / uninstall**: unregister the plugin's URL-shortcuts (hook the
  existing enable/disable/uninstall paths in the loader/commands).
- **Conflicts**: the URL-shortcuts use the same global-shortcut registry as
  launch hotkeys, so a taken combo simply fails to register and is reported back
  per-binding — never silently lost.

## Plugin UI (`plugins/quick-coffee/index.html`)

Management window, opened by the manifest launch hotkey (e.g.
`CmdOrCtrl+Shift+K`) or the Plugin Manager "launch" button:

- A browser `<select>` populated from `ani.browser.list()`; selection saved to
  the store and re-pushed via `setHotkeys`.
- An add / edit / delete item list. Each row: label, URL, a **hotkey-capture
  field** (keydown → Tauri accelerator string), an "open now" test button, and a
  registered / conflict status badge.
- Any edit re-pushes the full set via `setHotkeys`; per-binding errors surface on
  the relevant row.
- `data-testid` on every interactive element; semantic HTML and ARIA per the
  project's testing conventions.
- The keydown → accelerator helper is extracted as a standalone function so it is
  unit-testable.

## Security

- The `browser` capability is gated exactly like every other capability — only a
  plugin that declares it (and is enabled) can call `list` / `open` /
  `setHotkeys`.
- URLs are opened as a separate process argument (no shell), avoiding injection.
- **Scheme validation**: reject anything that is not `http` / `https` (no
  `file://`, `javascript:`, custom app schemes) so a hotkey cannot open arbitrary
  local files or launch apps. Enforced host-side in both `open` and `setHotkeys`.

## Plugin capabilities declared

`["window", "browser", "storage"]` — `window` for the management window,
`storage` for the editing store, `browser` for list/open/setHotkeys. The launch
hotkey works from the manifest `hotkey` field without a separate capability (same
as the `translate` plugin).

## Testing

- **Rust unit tests** (following `gateway.rs` test style):
  - `url-hotkeys.json` load/save round-trip.
  - Binding validation and URL scheme validation (reject non-http(s)).
  - `browser`-capability gating: undeclared / disabled plugin rejected.
  - `manifest.rs`: `browser` is an allowed capability.
  - `runtime.rs`: the `browser` namespace is exposed in `ANI_SDK_JS`.
- **Frontend**: keep `data-testid`s on all interactive elements; extract and
  unit-test the keydown → accelerator helper.

## Out of scope (v1)

- Linux/WSL2 specific browser enumeration (falls back to OS default).
- Per-item browser selection (browser is plugin-level).
- A generic host action-table (e.g. run-script / open-app actions) — `OpenUrl` is
  the only host action for now.

## Files touched

| File | Change |
|------|--------|
| `plugins/quick-coffee/manifest.json` | New plugin manifest |
| `plugins/quick-coffee/index.html` | New management UI |
| `plugins/quick-coffee/README.md` | New plugin readme |
| `src-tauri/src/plugin/browser.rs` | New module: enumerate, open, url-hotkey persistence + registration |
| `src-tauri/src/plugin/mod.rs` | Register `browser` module |
| `src-tauri/src/plugin/manifest.rs` | Add `"browser"` to `ALLOWED_CAPABILITIES` |
| `src-tauri/src/plugin/runtime.rs` | Add `browser` namespace to `ANI_SDK_JS` |
| `src-tauri/src/plugin/gateway.rs` | Handle `"browser"` capability |
| `src-tauri/src/platform/{mod,macos,linux}.rs` | `list_browsers()` + `open_url_in(bundle_id, url)` |
| `src-tauri/src/lib.rs` | Startup re-registration of URL-hotkeys; disable/uninstall unregister hooks |
| `src-tauri/tauri.conf.json` | Add the plugin dir to bundle resources if shipped built-in |
