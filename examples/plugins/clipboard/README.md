# Clipboard Manager — example plugin

A minimal Ani-Mime plugin that demonstrates the `window.ani` SDK: it saves
snippets of copied text and pastes them back with one click. Two files, no
build step.

## What it shows

- **`window.ani.storage`** — the snippet history is persisted to
  `~/.ani-mime/plugins/clipboard/data/store.json`.
- **Browser Clipboard API** — `navigator.clipboard.readText()` on "Save current
  clipboard", `navigator.clipboard.writeText()` on "Copy". (The host SDK has no
  clipboard capability yet — background capture of every copy needs a native
  capability planned for a later slice. This plugin captures on demand instead.)
- **Plugin manifest** — declares `window` + `storage` capabilities, a window
  size, and a `hotkey` (the hotkey is metadata until the global-shortcut slice
  lands; launch from Settings → Plugins → Launch for now).

## Files

```
clipboard/
├── manifest.json   # id, capabilities, window config
└── index.html      # self-contained UI + logic (uses window.ani)
```

## Install

**Option A — drop in the plugins folder** (picked up on next launch):

```bash
cp -R examples/plugins/clipboard ~/.ani-mime/plugins/clipboard
```

**Option B — zip and use Settings → Plugins → "Install…"**:

```bash
cd examples/plugins/clipboard
zip -r ../clipboard.zip manifest.json index.html
# then pick clipboard.zip in the installer
```

Then open Settings → **Plugins** → **Launch** on "Clipboard Manager".

## Notes

- `navigator.clipboard.readText()` may be blocked by the WebView if the window
  isn't focused or permission is denied; the UI falls back to a paste box.
- History is capped at 100 entries; consecutive duplicates are skipped.
