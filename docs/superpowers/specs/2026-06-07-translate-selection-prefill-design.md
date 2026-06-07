# Translate: pre-fill input from the current selection — Design

**Date:** 2026-06-07
**Status:** Approved (design); implementing

## Goal

When the Quick Translate plugin is launched via its global hotkey, pre-fill the
input with whatever text the user has selected in the frontmost app, and
auto-translate it. Selecting text anywhere → `Cmd+Shift+T` → the popup opens
with that text already translated.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Trigger | **Hotkey only.** Grab happens at the instant the hotkey fires, while the source app is still frontmost. Not on the Plugin-Manager "Launch" button (frontmost app there is our own settings). |
| Grab method | **Synthesize ⌘C + restore clipboard.** Broadest app coverage (terminals, browsers, native). Accessibility-only (`AXSelectedText`) was rejected — silently fails in too many apps. |
| After grab | **Auto-translate** the grabbed text immediately. |
| No selection | Popup opens empty + focused, exactly as today. |
| Scope | A reusable, gated **`selection`** capability (mirrors `clipboard`), not hard-coded into translate. |
| Permission | Requires macOS Accessibility permission (unavoidable). First hotkey press triggers the system prompt and opens empty; works thereafter. |

## Non-goals (YAGNI)

- Reading the selection when launched from the Plugin-Manager button.
- Reaching into a background app's selection *after* the popup already has focus.
- Linux selection capture (stub returns `None`; the plugin opens empty).
- Remembering / history of grabbed selections.

## Grab mechanism (macOS)

In the hotkey path, before the plugin window is created:

1. Snapshot `NSPasteboard.general` `changeCount` and current string contents.
2. Synthesize **⌘C** via CoreGraphics (`CGEvent` keyboard down/up with the
   Command flag, key code `kVK_ANSI_C` = 8), posted to `CGEventTapLocation::HID`.
3. Sleep ~100 ms to let the target app service the copy.
4. Read `NSPasteboard.general`. If `changeCount` advanced, the new string is the
   selection; otherwise nothing was selected → treat as empty.
5. **Restore** the original clipboard contents (string), regardless of outcome.

If Accessibility permission is not granted, `AXIsProcessTrusted()` is false →
call the prompting variant once (`AXIsProcessTrustedWithOptions` with
`kAXTrustedCheckOptionPrompt`), skip the grab this time, open empty.

## Architecture — new gated `selection` capability

Mirrors how `clipboard` is structured: logic in its own module, gated through
`plugin_call`, plugin id derived from the window label.

- **`src-tauri/src/plugin/manifest.rs`** — add `"selection"` to `ALLOWED_CAPABILITIES`.
- **`plugins/translate/manifest.json`** — `capabilities: ["window","translate","selection"]`.
- **`src-tauri/src/plugin/selection.rs`** (new) — platform-gated:
  - macOS: `capture_selection() -> Option<String>` (the ⌘C+restore dance),
    `accessibility_trusted() -> bool`, `prompt_accessibility()`.
  - Linux/other: `capture_selection()` returns `None`; trust helpers no-op `true`.
- **`src-tauri/src/state.rs`** — add `pending_selection: HashMap<String, String>`
  (plugin id → captured text) to `AppState`.
- **`src-tauri/src/plugin/hotkey.rs`** — in the `Pressed` handler, if the launching
  plugin declares `selection`: capture, store into `pending_selection[id]`, then
  launch. (Capture must happen before the window is built.)
- **`src-tauri/src/plugin/gateway.rs`** — new `"selection"` arm, method `read`:
  returns and **removes** `pending_selection[id]` (one-shot), or empty string.
- **`src-tauri/src/plugin/runtime.rs`** — SDK gains
  `window.ani.selection = { read: () => invoke('selection','read') }`.
- **`plugins/translate/index.html`** — on load:
  `const s = await window.ani.selection.read(); if (s && s.trim()) { input.value = s; doTranslate(); } else { input.focus(); }`.

## Data flow

```
select text (iTerm) → Cmd+Shift+T
  → hotkey.rs Pressed: plugin declares 'selection'?
      → selection::capture_selection()   [snapshot → ⌘C → wait → read → restore]
      → AppState.pending_selection["translate"] = text
  → launch_plugin_webview  (popup floats on top)
  → index.html load → window.ani.selection.read()
      → gateway returns + clears pending_selection["translate"]
  → input filled → auto-translate → result shown
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| Accessibility not granted | Prompt once via `AXIsProcessTrustedWithOptions`; popup opens empty; works next time. |
| Nothing selected (changeCount unchanged) | Empty input; normal focused launch. |
| Capture failure / panic-safe | Returns `None`; popup opens empty. |
| Linux | `capture_selection()` returns `None`; popup opens empty. |
| Clipboard | Always restored to its prior string, including the empty path. |

## Dependencies

- New macOS-only crate: **`core-graphics`** (for `CGEvent` keystroke synthesis).
- FFI to **ApplicationServices** framework for `AXIsProcessTrusted` /
  `AXIsProcessTrustedWithOptions` (declared `extern "C"` + `#[link(... kind = "framework")]`).
- `NSPasteboard` via the existing `cocoa` crate.

## Testing

- **Rust units:** `pending_selection` store + read-and-clear (one-shot) logic;
  `selection` capability gating; `ALLOWED_CAPABILITIES` includes `selection`;
  SDK string exposes `selection`. The `CGEvent`/AX/pasteboard calls are OS-side →
  manual verification (consistent with the focus/dialog work).
- **Manual:** select text in iTerm → hotkey → text appears + auto-translates;
  nothing selected → empty popup; clipboard contents unchanged afterward; first
  run prompts for Accessibility permission.

## Risks

- ⌘C synthesis + AX behavior on macOS 26 is OS-dependent and can't be verified
  headlessly; treat the first real run as the verification gate.
- Accessibility permission attaches to the binary — in `tauri dev` the loose
  binary may need re-granting across rebuilds; a signed build is stable.
