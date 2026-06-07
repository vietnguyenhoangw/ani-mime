# Quick Translate Plugin — Design

**Date:** 2026-06-06
**Status:** Approved (design); pending implementation plan

## Goal

A first-party Ani-Mime plugin that gives a fast "select/type text → see translation"
experience launched by a global hotkey. It mirrors the Clipboard plugin's shape (a
`manifest.json` + a single self-contained `index.html`, installed via `.zip`), and adds
one new capability to the host so the plugin can produce translations and open Google
Translate in the browser.

## Decisions (locked during brainstorming)

| Decision | Choice |
|----------|--------|
| Translation source | **Backend free endpoint** — Rust (`ureq`) calls Google's free unofficial endpoint and returns the result inline. No API key, no CORS. |
| Translate trigger | **On Enter / Translate button** (not live-as-you-type) — keeps request volume low to avoid rate-limiting. |
| Input on launch | **Empty box, focused** — no clipboard prefill, no persisted text. |
| Language coverage | **Curated short list** (~15 common languages) + a "Detect language" source option. |
| Default language pair | **English → Vietnamese.** |
| Layout | **Layout A** — shared language bar on top (`source ⇄ target` + swap), input pane, then result pane. |
| Copy button | Uses `navigator.clipboard.writeText` (no new capability). Fallback to the `clipboard` capability only if WKWebView blocks it from the `plugin://` origin. |

## Non-goals (YAGNI)

- Translation history / favourites
- Text-to-speech / pronunciation
- Official Google Cloud Translation API (API key + billing)
- Auto-detect-then-swap, alternative translations, dictionary definitions
- More than the curated language set
- Windows-specific protocol handling (project's primary target is macOS; Linux works via the existing facade)

## Architecture

The plugin is **web assets only** — no app code ships inside the plugin folder. All
privileged operations route through the existing single gated command, `plugin_call`,
which derives the plugin id from the calling window label (never from JS args). This
design adds exactly one new capability, `translate`, with two methods.

```
Cmd+Shift+T (global hotkey)
  → hotkey.rs → launch_plugin_webview("translate")
  → WebView served from plugin://translate/index.html  (empty, focused input)

User types + presses Enter (or clicks Translate)
  → window.ani.translate.text({ q, source, target })
  → plugin_call(capability="translate", method="text")
  → gateway.rs → translate.rs::translate()  (ureq GET to googleapis)
  → parse array response → { text, detectedSource }
  → result pane renders translation

User clicks "Open in Google ↗"
  → window.ani.translate.openWeb({ q, source, target })
  → plugin_call(capability="translate", method="openWeb")
  → gateway.rs → translate.rs::web_url() → platform::open_url(...)

User clicks swap (⇄)
  → JS-only: swaps the two selected languages, no request
```

## Components

### 1. Plugin package — `plugins/translate/`

Mirrors `plugins/clipboard/`. No app code.

- **`manifest.json`**
  - `id: "translate"`, `name: "Quick Translate"`, `version: "0.1.0"`
  - `entry: "index.html"`
  - `hotkey: "CmdOrCtrl+Shift+T"` (user-rebindable via the existing override mechanism)
  - `capabilities: ["window", "translate"]`
  - `window`: `width: 420, height: 520, resizable: true, alwaysOnTop: true, decorations: true`
- **`index.html`** — self-contained UI (layout A):
  - Top language bar: source selector, swap button (⇄), target selector.
  - Input pane: focused `<textarea>`; Enter (without Shift) triggers translate; a **Translate** button as the explicit affordance.
  - Result pane: translated text (selectable), a **Copy** button (`navigator.clipboard.writeText`), and **Open in Google ↗**.
  - Curated language list bundled inline as a small JS array of `{ code, label }`:
    English (`en`), Vietnamese (`vi`), Spanish (`es`), French (`fr`), German (`de`),
    Italian (`it`), Portuguese (`pt`), Russian (`ru`), Chinese-Simplified (`zh-CN`),
    Japanese (`ja`), Korean (`ko`), Thai (`th`), Indonesian (`id`), Hindi (`hi`),
    Arabic (`ar`). The **source** selector also offers "Detect language" (`auto`);
    the target selector does not.
  - Default selection: source `en`, target `vi`.
  - `data-testid` on every control (`tw-source`, `tw-target`, `tw-swap`, `tw-input`,
    `tw-translate-btn`, `tw-result`, `tw-copy-btn`, `tw-open-google-btn`) per the
    project testing convention. Icon-only buttons get `aria-label`.
- **`README.md`** — worked-example notes, like `plugins/clipboard/README.md`.
- A built **`plugins/translate.zip`** for install, and a row added to `plugins/README.md`'s
  "Available plugins" table.

### 2. New backend module — `src-tauri/src/plugin/translate.rs`

Keeps `gateway.rs` thin (mirrors how `clipboard.rs` holds clipboard logic). Pure
functions, unit-testable without a running app:

- `web_url(q, source, target) -> String` — builds
  `https://translate.google.com/?sl=<source>&tl=<target>&text=<percent-encoded q>&op=translate`.
  `source == "auto"` maps to `sl=auto`.
- `api_url(q, source, target) -> String` — builds
  `https://translate.googleapis.com/translate_a/single?client=gtx&sl=<source>&tl=<target>&dt=t&q=<percent-encoded q>`.
- `parse_response(json: &serde_json::Value) -> Result<TranslateResult, String>` — the
  free endpoint returns `[[["<chunk>","<src chunk>",...], ...], null, "<detected>", ...]`.
  Concatenate every `result[0][i][0]` string for the translated text; read `result[2]`
  for the detected source language. Missing/!shaped data → `Err`.
- `translate(q, source, target) -> Result<TranslateResult, String>` — `ureq` GET against
  `api_url`, read body as JSON, hand to `parse_response`. Non-200 (incl. 429) → `Err`.
- `TranslateResult { text: String, detected_source: Option<String> }`, serializable so the
  gateway can return it as JSON.

### 3. Gateway dispatch — `src-tauri/src/plugin/gateway.rs`

Add a `"translate"` arm to the `match capability.as_str()`:
- `method == "text"`: read `q`, `source`, `target` from args; call `translate::translate(...)`;
  return `{ text, detectedSource }` JSON.
- `method == "openWeb"`: read `q`, `source`, `target`; call
  `platform::open_url(&translate::web_url(...))`; return `null`.
- unknown method → `Err`.

Capability gating is unchanged — `capability_allowed` already rejects a plugin that
doesn't declare `translate`.

### 4. Manifest allowlist — `src-tauri/src/plugin/manifest.rs`

Add `"translate"` to `ALLOWED_CAPABILITIES` so the manifest validates at install time.

### 5. Injected SDK — `src-tauri/src/plugin/runtime.rs`

Extend `ANI_SDK_JS` with:
```js
translate: {
  text:    function (q, source, target) { return invoke('translate', 'text',    { q: q, source: source, target: target }); },
  openWeb: function (q, source, target) { return invoke('translate', 'openWeb', { q: q, source: source, target: target }); }
}
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| Empty input | No request fired; result pane stays empty/placeholder. |
| Network error / offline | `text` returns `Err`; result pane shows *"Translation failed — try again, or open in Google ↗."* |
| Non-200 (incl. 429 rate-limit) | Same failed-translation message. |
| Malformed/unexpected response | `parse_response` → `Err` → same message. |
| Any translate failure | **Open in Google ↗** still works — it's a pure URL with no network call from us, so the user always has an escape hatch. |

## Testing

- **Rust unit tests** (in `translate.rs` + `gateway.rs`, mirroring `clipboard.rs`/`gateway.rs`):
  - `web_url` / `api_url` build correctly, including `auto` source and percent-encoding of `q`.
  - `parse_response` extracts joined text + detected language from a sample googleapis array;
    rejects malformed input.
  - Capability gating: a record without `translate` is rejected by `capability_allowed`.
  - `ALLOWED_CAPABILITIES` contains `translate`.
- **Plugin UI**: runs in its own WebView, outside the React/Playwright (Tauri-mock)
  harness, so automated coverage centers on the Rust layer. `data-testid`s are added for
  manual and any future plugin-webview testing.

## Release impact

- Backend changes (new capability + module) ship in the next app release — follow the
  4-file version-bump checklist in CLAUDE.md when that release is cut.
- The plugin itself versions independently (`0.1.0`) and is distributed as
  `plugins/translate.zip`; it is not bundled into the binary.
- Update `plugins/README.md`'s available-plugins table.
