# Quick Translate Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-party "Quick Translate" plugin that, on a global hotkey, opens a small window where the user types text and gets an inline translation (produced server-side in Rust), plus a button to open Google Translate pre-filled.

**Architecture:** The plugin is web-assets-only (`plugins/translate/` = `manifest.json` + `index.html`), mirroring the existing Clipboard plugin. It declares one new host capability, `translate`, routed through the existing gated `plugin_call` command. A new Rust module `plugin/translate.rs` builds URLs, calls Google's free unofficial endpoint with `ureq`, and parses the response. The injected `window.ani` SDK gains `translate.text(...)` and `translate.openWeb(...)`.

**Tech Stack:** Rust (Tauri 2, `ureq` 3, `urlencoding` 2, `serde_json`), vanilla HTML/CSS/JS for the plugin UI. Spec: `docs/superpowers/specs/2026-06-06-quick-translate-plugin-design.md`.

**Branch:** `feat/translate-plugin` (already created).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src-tauri/src/plugin/translate.rs` | URL building, HTTP call, response parsing (pure + network) | Create |
| `src-tauri/src/plugin/mod.rs` | Register the new `translate` module | Modify |
| `src-tauri/src/plugin/manifest.rs` | Add `"translate"` to `ALLOWED_CAPABILITIES` | Modify |
| `src-tauri/src/plugin/gateway.rs` | Dispatch the `translate` capability (`text`, `openWeb`) | Modify |
| `src-tauri/src/plugin/runtime.rs` | Add `window.ani.translate` to `ANI_SDK_JS` | Modify |
| `plugins/translate/manifest.json` | Plugin manifest | Create |
| `plugins/translate/index.html` | Plugin UI (layout A) | Create |
| `plugins/translate/README.md` | Worked-example notes | Create |
| `plugins/translate.zip` | Installable bundle | Create (build step) |
| `plugins/README.md` | Add row to available-plugins table | Modify |

---

## Task 1: Backend `translate.rs` — URL builders + response parser

Pure, unit-testable functions plus the `ureq` call. Mirrors how `clipboard.rs` keeps logic out of `gateway.rs`.

**Files:**
- Create: `src-tauri/src/plugin/translate.rs`
- Modify: `src-tauri/src/plugin/mod.rs`

- [ ] **Step 1: Register the module**

In `src-tauri/src/plugin/mod.rs`, add the module declaration alphabetically (after `pub mod storage;` is fine, but place near the others):

```rust
pub mod clipboard;
pub mod gateway;
pub mod hotkey;
pub mod loader;
pub mod manifest;
pub mod protocol;
pub mod runtime;
pub mod storage;
pub mod translate;
```

- [ ] **Step 2: Write `translate.rs` with the failing tests first**

Create `src-tauri/src/plugin/translate.rs` with the test module only at first (so it fails to compile → counts as a failing test). Write the full file but the functions will be filled in Step 4. To do TDD cleanly, write the tests now and stub the functions to `unimplemented!()`:

```rust
//! Quick Translate backend: URL builders + a `ureq` call to Google's free
//! (unofficial) translate endpoint, with response parsing. Kept out of
//! `gateway.rs` so the URL/parse logic is unit-testable without a WebView.

/// Result of a translation. `detected_source` is the language Google reports
/// it detected (useful when the user picked "auto").
#[derive(Debug, serde::Serialize)]
pub struct TranslateResult {
    pub text: String,
    #[serde(rename = "detectedSource")]
    pub detected_source: Option<String>,
}

/// Build the URL for Google's free unofficial translate endpoint.
/// `source == "auto"` is passed through as `sl=auto`.
pub fn api_url(q: &str, source: &str, target: &str) -> String {
    format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        source,
        target,
        urlencoding::encode(q)
    )
}

/// Build the user-facing Google Translate web URL (for the "Open in Google" button).
pub fn web_url(q: &str, source: &str, target: &str) -> String {
    format!(
        "https://translate.google.com/?sl={}&tl={}&text={}&op=translate",
        source,
        target,
        urlencoding::encode(q)
    )
}

/// Parse the array response from the free endpoint:
/// `[[["<translated>","<src>",...], ...], null, "<detected>", ...]`.
/// Concatenates every sentence chunk; reads the detected language at index 2.
pub fn parse_response(json: &serde_json::Value) -> Result<TranslateResult, String> {
    let chunks = json
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or_else(|| "unexpected response shape".to_string())?;
    let mut text = String::new();
    for c in chunks {
        if let Some(s) = c.get(0).and_then(|v| v.as_str()) {
            text.push_str(s);
        }
    }
    if text.is_empty() {
        return Err("empty translation".to_string());
    }
    let detected = json
        .get(2)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(TranslateResult {
        text,
        detected_source: detected,
    })
}

/// Call the endpoint and parse the result. Non-2xx and network failures map
/// to `Err`. The caller (gateway) surfaces the error to the UI.
pub fn translate(q: &str, source: &str, target: &str) -> Result<TranslateResult, String> {
    let url = api_url(q, source, target);
    let mut response = ureq::get(&url)
        .header("User-Agent", "ani-mime-translate")
        .call()
        .map_err(|e| format!("translate request failed: {e}"))?;
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("translate bad response: {e}"))?;
    parse_response(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_encodes_query_and_passes_langs() {
        let u = api_url("hello world", "en", "vi");
        assert!(u.starts_with("https://translate.googleapis.com/translate_a/single?"));
        assert!(u.contains("sl=en"));
        assert!(u.contains("tl=vi"));
        assert!(u.contains("q=hello%20world"));
        assert!(u.contains("client=gtx"));
        assert!(u.contains("dt=t"));
    }

    #[test]
    fn api_url_passes_auto_source() {
        let u = api_url("x", "auto", "en");
        assert!(u.contains("sl=auto"));
    }

    #[test]
    fn web_url_encodes_query() {
        let u = web_url("a&b c", "en", "vi");
        assert!(u.starts_with("https://translate.google.com/?"));
        assert!(u.contains("sl=en"));
        assert!(u.contains("tl=vi"));
        assert!(u.contains("op=translate"));
        assert!(u.contains("text=a%26b%20c"));
    }

    #[test]
    fn parse_response_joins_chunks_and_reads_detected() {
        let json = serde_json::json!([
            [
                ["Xin ", "Hello ", null, null],
                ["chào", "world", null, null]
            ],
            null,
            "en"
        ]);
        let r = parse_response(&json).expect("ok");
        assert_eq!(r.text, "Xin chào");
        assert_eq!(r.detected_source.as_deref(), Some("en"));
    }

    #[test]
    fn parse_response_rejects_wrong_shape() {
        let json = serde_json::json!({ "not": "an array" });
        assert!(parse_response(&json).is_err());
    }

    #[test]
    fn parse_response_rejects_empty_text() {
        let json = serde_json::json!([[], null, "en"]);
        assert!(parse_response(&json).is_err());
    }
}
```

Note: this file is written complete (functions implemented). The "failing" state in Step 3 is the compile error that exists until `mod.rs` is saved and the file is added — if you prefer strict red/green, temporarily replace each fn body with `unimplemented!()`, watch the tests fail, then restore. The implementations above are the final code.

- [ ] **Step 3: Run the tests to verify they compile-fail then are run**

Run: `cd src-tauri && cargo test --lib plugin::translate`
Expected: tests compile and PASS (the implementations are included). If you used the `unimplemented!()` red/green variant, expect panics first, then PASS after restoring bodies.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugin/translate.rs src-tauri/src/plugin/mod.rs
git commit -m "feat(plugin): add translate URL builders + response parser"
```

---

## Task 2: Allow the `translate` capability in manifest validation

Without this, any manifest declaring `translate` is rejected at install time with `UnknownCapability`.

**Files:**
- Modify: `src-tauri/src/plugin/manifest.rs:7`

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/plugin/manifest.rs`, inside the existing `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn translate_is_an_allowed_capability() {
    assert!(ALLOWED_CAPABILITIES.contains(&"translate"));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test --lib plugin::manifest::tests::translate_is_an_allowed_capability`
Expected: FAIL — assertion fails because `translate` is not yet in the list.

- [ ] **Step 3: Add `translate` to the allowlist**

Change line 7 of `src-tauri/src/plugin/manifest.rs` from:

```rust
pub const ALLOWED_CAPABILITIES: &[&str] = &["window", "hotkey", "storage", "clipboard"];
```

to:

```rust
pub const ALLOWED_CAPABILITIES: &[&str] = &["window", "hotkey", "storage", "clipboard", "translate"];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd src-tauri && cargo test --lib plugin::manifest`
Expected: PASS (all manifest tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/manifest.rs
git commit -m "feat(plugin): allow the translate capability in manifest validation"
```

---

## Task 3: Dispatch the `translate` capability in the gateway

Wire `window.ani.translate.text` / `.openWeb` to the backend. Like the existing `clipboard`/`window` arms, this dispatch isn't unit-tested directly (it needs a live `WebviewWindow`); coverage lives in Task 1 (`translate.rs`) and the capability-gating tests already present.

**Files:**
- Modify: `src-tauri/src/plugin/gateway.rs` (add an arm to the `match capability.as_str()` block, after the `"clipboard"` arm and before the final `other =>` arm)

- [ ] **Step 1: Add the `translate` arm**

In `src-tauri/src/plugin/gateway.rs`, locate the end of the `"clipboard" => { ... }` arm and the final `other => Err(format!("unknown capability '{}'", other)),`. Insert this arm between them:

```rust
        "translate" => {
            let q = arg_str(&args, "q")?;
            let source = arg_str(&args, "source")?;
            let target = arg_str(&args, "target")?;
            match method.as_str() {
                "text" => {
                    let result =
                        crate::plugin::translate::translate(&q, &source, &target)?;
                    serde_json::to_value(result).map_err(|e| e.to_string())
                }
                "openWeb" => {
                    let url = crate::plugin::translate::web_url(&q, &source, &target);
                    crate::platform::open_url(&url);
                    Ok(serde_json::Value::Null)
                }
                other => Err(format!("unknown translate method '{}'", other)),
            }
        }
```

- [ ] **Step 2: Type-check the backend**

Run: `cd src-tauri && cargo check`
Expected: compiles with no errors. (`arg_str`, `crate::platform::open_url`, and `crate::plugin::translate::*` all already exist/are defined.)

- [ ] **Step 3: Run the full backend test suite**

Run: `cd src-tauri && cargo test --lib plugin`
Expected: PASS — existing gateway capability-gating tests plus Task 1/2 tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugin/gateway.rs
git commit -m "feat(plugin): dispatch translate capability (text + openWeb)"
```

---

## Task 4: Expose `window.ani.translate` in the injected SDK

**Files:**
- Modify: `src-tauri/src/plugin/runtime.rs` (the `ANI_SDK_JS` constant + a test)

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/plugin/runtime.rs`, inside `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn sdk_script_exposes_translate_namespace() {
    assert!(ANI_SDK_JS.contains("translate:"));
    assert!(ANI_SDK_JS.contains("openWeb"));
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test --lib plugin::runtime::tests::sdk_script_exposes_translate_namespace`
Expected: FAIL — `translate:` is not yet in the SDK string.

- [ ] **Step 3: Add the `translate` namespace to `ANI_SDK_JS`**

In `src-tauri/src/plugin/runtime.rs`, find the `clipboard: { ... }` block inside the `window.ani = { ... }` object literal. Add a `translate` namespace right after the `clipboard` block (add a comma after the clipboard block's closing brace):

```js
    clipboard: {
      history: function () { return invoke('clipboard', 'history'); },
      copy: function (text) { return invoke('clipboard', 'copy', { text: text }); },
      remove: function (text) { return invoke('clipboard', 'remove', { text: text }); },
      clear: function () { return invoke('clipboard', 'clear'); }
    },
    translate: {
      text:    function (q, source, target) { return invoke('translate', 'text',    { q: q, source: source, target: target }); },
      openWeb: function (q, source, target) { return invoke('translate', 'openWeb', { q: q, source: source, target: target }); }
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd src-tauri && cargo test --lib plugin::runtime`
Expected: PASS (all runtime tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugin/runtime.rs
git commit -m "feat(plugin): expose window.ani.translate in injected SDK"
```

---

## Task 5: Plugin package — manifest + UI + README

The web assets. No app code.

**Files:**
- Create: `plugins/translate/manifest.json`
- Create: `plugins/translate/index.html`
- Create: `plugins/translate/README.md`

- [ ] **Step 1: Write the manifest**

Create `plugins/translate/manifest.json`:

```json
{
  "id": "translate",
  "name": "Quick Translate",
  "version": "0.1.0",
  "description": "Translate text fast — type, hit Enter, get the translation. Or open it in Google Translate.",
  "author": "ani-mime",
  "entry": "index.html",
  "hotkey": "CmdOrCtrl+Shift+T",
  "capabilities": ["window", "translate"],
  "window": {
    "width": 420,
    "height": 520,
    "resizable": true,
    "alwaysOnTop": true,
    "decorations": true
  }
}
```

- [ ] **Step 2: Write the UI (layout A)**

Create `plugins/translate/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quick Translate</title>
  <style>
    :root {
      --bg: #1e1e22;
      --surface: rgba(255, 255, 255, 0.06);
      --surface-hover: rgba(255, 255, 255, 0.10);
      --border: rgba(255, 255, 255, 0.10);
      --text: #f2f2f4;
      --muted: rgba(242, 242, 244, 0.55);
      --accent: #007aff;
      --green: #34a853;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f5f5f7;
        --surface: rgba(0, 0, 0, 0.04);
        --surface-hover: rgba(0, 0, 0, 0.08);
        --border: rgba(0, 0, 0, 0.10);
        --text: #1d1d1f;
        --muted: rgba(29, 29, 31, 0.55);
      }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      padding: 12px;
      gap: 10px;
    }
    .bar { display: flex; align-items: center; gap: 8px; }
    select {
      flex: 1; font: inherit; color: var(--text);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 7px; padding: 6px 8px; cursor: pointer;
    }
    button {
      font: inherit; color: var(--text); background: var(--surface);
      border: 1px solid var(--border); border-radius: 7px;
      padding: 6px 10px; cursor: pointer; transition: background 0.12s; white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--surface-hover); }
    #swap { padding: 6px 9px; font-size: 15px; }
    .pane { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
    textarea {
      flex: 1; resize: none; font: inherit; color: var(--text);
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 10px; min-height: 90px;
    }
    #result {
      flex: 1; overflow-y: auto; background: var(--surface);
      border: 1px solid var(--border); border-radius: 8px; padding: 10px;
      white-space: pre-wrap; -webkit-user-select: text; user-select: text;
      min-height: 90px; color: var(--green);
    }
    #result.placeholder, #result.error { color: var(--muted); }
    #result.error { color: var(--accent); }
    .actions { display: flex; gap: 6px; justify-content: flex-end; }
    .actions .grow { margin-right: auto; color: var(--muted); align-self: center; font-size: 11px; }
    .primary { background: var(--accent); color: #fff; border-color: transparent; }
    .go { background: var(--green); color: #fff; border-color: transparent; }
    .toast {
      position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
      background: var(--text); color: var(--bg);
      padding: 6px 12px; border-radius: 999px; font-size: 12px;
      opacity: 0; transition: opacity 0.2s; pointer-events: none;
    }
    .toast.show { opacity: 0.95; }
  </style>
</head>
<body>
  <div class="bar">
    <select id="source" data-testid="tw-source" aria-label="Source language"></select>
    <button id="swap" data-testid="tw-swap" aria-label="Swap languages" title="Swap languages">⇄</button>
    <select id="target" data-testid="tw-target" aria-label="Target language"></select>
  </div>

  <div class="pane">
    <textarea id="input" data-testid="tw-input" placeholder="Type text, then press Enter to translate…"></textarea>
    <div class="actions">
      <button id="translate" class="primary" data-testid="tw-translate-btn">Translate ⏎</button>
    </div>
  </div>

  <div class="pane">
    <div id="result" class="placeholder" data-testid="tw-result">Translation appears here.</div>
    <div class="actions">
      <button id="copy" data-testid="tw-copy-btn">Copy</button>
      <button id="open" class="go" data-testid="tw-open-google-btn">Open in Google ↗</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const $ = (id) => document.getElementById(id);
    const toastEl = $("toast");

    // Curated language set. The source select also gets an "auto" option.
    const LANGS = [
      ["en", "English"], ["vi", "Vietnamese"], ["es", "Spanish"], ["fr", "French"],
      ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"], ["ru", "Russian"],
      ["zh-CN", "Chinese (Simplified)"], ["ja", "Japanese"], ["ko", "Korean"],
      ["th", "Thai"], ["id", "Indonesian"], ["hi", "Hindi"], ["ar", "Arabic"]
    ];

    function fillSelect(sel, includeAuto, selected) {
      if (includeAuto) {
        const o = document.createElement("option");
        o.value = "auto"; o.textContent = "Detect language";
        sel.appendChild(o);
      }
      for (const [code, label] of LANGS) {
        const o = document.createElement("option");
        o.value = code; o.textContent = label;
        sel.appendChild(o);
      }
      sel.value = selected;
    }

    fillSelect($("source"), true, "en");
    fillSelect($("target"), false, "vi");

    function toast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toast._t);
      toast._t = setTimeout(() => toastEl.classList.remove("show"), 1300);
    }

    function setResult(text, cls) {
      const el = $("result");
      el.textContent = text;
      el.className = cls || "";
    }

    async function doTranslate() {
      const q = $("input").value.trim();
      if (!q) { setResult("Translation appears here.", "placeholder"); return; }
      const source = $("source").value;
      const target = $("target").value;
      setResult("Translating…", "placeholder");
      try {
        const res = await window.ani.translate.text(q, source, target);
        setResult(res.text, "");
      } catch (e) {
        setResult("Translation failed — try again, or open in Google ↗.", "error");
      }
    }

    // Enter translates; Shift+Enter inserts a newline.
    $("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doTranslate();
      }
    });
    $("translate").addEventListener("click", doTranslate);

    $("swap").addEventListener("click", () => {
      const s = $("source").value;
      const t = $("target").value;
      // If source is "auto" there's nothing concrete to put on the target side.
      if (s === "auto") { toast("Pick a source language to swap"); return; }
      $("source").value = t;
      $("target").value = s;
      doTranslate();
    });

    $("copy").addEventListener("click", async () => {
      const el = $("result");
      if (el.classList.contains("placeholder") || el.classList.contains("error")) return;
      try {
        await navigator.clipboard.writeText(el.textContent);
        toast("Copied");
      } catch (e) {
        toast("Copy failed");
      }
    });

    $("open").addEventListener("click", () => {
      const q = $("input").value.trim();
      if (!q) { toast("Type something first"); return; }
      window.ani.translate.openWeb(q, $("source").value, $("target").value);
    });

    $("input").focus();
  </script>
</body>
</html>
```

- [ ] **Step 3: Write the plugin README**

Create `plugins/translate/README.md`:

```markdown
# Quick Translate

Type text, press Enter, see the translation inline. Or hit **Open in Google ↗**
to continue in Google Translate. Launch with the global hotkey
`Cmd/Ctrl+Shift+T` (rebindable in Settings → Plugins).

## How it works

- The UI talks to the host only through `window.ani.translate`:
  - `text(q, source, target)` → `{ text, detectedSource }` — the host calls
    Google's free endpoint server-side (no CORS issues) and returns the result.
  - `openWeb(q, source, target)` → opens `translate.google.com` pre-filled.
- Source defaults to English (with a "Detect language" option); target defaults
  to Vietnamese. Languages are a curated set bundled in `index.html`.

## Capabilities

`window`, `translate`.

## Note

The inline translation uses Google's free, **unofficial** endpoint. It works
well for personal use but can rate-limit; when a translation fails, the
**Open in Google ↗** button still works.
```

- [ ] **Step 4: Commit**

```bash
git add plugins/translate/manifest.json plugins/translate/index.html plugins/translate/README.md
git commit -m "feat(plugin): add Quick Translate plugin package"
```

---

## Task 6: Build the installable zip + update the plugins index

**Files:**
- Create: `plugins/translate.zip`
- Modify: `plugins/README.md` (available-plugins table)

- [ ] **Step 1: Build the zip**

The zip must contain the plugin files at its root (matching how `clipboard.zip` is laid out — `manifest.json` at top level, not nested under a folder). Run:

```bash
cd plugins/translate && zip -r ../translate.zip manifest.json index.html README.md && cd ../..
```

- [ ] **Step 2: Verify the zip layout matches clipboard.zip**

Run: `unzip -l plugins/translate.zip && echo '--- clipboard for comparison ---' && unzip -l plugins/clipboard.zip`
Expected: `manifest.json`, `index.html`, `README.md` listed at the archive root (no leading `translate/` path component), mirroring `clipboard.zip`.

- [ ] **Step 3: Add a row to the plugins table**

In `plugins/README.md`, find the "## Available plugins" table and add a row under the clipboard row:

```markdown
| [`translate`](./translate) | Quick text translation — type, Enter, get the result, or open it in Google Translate |
```

- [ ] **Step 4: Commit**

```bash
git add plugins/translate.zip plugins/README.md
git commit -m "feat(plugin): ship Quick Translate zip + list it in plugins README"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend type-check + tests**

Run: `cd src-tauri && cargo check && cargo test --lib plugin`
Expected: compiles clean; all `plugin::*` tests PASS (including `plugin::translate::*`, `plugin::manifest::*`, `plugin::runtime::*`).

- [ ] **Step 2: Frontend type-check (sanity — no TS changed, but confirm nothing broke)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test (requires a dev run)**

Run: `bun run tauri dev`
Then:
1. Open Settings → Plugins → **Install…** → choose `plugins/translate.zip`. Confirm the card appears and the plugin is enabled.
2. Press `Cmd/Ctrl+Shift+T`. A ~420×520 window opens with the language bar (English ⇄ Vietnamese), an empty focused input, and the result/actions.
3. Type `hello`, press Enter → result pane shows the Vietnamese translation.
4. Click **Open in Google ↗** → browser opens `translate.google.com` with `hello` pre-filled, English→Vietnamese.
5. Click **Copy** on a result → paste elsewhere to confirm.
6. Disconnect network, translate again → result shows the failure message; **Open in Google ↗** still works.

Expected: all six behave as described. (This step is manual; there is no automated coverage for the plugin WebView UI — the React/Playwright harness does not run plugin webviews.)

- [ ] **Step 4: Final commit (only if any fixes were needed)**

```bash
git add -A
git commit -m "fix(plugin): address Quick Translate smoke-test findings"
```

---

## Notes for the implementer

- **No new dependencies.** `ureq` 3, `urlencoding` 2, `serde`/`serde_json` are already in `src-tauri/Cargo.toml`.
- **`ureq` v3 API:** use `ureq::get(&url).header(...).call()` then `response.body_mut().read_json::<serde_json::Value>()` — see `src-tauri/src/updater.rs:147` for the exact pattern. Non-2xx responses return `Err` from `.call()` in v3, so rate-limits surface as the failure message automatically.
- **Security model unchanged:** all calls go through `plugin_call`, which derives the plugin id from the window label. The `translate` capability is gated by the existing `capability_allowed` check — no new `#[tauri::command]` is added.
- **Copy:** uses `navigator.clipboard.writeText`. If it turns out to be blocked from the `plugin://` origin during the smoke test (Step 3.5 fails with a permission error), the fallback is to add `"clipboard"` to the manifest `capabilities` and call `window.ani.clipboard.copy(...)` instead — note this would activate the OS clipboard-history monitor while the plugin is enabled.
- **Release:** these backend changes ship in the next app release — follow the 4-file version-bump checklist in `CLAUDE.md` when cutting it. The plugin itself versions independently (`0.1.0`).
