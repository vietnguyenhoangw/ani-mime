# Ani-Mime

A floating desktop mascot (pixel dog) that reacts to terminal and Claude Code activity in real-time. Ships on macOS; runs on Linux and WSL2 via a cross-platform backend facade. Built with Tauri 2 + React 19.

<!-- c3-generated: c3-0 -->
## Architecture (C3)

This project uses C3 architecture docs in `.c3/`. For architecture questions, changes, audits, or file ownership lookup, invoke `/c3-skill:c3` with one of: query, audit, change, ref, rule, sweep.

- File → component lookup: `c3x lookup <file-or-glob>` (use the c3-skill bin)
- Topology: `c3x list` (containers, components, refs, rules)
- Validate: `c3x check` (must be zero issues before merging architecture changes)
- HARD RULE: never read or edit files under `.c3/` directly — always go through `c3x` CLI

Containers: `c3-1` Rust Backend, `c3-2` React Frontend, `c3-3` Shell Integration. See `.c3/README.md` (via `c3x read c3-0`) for the system goal and the rules cited from each component.
<!-- /c3-generated -->

## Quick Reference

- **Dev**: `bun run tauri dev`
- **Build (macOS)**: `bun run tauri build && bash src-tauri/script/post-build-sign.sh`
- **Build (Linux/WSL2)**: `bun run tauri build` — produces AppImage + .deb in `src-tauri/target/release/bundle/`
- **Type check frontend**: `npx tsc --noEmit`
- **Type check backend**: `cd src-tauri && cargo check`
- **Package manager**: Bun (not npm/yarn)
- **Entitlements (macOS)**: `src-tauri/Entitlements.plist` (network + Hardened Runtime); post-build re-sign is required for ad-hoc builds
- **Linux prerequisites**: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libglib2.0-dev libayatana-appindicator3-dev librsvg2-dev zenity` — required for `cargo check` and runtime dialogs

## Architecture

See `docs/ARCHITECTURE.md` for full details. Key data flow:

```
Shell hooks (curl) → HTTP :1234 → Rust state → Tauri event → React UI
Claude Code ←stdio→ MCP server (Node.js) ←HTTP→ :1234 → Tauri event → React UI
Peer announces ←UDP :1235 (mDNS + multicast + unicast scan)→ AppState.peers → peers-changed event → UI
```

### Backend (`src-tauri/src/`)

| Module | Responsibility |
|--------|---------------|
| `lib.rs` | Tauri setup, plugin registration, tray icon, composition root, all `#[tauri::command]` functions |
| `state.rs` | `AppState`, `Session`, `SessionInfo`, `resolve_ui_state()`, `emit_if_changed()` |
| `server.rs` | HTTP server on `127.0.0.1:1234` (tiny_http), incl. MCP endpoints. Rejects status/heartbeat with 410 when the pid isn't alive |
| `watchdog.rs` | Background thread: service→idle transition, stale session cleanup |
| `proc_scan.rs` | Background thread (2s): libproc-based OS scan — auto-discovers shells, fills `pwd`/`tty`/`fg_cmd`, detects `claude` via `KERN_PROCARGS2` argv, drops zombie sessions |
| `focus.rs` | `focus_terminal_for_pid()` — walks parent chain to find owning terminal app (iTerm/Terminal/VS Code/Cursor/tmux/etc.), activates via `open -a`, optionally targets tab via AppleScript |
| `discovery.rs` | mDNS peer discovery — registers `_ani-mime._tcp.local.`, browses peers, emits `peers-changed` |
| `broadcast.rs` | UDP peer discovery on `:1235` — multicast announce (224.0.0.200 every 5s), unicast `/24` scan (every 30s), receive loop, expiry loop. Writes into the same `AppState.peers` as `discovery.rs` keyed by `instance_name` |
| `helpers.rs` | `now_secs()`, `get_query_param()` |
| `setup/mod.rs` | First-launch auto-setup orchestrator |
| `setup/shell.rs` | Shell detection, RC file injection, shell-selection prompt (via `platform::show_dialog`) |
| `setup/claude.rs` | Claude Code hooks configuration |
| `setup/mcp.rs` | MCP server installation + Claude Code MCP registration |
| `logger.rs` | Log file tail-reader, `app_log!`/`app_warn!`/`app_error!` macros |
| `platform/mod.rs` | Cross-platform facade: `setup_main_window`, `set_dock_visibility`, `open_path`, `open_url`, `show_dialog`, `show_choose_list`, `open_local_network_settings`, `run_update_command` |
| `platform/macos.rs` | macOS impl: Cocoa/objc window tweaks, `osascript` dialogs, `open` / `brew --cask` update flow |
| `platform/linux.rs` | Linux impl: Tauri-native transparency, `zenity` dialogs, `xdg-open`, manual update via release URL |
| `plugin/runtime.rs` | Spawns a per-plugin WebView (`plugin://<id>/<entry>`), injects the `window.ani` SDK, maps plugin id ↔ `plugin-<id>` window label |
| `plugin/gateway.rs` | `plugin_call` command — the single gated entry point for `window.ani`; checks declared capabilities, dispatches to storage / window ops |
| `plugin/storage.rs` | Per-plugin key/value store at `~/.ani-mime/plugins/<id>/data/store.json` |
| `plugin/clipboard.rs` | Background OS-clipboard monitor (arboard) + history (deduped, capped 20, persisted to `~/.ani-mime/clipboard-history.json`); runs only while a `clipboard`-capable plugin is enabled; exposed via the `clipboard` capability |

### MCP Server (`src-tauri/mcp-server/`)

| File | Responsibility |
|------|---------------|
| `server.mjs` | Zero-dependency Node.js MCP server (JSON-RPC 2.0 over stdio) |

### Frontend (`src/`)

| Module | Responsibility |
|--------|---------------|
| `App.tsx` | Root composition: layout + drag |
| `components/Mascot.tsx` | Sprite animation with auto-freeze |
| `components/StatusPill.tsx` | Colored dot + status label + session list dropdown (grouped by PWD) |
| `hooks/useStatus.ts` | Tauri `"status-changed"` + `"mcp-react"` event listener |
| `hooks/useDrag.ts` | Window drag via Tauri API |
| `hooks/useBubble.ts` | Speech bubbles: task-completed, welcome, `"mcp-say"` |
| `hooks/useDockVisible.ts` | Toggle dock visibility via `set_dock_visible` command |
| `hooks/useSessions.ts` | `fetchSessions()` wrapper around the `get_sessions` Tauri command |
| `hooks/useSessionList.ts` | Persistent setting: whether the pill-click session dropdown is enabled |
| `constants/sprites.ts` | Sprite file map, frame counts, auto-stop set |
| `types/status.ts` | `Status` type, `SpriteConfig` interface |
| `assets/claude-logo.png` | Claude Code icon shown on sessions running `claude` |
| `components/PluginManager.tsx` | Settings "Plugins" tab — install (.zip) / list / enable / disable / launch / uninstall installed plugins |
| `hooks/usePlugins.ts` | Loads plugins via `get_plugins`, refreshes on `plugins-changed`, exposes install/uninstall/setEnabled/launch actions |
| `types/plugin.ts` | `PluginRecord` / `PluginManifest` / `PluginStatus` TypeScript mirrors of the Rust types |

### Status Priority

When multiple terminals are open, the UI shows one winner: `busy > service > idle > disconnected`

## Conventions

- **Rust**: Modules are flat files or directories with `mod.rs`. Shared state uses `Arc<Mutex<AppState>>`.
- **React**: Functional components, hooks for logic. No state management library — `useState` + Tauri events.
- **CSS**: Split by component (`styles/app.css`, `styles/mascot.css`, `styles/status-pill.css`). Uses CSS custom properties for sprite animation.
- **Types**: `Status` is the core shared type. Keep frontend and backend status strings in sync manually (no codegen yet).
- **Shell scripts**: One per shell (`terminal-mirror.{zsh,bash,fish}`). All use `curl` to talk to `:1234`.

## Important Details

- HTTP server runs on `127.0.0.1:1234` — this port is hardcoded in shell scripts, Claude hooks, and Rust server
- Peer discovery runs on UDP `:1235` (multicast group `224.0.0.200` + unicast /24 scan) in addition to mDNS — all three channels feed the same `AppState.peers` HashMap keyed by `instance_name`, so peers discovered by multiple channels appear once
- pid=0 is reserved for Claude Code hooks (virtual session)
- Heartbeats only refresh `last_seen` for non-busy sessions (prevents stuck commands from staying alive)
- `/status` and `/heartbeat` reject with 410 when the pid isn't a live OS process — stops orphaned heartbeat subshells from re-registering dead sessions
- Service state auto-transitions to idle after 2 seconds (watchdog)
- Sessions are removed after 40 seconds with no heartbeat (watchdog) OR immediately once `proc_scan` sees the PID is gone
- Shell hooks send `pwd=$PWD` and `tty=$TTY` on every `/status` and `/heartbeat`; `proc_scan` fills the same fields authoritatively from libproc every 2 seconds
- `proc_scan` uses `KERN_PROCARGS2` sysctl to read argv[0] because `claude` shows up as `"node"` in `p_comm` (Claude Code is a Node binary)
- `focus_terminal` Tauri command walks the parent chain via libproc + a `ps`-based ppid fallback (needed because libproc refuses BSDInfo for root-owned `login`)
- Setup marker file: `~/.ani-mime/setup-done`
- OS-specific code lives under `src-tauri/src/platform/<target>.rs` with a cfg-gated facade in `platform/mod.rs` — callers use `platform::fn_name(...)` and never see `#[cfg(target_os = "...")]` themselves
- macOS uses `cocoa` + `objc` crates for NSWindow tweaks (gated on `#[cfg(target_os = "macos")]` in Cargo.toml target deps)
- Linux uses Tauri's built-in `transparent: true` via webkit2gtk; `zenity` provides native dialogs (required package); dock visibility is a no-op since Linux has no global dock (`skipTaskbar: true` handles the taskbar)
- Tray icon is always present; left-click toggles main window, right-click shows menu (Show, Settings, Quit)
- "Hide from Dock" preference stored as `hideDock` in `settings.json`; on macOS applies `ActivationPolicy::Accessory` at startup, on Linux it is a no-op
- MCP server (`server.mjs`) is installed to `~/.ani-mime/mcp/` on every startup; registered in `~/.claude.json` during first-launch setup
- MCP endpoints: `/mcp/say` (speech bubble), `/mcp/react` (temp animation), `/mcp/pet-status` (JSON status)
- MCP reactions map to existing statuses: celebrate/excited→service, nervous→busy, confused→searching, sleep→disconnected
- Plugin WebViews are created at runtime (`plugin::runtime::launch_plugin_webview`), labeled `plugin-<id>`, and granted the `plugin` capability (`src-tauri/capabilities/plugin.json`, scoped to the `plugin-*` glob). All `window.ani` calls route through the single `plugin_call` command, which derives the plugin id from the calling window label — never from JS args — so plugins cannot impersonate each other. Window control (show/hide/resize/close) and per-plugin storage are mediated by `plugin_call`; the `launch_plugin` command is the temporary trigger until the hotkey (Slice 3) and Plugin Manager UI (Slice 4) land.

## Logging

- **Writer**: `tauri-plugin-log` appends structured lines to `ani-mime.log` inside the Tauri log dir (`~/Library/Logs/<bundle-id>/` on macOS, `~/.local/share/<bundle-id>/logs/` on Linux)
- **Reader**: `logger.rs` reads the tail of that same file to display in the Superpower Tool UI
- **Rotation**: Configured as `KeepSome(3)` with 1MB max per file — do not increase without reason
- **Tail-read**: `read_log_file()` seeks to the end of the file and reads only the last ~N×256 bytes. Never load the entire log file into memory.
- **Macros**: Use `app_log!()`, `app_warn!()`, `app_error!()` for app-level logging — these route through the `log` crate so the plugin writes them to file
- **Levels**: `debug` for dev diagnostics, `info` for state changes, `warn`/`error` for problems. Third-party crate noise is filtered in `lib.rs` (e.g. `mdns_sd` set to `Warn`)
- **Don't truncate the log file externally** — `tauri-plugin-log` holds its own file handle; truncating causes stale size tracking and premature rotation

## Testing

### Automation-Friendly UI

Every interactive or observable UI element must be locatable by automated tests without coupling to styling or DOM structure.

- **Always add `data-testid`** to any element that a test might need to find — buttons, inputs, status indicators, containers, cards, toggles, labels. When in doubt, add one.
- **Naming**: `data-testid="section-element"` (e.g., `settings-tab-appearance`, `pet-card-shiba`, `creator-save-btn`). Use kebab-case. Parameterize with dynamic values where appropriate (`pet-card-${id}`).
- **Semantic HTML first**: Use `<button>`, `<input>`, `<nav>`, `<main>`, `<label>` — not styled `<div>`s. This enables `getByRole()` locators.
- **ARIA attributes**: Add `aria-label` on icon-only buttons, `role="switch"` + `aria-checked` on toggles, and `htmlFor` on `<label>` elements. These serve both accessibility and testability.
- **Never rely on CSS classes or DOM position for test selectors.** Selectors like `.sidebar-item:nth-child(2)` break when styling or order changes.

### Selector Priority (for both unit and e2e tests)

1. `getByRole()` — preferred, tests what users see
2. `getByTestId()` / `[data-testid="..."]` — explicit, stable
3. `getByText()` / `getByPlaceholderText()` — acceptable for unique visible text
4. **Avoid**: `container.querySelector(".class")`, CSS class selectors, `:nth-child()`

### Test Structure

- **Unit tests** (Vitest + React Testing Library): `src/**/*.test.{ts,tsx}`
- **E2E tests** (Playwright): `e2e/*.spec.ts`
- **Run e2e**: `bunx playwright test -c e2e/playwright.config.ts --project=chromium`
- **Playwright config**: `e2e/playwright.config.ts` — chromium + webkit, trace on failure
- **When to run e2e**: Before pushing. No pre-commit or pre-push hook is configured — run manually. E2e takes ~7s on Chromium; too slow for a commit hook.
- **Tauri mock**: `e2e/tauri-mock.ts` — injects fake `__TAURI_INTERNALS__` for store, dialog, FS, window, and event plugins. Supports `__MOCK_DIALOG_RESULT__`, `__MOCK_READ_FILE_BYTES__`, `__MOCK_READ_FILE_MAP__`, `__MOCK_SAVE_DIALOG_RESULT__`, `__MOCK_WRITTEN_FILES__`, `__MOCK_WINDOW_SIZES__` for test assertions.

## Adding Features

- **New UI state**: Update `Status` type → `sprites.ts` → `StatusPill.tsx` → `status-pill.css` → `resolve_ui_state()` in `state.rs`
- **New HTTP endpoint**: Add route in `server.rs`, lock `AppState` if mutating, call `emit_if_changed()`
- **New Tauri command**: Define `#[tauri::command] fn` in `lib.rs`, register in the `invoke_handler!` macro. Domain logic may live in its own module (e.g. `focus.rs`), but the `#[tauri::command]` wrapper stays in `lib.rs`.
- **New MCP tool**: Add tool definition in `mcp-server/server.mjs`, add HTTP endpoint in `server.rs`, emit Tauri event for frontend
- **New shell**: Add script in `src-tauri/script/`, add `ShellInfo` in `setup/shell.rs`, add to `tauri.conf.json` bundle resources
- **New terminal app for click-to-focus**: Add an entry to `classify_bundle()` in `proc_scan.rs`, dispatch in `focus.rs` with either an existing strategy (`open -a` + AppleScript tab selection) or a new strategy
- **New persistent setting**: Follow the `useDockVisible` pattern — hook uses `load("settings.json")` + `listen`/`emit` on a `*-changed` event; add a row in `Settings.tsx`
- **New peer-discovery channel**: Create a new module in `src-tauri/src/` (or extend `broadcast.rs`). Spawn worker threads from `lib.rs::run()` alongside `start_discovery` / `start_broadcast`. Write peers into the existing `AppState.peers` HashMap keyed by `instance_name` — **do not** maintain a separate peers map. Emit the existing `peers-changed` event when the set mutates. If your channel has freshness/expiry semantics, track them in a dedicated `HashMap<String, u64>` on `AppState` (see `broadcast_seen` for the pattern) and expire under a dedicated loop. Use the `[your-channel]` log tag and include a `self-loop confirmed` style health check where applicable.
- **Storage**: See `docs/storage.md` for the planned approach (tauri-plugin-store for prefs, SQLite for history)

## Releasing a New Version

Every version bump must update **all 4 files** — missing one causes the app to show stale version info:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src/components/Settings.tsx` | Hardcoded `Version X.Y.Z` string in About section |

After editing `Cargo.toml`, run `cargo check` in `src-tauri/` to regenerate `Cargo.lock`.

### Release checklist

1. **Bump version** in all 4 files above + update `CHANGELOG.md` header
2. **Commit**: `chore: release vX.Y.Z`
3. **PR → merge to main** (branch protection requires PR)
4. **Tag on main**: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. **CI builds automatically** — triggered by `v*` tag push:
   - `create-release` job runs first: calls `gh release create --notes "$(gh api .../releases/generate-notes | grep -v '^\* chore: release v[0-9]')"` to publish the GitHub release with an auto-generated "What's Changed" list of PRs merged since the previous tag, plus a **Full Changelog** compare link
   - The `grep -v` filter strips the `chore: release vX.Y.Z` PR bullet — every release has one by definition and it's noise in the user-facing changelog. If you add any other PR-title patterns that should always be hidden from release notes (docs-only churn, CI-only tweaks, etc.), extend the grep pattern in `release.yml`
   - `build` matrix then builds aarch64 + x86_64 DMGs and uploads them to that same release
   - Write PR titles in conventional-commit style (`feat:`, `fix:`, `chore:`, etc.) — they become the release-note bullet text verbatim
6. **Update Homebrew cask** after CI publishes DMG artifacts:
   - Download both DMGs: `gh release download vX.Y.Z --pattern "*.dmg"`
   - Compute hashes: `shasum -a 256 *.dmg`
   - Update `Casks/ani-mime.rb` in `vietnguyenhoangw/homebrew-ani-mime` with new version + SHA256s

### Naming conventions

- **Branch**: `release/vX.Y.Z`
- **Tag**: `vX.Y.Z`
- **Commit message**: `chore: release vX.Y.Z`
- **DMG artifacts**: `ani-mime_X.Y.Z_aarch64.dmg`, `ani-mime_X.Y.Z_x64.dmg`
- **Homebrew tap**: `vietnguyenhoangw/homebrew-ani-mime` → `Casks/ani-mime.rb`
