# Spotify Integration — Faithful Port from v2

**Date:** 2026-05-06
**Branch:** `feat/spotify-support`
**Source:** `/Users/linh/Projects/v2/ani-mime/` (working implementation)
**Approach:** 1:1 faithful port — same architecture, same UX, same API surface

## Overview

Port the complete Spotify integration from v2/ani-mime to the current project. The feature lets users control Spotify playback from an inline dropdown panel under the mascot, with OAuth PKCE authentication configured in Settings.

## Architecture

```
Browser OAuth → redirect → HTTP :1234/spotify/callback → exchange_code() → tokens in settings.json
                                                                              ↓
StatusPill button click → SpotifyPlayerApp → useSpotify() → invoke("spotify_state") → spotify.rs → Spotify Web API
                                                          → invoke("spotify_play/pause/next/prev/seek")
```

## Components to Port

### Backend (Rust)

| File | Action | Source |
|------|--------|--------|
| `src-tauri/src/spotify.rs` | **Create** — 435 lines. PKCE auth, token mgmt, all API calls (get_state, play, pause, next, previous, seek, get_queue) | v2 `spotify.rs` |
| `src-tauri/src/lib.rs` | **Modify** — add `mod spotify;`, 10 Tauri commands, `spotify_settings_path()` helper, register in `generate_handler![]` | v2 lines 159–255, 613 |
| `src-tauri/src/server.rs` | **Modify** — add `/spotify/callback` route handler (~55 lines) | v2 lines 748–802 |
| `src-tauri/Cargo.toml` | **Modify** — add `sha2`, `base64`, `rand`, `urlencoding` deps | v2 lines 39–41 |

### Frontend (React + TypeScript)

| File | Action | Source |
|------|--------|--------|
| `src/hooks/useSpotify.ts` | **Create** — 280 lines. `useSpotify()` (polling + controls) + `useSpotifyConnected()` (read-only status) | v2 `useSpotify.ts` |
| `src/SpotifyPlayerApp.tsx` | **Create** — 160 lines. Player UI: album art, scrubber, controls, up-next card, reauth state | v2 `SpotifyPlayerApp.tsx` |
| `src/spotify-player-main.tsx` | **Create** — 10 lines. React entry point for standalone page | v2 |
| `src/styles/spotify-player.css` | **Create** — 283 lines. All player styling | v2 |

### Integration Points (Modify Existing)

| File | Changes |
|------|---------|
| `src/components/StatusPill.tsx` | Add Spotify button (SVG icon), panel state, dropdown rendering, `useSpotifyConnected()` import |
| `src/components/Settings.tsx` | Add "spotify" tab with Client ID input, Connect/Disconnect buttons, status display |
| `src/App.tsx` | Add `spotifyOpen`/`spotifyClosing` state, window height grow/shrink effect (450px), prop callbacks |

### Config & Docs

| File | Changes |
|------|---------|
| `vite.config.ts` | Add `"spotify-player"` entry point |
| `spotify-player.html` | **Create** — 14 lines. Standalone HTML template |
| `docs/SPOTIFY_SETUP.md` | **Create** — 56 lines. User-facing setup guide |

## Key Design Decisions (from v2, preserved)

1. **PKCE OAuth** — no client secret needed, state + code_verifier prevent CSRF
2. **Token persistence** — saved directly to settings.json (bypasses tauri-plugin-store cache race)
3. **Polling at 2.5s** — with local interpolation for smooth scrubber movement
4. **Auto-refresh on 401** — single retry, clears tokens on 400 (dead refresh token)
5. **Inline panel** — fixed-position dropdown inside main window (moves with drag, no separate WebviewWindow)
6. **Height-only window grow** — 450px when panel open, shrink back on close (no horizontal shift)
7. **Premium required** — Free accounts can read state but not control playback (API limitation)

## Spotify API Surface

- **Auth**: `https://accounts.spotify.com/authorize` (PKCE) + `/api/token`
- **Redirect**: `http://127.0.0.1:1234/spotify/callback`
- **Scopes**: `user-read-playback-state user-modify-playback-state user-read-currently-playing`
- **Endpoints**: `/me/player`, `/me/player/play`, `/me/player/pause`, `/me/player/next`, `/me/player/previous`, `/me/player/seek`, `/me/player/queue`

## Settings Keys

- `spotifyClientId` — user's Spotify app client ID
- `spotifyAccessToken` — OAuth access token
- `spotifyRefreshToken` — OAuth refresh token
- `spotifyExpiresAt` — token expiry timestamp (epoch seconds)

## Tauri Commands

```
spotify_connect(client_id) → Result<String>     // Returns auth URL, opens browser
spotify_disconnect(app)    → Result<()>          // Clears tokens, emits event
spotify_status(app)        → Result<Value>       // { connected, client_id }
spotify_state(app)         → Result<Value>       // Full playback state
spotify_queue(app)         → Result<Value>       // { queue: [...] }
spotify_play(app)          → Result<()>
spotify_pause(app)         → Result<()>
spotify_next(app)          → Result<()>
spotify_prev(app)          → Result<()>
spotify_seek(position_ms)  → Result<()>
```

## Tauri Events

- `spotify-connected` — emitted after successful token exchange or disconnect
- `spotify-client-changed` — emitted when client ID is saved in Settings

## Testing Considerations

- All interactive elements get `data-testid` attributes (per project conventions)
- Player component uses semantic HTML (`<button>`, `<input type="range">`)
- ARIA labels on icon-only buttons
