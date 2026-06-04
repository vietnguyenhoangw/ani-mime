use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use serde::Serialize;
use tauri::Emitter;
use crate::plugin::PluginRecord;

/// Payload emitted when a task finishes (busy -> idle).
#[derive(Clone, Serialize)]
pub struct TaskCompleted {
    pub duration_secs: u64,
}

/// A peer discovered via mDNS on the local network.
#[derive(Clone, Serialize)]
pub struct PeerInfo {
    pub instance_name: String,
    pub nickname: String,
    pub pet: String,
    pub ip: String,
    pub port: u16,
}

/// A dog currently visiting this screen.
#[derive(Clone, Serialize)]
pub struct VisitingDog {
    pub instance_name: String,
    pub pet: String,
    pub nickname: String,
    pub arrived_at: u64,
    pub duration_secs: u64,
    /// Optional one-line message from the sender. When present, the
    /// frontend renders it as a persistent speech bubble for the full
    /// visit duration instead of showing a random greeting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Per-shell session state.
#[derive(Clone)]
pub struct Session {
    /// "task", "service", or "" (idle)
    pub busy_type: String,
    /// Current UI state emitted for this session.
    pub ui_state: String,
    /// Last time we heard anything from this PID (heartbeat or status).
    pub last_seen: u64,
    /// When this session entered "service" state (0 = not in service).
    pub service_since: u64,
    /// When this session entered "busy" state (0 = not busy).
    pub busy_since: u64,
    /// Human-readable session title (directory basename).
    pub title: String,
    /// Full working directory path (for grouping in the UI).
    pub pwd: String,
    /// TTY device (e.g. "/dev/ttys001") — identifies the terminal window.
    pub tty: String,
    /// Set by proc_scan: this shell has a `claude` process as a child/descendant.
    pub has_claude: bool,
    /// PID of the claude process running inside this shell, if any.
    pub claude_pid: Option<u32>,
    /// Set by proc_scan: this session's PID *is* itself a claude process
    /// (created by the pid=$PPID Claude Code hook). UI hides these from the
    /// dropdown — their state is overlaid onto the parent shell row instead.
    pub is_claude_proc: bool,
    /// Name of the foreground command running in this shell (e.g. "claude",
    /// "node", "bun"). Empty if the shell is idle at its prompt.
    pub fg_cmd: String,
}

impl Session {
    pub fn new_idle(now: u64) -> Self {
        Session {
            busy_type: String::new(),
            ui_state: "idle".to_string(),
            last_seen: now,
            service_since: 0,
            busy_since: 0,
            title: String::new(),
            pwd: String::new(),
            tty: String::new(),
            has_claude: false,
            claude_pid: None,
            is_claude_proc: false,
            fg_cmd: String::new(),
        }
    }
}

/// Serializable session info returned to the frontend.
#[derive(Clone, Serialize)]
pub struct SessionInfo {
    pub pid: u32,
    pub title: String,
    pub ui_state: String,
    pub pwd: String,
    pub tty: String,
    pub busy_type: String,
    pub has_claude: bool,
    pub claude_pid: Option<u32>,
    pub is_claude_proc: bool,
    pub fg_cmd: String,
}

pub struct AppState {
    pub sessions: HashMap<u32, Session>,
    /// What the frontend is currently showing.
    pub current_ui: String,
    /// When the UI entered "idle" state (0 = not idle).
    pub idle_since: u64,
    /// True when idle countdown triggered sleep. Only busy/service wakes up.
    pub sleeping: bool,
    // --- Peer visits ---
    pub peers: HashMap<String, PeerInfo>,
    pub visitors: Vec<VisitingDog>,
    pub visiting: Option<String>,
    // --- Discovery diagnostics ---
    pub discovery_instance: String,
    pub discovery_addrs: Vec<String>,
    pub discovery_port: u16,
    /// Last time each peer was heard from via UDP broadcast (unix secs).
    /// Peers only in this map (not refreshed by mDNS) are pruned by the broadcast watchdog.
    pub broadcast_seen: HashMap<String, u64>,
    // --- Identity (for MCP pet-status) ---
    pub pet: String,
    pub nickname: String,
    pub started_at: u64,
    // --- Usage tracking (auto-resets daily) ---
    pub tasks_completed_today: u32,
    pub total_busy_secs_today: u64,
    pub longest_task_today_secs: u64,
    pub last_task_duration_secs: u64,
    pub usage_day: u64,
    /// Hash of the session fields exposed to the UI. `emit_if_changed` emits
    /// `sessions-changed` only when this value shifts, so the frontend can
    /// stay event-driven instead of polling.
    pub last_sessions_fingerprint: u64,
    /// Installed plugins, keyed by manifest `id`. Populated at startup by
    /// `plugin::loader::scan_plugins` and mutated by install/uninstall.
    pub plugins: HashMap<String, PluginRecord>,
    /// OS clipboard history (newest first, capped at 20), captured by the
    /// `plugin::clipboard` monitor while a `clipboard`-capable plugin is
    /// enabled. Exposed to plugins via the `clipboard` capability.
    pub clipboard_history: Vec<String>,
}

/// Deterministic hash of the session fields the UI renders. Pids are sorted so
/// the result doesn't depend on `HashMap` iteration order.
fn sessions_fingerprint(sessions: &HashMap<u32, Session>) -> u64 {
    let mut pids: Vec<u32> = sessions.keys().copied().collect();
    pids.sort_unstable();

    let mut h = DefaultHasher::new();
    for pid in pids {
        let s = &sessions[&pid];
        pid.hash(&mut h);
        s.ui_state.hash(&mut h);
        s.busy_type.hash(&mut h);
        s.pwd.hash(&mut h);
        s.title.hash(&mut h);
        s.tty.hash(&mut h);
        s.has_claude.hash(&mut h);
        s.claude_pid.hash(&mut h);
        s.is_claude_proc.hash(&mut h);
        s.fg_cmd.hash(&mut h);
    }
    h.finish()
}

/// Picks the "winning" UI state across all sessions.
/// Priority: busy > service > idle.
pub fn resolve_ui_state(sessions: &HashMap<u32, Session>) -> &'static str {
    let mut has_service = false;
    let mut has_idle = false;

    for s in sessions.values() {
        match s.ui_state.as_str() {
            "busy" => return "busy",
            "service" => has_service = true,
            "idle" => has_idle = true,
            _ => {}
        }
    }

    if has_service {
        "service"
    } else if has_idle {
        "idle"
    } else {
        "disconnected"
    }
}

pub fn emit_if_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let new_ui = resolve_ui_state(&state.sessions);

    // If sleeping, only wake up for busy or service
    if state.sleeping {
        if new_ui == "busy" || new_ui == "service" {
            crate::app_log!("[state] waking from sleep for {}", new_ui);
            state.sleeping = false;
        } else {
            // Still check for session-set changes even while sleeping, so the
            // session-list UI updates (e.g. a shell exiting shouldn't wait for
            // the next global transition).
            maybe_emit_sessions_changed(app, state);
            return;
        }
    }

    if new_ui != state.current_ui {
        crate::app_log!("[state] ui transition: {} -> {}", state.current_ui, new_ui);

        // Track when UI enters idle for sleep countdown
        if new_ui == "idle" {
            state.idle_since = crate::helpers::now_secs();
        } else {
            state.idle_since = 0;
        }
        if let Err(e) = app.emit("status-changed", new_ui) {
            crate::app_error!("[state] failed to emit status-changed: {}", e);
        }
        state.current_ui = new_ui.to_string();
    }

    maybe_emit_sessions_changed(app, state);
}

fn maybe_emit_sessions_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let fp = sessions_fingerprint(&state.sessions);
    if fp != state.last_sessions_fingerprint {
        state.last_sessions_fingerprint = fp;
        if let Err(e) = app.emit("sessions-changed", ()) {
            crate::app_error!("[state] failed to emit sessions-changed: {}", e);
        }
    }
}
