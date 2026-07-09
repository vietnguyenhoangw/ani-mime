# Spotify Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the complete Spotify playback integration from v2/ani-mime — OAuth PKCE auth, inline player panel with controls, Settings tab — to the current project.

**Architecture:** Backend (Rust) handles OAuth PKCE flow and proxies all Spotify Web API calls. Frontend polls playback state via Tauri commands, renders an inline dropdown player panel from StatusPill, and manages auth via a Settings tab. Tokens persist in settings.json.

**Tech Stack:** Rust (ureq, sha2, base64, rand), React 19 (hooks, functional components), Tauri 2 commands + events, CSS custom properties

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src-tauri/src/spotify.rs` | PKCE auth, token persistence, all Spotify API calls |
| Create | `src/hooks/useSpotify.ts` | Polling hook + read-only status hook |
| Create | `src/SpotifyPlayerApp.tsx` | Player UI component |
| Create | `src/spotify-player-main.tsx` | React entry point for standalone page |
| Create | `src/styles/spotify-player.css` | Player styling |
| Create | `spotify-player.html` | HTML template for standalone entry |
| Create | `docs/SPOTIFY_SETUP.md` | User-facing setup guide |
| Modify | `src-tauri/Cargo.toml` | Add sha2, base64, rand deps |
| Modify | `src-tauri/src/lib.rs` | Add mod, 10 commands, register in handler |
| Modify | `src-tauri/src/server.rs` | Add `/spotify/callback` route |
| Modify | `vite.config.ts` | Add spotify-player entry |
| Modify | `src/components/Settings.tsx` | Add Spotify tab |
| Modify | `src/components/StatusPill.tsx` | Add Spotify button + panel |
| Modify | `src/App.tsx` | Add Spotify panel window management |

---

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml:38`

- [ ] **Step 1: Add sha2, base64, rand to Cargo.toml**

After line 38 (`urlencoding = "2"`), add:

```toml
sha2 = "0.10"
base64 = "0.22"
rand = "0.8"
```

- [ ] **Step 2: Verify deps resolve**

Run: `cd src-tauri && cargo check 2>&1 | head -5`
Expected: compilation begins (deps download), no immediate errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(spotify): add sha2, base64, rand dependencies for PKCE auth"
```

---

### Task 2: Create spotify.rs — Backend Module

**Files:**
- Create: `src-tauri/src/spotify.rs`
- Reference: `/Users/linh/Projects/v2/ani-mime/src-tauri/src/spotify.rs`

- [ ] **Step 1: Create the spotify.rs file**

Copy the full module from v2. This file is self-contained (435 lines). It contains:
- `SpotifyConfig` struct + `load_config()` / `save_tokens()` / `clear_tokens()`
- `PendingAuth` + `PENDING_AUTH` static mutex
- `build_auth_url()` — PKCE authorize URL builder
- `exchange_code()` — auth code → token exchange
- `refresh_access_token()` — token refresh with dead-token cleanup
- `ensure_fresh()` — lazy refresh wrapper
- `api_call()` — generic Spotify API caller with 401 retry
- `get_state()`, `play()`, `pause()`, `next()`, `previous()`, `get_queue()`, `seek()`

```rust
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const REDIRECT_URI: &str = "http://127.0.0.1:1234/spotify/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing";

const KEY_CLIENT_ID: &str = "spotifyClientId";
const KEY_ACCESS: &str = "spotifyAccessToken";
const KEY_REFRESH: &str = "spotifyRefreshToken";
const KEY_EXPIRES_AT: &str = "spotifyExpiresAt";

#[derive(Debug, Clone)]
pub struct PendingAuth {
    pub state: String,
    pub code_verifier: String,
    pub client_id: String,
}

pub static PENDING_AUTH: Mutex<Option<PendingAuth>> = Mutex::new(None);

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SpotifyConfig {
    pub client_id: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
}

impl SpotifyConfig {
    pub fn is_connected(&self) -> bool {
        !self.access_token.is_empty() && !self.refresh_token.is_empty()
    }
    pub fn is_expired(&self, now: u64) -> bool {
        self.expires_at <= now.saturating_add(30)
    }
}

pub fn load_config(store_path: &Path) -> SpotifyConfig {
    let raw = match std::fs::read_to_string(store_path) {
        Ok(c) => c,
        Err(_) => return SpotifyConfig::default(),
    };
    let json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return SpotifyConfig::default(),
    };
    SpotifyConfig {
        client_id: json.get(KEY_CLIENT_ID).and_then(|v| v.as_str()).unwrap_or("").to_string(),
        access_token: json.get(KEY_ACCESS).and_then(|v| v.as_str()).unwrap_or("").to_string(),
        refresh_token: json.get(KEY_REFRESH).and_then(|v| v.as_str()).unwrap_or("").to_string(),
        expires_at: json.get(KEY_EXPIRES_AT).and_then(|v| v.as_u64()).unwrap_or(0),
    }
}

pub fn save_tokens(
    store_path: &Path,
    access_token: &str,
    refresh_token: &str,
    expires_at: u64,
) -> Result<(), String> {
    let mut json: serde_json::Value = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !json.is_object() {
        json = serde_json::json!({});
    }
    let map = json.as_object_mut().unwrap();
    map.insert(KEY_ACCESS.into(), serde_json::Value::String(access_token.into()));
    map.insert(KEY_REFRESH.into(), serde_json::Value::String(refresh_token.into()));
    map.insert(KEY_EXPIRES_AT.into(), serde_json::Value::Number(expires_at.into()));

    if let Some(parent) = store_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(store_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to write settings.json: {}", e))
}

pub fn clear_tokens(store_path: &Path) -> Result<(), String> {
    let mut json: serde_json::Value = std::fs::read_to_string(store_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if let Some(map) = json.as_object_mut() {
        map.remove(KEY_ACCESS);
        map.remove(KEY_REFRESH);
        map.remove(KEY_EXPIRES_AT);
    }
    std::fs::write(store_path, serde_json::to_string_pretty(&json).unwrap())
        .map_err(|e| format!("Failed to write settings.json: {}", e))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_url_safe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

pub fn build_auth_url(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("Client ID is empty — paste it in Settings → Spotify first.".into());
    }

    let code_verifier = random_url_safe(64);
    let code_challenge = pkce_challenge(&code_verifier);
    let state = random_url_safe(24);

    *PENDING_AUTH.lock().unwrap() = Some(PendingAuth {
        state: state.clone(),
        code_verifier: code_verifier.clone(),
        client_id: client_id.into(),
    });

    let url = format!(
        "https://accounts.spotify.com/authorize?\
client_id={cid}\
&response_type=code\
&redirect_uri={ru}\
&code_challenge_method=S256\
&code_challenge={cc}\
&state={st}\
&scope={sc}",
        cid = urlencoding::encode(client_id),
        ru = urlencoding::encode(REDIRECT_URI),
        cc = code_challenge,
        st = state,
        sc = urlencoding::encode(SCOPES),
    );
    Ok(url)
}

pub fn exchange_code(
    store_path: &Path,
    code: &str,
    state: &str,
) -> Result<(), String> {
    let pending = PENDING_AUTH
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No pending Spotify auth. Click Connect Spotify first.".to_string())?;

    if pending.state != state {
        return Err("State mismatch — possible CSRF, aborting.".into());
    }

    let body = format!(
        "grant_type=authorization_code&code={code}&redirect_uri={ru}&client_id={cid}&code_verifier={cv}",
        code = urlencoding::encode(code),
        ru = urlencoding::encode(REDIRECT_URI),
        cid = urlencoding::encode(&pending.client_id),
        cv = urlencoding::encode(&pending.code_verifier),
    );

    let mut response = ureq::post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(body)
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = response.status().as_u16();
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Bad token response: {}", e))?;

    if status / 100 != 2 {
        let desc = json
            .get("error_description")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("Spotify token error ({}): {}", status, desc));
    }

    let access = json.get("access_token").and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in response".to_string())?;
    let refresh = json.get("refresh_token").and_then(|v| v.as_str())
        .ok_or_else(|| "No refresh_token in response".to_string())?;
    let expires_in = json.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600);
    let expires_at = now_secs() + expires_in;

    save_tokens(store_path, access, refresh, expires_at)?;
    *PENDING_AUTH.lock().unwrap() = None;
    Ok(())
}

fn refresh_access_token(store_path: &Path, cfg: &SpotifyConfig) -> Result<SpotifyConfig, String> {
    if cfg.client_id.is_empty() {
        return Err("Spotify not configured (no client_id)".into());
    }
    if cfg.refresh_token.is_empty() {
        return Err("No refresh token — reconnect Spotify in Settings.".into());
    }
    let body = format!(
        "grant_type=refresh_token&refresh_token={rt}&client_id={cid}",
        rt = urlencoding::encode(&cfg.refresh_token),
        cid = urlencoding::encode(&cfg.client_id),
    );
    let mut response = match ureq::post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(body)
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("400") {
                let _ = clear_tokens(store_path);
            }
            return Err(format!("Refresh request failed: {}", msg));
        }
    };

    let status = response.status().as_u16();
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("Bad refresh response: {}", e))?;

    if status / 100 != 2 {
        let desc = json
            .get("error_description")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        if status == 400 {
            let _ = clear_tokens(store_path);
        }
        return Err(format!("Spotify refresh error ({}): {}", status, desc));
    }

    let access = json.get("access_token").and_then(|v| v.as_str())
        .ok_or_else(|| "No access_token in refresh response".to_string())?
        .to_string();
    let refresh = json.get("refresh_token").and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| cfg.refresh_token.clone());
    let expires_in = json.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(3600);
    let expires_at = now_secs() + expires_in;

    save_tokens(store_path, &access, &refresh, expires_at)?;
    Ok(SpotifyConfig {
        client_id: cfg.client_id.clone(),
        access_token: access,
        refresh_token: refresh,
        expires_at,
    })
}

fn ensure_fresh(store_path: &Path) -> Result<SpotifyConfig, String> {
    let cfg = load_config(store_path);
    if !cfg.is_connected() {
        return Err("Not connected to Spotify".into());
    }
    if cfg.is_expired(now_secs()) {
        return refresh_access_token(store_path, &cfg);
    }
    Ok(cfg)
}

fn api_call(
    store_path: &Path,
    method: &str,
    path: &str,
) -> Result<(u16, serde_json::Value), String> {
    let cfg = ensure_fresh(store_path)?;
    let url = format!("https://api.spotify.com/v1{}", path);

    let do_req = |token: &str| -> Result<(u16, serde_json::Value), String> {
        let auth = format!("Bearer {}", token);
        let resp = match method {
            "GET" => ureq::get(&url).header("Authorization", &auth).call(),
            "PUT" => ureq::put(&url).header("Authorization", &auth).header("Content-Length", "0").send(""),
            "POST" => ureq::post(&url).header("Authorization", &auth).header("Content-Length", "0").send(""),
            _ => return Err(format!("Unsupported method: {}", method)),
        };
        let mut resp = resp.map_err(|e| format!("HTTP error: {}", e))?;
        let status = resp.status().as_u16();
        let json: serde_json::Value = if status == 204 {
            serde_json::Value::Null
        } else {
            resp.body_mut().read_json().unwrap_or(serde_json::Value::Null)
        };
        Ok((status, json))
    };

    let (status, json) = do_req(&cfg.access_token)?;
    if status != 401 {
        return Ok((status, json));
    }

    crate::app_log!("[spotify] 401 on {} {}, refreshing token", method, path);
    let cfg2 = refresh_access_token(store_path, &cfg)?;
    do_req(&cfg2.access_token)
}

pub fn get_state(store_path: &Path) -> Result<serde_json::Value, String> {
    let (status, json) = api_call(store_path, "GET", "/me/player")?;
    if status == 204 {
        return Ok(serde_json::json!({ "playing": false, "no_device": true }));
    }
    if status / 100 != 2 {
        return Err(format!("Spotify state error ({}): {}", status, json));
    }
    Ok(json)
}

pub fn play(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "PUT", "/me/player/play")?;
    if status / 100 != 2 {
        return Err(format!("Spotify play error ({}): {}", status, json));
    }
    Ok(())
}

pub fn pause(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "PUT", "/me/player/pause")?;
    if status / 100 != 2 {
        return Err(format!("Spotify pause error ({}): {}", status, json));
    }
    Ok(())
}

pub fn next(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "POST", "/me/player/next")?;
    if status / 100 != 2 {
        return Err(format!("Spotify next error ({}): {}", status, json));
    }
    Ok(())
}

pub fn previous(store_path: &Path) -> Result<(), String> {
    let (status, json) = api_call(store_path, "POST", "/me/player/previous")?;
    if status / 100 != 2 {
        return Err(format!("Spotify previous error ({}): {}", status, json));
    }
    Ok(())
}

pub fn get_queue(store_path: &Path) -> Result<serde_json::Value, String> {
    let (status, json) = api_call(store_path, "GET", "/me/player/queue")?;
    if status == 204 {
        return Ok(serde_json::json!({ "queue": [] }));
    }
    if status / 100 != 2 {
        return Err(format!("Spotify queue error ({}): {}", status, json));
    }
    Ok(json)
}

pub fn seek(store_path: &Path, position_ms: u64) -> Result<(), String> {
    let path = format!("/me/player/seek?position_ms={}", position_ms);
    let (status, json) = api_call(store_path, "PUT", &path)?;
    if status / 100 != 2 {
        return Err(format!("Spotify seek error ({}): {}", status, json));
    }
    Ok(())
}
```

- [ ] **Step 2: Verify file compiles in isolation**

Run: `cd src-tauri && cargo check 2>&1 | tail -3`
Expected: Will show "unused module" warnings (not registered yet), but no compilation errors in spotify.rs itself. If there are errors about `app_log!`, that's expected — it gets resolved in Task 3 when we add `mod spotify;`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/spotify.rs
git commit -m "feat(spotify): add Spotify PKCE auth and API module"
```

---

### Task 3: Register Spotify Module and Tauri Commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:5-18` (mod declarations), `:38-412` (commands), `:438` (handler)

- [ ] **Step 1: Add mod declaration**

After line 14 (`mod server;`), add:

```rust
mod spotify;
```

- [ ] **Step 2: Add the settings path helper and all 10 Spotify commands**

After the last `#[tauri::command]` function (the `start_visit` command ending around line 412), add:

```rust
fn spotify_settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
async fn spotify_connect(client_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || spotify::build_auth_url(&client_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::clear_tokens(&path))
        .await
        .map_err(|e| e.to_string())??;
    let _ = app.emit("spotify-connected", false);
    Ok(())
}

#[tauri::command]
async fn spotify_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cfg = spotify::load_config(&path);
        serde_json::json!({
            "connected": cfg.is_connected(),
            "client_id": cfg.client_id,
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn spotify_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::get_state(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_play(app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::play(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_pause(app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::pause(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_next(app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::next(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_prev(app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::previous(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_queue(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::get_queue(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn spotify_seek(position_ms: u64, app: tauri::AppHandle) -> Result<(), String> {
    let path = spotify_settings_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || spotify::seek(&path, position_ms))
        .await
        .map_err(|e| e.to_string())?
}
```

- [ ] **Step 3: Register commands in generate_handler**

At line 438, add the Spotify commands to the `generate_handler![]` macro. The existing list ends with `claude_config::delete_hook_entry`. Append:

```
, spotify_connect, spotify_disconnect, spotify_status, spotify_state, spotify_queue, spotify_play, spotify_pause, spotify_next, spotify_prev, spotify_seek
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: Clean compilation (possibly warnings about unused imports in spotify.rs — that's fine)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(spotify): register Spotify commands in Tauri handler"
```

---

### Task 4: Add /spotify/callback Route to HTTP Server

**Files:**
- Modify: `src-tauri/src/server.rs:487-490`

- [ ] **Step 1: Add the callback route handler**

After the `/debug` handler's `continue;` (line 487) and before the fallback unknown-route handler (line 490), insert:

```rust
            // --- /spotify/callback ---
            if url.starts_with("/spotify/callback") {
                let code = get_query_param(&url, "code");
                let state = get_query_param(&url, "state");
                let error = get_query_param(&url, "error");

                let (html, status_code) = if let Some(err) = error {
                    app_warn!("[spotify] OAuth error: {}", err);
                    (
                        format!(
                            r#"<html><body style="background:#1e1e1e;color:#e74c3c;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><h2>Spotify auth failed: {}</h2><script>setTimeout(()=>window.close(),1500)</script></body></html>"#,
                            err
                        ),
                        400u16,
                    )
                } else if let (Some(code), Some(state)) = (code, state) {
                    let store_path = app.path().app_data_dir().unwrap().join("settings.json");
                    match crate::spotify::exchange_code(&store_path, code, state) {
                        Ok(()) => {
                            let _ = app.emit("spotify-connected", true);
                            app_log!("[spotify] OAuth tokens stored successfully");
                            (
                                r#"<html><body style="background:#1e1e1e;color:#1db954;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><h2>Connected! You can close this tab.</h2><script>setTimeout(()=>window.close(),1500)</script></body></html>"#.to_string(),
                                200u16,
                            )
                        }
                        Err(e) => {
                            app_error!("[spotify] Token exchange failed: {}", e);
                            (
                                format!(
                                    r#"<html><body style="background:#1e1e1e;color:#e74c3c;font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0"><h2>Auth failed: {}</h2><script>setTimeout(()=>window.close(),1500)</script></body></html>"#,
                                    e
                                ),
                                400u16,
                            )
                        }
                    }
                } else {
                    ("Missing code or state".to_string(), 400u16)
                };

                let resp = tiny_http::Response::from_string(html)
                    .with_status_code(status_code)
                    .with_header(cors.clone())
                    .with_header("Content-Type: text/html".parse::<tiny_http::Header>().unwrap());
                let _ = req.respond(resp);
                continue;
            }
```

- [ ] **Step 2: Verify compilation**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: Clean compile

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/server.rs
git commit -m "feat(spotify): add /spotify/callback OAuth route"
```

---

### Task 5: Create useSpotify Hook

**Files:**
- Create: `src/hooks/useSpotify.ts`
- Reference: `/Users/linh/Projects/v2/ani-mime/src/hooks/useSpotify.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SpotifyTrack {
  title: string;
  artist: string;
  artUrl: string | null;
  durationMs: number;
  isPlaying: boolean;
  progressMs: number;
  noDevice: boolean;
}

export interface SpotifyQueueItem {
  title: string;
  artist: string;
  artUrl: string | null;
}

function parseQueueItem(raw: unknown): SpotifyQueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const album = r.album as Record<string, unknown> | undefined;
  const images = (album?.images as Array<{ url: string }> | undefined) ?? [];
  const artists = (r.artists as Array<{ name: string }> | undefined) ?? [];
  return {
    title: (r.name as string) ?? "",
    artist: artists.map((a) => a.name).join(", "),
    artUrl: images[0]?.url ?? null,
  };
}

interface SpotifyStatus {
  connected: boolean;
  client_id: string;
}

const EVENT_CONNECTED = "spotify-connected";
const EVENT_CLIENT_CHANGED = "spotify-client-changed";

function isAuthError(err: string): boolean {
  const lower = err.toLowerCase();
  return (
    lower.includes("not connected") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh error") ||
    lower.includes("refresh request failed") ||
    lower.includes("no refresh token") ||
    lower.includes("no client_id") ||
    lower.includes("reconnect")
  );
}

function parseState(raw: unknown): SpotifyTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.no_device) {
    return {
      title: "",
      artist: "",
      artUrl: null,
      durationMs: 0,
      isPlaying: false,
      progressMs: 0,
      noDevice: true,
    };
  }
  const item = r.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const album = item.album as Record<string, unknown> | undefined;
  const images = (album?.images as Array<{ url: string }> | undefined) ?? [];
  const artists = (item.artists as Array<{ name: string }> | undefined) ?? [];
  return {
    title: (item.name as string) ?? "",
    artist: artists.map((a) => a.name).join(", "),
    artUrl: images[0]?.url ?? null,
    durationMs: (item.duration_ms as number) ?? 0,
    isPlaying: Boolean(r.is_playing),
    progressMs: (r.progress_ms as number) ?? 0,
    noDevice: false,
  };
}

export function useSpotify(active: boolean) {
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [nextUp, setNextUp] = useState<SpotifyQueueItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const authFailedRef = useRef(false);
  const lastFetchRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await invoke<SpotifyStatus>("spotify_status");
        if (!cancelled) setConnected(s.connected);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    void refresh();
    const u = listen<boolean>(EVENT_CONNECTED, () => {
      void refresh();
      setNeedsReauth(false);
      setError(null);
      authFailedRef.current = false;
    });
    return () => {
      cancelled = true;
      u.then((fn) => fn());
    };
  }, []);

  const fetchState = useCallback(async () => {
    if (!connected || authFailedRef.current) return;
    try {
      const raw = await invoke<unknown>("spotify_state");
      lastFetchRef.current = Date.now();
      const parsed = parseState(raw);
      setTrack(parsed);
      setError(null);
    } catch (e) {
      const errStr = String(e);
      setError(errStr);
      if (isAuthError(errStr)) {
        authFailedRef.current = true;
        setConnected(false);
        setNeedsReauth(true);
        return;
      }
    }
    try {
      const q = await invoke<{ queue?: unknown[] }>("spotify_queue");
      const first = q?.queue?.[0];
      setNextUp(first ? parseQueueItem(first) : null);
    } catch {
      setNextUp(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!active || !connected) return;
    void fetchState();
    const id = setInterval(() => void fetchState(), 2500);
    return () => clearInterval(id);
  }, [active, connected, fetchState]);

  useEffect(() => {
    if (!track || !track.isPlaying) return;
    const id = setInterval(() => {
      setTrack((t) => {
        if (!t || !t.isPlaying) return t;
        const elapsed = Date.now() - lastFetchRef.current;
        const next = Math.min(t.durationMs, t.progressMs + 500);
        if (elapsed > 3000) return t;
        return { ...t, progressMs: next };
      });
    }, 500);
    return () => clearInterval(id);
  }, [track]);

  const play = useCallback(async () => {
    try {
      await invoke("spotify_play");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const pause = useCallback(async () => {
    try {
      await invoke("spotify_pause");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const next = useCallback(async () => {
    try {
      await invoke("spotify_next");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const prev = useCallback(async () => {
    try {
      await invoke("spotify_prev");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const seek = useCallback(async (positionMs: number) => {
    try {
      await invoke("spotify_seek", { positionMs });
      setTrack((t) => (t ? { ...t, progressMs: positionMs } : t));
      lastFetchRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const reconnect = useCallback(async () => {
    try {
      const s = await invoke<SpotifyStatus>("spotify_status");
      if (!s.client_id) {
        setError("No Client ID configured. Set it in Settings → Spotify.");
        return;
      }
      await invoke<string>("spotify_connect", { clientId: s.client_id });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { track, nextUp, connected, needsReauth, error, play, pause, next, prev, seek, reconnect };
}

export function useSpotifyConnected() {
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await invoke<SpotifyStatus>("spotify_status");
        if (!cancelled) {
          setConnected(s.connected);
          setClientId(s.client_id ?? "");
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
        }
      }
    };
    void refresh();
    const u1 = listen<boolean>(EVENT_CONNECTED, () => void refresh());
    const u2 = listen<string>(EVENT_CLIENT_CHANGED, (ev) => setClientId(ev.payload));
    return () => {
      cancelled = true;
      u1.then((fn) => fn());
      u2.then((fn) => fn());
    };
  }, []);

  return { connected, clientId };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -i spotify | head -10`
Expected: No errors in useSpotify.ts (may show errors for not-yet-created files)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSpotify.ts
git commit -m "feat(spotify): add useSpotify and useSpotifyConnected hooks"
```

---

### Task 6: Create Spotify Player CSS

**Files:**
- Create: `src/styles/spotify-player.css`
- Reference: `/Users/linh/Projects/v2/ani-mime/src/styles/spotify-player.css`

- [ ] **Step 1: Create the CSS file**

```css
.spotify-shell {
  padding: 10px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  justify-content: stretch;
}

.spotify-root {
  background: var(--surface, #1e1e1e);
  color: var(--text, #fff);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 12px;
}

.spotify-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-muted, #888);
  font-size: 12px;
  text-align: center;
  padding: 12px;
}

.spotify-track {
  display: flex;
  gap: 10px;
  align-items: center;
}

.spotify-art {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: #2a2a2a;
  flex-shrink: 0;
  object-fit: cover;
}

.spotify-art-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: linear-gradient(135deg, #1db954, #136a30);
  flex-shrink: 0;
}

.spotify-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.spotify-title {
  font-weight: 600;
  font-size: 13px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  line-height: 1.3;
}

.spotify-artist {
  font-size: 11px;
  color: var(--text-muted, #aaa);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  line-height: 1.3;
}

.spotify-progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spotify-time {
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: var(--text-muted, #888);
  width: 32px;
  text-align: center;
}

.spotify-progress {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  height: 16px;
  cursor: pointer;
  margin: 0;
}

.spotify-progress::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(
    to right,
    #1db954 0%,
    #1db954 var(--pct, 0%),
    rgba(255, 255, 255, 0.18) var(--pct, 0%),
    rgba(255, 255, 255, 0.18) 100%
  );
}

.spotify-progress::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  margin-top: -4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}

.spotify-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
}

.spotify-btn {
  background: transparent;
  border: none;
  color: var(--text, #fff);
  cursor: pointer;
  padding: 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease;
}

.spotify-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.spotify-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.spotify-btn.play {
  background: #1db954;
  width: 32px;
  height: 32px;
}

.spotify-btn.play:hover:not(:disabled) {
  background: #1ed760;
}

.spotify-btn.play svg {
  fill: #000;
}

.spotify-up-next {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
  transition: background 0.12s ease;
}

.spotify-up-next:hover {
  background: rgba(255, 255, 255, 0.08);
}

.spotify-up-next-art {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.spotify-up-next-art.placeholder {
  background: linear-gradient(135deg, #1db954, #136a30);
}

.spotify-up-next-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.2;
}

.spotify-up-next-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-muted, #888);
}

.spotify-up-next-title {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotify-up-next-artist {
  font-size: 10px;
  color: var(--text-muted, #aaa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spotify-up-next-skip {
  flex-shrink: 0;
  color: var(--text-muted, #888);
}

.spotify-up-next:hover .spotify-up-next-skip {
  color: var(--text, #fff);
}

.spotify-reauth {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
}

.spotify-reauth-msg {
  font-size: 12px;
  color: var(--text-muted, #aaa);
  line-height: 1.4;
}

.spotify-reauth-btn {
  background: #1db954;
  color: #000;
  border: none;
  border-radius: 16px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}

.spotify-reauth-btn:hover {
  background: #1ed760;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/spotify-player.css
git commit -m "feat(spotify): add Spotify player styles"
```

---

### Task 7: Create SpotifyPlayerApp Component

**Files:**
- Create: `src/SpotifyPlayerApp.tsx`
- Reference: `/Users/linh/Projects/v2/ani-mime/src/SpotifyPlayerApp.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useRef, useState } from "react";
import { useSpotify } from "./hooks/useSpotify";
import { useTheme } from "./hooks/useTheme";
import "./styles/theme.css";
import "./styles/spotify-player.css";

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpotifyPlayerApp() {
  useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const { track, nextUp, connected, needsReauth, error, play, pause, next, prev, seek, reconnect } = useSpotify(true);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const renderEmpty = (msg: string) => (
    <div className="spotify-shell">
      <div className="spotify-root">
        <div className="spotify-empty" data-testid="spotify-empty">{msg}</div>
      </div>
    </div>
  );

  if (!connected && needsReauth) {
    return (
      <div className="spotify-shell">
        <div className="spotify-root">
          <div className="spotify-reauth" data-testid="spotify-reauth">
            <span className="spotify-reauth-msg">Spotify session expired. Log in again to continue.</span>
            <button
              type="button"
              className="spotify-reauth-btn"
              data-testid="spotify-reconnect-btn"
              onClick={() => void reconnect()}
            >
              Reconnect
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!connected) return renderEmpty("Connect Spotify in Settings.");
  if (error && !track) return renderEmpty(error);
  if (!track) return renderEmpty("Loading...");
  if (track.noDevice) return renderEmpty("No active Spotify device. Open Spotify on any device, start a track, then come back.");

  const displayProgress = scrubbing ?? track.progressMs;
  const pct = track.durationMs > 0 ? (displayProgress / track.durationMs) * 100 : 0;

  return (
    <div ref={rootRef} className="spotify-shell">
      <div className="spotify-root" data-testid="spotify-player-root">
        <div className="spotify-track">
          {track.artUrl ? (
            <img src={track.artUrl} alt="" className="spotify-art" />
          ) : (
            <div className="spotify-art-placeholder" />
          )}
          <div className="spotify-meta">
            <span className="spotify-title" data-testid="spotify-title">{track.title || "Nothing playing"}</span>
            <span className="spotify-artist" data-testid="spotify-artist">{track.artist}</span>
          </div>
        </div>

        <div className="spotify-progress-row">
          <span className="spotify-time" data-testid="spotify-elapsed">{fmtTime(displayProgress)}</span>
          <input
            type="range"
            className="spotify-progress"
            min={0}
            max={track.durationMs || 1}
            value={displayProgress}
            data-testid="spotify-progress"
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onMouseDown={() => setScrubbing(track.progressMs)}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setScrubbing(null);
              void seek(v);
            }}
            onTouchEnd={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setScrubbing(null);
              void seek(v);
            }}
          />
          <span className="spotify-time" data-testid="spotify-duration">{fmtTime(track.durationMs)}</span>
        </div>

        <div className="spotify-controls">
          <button
            type="button"
            className="spotify-btn"
            data-testid="spotify-prev"
            aria-label="Previous track"
            onClick={() => void prev()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>

          <button
            type="button"
            className="spotify-btn play"
            data-testid="spotify-play-pause"
            aria-label={track.isPlaying ? "Pause" : "Play"}
            onClick={() => void (track.isPlaying ? pause() : play())}
          >
            {track.isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>

          <button
            type="button"
            className="spotify-btn"
            data-testid="spotify-next"
            aria-label="Next track"
            onClick={() => void next()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2 6L5.5 6v12z"/></svg>
          </button>
        </div>

        {nextUp && (
          <button
            type="button"
            className="spotify-up-next"
            data-testid="spotify-up-next"
            onClick={() => void next()}
            title="Skip to next track"
          >
            {nextUp.artUrl ? (
              <img src={nextUp.artUrl} alt="" className="spotify-up-next-art" />
            ) : (
              <span className="spotify-up-next-art placeholder" />
            )}
            <span className="spotify-up-next-meta">
              <span className="spotify-up-next-label">Up next</span>
              <span className="spotify-up-next-title">{nextUp.title}</span>
              <span className="spotify-up-next-artist">{nextUp.artist}</span>
            </span>
            <svg className="spotify-up-next-skip" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 6h2v12h-2zm-2 6L5.5 6v12z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit 2>&1 | grep SpotifyPlayerApp`
Expected: No errors (may show warnings from other files)

- [ ] **Step 3: Commit**

```bash
git add src/SpotifyPlayerApp.tsx
git commit -m "feat(spotify): add SpotifyPlayerApp component"
```

---

### Task 8: Create Standalone Entry Point and HTML

**Files:**
- Create: `src/spotify-player-main.tsx`
- Create: `spotify-player.html`
- Modify: `vite.config.ts:17-18`

- [ ] **Step 1: Create React entry point**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { SpotifyPlayerApp } from "./SpotifyPlayerApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SpotifyPlayerApp />
  </React.StrictMode>
);
```

- [ ] **Step 2: Create HTML template**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spotify</title>
    <style>html, body, #root { margin: 0; padding: 0; overflow: hidden; height: 100%; background: transparent; }</style>
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/spotify-player-main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Add Vite entry point**

In `vite.config.ts`, after the `"peer-list"` entry (line 17), add:

```typescript
        "spotify-player": resolve(__dirname, "spotify-player.html"),
```

- [ ] **Step 4: Verify Vite resolves the entry**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/spotify-player-main.tsx spotify-player.html vite.config.ts
git commit -m "feat(spotify): add standalone player entry point and Vite config"
```

---

### Task 9: Integrate Spotify into StatusPill

**Files:**
- Modify: `src/components/StatusPill.tsx`
- Modify: `src/styles/status-pill.css`

This task adds the Spotify button to the pill and renders the inline player panel.

- [ ] **Step 1: Add imports to StatusPill.tsx**

After the existing imports (around line 21), add:

```typescript
import { useSpotifyConnected } from "../hooks/useSpotify";
import { SpotifyPlayerApp } from "../SpotifyPlayerApp";
```

- [ ] **Step 2: Update the StatusPillProps interface**

Add a callback prop for Spotify panel state. In the `StatusPillProps` interface (around line 23-38), add:

```typescript
  onSpotifyOpenChange?: (open: boolean) => void;
```

- [ ] **Step 3: Add Spotify state variables**

After the existing state declarations (around line 261, after `tooltipRef`), add:

```typescript
  const { connected: spotifyConnected } = useSpotifyConnected();
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [spotifyDropdownTop, setSpotifyDropdownTop] = useState(0);
  const [spotifyDropdownMaxHeight, setSpotifyDropdownMaxHeight] = useState(280);
  const spotifyButtonRef = useRef<HTMLButtonElement>(null);
```

- [ ] **Step 4: Add Spotify layout computation and toggle**

After the existing `computeDropdownLayout` function (find it by searching), add:

```typescript
  const computeSpotifyLayout = () => {
    const btn = spotifyButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const top = rect.bottom + 6;
    const maxH = window.innerHeight - top - 12;
    setSpotifyDropdownTop(top);
    setSpotifyDropdownMaxHeight(Math.max(120, maxH));
  };

  const toggleSpotify = () => {
    if (spotifyOpen) {
      setSpotifyOpen(false);
      onSpotifyOpenChange?.(false);
      return;
    }
    setSessionOpen(false);
    setPeerOpen(false);
    computeSpotifyLayout();
    setSpotifyOpen(true);
    onSpotifyOpenChange?.(true);
  };
```

- [ ] **Step 5: Add effect to close Spotify when disconnected**

```typescript
  useEffect(() => {
    if (!spotifyConnected && spotifyOpen) {
      setSpotifyOpen(false);
      onSpotifyOpenChange?.(false);
    }
  }, [spotifyConnected]);
```

- [ ] **Step 6: Close Spotify on Escape**

Find the existing Escape key handler (around line 379) and extend it. In the same `useEffect` that handles Escape for session/peer, add:

```typescript
    if (spotifyOpen) {
      setSpotifyOpen(false);
      onSpotifyOpenChange?.(false);
    }
```

- [ ] **Step 7: Add Spotify button to pill-actions**

After the LAN button (around line 540), inside the `pill-actions` div, add:

```tsx
          {spotifyConnected && (
            <button
              ref={spotifyButtonRef}
              type="button"
              className={`pill-action-btn pill-action-spotify ${spotifyOpen ? "active" : ""}`}
              data-testid="pill-action-spotify"
              aria-label="Spotify"
              onClick={toggleSpotify}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
            </button>
          )}
```

- [ ] **Step 8: Add Spotify dropdown panel rendering**

After the session dropdown and before the path tooltip portal (around line 646), add:

```tsx
        {spotifyOpen && (
          <div
            className="spotify-dropdown"
            data-testid="spotify-dropdown"
            style={{
              top: spotifyDropdownTop,
              maxHeight: spotifyDropdownMaxHeight,
            }}
          >
            <SpotifyPlayerApp />
          </div>
        )}
```

- [ ] **Step 9: Add Spotify dropdown CSS to status-pill.css**

At the end of `src/styles/status-pill.css`, add:

```css
.spotify-dropdown {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  z-index: 10;
  animation: dropdown-in 0.12s ease-out;
}

.container.effect-active .spotify-dropdown {
  display: none;
}

.pill-action-spotify {
  color: var(--text-muted, #888);
}

.pill-action-spotify.active {
  color: #1db954;
}
```

- [ ] **Step 10: Close Spotify when other panels open**

Find where `sessionOpen` is set to true (the toggle handler) and add `setSpotifyOpen(false); onSpotifyOpenChange?.(false);` before it. Do the same for the peer open handler. Conversely, in `toggleSpotify` above, we already close session/peer.

- [ ] **Step 11: Verify frontend compiles**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: Clean or only pre-existing warnings

- [ ] **Step 12: Commit**

```bash
git add src/components/StatusPill.tsx src/styles/status-pill.css
git commit -m "feat(spotify): add Spotify button and panel to StatusPill"
```

---

### Task 10: Integrate Spotify into Settings

**Files:**
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Add imports**

At the top of Settings.tsx, add:

```typescript
import { useSpotifyConnected } from "../hooks/useSpotify";
```

- [ ] **Step 2: Add "spotify" to Tab type**

Change line 74 from:
```typescript
type Tab = "general" | "mime" | "sound" | "claude" | "about";
```
to:
```typescript
type Tab = "general" | "mime" | "sound" | "claude" | "spotify" | "about";
```

- [ ] **Step 3: Add to tabTitles**

In the `tabTitles` object (lines 76-82), add before `about`:
```typescript
  spotify: "Spotify",
```

- [ ] **Step 4: Add to sidebar nav array**

At line 394, change the array from:
```typescript
["general", "mime", "sound", "claude", "about"]
```
to:
```typescript
["general", "mime", "sound", "claude", "spotify", "about"]
```

- [ ] **Step 5: Add Spotify state variables**

After existing state declarations (around line 144), add:

```typescript
  const spotify = useSpotifyConnected();
  const [spotifyClientDraft, setSpotifyClientDraft] = useState("");
  const [spotifyClientLoaded, setSpotifyClientLoaded] = useState(false);
  const [spotifyMsg, setSpotifyMsg] = useState<{ kind: "idle" | "ok" | "err"; text: string }>({ kind: "idle", text: "" });
```

- [ ] **Step 6: Add useEffect to load client ID from hook**

```typescript
  useEffect(() => {
    if (spotify.clientId && !spotifyClientLoaded) {
      setSpotifyClientDraft(spotify.clientId);
      setSpotifyClientLoaded(true);
    }
  }, [spotify.clientId, spotifyClientLoaded]);
```

- [ ] **Step 7: Add Spotify handler functions**

```typescript
  const spotifyClientChanged = spotifyClientDraft !== (spotify.clientId ?? "");

  const handleSpotifySaveClient = async () => {
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("settings.json");
      await store.set("spotifyClientId", spotifyClientDraft.trim());
      await store.save();
      const { emit } = await import("@tauri-apps/api/event");
      await emit("spotify-client-changed", spotifyClientDraft.trim());
      setSpotifyMsg({ kind: "ok", text: "Client ID saved." });
    } catch (e) {
      setSpotifyMsg({ kind: "err", text: String(e) });
    }
  };

  const handleSpotifyConnect = async () => {
    try {
      const url = await invoke<string>("spotify_connect", { clientId: spotifyClientDraft.trim() });
      const { open } = await import("@tauri-apps/plugin-opener");
      await open(url);
      setSpotifyMsg({ kind: "ok", text: "Check your browser to complete auth." });
    } catch (e) {
      setSpotifyMsg({ kind: "err", text: String(e) });
    }
  };

  const handleSpotifyDisconnect = async () => {
    try {
      await invoke("spotify_disconnect");
      setSpotifyMsg({ kind: "ok", text: "Disconnected." });
    } catch (e) {
      setSpotifyMsg({ kind: "err", text: String(e) });
    }
  };
```

- [ ] **Step 8: Add Spotify tab content block**

Between the Claude Code tab block (ends ~line 1473) and the About tab block (starts ~line 1474), insert:

```tsx
          {tab === "spotify" && (
            <>
              <section className="settings-card" data-testid="settings-spotify">
                <h3>Spotify</h3>
                <p className="settings-hint">
                  Connect your Spotify account to control playback from the mascot.
                  You'll need a <strong>Spotify Premium</strong> account and a Client ID from the{" "}
                  <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                    Spotify Developer Dashboard
                  </a>.
                  See <code>docs/SPOTIFY_SETUP.md</code> for full instructions.
                </p>

                <label className="settings-row" htmlFor="spotify-client-id">
                  <span className="settings-label">Client ID</span>
                  <div className="settings-input-group">
                    <input
                      id="spotify-client-id"
                      type="text"
                      className="settings-input"
                      data-testid="spotify-client-id-input"
                      placeholder="Paste your Spotify Client ID"
                      value={spotifyClientDraft}
                      onChange={(e) => setSpotifyClientDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-btn"
                      data-testid="spotify-save-client-btn"
                      disabled={!spotifyClientChanged}
                      onClick={() => void handleSpotifySaveClient()}
                    >
                      Save
                    </button>
                  </div>
                </label>

                <div className="settings-row">
                  <span className="settings-label">Connection</span>
                  <div className="settings-input-group">
                    {spotify.connected ? (
                      <button
                        type="button"
                        className="settings-btn settings-btn-danger"
                        data-testid="spotify-disconnect-btn"
                        onClick={() => void handleSpotifyDisconnect()}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn settings-btn-primary"
                        data-testid="spotify-connect-btn"
                        disabled={!spotifyClientDraft.trim()}
                        onClick={() => void handleSpotifyConnect()}
                      >
                        Connect Spotify
                      </button>
                    )}
                  </div>
                </div>

                {spotifyMsg.text && (
                  <p
                    className={`settings-msg ${spotifyMsg.kind === "err" ? "settings-msg-err" : ""}`}
                    data-testid="spotify-msg"
                  >
                    {spotifyMsg.text}
                  </p>
                )}

                <p className="settings-hint" data-testid="spotify-status">
                  {spotify.connected
                    ? "Connected — Spotify button visible under the dog."
                    : "Not connected."}
                </p>
              </section>
            </>
          )}
```

- [ ] **Step 9: Verify compiles**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: Clean

- [ ] **Step 10: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(spotify): add Spotify tab to Settings"
```

---

### Task 11: Integrate Spotify Panel into App.tsx Window Management

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add constant**

After `SESSION_DROPDOWN_MIN_WIDTH` (line 49), add:

```typescript
const SPOTIFY_DROPDOWN_WINDOW_HEIGHT = 450;
```

- [ ] **Step 2: Add state variables**

After `sessionClosing` state (line 169), add:

```typescript
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [spotifyClosing, setSpotifyClosing] = useState(false);
```

- [ ] **Step 3: Add Spotify to useWindowDefaultSize pause condition**

At line 184-187, add `spotifyOpen || spotifyClosing` to the pause condition:

```typescript
  useWindowDefaultSize(
    scale,
    effectActive || sessionOpen || sessionClosing || spotifyOpen || spotifyClosing || bubbleGrowActive || visitors.length > 0
  );
```

- [ ] **Step 4: Add window height grow/shrink effect for Spotify panel**

After the session dropdown effect (around line 402), add:

```typescript
  useEffect(() => {
    const win = getCurrentWindow();
    const el = document.getElementById("root");
    if (!el) return;

    if (spotifyOpen) {
      void (async () => {
        const factor = await win.scaleFactor();
        const { width: pw, height: ph } = (await win.outerSize()).toLogical(factor);
        const currentHeight = ph;
        const newHeight = Math.max(currentHeight, SPOTIFY_DROPDOWN_WINDOW_HEIGHT);
        if (newHeight > currentHeight) {
          await win.setSize(new LogicalSize(pw, newHeight));
        }
      })();
    }

    if (spotifyClosing) {
      void (async () => {
        const factor = await win.scaleFactor();
        const { width: pw } = (await win.outerSize()).toLogical(factor);
        const contentH = el.offsetHeight;
        if (!sessionOpen) {
          await win.setSize(new LogicalSize(pw, contentH));
        }
        setSpotifyClosing(false);
      })();
    }
  }, [spotifyOpen, spotifyClosing, sessionOpen]);
```

- [ ] **Step 5: Add onSpotifyOpenChange callback to StatusPill**

Find the `<StatusPill` rendering (around line 432-446). Add the `onSpotifyOpenChange` prop:

```tsx
  onSpotifyOpenChange={(open) => {
    if (!open) setSpotifyClosing(true);
    setSpotifyOpen(open);
  }}
```

- [ ] **Step 6: Verify compiles**

Run: `npx tsc --noEmit 2>&1 | tail -10`
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(spotify): add Spotify panel window management to App"
```

---

### Task 12: Create SPOTIFY_SETUP.md Documentation

**Files:**
- Create: `docs/SPOTIFY_SETUP.md`

- [ ] **Step 1: Create the setup guide**

```markdown
# Spotify Setup

Ani-Mime can show your currently-playing Spotify track and let you play / pause / skip / scrub from a popover under the dog. This is opt-in and uses Spotify's official OAuth (PKCE) flow — no client secret, no third-party server.

## Prerequisites

- A Spotify **Premium** account (Free accounts can read playback state but cannot control playback per Spotify's API rules).
- An active Spotify session on at least one device (desktop app, web player, phone). Ani-Mime controls whichever device Spotify treats as currently active.

## 1. Register a Spotify app (5 min)

1. Open <https://developer.spotify.com/dashboard> and sign in.
2. Click **Create app**.
3. Fill in:
   - **App name**: `Ani-Mime` (anything; only you will see it)
   - **App description**: anything
   - **Website**: leave blank or paste anything
   - **Redirect URI**: `http://127.0.0.1:1234/spotify/callback`  ← exact match required
   - **Which API/SDKs are you planning to use**: check **Web API**
4. Agree to terms, click **Save**.
5. On the resulting app page, click **Settings**. Copy the **Client ID** (long hex string).

You do **not** need the Client Secret — Ani-Mime uses PKCE.

## 2. Connect Ani-Mime

1. Open Ani-Mime → **Settings** → **Spotify**.
2. Paste the Client ID into the **Client ID** field, click **Save**.
3. Click **Connect Spotify**. Your default browser opens Spotify's auth page.
4. Click **Agree**. Spotify redirects to `127.0.0.1:1234/spotify/callback`, Ani-Mime captures the code, exchanges it for tokens, and the popover under the dog becomes available.

## 3. Use it

- A music-note button appears under the dog when connected. Click to open the player popover.
- Popover shows: track art, title, artist, progress bar (drag to seek), and play / pause / prev / next buttons.
- Polling refreshes state every ~2.5s while the popover is open.

## Scopes requested

| Scope | Why |
|-------|-----|
| `user-read-playback-state` | Read what's playing + progress + active device |
| `user-modify-playback-state` | Play / pause / skip / seek |
| `user-read-currently-playing` | Fallback for currently-playing track |

## Disconnect

Settings → Spotify → **Disconnect**. This wipes the stored tokens from `settings.json`. Spotify still remembers the app authorisation; revoke it at <https://www.spotify.com/account/apps/> if you also want to remove it from your account.

## Troubleshooting

- **"INVALID_CLIENT: Invalid redirect URI"** — the redirect URI in your Spotify app settings does not exactly match `http://127.0.0.1:1234/spotify/callback`. Fix and save.
- **"No active device"** — Spotify needs an active player. Open the Spotify app or web player and start any track once. Ani-Mime then sees the device.
- **Controls do nothing** — confirm your account is Premium. Free accounts return `403 Forbidden` on play/pause/skip.
- **Auth page loops back to "Connect Spotify"** — make sure the Ani-Mime HTTP server is running (it starts with the app). Check logs for `[spotify]` lines.
```

- [ ] **Step 2: Commit**

```bash
git add docs/SPOTIFY_SETUP.md
git commit -m "docs: add Spotify setup guide"
```

---

### Task 13: Full Build Verification

- [ ] **Step 1: Verify Rust backend compiles clean**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 2: Verify frontend compiles clean**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify Vite build succeeds**

Run: `bun run build 2>&1 | tail -10`
Expected: Build completes, `spotify-player` entry appears in output

- [ ] **Step 4: Run existing tests**

Run: `bun run test 2>&1 | tail -20` (if test script exists)
Expected: All existing tests still pass

- [ ] **Step 5: Manual smoke test**

Run: `bun run tauri dev`
Verify:
1. App launches without errors
2. Settings → Spotify tab appears with Client ID input + Connect button
3. Without connecting: no Spotify button in pill (correct)
4. Check console/logs for any Spotify-related errors at startup (should be none)
