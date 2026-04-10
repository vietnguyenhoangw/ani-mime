# Changelog

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
