# Constants & Configuration Reference

All hardcoded values, timeouts, and configurable parameters in the codebase.

## Backend Constants (Rust)

### Timing

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `HEARTBEAT_TIMEOUT_SECS` | 40 | `watchdog.rs` | Remove session if no heartbeat for this long |
| `SERVICE_DISPLAY_SECS` | 2 | `watchdog.rs` | How long service state shows before auto-transitioning to idle |
| `IDLE_TO_SLEEP_SECS` | 120 | `watchdog.rs` | Idle duration before entering sleep mode (suppresses emits) |
| `VISIT_DURATION_SECS` | 8 | `lib.rs` | How long a dog visit lasts |
| `ANNOUNCE_INTERVAL_SECS` | 5 | `broadcast.rs` | UDP multicast announce cadence |
| `PEER_EXPIRY_SECS` | 30 | `broadcast.rs` | Remove broadcast peer after this many seconds of silence |
| `UNICAST_SCAN_INTERVAL_SECS` | 30 | `broadcast.rs` | How often to sweep the local /24 via unicast |
| `UNICAST_SEND_SPACING_MS` | 10 | `broadcast.rs` | Delay between per-host sends within one scan (keeps peak <100 pps) |
| Watchdog tick | 2s | `watchdog.rs` | Background thread check interval |
| Discovery heartbeat | 30s | `discovery.rs` | Peer count check and hint interval |
| Update check delay | 3s | `updater.rs` | Delay before first background update check |

### Networking

| Value | File | Purpose |
|-------|------|---------|
| Default HTTP port: `1234` | `helpers.rs` | HTTP server port (overridable via `ANI_MIME_PORT` env var) |
| Bind address: `0.0.0.0` | `server.rs` | Listen on all interfaces (for peer visits) |
| mDNS service: `_ani-mime._tcp.local.` | `discovery.rs` | mDNS service type |
| `MULTICAST_PORT`: `1235` | `broadcast.rs` | UDP port for multicast + unicast announces |
| `MULTICAST_ADDR`: `224.0.0.200` | `broadcast.rs` | Link-local multicast group (in `224.0.0.0/24` flooded range — same class as AirPlay/mDNS) |
| `MAGIC`: `"ani-mime/1"` | `broadcast.rs` | Protocol tag in announce payloads; foreign UDP on `:1235` is dropped |
| curl timeout: `1s` | shell scripts | `--max-time 1` on all curl calls |

### Limits

| Value | File | Purpose |
|-------|------|---------|
| Max log entries: `1000` | `logger.rs` | Ring buffer size, oldest dropped on overflow |
| Nickname max length: `20` | `useNickname.ts` | Character limit for display names |

### MCP Defaults

| Value | File | Purpose |
|-------|------|---------|
| `pet_say` default duration: `7s` | `server.mjs`, `server.rs` | Speech bubble display time |
| `pet_react` default duration: `3s` | `server.mjs`, `server.rs` | Reaction animation time |
| MCP protocol version: `2024-11-05` | `server.mjs` | JSON-RPC protocol version |

### Special Values

| Value | Meaning | File |
|-------|---------|------|
| PID `0` | Claude Code virtual session | `server.rs`, `watchdog.rs` |
| `/tmp/tauri-heartbeat-{pid}` | Heartbeat PID guard file | shell scripts |
| `/tmp/tauri-shell-pid` | Claude Code PID bridge | `tauri-hook.sh` |
| `~/.ani-mime/setup-done` | First-launch marker | `setup/mod.rs` |
| `~/.ani-mime/mcp/server.mjs` | MCP server script | `setup/mcp.rs` |
| `~/.claude.json` | Claude Code MCP server registry | `setup/mcp.rs` |

## Frontend Constants (TypeScript)

### Animation

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| Frame size | 128px | `Mascot.tsx` | Sprite frame width and height |
| Frame duration | 80ms | `Mascot.tsx` | Milliseconds per animation frame |
| Freeze delay | 10,000ms | `Mascot.tsx` | Auto-freeze after idle/disconnected |
| Visitor frame size | 96px | `VisitorDog.tsx` | Smaller sprite for visitors |
| Visitor spacing | 80px | `VisitorDog.tsx` | Horizontal offset between visitors |

### UI

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `BUBBLE_DURATION_MS` | 7,000 | `useBubble.ts` | Auto-dismiss speech bubble timeout |
| Log poll interval | 1,000ms | `SuperpowerTool.tsx` | Log viewer refresh rate |
| Dev mode clicks | 10 | `Settings.tsx` | Clicks on version to enable dev mode |

### Window sizing (see [window-sizing.md](./window-sizing.md) for the full pipeline)

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `BASELINE_WIDTH` | 320 | `App.tsx` | Root window width floor |
| `.container` `min-width` | 320 px | `app.css` | CSS-level width floor |
| `.container` `min-height` | 250 px | `app.css` | CSS-level height floor |
| `.container.has-visitors` `min-width` | 500 px | `app.css` | Visitor-mode width |
| Visitor-mode window width | 500 | `App.tsx` (visitor effect) | Explicit `setSize` target while visitors present |
| `SESSION_DROPDOWN_MIN_WIDTH` | 320 | `App.tsx` | Width floor while session list is open |
| `SESSION_DROPDOWN_WINDOW_HEIGHT` | 400 | `App.tsx` | Total window height while session list is open |
| `BASE_PAD_TOP` | 20 | `App.tsx` | Container base top padding (used by bubble math) |
| `BASE_PAD_HORIZONTAL` | 50 | `App.tsx` | Container base L+R padding (used by bubble math) |
| `BUBBLE_OVERLAP_PX` | 46 | `App.tsx` | Bubble–sprite overlap in CSS px at scale=1 |
| `SPRITE_NATIVE_WIDTH` | 128 | `App.tsx` | Pre-scale sprite width |

### Tauri Store Keys

| Key | Type | Default | Hook |
|-----|------|---------|------|
| `"theme"` | `"dark" \| "light"` | `"dark"` | `useTheme` |
| `"pet"` | `Pet` | `"rottweiler"` | `usePet` |
| `"nickname"` | `string` | `""` | `useNickname` |
| `"glowMode"` | `GlowMode` | `"off"` | `useGlow` |
| `"bubbleEnabled"` | `boolean` | `true` | `useBubble` |
| `"skippedVersion"` | `string` | `""` | `updater.rs` |

## Window Configuration (`tauri.conf.json`)

| Window | Size | Decorations | Always on Top | Visible |
|--------|------|-------------|---------------|---------|
| main | 320x250 (baseline, auto-resizes at runtime — see [window-sizing.md](./window-sizing.md)) | No | Yes | Yes |
| settings | 620x560 | Yes | No | Hidden |
| superpower | 800x500 | Yes | No | Hidden |
| peer-list | 280x260 | No | No | Hidden |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANI_MIME_PORT` | Override HTTP server port | `1234` |

## Shell Hook Classification

Commands matching these patterns are classified as "service" (otherwise "task"):

```regex
(start|dev|serve|watch|metro|docker-compose|docker compose|up|run dev|run start|run serve)
```

Defined in each `terminal-mirror.{zsh,bash,fish}` script.
