# Clipboard Manager

A system clipboard-history plugin: it shows your last 20 copies (from any app)
and pastes any of them back with one click. Two files, no build step.

## What it shows

- **`window.ani.clipboard`** — the new native clipboard capability. The host
  runs a background monitor that captures every OS copy (deduped, newest-first,
  capped at 20) while this plugin is enabled, and persists it to
  `~/.ani-mime/clipboard-history.json`. The plugin reads it with
  `clipboard.history()`, writes back with `clipboard.copy(text)`, and prunes
  with `clipboard.remove(text)` / `clipboard.clear()`.
- **Live polling** — the UI polls `clipboard.history()` (~1s) while open, so new
  copies appear without any action.
- **Plugin manifest** — declares `window` + `clipboard` capabilities, a window
  size, and a `hotkey` (the hotkey is metadata until the global-shortcut slice
  lands; launch from Settings → Plugins → Launch for now).

> **Capture only runs while this plugin is enabled.** Disable or uninstall it and
> the host stops watching the clipboard.
>
> **Privacy:** capture is indiscriminate plain text — it can't detect macOS
> "concealed" clipboard types, so password-manager copies may land in history.
> History is stored unencrypted in `~/.ani-mime/clipboard-history.json`.

## Files

```
clipboard/
├── manifest.json   # id, capabilities, window config
└── index.html      # self-contained UI + logic (uses window.ani)
```

## Install

**Option A — drop in the plugins folder** (picked up on next launch):

```bash
cp -R plugins/clipboard ~/.ani-mime/plugins/clipboard
```

**Option B — zip and use Settings → Plugins → "Install…"**:

```bash
cd plugins/clipboard
zip -r ../clipboard.zip manifest.json index.html
# then pick clipboard.zip in the installer
```

Then open Settings → **Plugins** → **Launch** on "Clipboard Manager".

## Notes

- History is capped at 20 entries; re-copying an existing item moves it to the
  top (global dedup), and the oldest is dropped past 20.
- The monitor polls every ~800ms, so a copy appears within ~1–2s.
