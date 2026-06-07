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
