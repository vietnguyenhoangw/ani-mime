# Changelog

## [0.18.1] - 2026-06-16

### Added
- **Quick Coffee plugin.** Assign a system-wide hotkey to any website and open it in a chosen browser (macOS lists installed browsers; other platforms use the OS default). Hotkeys fire even with the window closed and after a restart. Manage sites in an app-styled window with a reorderable list, per-item URL + hotkey, and a one-click "Open".
- **`browser` plugin capability.** Lets a plugin list installed browsers, open an `http`/`https` URL in a chosen one, and register per-item global hotkeys (host-owned and persisted).
- **Clearable launch hotkeys.** A plugin's launch shortcut can now be left empty / cleared from the Plugin Manager.

### Changed
- **Plugin data survives reinstall.** Per-plugin storage and hotkey bindings now live in `~/.ani-mime/plugin-data/<id>/`, outside the directory removed on uninstall.

## [0.18.0] - 2026-06-15

### Added
- **Mini bar mode.** A minimize button on the status pill collapses the floating pet into a thin status bar docked to a screen edge. Hold the grip to drag it; it magnet-snaps to the nearest edge on release (vertical on the sides, horizontal on top/bottom) and is multi-monitor aware. The bar shows the live status color, and its session/peer tools each open their own window (the session list as a clipboard-manager-style dialog). On macOS the window opts out of Sequoia edge-tiling while docked.

## [0.17.14] - 2026-06-08

### Fixed
- Quick Translate no longer re-prompts for macOS Accessibility permission on every popup launch. It now asks at most once per app run — grant access, restart the app once, and selection pre-fill works silently thereafter.

## [0.17.13] - 2026-06-07

### Added
- **Quick Translate plugin.** Hotkey-launched popup (`Cmd/Ctrl+Shift+T`) that translates text inline (server-side via Google's free endpoint, no CORS) with quick language pickers, a swap button, and an **Open in Google Translate** button. Pre-fills from the text selected in the frontmost app at hotkey time (macOS; requires Accessibility permission).
- **`translate` and `selection` plugin capabilities.** New gated `window.ani` APIs — `translate.text` / `translate.openWeb`, and `selection.read` (host-captured selection).
- **Edit menu** (Undo/Redo/Cut/Copy/Paste/Select All) — enables the standard `Cmd+C/V/X/A/Z` shortcuts across all app windows.

### Fixed
- Installing a plugin from the file dialog no longer freezes the app (the command ran on the main thread and deadlocked on the picker callback).
- Plugin hotkey reassignment now accepts Option (`⌥`) based shortcuts (resolved from the physical key code).

## [0.17.12] - 2026-06-04

### Added
- **Plugin system.** Install, enable/disable, launch, and uninstall mini-app plugins from a `.zip` via a new **Plugins** tab in Settings. Plugins run sandboxed in their own WebView (`plugin://` scheme) with a `window.ani` SDK gated by declared capabilities (`window`, `storage`, `clipboard`).
- **Clipboard Manager plugin + native clipboard capability.** A background monitor keeps your last 20 copies (deduped, newest-first) while a clipboard-capable plugin is enabled; the plugin shows the history and pastes any entry back with one click.
- **Global launch hotkeys.** A plugin's manifest hotkey opens it from anywhere; reassign it by clicking the hotkey badge in the Plugins tab.
- **Cmd/Ctrl+W quick-close** for dialog windows (Settings, Superpower, Peer List, Session List) and plugin windows.

## [0.17.8] - 2026-05-05

### Changed
- **LAN Peer List toggle now fully gates the LAN feature.** Turning it off skips mDNS discovery, UDP multicast/unicast announces, and the periodic discovery heartbeat at startup — previously these all kept running even with the toggle off, only the status-pill icon was hidden. The "No friends nearby! Check Privacy → Local Network" speech bubble is also suppressed live when the toggle is off. Toggling the setting requires a restart for the LAN scanner to start or stop.

### Fixed
- **Session list dropdown no longer cancels in-flight window drags.** Closing the dropdown mid-drag preserves the dragged window position instead of snapping back.
- **Session list button hover/active state is now rounded** to match the pill, no more sharp-cornered hover artifact.

## [0.17.7] - 2026-05-05

### Fixed
- **Claude Code mirror no longer flickers between Working… and Free during auto-compaction.** Recent Claude Code versions fire `SessionStart(source="compact")` mid-turn; the inline curl hooks couldn't read stdin JSON to distinguish that from `startup`/`resume`/`clear`, so the pill flipped to Free and back. Replaced the inline curl with a single stdin-aware Node hook script (`~/.ani-mime/hooks/ani-mime-hook.mjs`) that ignores `compact` and routes the rest correctly.
- **Pill no longer sticks at Working… when Claude is waiting on the user.** Subscribed to `Notification(permission_prompt|idle_prompt)` → idle, so the mirror flips to Free during permission dialogs and back to Working… when you approve.
- **Pill no longer sticks at Working… after a turn fails.** Subscribed to `StopFailure` → idle, mirroring the existing `Stop` mapping.
- Existing settings.json migrates automatically on launch — legacy curl hooks are rewritten in place; unrelated hooks (e.g. masko-desktop) are untouched.

### Changed
- **LAN peer list defaults to off** for new users; square icon in the session list dropdown for visual consistency with the peer-count badge.

## [0.17.6] - 2026-04-29

### Changed
- **Fixed-default pet window with explicit size triggers** — the main window now starts at a single fixed default and only grows when a named trigger fires (session list, visitors, speech bubble), shrinking back when the trigger clears. Removes the cascade of auto-size effects that could leave the window in inconsistent states.

### Fixed
- **DEV Tag toggle no longer kills the bounds outlines.** Toggling DEV Tag off in the Superpower tool used to call `set_dev_mode(false)`, which dropped the App / Container / Root bounds visuals along with the tag. The toggle now emits a dedicated `dev-tag-changed` event and only hides the DEV tag.
- **Auto-open Superpower on dev unlock** — clicking the version label 10 times now opens the Superpower window automatically, not just enables dev mode silently.

## [0.17.5] - 2026-04-23

### Fixed
- **Window no longer gets stuck at an oversized 1200×1200 after busy transitions.** The shadow-clone effect expanded the window even when its toggle was off, and rapid busy→idle→busy could corrupt the saved pre-expansion baseline so the next "restore" locked the window at the expanded size. Disabled effects now skip the expand path entirely, and the baseline capture is guarded against reentrant overwrites.

## [0.17.4] - 2026-04-23

### Added
- **Session-count badge** on the pill task icon, showing the number of active session groups (grouped by pwd) — matches the peer-count badge style.
- **Expo / React Native command classification** — `bun run ios`, `bun run android`, `expo run:*`, `npx expo …` now classify as `service` across zsh / bash / fish. Previously stayed busy indefinitely.

### Changed
- **Event-driven session updates** — backend emits a fingerprint-gated `sessions-changed` event whenever session state mutates (including `proc_scan` passes, which used to mutate silently). `useSessionGroupCount`, the `StatusPill` dropdown, and the `SessionListApp` window all drop their 3-second polls and listen to the event instead.
- Removed the redundant per-group child-count pill inside dropdown rows.

### Fixed
- **Peer-count badge** now survives window reload / HMR — added a `get_peers` Tauri command; `usePeers` seeds from it on mount instead of waiting for a `peers-changed` event that only fires on add/expire.
- **Path tooltip** no longer gets clipped by the window edge — it measures itself after render and clamps both axes to the viewport, wrapping long paths instead of overflowing. Arrow tracks the `?` icon after clamping and flips automatically when placed below.

## [0.17.3] - 2026-04-22

### Added
- **Sound effects** — Ani-Mime now reacts audibly to meaningful events: a kalimba chime on status transitions (searching, idle, service, disconnected, visiting), an optional working loop while a task runs, a "Done" chime when it finishes, a doorbell when a peer's mime visits, and a tap when you click the session or LAN peer icon.
- **Sound tab in Settings** — master toggle, per-category toggles (Status / Visit), and a collapsible card per status case so each transition's sound can be swapped, silenced, or previewed with ▶.
- **Sound Library** — import your own audio files (MP3/WAV/OGG/M4A/AAC/FLAC up to 2 MB), delete customs you don't want, and pick them in any case dropdown. Bundled defaults are read-only.
- **Loop While Busy** toggle in the Working case (default off) — choose between a looped working sound or a single tap at task start.
- **Multi-image Smart Import** — the Import Sheet flow now accepts multiple images at once (Cmd+click in the picker). Each imported image shows as a removable tag; adding more preserves your existing frame assignments, removing one drops only that image's frames.
- **Duplicate frame (+)** — each frame chip in Smart Import has a + button that inserts a copy of that frame right after itself, handy for repeated frames in an animation.
- **Deep-link install** (`animime://`) — install marketplace mimes by clicking an `animime://` URL. Thanks @cuongtranba (#114)

### Changed
- **Working sound default** — now Kalimba, matching the other status defaults.

## [0.17.2] - 2026-04-21

### Added
- **Stable root-window baseline** — the main window is always at least 320 × 250 and collapses back to that size after any transient growth (bubble, session list, visiting pets). Three named growth modes: session list → 400 tall, 1–3 visitors → 500 wide, speech bubble → grows container padding to fit multi-line messages. See `docs/window-sizing.md`.
- **Multi-line speech bubble** — long messages wrap to multiple lines (cap 280 px wide) instead of extending past the window. Tail re-centered so it always points at the pet.
- **Dev-build badge hover tooltip** — hovering the centered "DEV" badge (dev builds only) shows a guideline: "Click Version in Settings 10× to unlock Superpower."
- **Dev layout outlines** auto-enable when dev mode is activated (and auto-hide when it's off). Three toggleable outlines in the Superpower tool: App Bounds (purple), Container (red), Root (green).
- **Ultra-long-bubble scenario** in Superpower → Scenarios → Pet Status, for overflow testing.
- **Docs: `docs/window-sizing.md`** — full reference for the baseline + growth modes + change recipes.

### Changed
- **Local Network permission** — the Settings button now reliably opens System Settings → Privacy & Security and uses `osascript reveal anchor` on Ventura+ to scroll to the Local Network row. Hint text tells the user which toggle to flip.
- **Session list dropdown** — caps total window height at 400 and scrolls inside that budget when the list is long, instead of growing the window taller every open.

### Fixed
- **Mascot jitter on status change** (busy → idle flash + one-frame stretch) caused by stale sheet dimensions during sprite swap.
- **Sprite shift when speech bubble appears/disappears** — bubble moved out of the flex flow so its visibility no longer nudges the pet.
- **Pill popovers no longer overlap** — opening the session list closes the peer list and vice versa.
- **Duplicate visitors on a single arrival** — React Strict Mode's useEffect double-invoke was adding each visitor twice; now deduped by instance name.
- **`useScale` hardcoded window sizes** removed — was forcing the window to 500 × 220 at sprite scale 1 on every launch, fighting the auto-size pipeline.

## [0.17.1] - 2026-04-20

### Added
- **Mime opacity slider** in Settings → General → Transparency — drag to fade the mime live, click Save to persist.
- **Status bar opacity slider** in the same section — fades the status pill independently of the mime.

### Changed
- **Session dropdown open/close** is smoother and the path tooltip is no longer clipped by the dropdown's overflow bounds.
- **LAN peer list toggle** added under Settings → General → Status Bar so the peer icon can be hidden entirely.

## [0.17.0] - 2026-04-20

### Added
- **Chat-message visits** — click the new chat icon next to any peer in the network list to open a compose dialog. Write up to 100 chars, press Enter (or Send), and your pet visits theirs for 8 seconds carrying the message as a persistent speech bubble. Uses the existing `/visit` HTTP route + `visitor-arrived` event with an optional `message` field — no new endpoints, no stored history. (#101)
- **Unified status bar** — the status pill and the peer (p2p) button are merged into a single action bar: `● Free ——— [task] [lan]`. Left: status dot + label. Right: task icon opens the session list, lan icon opens the peer list. Peer-count badge shows on the lan icon when peers are nearby. (#101)
- **Peer list in a dedicated Tauri popover window** — `Mime Around You` no longer grows the main widget. Clicking the lan icon opens a transparent popover next to the pet; the popover follows the pet when you drag, closes on focus loss / Escape. (#101)
- **Visitor greeting bubbles** — each arriving visitor now shows a random one-line greeting (5s auto-fade) from a 16-line pool. When a visit carries a chat message, that message is shown instead and stays visible for the full visit. (#101)
- **Visitors scenario** in SuperpowerTool — emits the same `visitor-arrived` / `visitor-left` events real peers use, so multi-pet layout + greeting bubbles can be previewed without a live LAN peer. (#101)
- **`.animime` v2 export format** for Smart Import mimes — embeds only the source sheet + frame-input strings instead of per-status base64 sprite blobs. Cuts typical export size ~8x (Naruto Kyuubi: 2.2 MB → 1.2 MB, now under the 2 MB marketplace upload cap). v1 files (manual-creator mimes, older Smart Import exports) continue to import via the unchanged v1 code path. (#100, @yanmad27)
- **Import errors now surface in the Settings UI** instead of being swallowed into the log. (#100, @yanmad27)

### Fixed
- **Smart Import was silently dropping sprite frames** — `removeSmallComponents()` was filtering every detected region classified as "text noise", shrinking the Naruto Kyuubi sheet from 277 → 228 frames and breaking round-trips for any frame range above 228. Removed the filter so every detected region survives. (#100, @yanmad27)
- **Session-list dropdown clipping on the left edge** — the dropdown was centered on the status pill, but the pill sits near the window's left edge so half the dropdown was cut off by the window bounds. Dropdown is now fixed-positioned and centered on the viewport instead of the pill. Max-height 280px with internal vertical scroll so many-session lists don't produce a comically tall window. (#101)
- **Peer icon being pushed to the right when session list opened** — the session dropdown was inflating the pill-wrap's width, shifting the peer button. Session dropdown is now absolute-positioned and doesn't affect layout; the main window grows only when the dropdown opens. (#101)

### Changed
- **Visit duration 15s → 8s.** Both plain visits and message visits last the same 8s. Kept as separate constants (`VISIT_DURATION_SECS`, `MESSAGE_VISIT_DURATION_SECS`) so they can diverge later without touching the plain-visit path. (#101)
- **Visitor name tag moved below the sprite** (was above). (#101)
- **Status bar is tighter** — label font 13px → 11px, action buttons 24×24 → 20×20, dot 8px → 7px. Whole bar is ~20% shorter vertically. (#101)
- `parseFrameInput` / `serializeFrames` moved to `spriteSheetProcessor.ts` to break the `useCustomMimes` ↔ `SmartImport` import cycle. `SmartImport` re-exports them for existing test imports. (#100, @yanmad27)

## [0.16.6] - 2026-04-20

### Added
- **Resilient peer discovery** — peer discovery now runs across three parallel channels (mDNS + UDP multicast + UDP unicast `/24` subnet scan), so peers are found on networks where any one channel is blocked. A new `broadcast.rs` module handles the UDP channels on port `1235`; all three channels feed the same `AppState.peers` keyed by `instance_name` so the UI and visit protocol are unchanged. (#98)
- **`[broadcast]` diagnostic logging** — new log tag with explicit lines for socket bind, multicast join, per-scan summary, `NEW peer` / `refresh peer` / `EXPIRED peer` transitions, and a one-shot `self-loop confirmed` line that proves the local multicast send→recv pipeline is healthy. Makes triaging "peers not finding each other" issues grep-friendly. (#98)
- **Network-compatibility matrix & troubleshooting guide** in `docs/peer-discovery.md` — covers which channel wins on which network type (home WiFi / managed WiFi with Bonjour Gateway / VLAN) and how to read the log to pinpoint failures. (#98)

### Fixed
- **Peer discovery on managed WiFi / enterprise networks** — on networks running a Bonjour Gateway that allowlists specific mDNS service types (common in offices and co-working spaces), `_ani-mime._tcp` was silently dropped even between machines on the same subnet. The new UDP unicast subnet scan bypasses multicast filtering entirely by direct-poking every IP in the local `/24` every 30s. (#98)

### Changed
- New `AppState.broadcast_seen: HashMap<String, u64>` tracks last-heard-from time per peer; the expiry loop removes peers silent for `PEER_EXPIRY_SECS` (30s).
- `lib.rs` now spawns both `discovery::start_discovery` and `broadcast::start_broadcast` in parallel on startup.

## [0.16.5] - 2026-04-20

### Added
- **Linux / WSL2 support** — Ani-Mime now runs on Linux and WSL2 via a cross-platform backend facade. Native Linux uses GTK `set_keep_above`; WSLg uses a `SetWindowPos(HWND_TOPMOST)` PowerShell shim, re-asserted on every focus-lost event so the pet stays on top after clicking into other maximized Windows apps. Dialogs use `zenity`, file/URL open uses `xdg-open`. macOS is unchanged. (#81, @cuongtranba)
- **Linux release artifacts in CI** — tag pushes now build and publish `.deb`, `.rpm`, and `.AppImage` for both `x86_64` and `aarch64` alongside the existing macOS DMGs. A release now ships 8 artifacts (2 DMGs + 6 Linux bundles). (#93)
- **Claude Code Management UI screenshot** — new `docs/assets/settings-claude-code.png` added to the README Screenshots table with a dedicated Features bullet describing the Settings → Claude Code tab. (#93)

### Fixed
- **Updater auto-install compile break** — the auto-install branch called `update_now(&app_handle)` with one argument while the function requires `(app_handle, release_url)`. This was a hard `E0061` compile error on Linux and a silent hole on macOS where auto-install never reached the upgrade flow. `release_url` is now computed once per run and passed to both the auto-install path and `show_update_dialog`. (#93)
- **macOS full-screen Spaces** — pet now floats over full-screen apps on every Space (`setCollectionBehavior` switched from `fullScreenNone` to `fullScreenAuxiliary`). (#81)
- **Peer discovery & visit flow** — hardened to match snor-oh parity; visitors now render reliably with a fallback sprite for unknown pet types. (#92)
- **Claude Code settings — MCP Servers** — "Global" and per-project sub-headers no longer hug the card's left edge; horizontal padding bumped from `0` to `12px` so they align with the server rows below. (#93)
- **Claude Code settings — Commands** — the expanded `/command` body (shown after tapping View) now sits inside the card with `12px` left/right margin instead of stretching flush edge-to-edge. (#93)
- **Claude Code settings — Plugins** — plugin rows now match the 2-line rhythm used by MCP, Commands, and Hooks: name + version badge on line 1, marketplace on line 2. The enable/disable toggle keeps its full size on narrow windows (`.toggle-switch` gets `flex-shrink: 0`). The plugin skills expand toggle ("N skills") is temporarily hidden pending UX work. (#93)

### Changed
- `.claude-item-info` now wraps so any row can drop an ellipsized preview onto a second line via `.claude-cmd-preview { flex-basis: 100%; }`. Unifies the layout across Commands, MCP Servers, Plugins, and Hooks rows. (#93)

## [0.16.4] - 2026-04-19

### Added
- **Install Updates Automatically** toggle in Settings (default ON) — when enabled, a detected new version runs `brew upgrade --cask ani-mime` directly instead of showing the Later/Changelog/Update Now dialog. Disable the toggle to restore the confirmation dialog. Manual menu checks always show the dialog. (#88)
- **Collapsible session groups** in the status-pill dropdown. Click a group header to hide its shells; the collapsed state is persisted in `settings.json` under `collapsedSessionGroups` and restored on the next dropdown open. (#90)

### Fixed
- Hook rows and the event-name label in the Claude Code settings tab now align with plugin rows and other row content (removed the `padding-left: 8px` override on `.claude-hook-row`, added horizontal padding to `.claude-hook-header`). (#89)
- Empty-state messages in the Claude Code tab ("No plugins installed", "No MCP servers registered", "No custom commands", "No hooks configured") now render inside the same grey card container as populated lists, keeping visual rhythm. (#89)

### Changed
- Release notes auto-generator now filters out `chore: release vX.Y.Z` PRs so each release's "What's Changed" list only shows real feature/fix PRs.

## [0.16.3] - 2026-04-18

### Added
- **Claude Code plugin manager tab** in Settings — view, enable, disable, and manage installed Claude Code plugins directly from Ani-Mime. (#86, @thanh-dong)

### Changed
- **GitHub release notes are now auto-generated from merged PRs** via `gh release create --generate-notes`. The release page shows a "What's Changed" list linking every PR + author since the previous tag, plus a "Full Changelog" compare link. `CHANGELOG.md` remains the curated long-form history.

## [0.16.2] - 2026-04-18

### Fixed
- **Claude Code session detection for the new `claude.exe` binary** — newer Claude Code releases ship a compiled single-file binary named `claude.exe` (with `claude` as a PATH symlink). `proc_scan` was still matching only `"claude"`, so on the owning shell's row the claude icon disappeared, the label showed `"claude.exe"`, and the claude session was dropped as a zombie every 2s — making the pet's busy/idle mirror flap instead of sticking on busy while Claude worked. `is_claude()` now matches both `"claude"` and `"claude.exe"`.
- **`ssh` classified as a service** — long-running SSH sessions were stuck on `busy` for the full connection, keeping the pet visually working the entire time. `ssh` now flashes service then returns to idle, matching `dev` / `serve` / `watch` etc.

### Added
- **`DEV` badge over the mascot** when running via `bun run tauri dev`. The badge is driven by Vite's build-time `import.meta.env.DEV` flag, so it tree-shakes out of release builds — zero visual change for installed-app users. Makes it easy to tell the running dev build apart from the installed `/Applications/Ani-Mime.app` at a glance.

## [0.16.1] - 2026-04-15

### Added
- **Session List Dropdown** — Click the status pill to see every open terminal grouped by project path. Each row shows state (busy / idle / service), foreground command, and a Claude Code badge when `claude` is running inside.
- **Click-to-Focus** — Click any shell row to jump directly to that terminal tab. Supports iTerm2 and Terminal.app (tab-precise via AppleScript), VS Code / Cursor (window focus via Accessibility), tmux (pane switch via CLI), plus Warp / WezTerm / kitty / Alacritty / Hyper / Ghostty (activation only).
- **OS Process Scanner** — 2-second `libproc` scan auto-discovers shells without needing the zsh hook, enriches pwd / tty / foreground command, detects running Claude Code instances, and removes zombie sessions immediately.
- **Per-Claude Session Tracking** — Claude Code hooks migrated from shared `pid=0` to `pid=$PPID`, so each Claude tab has its own session. Existing `~/.claude/settings.json` hooks are auto-migrated on every startup.
- **Session List toggle** in Settings (enabled by default) — lets users opt out of the feature.
- **`QuangHo0911`** added to the contributors grid on the About page.

### Fixed
- **Neon-glow clipping** — busy-state pulse was cut off at the window edge; container now reserves padding to fit the glow.
- **Effect toggle init flash** — disabled effects (e.g. Shadow Clone) briefly appeared "on" when reopening Settings. Hook now uses a module-level cache to start from the persisted value on every mount.
- **Tray is locked on while "Hide from Dock" is enabled** — prevents losing all access to Settings when both would be off.
- **Session list updates live while open** (hybrid `status-changed` event + 3s fallback poll) — no close/reopen required.

### Changed
- Shell hook scripts (zsh / bash / fish) now send `pwd` and `tty` via `curl -G --data-urlencode` for safe URL encoding and include them on every `/status` and `/heartbeat`.
- `/status` and `/heartbeat` return `410 Gone` when the PID isn't a live process — prevents orphaned heartbeat subshells from resurrecting dead sessions.
- Services shown in the session list keep their service color for the entire lifetime of the dev server (not just the 2s watchdog window).
- macOS menu bar no longer shows the Edit submenu.

### Docs
- Added a "Session List & Click-to-Focus" section to README with the full terminal-app support matrix.
- Updated `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/state-management.md`, `docs/http-api.md`, `docs/events-reference.md`, `docs/project-structure.md`, and `docs/shell-integration.md` to reflect the new modules, fields, events, Tauri commands, HTTP params, and terminal-app support matrix.

## [0.15.5] - 2026-04-14

### Added
- **MCP Server** — Claude Code can now interact with your desktop pet via Model Context Protocol (MCP) tools
  - `pet_say` — trigger a speech bubble with a custom message
  - `pet_react` — play a temporary reaction animation (celebrate, nervous, confused, excited, sleep)
  - `pet_status` — query the pet's current status, uptime, visitors, and nearby peers
- Zero-dependency Node.js MCP server (`server.mjs`) using JSON-RPC 2.0 over stdio
- MCP server auto-installed to `~/.ani-mime/mcp/` on every app launch (keeps up-to-date)
- MCP server auto-registered in `~/.claude.json` during first-launch Claude Code setup
- Manual setup: `claude mcp add ani-mime -- node ~/.ani-mime/mcp/server.mjs`
- New HTTP endpoints: `POST /mcp/say`, `POST /mcp/react`, `GET /mcp/pet-status`
- New Tauri events: `mcp-say` (speech bubble), `mcp-react` (temporary animation override)
- `pet`, `nickname`, `started_at` fields added to `AppState` for MCP status reporting
- **Smart Import frame selection** — preserve frame order and support directional ranges
- **Local Network permission** — request button in Settings for network access

### Fixed
- Shadow clone effect now works on custom mascots

## [0.15.4] - 2026-04-14

### Added
- **Pluggable effect system** — modular architecture for visual effects on the mascot
- **Shadow Clone animation** — Naruto-style kage bunshin effect triggered on busy status
- **Editable Smart Import** — re-edit previously imported custom mimes instead of starting from scratch
- **Smart Import metadata persistence** — source sheet and frame inputs saved for later editing
- **Source sheet cleanup** — deleting a custom mime also removes its source sheet file

### Changed
- Sprite animation engine upgraded from strip-only to 2D grid sheet support via `requestAnimationFrame`

### Fixed
- Dark outline artifact on transparent window after shadow-clone effect restores window shadow
- `smartImportMeta` preserved through manual editor path
- `arrayBuffer` rejection properly propagated in Smart Import canvas encoder

### Tests
- Smart Import edit-mode smoke tests and e2e round-trip assertions

## [0.15.3] - 2026-04-13

### Added
- **Log file reader** — replace in-memory log buffer with log file tail-reader; LogViewer updated for file-based format with source and debug level
- **SmartImport UX improvements** — direct file picker, auto-preview on blur, frame thumbnails with numbered overlays
- **Reveal in Finder** button in Superpower log toolbar to open the log directory
- **Show in Menu Bar** toggle in Settings to control tray icon visibility

### Changed
- Log level filter buttons replaced with compact dropdown select in Superpower toolbar

### Performance
- Tail-read log file instead of loading entirely — seeks to end and reads only the last N x 256 bytes

### Fixed
- Orphaned CSS block in `superpower.css` causing PostCSS parse error

### Tests
- SmartImport Charlotte flow with frame selection (e2e)
- Charlotte export with real sprite fixtures (e2e)
- Delete and re-import Charlotte via `.animime` file (e2e)
- Window auto-resize to fit sprite content (e2e)
- Split delete and import mime into separate tests (e2e)

### Docs
- Add e2e run guidance and tauri mock reference to CLAUDE.md

## [0.15.2] - 2026-04-12

### Fixed
- **Peer discovery broken in release builds** — added macOS entitlements (`Entitlements.plist`) for network access; Tauri's ad-hoc signing doesn't embed entitlements, so a post-build re-sign step is now required
- **Visitor collision when peers share a nickname** — visitors are now keyed by `instance_name` (unique per process) instead of `nickname`
- **Silent discovery failure** — mDNS daemon, registration, and browse errors now emit a `discovery-error` event to the frontend instead of failing silently
- **Log viewer overflow** — last rows in Superpower log viewer were clipped by container overflow

### Added
- **Menu Bar Tray Icon** — always-visible system tray icon; left-click toggles mascot window, right-click shows menu (Show, Settings, Quit)
- **Hide from Dock** — toggle in Settings to remove app from Dock and Cmd+Tab switcher via `ActivationPolicy`, persisted across restarts
- `src-tauri/Entitlements.plist` — macOS Hardened Runtime entitlements for network client/server, JIT, and library validation
- `bundle.macOS` config in `tauri.conf.json` — explicit entitlements and Info.plist references
- `src-tauri/script/post-build-sign.sh` — re-signs the .app with entitlements and re-creates the DMG after `tauri build`
- `src-tauri/script/install-mac.sh` — installer script for users receiving the app without notarization (removes quarantine)
- Peer visit troubleshooting section in README

### Changed
- Visit protocol now includes `instance_name` field in `/visit` and `/visit-end` request bodies (backward-compatible: falls back to `nickname` for older peers)
- `VisitingDog` struct has new `instance_name` field
- `visitor-arrived` and `visitor-left` events include `instance_name`
- Release workflow updated with post-build entitlement signing step

## [0.15.0] - 2026-04-12

### Added
- **Custom Mime Creator** — create your own mimes with per-status PNG sprites, frame range expressions (e.g. `1-5`, `41-55,57,58`), and auto frame detection from image dimensions
- **Smart Import** — auto-split sprite sheets into individual frames, assign frames to statuses, with chroma key background removal
- **Custom Mime Editing** — edit button on hover to rename or change sprites/frame ranges on existing custom mimes
- **Animation Preview** — click Preview to see animated sprite in a popup instead of static thumbnails
- **.animime Export/Import** — export custom mimes as self-contained `.animime` files for sharing; import to restore them locally
- **Display Scale** — Tiny / Normal / Large / XL size presets for the mascot sprite
- **Auto-resize Window** — window boundary matches visible content (sprite + pill + bubble)
- **Start at Login** — toggle in Settings to launch Ani-Mime on macOS login
- **Auto Update** — toggle in Settings, auto close and relaunch after update
- **Persistent File Logging** — logs written to disk via tauri-plugin-log with rotation (3 files, 1MB max)
- **Bubble Test Scenario** — "Free + Bubble" and "Long Bubble" in Pet Status scenario with persistent bubbles
- **DEV Tag Toggle** — toggle in Superpower toolbar to show/hide the DEV tag
- **Guide PDF** — "Read the guide" link in Create Your Own section
- **New contributor** — setnsail added to the About page
- **E2E tests** — Playwright test suite for app startup, statuses, bubbles, scenarios, settings, and custom sprites
- **Unit tests** — Vitest tests for all hooks and components with full Tauri mock layer
- **C3 architecture docs** — system context, container breakdowns, and component details

### Changed
- Removed Genjuro from built-in sprite roster
- Save button in custom mime forms always enabled — shows red validation errors instead of being disabled
- Refactored documentation: consolidated guides, added new references

### Fixed
- Zsh and bash job notifications from terminal-mirror hook
- Visible window boundary at large sprite scales
- Sprite sheets read via FS plugin instead of asset protocol
- Status pill glow shadow no longer clipped by window auto-resize

## [0.14.19] - 2026-04-10

### Added
- **Dialog Preview scenario**: New scenario in Superpower Tool to preview all native macOS dialogs and speech bubbles without side effects (update alerts, setup dialogs, bubbles)

### Changed
- **Native update dialog**: Replaced in-app update banner with native macOS alert dialog (Later / Changelog / Update Now)
- **Check for Updates menu**: Added "Check for Updates..." item to the macOS menu bar for manual update checks

## [0.14.16] - 2026-04-09

### Added
- **New contributor**: thanh-dong added to the About page

### Fixed
- Peer detection not working in release mode on macOS (added Info.plist with Bonjour networking entitlements)
- Unused variable in UpdateBanner causing CI build failure
- Version display in Settings now shows correct version

## [0.14.15] - 2026-04-08

### Added
- **In-app update checker**: Background check for new GitHub releases with dismissible update banner
- **Auto-dismiss speech bubble**: Bubble hides automatically when status transitions to busy or service

### Changed
- Claude Code setup dialog only appears when CLI is installed — no more prompt when Claude is not found
- Friendlier Claude Code setup dialog copy describing real-time mascot reactions

### Fixed
- Claude Code hooks no longer error when Ani-Mime is not running (silent fail with `--max-time 1`)

## [0.14.12] - 2026-04-08

### Added
- **Mime tab**: Dedicated settings tab for character selection with categorized grid (Pet, Character) and nickname input with save button
- **Samurai & Hancock**: Two new character sprites with full animation sets
- **Glow modes**: Glow effect upgraded from toggle to 3-mode selector (Off / Light / Dark)
- **Contributors section**: About page now shows contributors with GitHub avatars and a thank-you message
- `MimeCategory` type system for organizing mimes into extensible categories

### Changed
- Pet selection moved from General to its own Mime sidebar tab
- Pet grid now displays 4 items per row with compact card sizing
- Author and Twitter combined into a single row in About
- Nickname input now requires explicit Save button instead of saving on every keystroke

### Fixed
- Hancock sleep sprite: use single-frame image instead of multi-frame reference
- Peer discovery on macOS with enhanced diagnostic logging

## [0.14.3] - 2026-04-08

### Added
- **Superpower Tool**: Hidden devtool (easter egg) with sidebar menu layout, activated by clicking version text 10 times in Settings > About
- **Log viewer**: Real-time in-app log viewer with info/warn/error levels, text search, level filtering, color-coded module tags, and auto-scroll
- **Scenarios**: Visual testing mode that overrides mascot state — Pet Status scenario with buttons for all 7 statuses
- Global logger with `app_log!`/`app_warn!`/`app_error!` macros and 1000-entry ring buffer
- Comprehensive error handling and logging across all backend modules (discovery, server, watchdog, setup, state, platform)
- "SCENARIO" badge on mascot during test mode, "DEV" tag below status pill when dev mode is active
- Dev mode is session-only — resets on app restart

## [0.14.2] - 2026-04-08

### Fixed
- Peer discovery now advertises local IP and accepts external connections

## [0.14.1] - 2026-04-07

### Fixed
- Center mascot, status pill, and speech bubble within main window
- Settings content area now scrollable when content overflows

## [0.14.0] - 2026-04-07

### Added
- **Peer Visits**: Pets can visit each other across the local network via mDNS discovery
- mDNS-based peer discovery using `mdns-sd` crate
- `/visit` and `/visit-end` HTTP routes for cross-machine pet communication
- `VisitorDog` component with slide-in animation for visiting pets
- Right-click context menu to select which peer to visit
- Nickname setting for peer identity in Settings
- New "visiting" status type with purple dot indicator
- Configurable HTTP port via `ANI_MIME_PORT` environment variable
- Visitor watchdog for automatic cleanup of stale visits

### Fixed
- Handle hostname returning IP instead of proper hostname

### Changed
- Main window widened to accommodate visiting dogs

## [0.13.25] - 2026-04-07

### Added
- Speech bubble notifications on task completion with random fun messages
- Welcome bubble greeting on first "Free" status after app launch
- Neon glow effects on status pill: green pulse on task done, red pulse when busy
- Idle-to-sleep countdown: pet sleeps after 2 minutes of inactivity, wakes on real work
- Speech bubble toggle in Settings > General > Behavior with macOS-style switch
- Theme-aware bubble styling (grey bubble in dark mode, white in light mode)
- `busy_since` tracking for task duration measurement
- `task-completed` Tauri event emitted on busy→idle transition

### Fixed
- Claude Code (pid=0) sessions no longer expire prematurely during long tasks
- Heartbeats now keep busy sessions alive (long-running commands stay as "Working...")
- Fixed "Initializing..." flashing to "Sleep" on first app launch
- Widened mascot window (140→200px) to prevent speech bubble text clipping

### Changed
- Mascot window size increased to 200x190 for bubble space
- Status pill vertical padding reduced (8→6px) for tighter layout
- Added spacing between mascot and status pill

## [0.13.19] - 2026-04-04

### Added
- Native macOS menu bar with About, Settings (Cmd+,), and Quit
- Settings window with sidebar navigation (General, About)
- Dark/light theme toggle for status pill via CSS custom properties
- Pet selection: choose between Rottweiler and Dalmatian
- Dalmatian pixel art sprites (idle, bark, sniff, sit, sleep)
- Preferences persistence via tauri-plugin-store (theme + pet survive restarts)
- Cross-window real-time sync for theme and pet changes
- About page with app info, author, and Twitter link

### Changed
- Mascot window fitted to content size (140x175)
- Status pill colors now driven by CSS variables for theming
- Vite configured for multi-page build (main + settings)

### Fixed
- Opt out of macOS Sequoia window tiling/snapping via NSWindowCollectionBehavior

## [0.2.17] - 2026-04-03

### Fixed
- Setup dialogs only show on first launch — no more repeated prompts on every app open
- App now restarts automatically after first-time setup completes

### Added
- "Setup complete" dialog telling users to open a new terminal tab for tracking to take effect
- `~/.ani-mime/setup-done` marker file to track initialization state (delete to re-run setup)

## [0.2.14] - 2026-04-01

### Added
- Multi-shell support: zsh, bash, and fish
- Smart shell detection with multi-select dialog when 2+ shells are installed
- App quits if user skips setup with no shell configured
- Native macOS setup dialogs (osascript) for first-time configuration
- Claude Code hooks setup dialog (Yes/Skip for both installed and not installed)
- Auto-setup on first launch: injects hooks into shell RC files and Claude Code settings

## [0.2.11] - 2026-04-01

### Changed
- New pixel art cat app icon

## [0.2.0] - 2026-04-01

### Added
- Animated Rottweiler pixel art sprites for each status
  - Sniffing (busy/working)
  - Barking (service/dev server)
  - Sitting (idle/free)
  - Sleeping (disconnected/sleep)
  - Idle (searching/initializing)
- Auto-freeze idle and sleep animations after 10 seconds
- "Initializing..." status with orange pulse for first-time setup
- Disable window shadow
- Show on all macOS workspaces/Spaces
- Bundle shell scripts as Tauri resources

## [0.1.0] - 2026-04-01

### Added
- Initial release
- Floating status pill UI (always-on-top, transparent, draggable)
- Manual Tagging + Heartbeat architecture (no process tree scanning)
- Zsh terminal tracking via preexec/precmd hooks
- Claude Code integration via hooks (PreToolUse, Stop, etc.)
- Multi-session support with priority resolution (busy > service > idle)
- Watchdog for stale session cleanup (40s heartbeat timeout)
- Service command auto-detection (start, dev, serve, watch, metro, etc.)
- Claude alias detection via `whence` (works with any alias)
- GitHub Actions CI for macOS builds (arm64 + x86_64)
- Homebrew Cask distribution
- Debug endpoint (`/debug`) for session inspection
