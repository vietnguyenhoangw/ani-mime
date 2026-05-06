//! Process scanner: enumerates shells/claude via macOS libproc and reconciles
//! against AppState.sessions.
//!
//! Responsibilities:
//!   • Auto-discover user-terminal shells — any zsh/bash/fish whose parent isn't
//!     itself a shell or claude (filters out `zsh -c "..."` subshells).
//!   • Always populate pwd/title from the OS (authoritative — reflects `cd`
//!     immediately, not on next hook).
//!   • Detect each shell's foreground command via the TTY's e_tpgid, so the UI
//!     can show "claude" / "bun run tauri dev" etc. even without hook state.
//!   • Mark which shell has a `claude` descendant (used to attach pid=0 activity
//!     to the right tab).
//!   • Drop sessions whose PID no longer exists (zombie cleanup).
//!
//! Shell hooks remain the authoritative source of ui_state (busy/idle/service
//! transitions). The scanner only ENRICHES — it never flips ui_state.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::state::AppState;

#[cfg(target_os = "macos")]
use libproc::libproc::bsd_info::BSDInfo;
#[cfg(target_os = "macos")]
use libproc::libproc::proc_pid;

// `libproc::proc_pid::pidcwd` is unimplemented on macOS (returns Err). We work
// around it by calling `proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, ...)` via the
// crate's generic `pidinfo::<T>` helper — that gives us the process's current
// working directory. The structs below mirror macOS headers exactly so Rust's
// sizeof matches what the kernel writes.
#[cfg(target_os = "macos")]
mod vnode_ffi {
    use libproc::libproc::proc_pid::{PIDInfo, PidInfoFlavor};
    use std::os::raw::c_char;

    // struct vinfo_stat from <sys/_types/_fsid_t.h> + vnode_info.h
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct VinfoStat {
        pub vst_dev: u32,
        pub vst_mode: u16,
        pub vst_nlink: u16,
        pub vst_ino: u64,
        pub vst_uid: u32,
        pub vst_gid: u32,
        pub vst_atime: i64,
        pub vst_atimensec: i64,
        pub vst_mtime: i64,
        pub vst_mtimensec: i64,
        pub vst_ctime: i64,
        pub vst_ctimensec: i64,
        pub vst_birthtime: i64,
        pub vst_birthtimensec: i64,
        pub vst_size: i64,
        pub vst_blocks: i64,
        pub vst_blksize: i32,
        pub vst_flags: u32,
        pub vst_gen: u32,
        pub vst_rdev: u32,
        pub vst_qspare: [i64; 2],
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct Fsid {
        pub val: [i32; 2],
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct VnodeInfo {
        pub vi_stat: VinfoStat,
        pub vi_type: i32,
        pub vi_pad: i32,
        pub vi_fsid: Fsid,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct VnodeInfoPath {
        pub vip_vi: VnodeInfo,
        pub vip_path: [c_char; 1024],
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct VNodePathInfo {
        pub pvi_cdir: VnodeInfoPath,
        pub pvi_rdir: VnodeInfoPath,
    }

    impl PIDInfo for VNodePathInfo {
        fn flavor() -> PidInfoFlavor {
            PidInfoFlavor::VNodePathInfo
        }
    }
}

#[cfg(target_os = "macos")]
fn get_cwd_macos(pid: i32) -> Option<String> {
    use vnode_ffi::VNodePathInfo;
    let info = proc_pid::pidinfo::<VNodePathInfo>(pid, 0).ok()?;
    let path_bytes = &info.pvi_cdir.vip_path;
    let bytes: Vec<u8> = path_bytes
        .iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as u8)
        .collect();
    if bytes.is_empty() {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// Read argv[0] of a process via `sysctl KERN_PROCARGS2`. Returns None for
/// processes we can't read (permission denied / gone).
///
/// The KERN_PROCARGS2 layout is:
///   [4 bytes: argc]
///   [exec_path + \0]    (the actual exe path)
///   [padding to word alignment]
///   [argv[0]\0 argv[1]\0 ... argv[argc-1]\0]
///   [env vars \0 ...]
#[cfg(target_os = "macos")]
fn read_argv0(pid: i32) -> Option<String> {
    use std::os::raw::{c_int, c_void};

    // sysctl mib: CTL_KERN (1), KERN_PROCARGS2 (49), pid
    const CTL_KERN: c_int = 1;
    const KERN_PROCARGS2: c_int = 49;

    extern "C" {
        fn sysctl(
            name: *mut c_int,
            namelen: u32,
            oldp: *mut c_void,
            oldlenp: *mut usize,
            newp: *mut c_void,
            newlen: usize,
        ) -> c_int;
    }

    let mut mib: [c_int; 3] = [CTL_KERN, KERN_PROCARGS2, pid];
    let mut size: usize = 4096;
    let mut buf: Vec<u8> = vec![0u8; size];
    let ret = unsafe {
        sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr() as *mut c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if ret != 0 {
        return None;
    }
    buf.truncate(size);

    if buf.len() < 4 {
        return None;
    }
    // Skip first 4 bytes (argc as int32).
    let mut pos = 4usize;
    // Next: exec_path, null-terminated.
    while pos < buf.len() && buf[pos] != 0 {
        pos += 1;
    }
    // Skip padding of zeros.
    while pos < buf.len() && buf[pos] == 0 {
        pos += 1;
    }
    // argv[0] starts here.
    let start = pos;
    while pos < buf.len() && buf[pos] != 0 {
        pos += 1;
    }
    if start == pos {
        return None;
    }
    String::from_utf8(buf[start..pos].to_vec()).ok()
}

/// Just the basename of argv[0] (strip any leading dirs).
fn argv0_basename(s: &str) -> &str {
    s.rsplit('/').next().unwrap_or(s)
}

/// Convert a macOS character-device number to its /dev name (e.g. "ttys001").
/// Returns None for tdev values that don't resolve to a known tty.
#[cfg(target_os = "macos")]
pub fn tty_name_from_dev(dev: u32) -> Option<String> {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_int, c_uint};

    const S_IFCHR: c_uint = 0o020000;

    extern "C" {
        fn devname(dev: c_int, mode: c_uint) -> *const c_char;
    }

    if dev == 0 || dev == u32::MAX {
        return None;
    }
    unsafe {
        let ptr = devname(dev as c_int, S_IFCHR);
        if ptr.is_null() {
            return None;
        }
        let name = CStr::from_ptr(ptr).to_str().ok()?;
        // devname returns "??" for unknown devices.
        if name.is_empty() || name == "??" {
            return None;
        }
        Some(name.to_string())
    }
}

/// Given an executable path like `/Applications/iTerm.app/Contents/MacOS/iTerm2`,
/// return the `.app` bundle name (`iTerm.app`). Returns None if the path
/// doesn't live inside a .app bundle.
fn app_bundle_from_path(path: &str) -> Option<String> {
    let idx = path.find(".app/")?;
    let up_to_app = &path[..idx + 4]; // includes ".app"
    let slash = up_to_app.rfind('/')?;
    Some(up_to_app[slash + 1..].to_string())
}

/// Map a .app bundle name (e.g. "iTerm.app") to a stable internal app id we
/// use to pick the right AppleScript tab-focus strategy.
fn classify_bundle(bundle: &str) -> &'static str {
    match bundle {
        "iTerm.app" => "iTerm2",
        "Terminal.app" => "Terminal",
        "Visual Studio Code.app" | "Code.app" => "VSCode",
        "Cursor.app" => "Cursor",
        "WezTerm.app" => "WezTerm",
        "Warp.app" => "Warp",
        "Alacritty.app" => "Alacritty",
        "kitty.app" => "kitty",
        "Hyper.app" => "Hyper",
        "Ghostty.app" => "Ghostty",
        _ => "Other",
    }
}

/// Build a PID→PPID map using `ps -axo pid=,ppid=`. Works for processes owned
/// by any user, unlike `proc_pidinfo` which requires matching UID for some
/// info. One subprocess call is cheap on a click path.
#[cfg(target_os = "macos")]
fn ppid_map_from_ps() -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    let output = match std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return map,
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            if let (Ok(pid), Ok(ppid)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                map.insert(pid, ppid);
            }
        }
    }
    map
}

/// Walk up the parent chain from `pid` and return the owning terminal app.
/// Returns (classify_id, bundle_name_with_suffix, `open -a` name).
///
/// The walk uses:
///   • `proc_pid::pidpath()` for the exe path (works for any process) to
///     detect .app bundles.
///   • A `ps`-built ppid map (works across UID boundaries) to climb through
///     root-owned processes like /usr/bin/login that `proc_pid::pidinfo`
///     refuses to read.
#[cfg(target_os = "macos")]
pub fn find_terminal_app_for_pid(pid: u32) -> Option<(String, String, String)> {
    // Terminal launchers that don't live in a .app bundle.
    let name_fallbacks: &[(&str, &str, &str)] = &[
        ("tmux", "tmux", "tmux"),
        ("sshd", "ssh", "Terminal"),
    ];

    let ppid_map = ppid_map_from_ps();

    let mut cursor = pid;
    let mut steps = 0;
    while cursor != 0 && cursor != 1 && steps < 12 {
        let name = proc_pid::name(cursor as i32).unwrap_or_default();
        let path = proc_pid::pidpath(cursor as i32).unwrap_or_default();

        crate::app_log!(
            "[focus-walk] step={} pid={} name={:?} path={:?}",
            steps, cursor, name, path
        );

        // Primary strategy: is this process inside a .app bundle?
        if let Some(bundle) = app_bundle_from_path(&path) {
            if !bundle.eq_ignore_ascii_case("Finder.app")
                && !bundle.eq_ignore_ascii_case("ani-mime.app")
                && !bundle.eq_ignore_ascii_case("loginwindow.app")
            {
                let app_id = classify_bundle(&bundle);
                let open_name = bundle.strip_suffix(".app").unwrap_or(&bundle).to_string();
                return Some((app_id.to_string(), bundle, open_name));
            }
        }

        // Secondary strategy: non-bundled launchers (tmux, sshd).
        for (needle, app_id, open_name) in name_fallbacks {
            if !name.is_empty() && name.starts_with(*needle) {
                return Some((
                    (*app_id).to_string(),
                    name.clone(),
                    (*open_name).to_string(),
                ));
            }
        }

        // Walk up. Prefer libproc (fast); fall back to ps map when libproc
        // refuses due to permissions (e.g. root-owned `login` process).
        let libproc_ppid = proc_pid::pidinfo::<BSDInfo>(cursor as i32, 0)
            .ok()
            .map(|i| i.pbi_ppid);
        let ppid = libproc_ppid
            .filter(|p| *p > 0)
            .or_else(|| ppid_map.get(&cursor).copied())
            .unwrap_or(0);

        if ppid == 0 || ppid == cursor {
            crate::app_log!(
                "[focus-walk] stopped at step={} pid={} (no ppid resolvable)",
                steps, cursor
            );
            break;
        }
        cursor = ppid;
        steps += 1;
    }
    None
}

#[cfg(not(target_os = "macos"))]
pub fn tty_name_from_dev(_dev: u32) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn find_terminal_app_for_pid(_pid: u32) -> Option<(String, String, String)> {
    None
}

/// Fetch full OS-level info for a single PID (for diagnostic logging).
#[cfg(target_os = "macos")]
pub fn get_proc_info(pid: u32) -> Option<ProcInfo> {
    let name = proc_pid::name(pid as i32).ok()?;
    let (ppid, pgid, tpgid, tdev) = proc_pid::pidinfo::<BSDInfo>(pid as i32, 0)
        .map(|info| (info.pbi_ppid, info.pbi_pgid, info.e_tpgid, info.e_tdev))
        .unwrap_or((0, 0, 0, 0));
    let cwd = if is_shell(&name) {
        get_cwd_macos(pid as i32)
    } else {
        None
    };
    let argv0 = if name == "node" || is_shell(&name) {
        read_argv0(pid as i32).unwrap_or_default()
    } else {
        String::new()
    };
    Some(ProcInfo {
        pid,
        ppid,
        pgid,
        tpgid,
        tdev,
        name,
        argv0,
        cwd,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn get_proc_info(_pid: u32) -> Option<ProcInfo> {
    None
}

const SCAN_INTERVAL_SECS: u64 = 2;

/// Information about a single OS process relevant to ani-mime.
#[derive(Debug, Clone)]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    pub pgid: u32,
    pub tpgid: u32,
    pub tdev: u32,
    /// `p_comm` (kernel short name, 16 chars). For node apps like Claude Code
    /// this is literally "node".
    pub name: String,
    /// First arg of argv (often the actual invocation name — e.g. "claude"
    /// for Claude Code, since Node apps reset argv[0]). Read via sysctl.
    pub argv0: String,
    pub cwd: Option<String>,
}

fn is_shell(name: &str) -> bool {
    // pbi_comm is truncated to 16 chars; login shells may have the "-" prefix.
    matches!(
        name,
        "zsh" | "bash" | "fish" | "-zsh" | "-bash" | "-fish"
    )
}

/// Recent Claude Code releases spoof `p_comm` to the version string
/// (e.g. "2.1.128") via setproctitle/argv-rewriting. When we see a
/// numeric-dotted name we read argv0 to recover the real binary name.
fn looks_like_version_string(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_digit() {
        return false;
    }
    let mut has_dot = false;
    for &b in bytes {
        if b == b'.' {
            has_dot = true;
        } else if !b.is_ascii_digit() && b != b'-' {
            return false;
        }
    }
    has_dot
}

fn is_claude(proc: &ProcInfo) -> bool {
    // Claude Code has shipped under three executable identities:
    //   • "node" — older Node-shipped CLI (real name is via argv[0])
    //   • "claude.exe" — single-file compiled binary at
    //     ~/.../@anthropic-ai/claude-code/bin/claude.exe, with a `claude`
    //     symlink in PATH. p_comm reflects the real file, not the symlink.
    //   • "<version>" (e.g. "2.1.128") — recent claude.exe versions spoof
    //     p_comm to their version string. Detected via argv0 fallback.
    fn is_claude_name(s: &str) -> bool {
        s == "claude" || s == "claude.exe"
    }
    is_claude_name(&proc.name) || is_claude_name(argv0_basename(&proc.argv0))
}

#[cfg(target_os = "macos")]
pub fn scan_processes() -> Vec<ProcInfo> {
    let pids = match proc_pid::listpids(proc_pid::ProcType::ProcAllPIDS) {
        Ok(p) => p,
        Err(e) => {
            crate::app_warn!("[proc_scan] listpids failed: {}", e);
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for pid in pids {
        let name = match proc_pid::name(pid as i32) {
            Ok(n) => n,
            Err(_) => continue,
        };

        let (ppid, pgid, tpgid, tdev) = match proc_pid::pidinfo::<BSDInfo>(pid as i32, 0) {
            Ok(info) => (info.pbi_ppid, info.pbi_pgid, info.e_tpgid, info.e_tdev),
            Err(_) => (0, 0, 0, 0),
        };

        // Only fetch cwd for shells — it's the only type of process whose
        // cwd we consume (in reconcile() via is_user_terminal -> is_shell).
        // PROC_PIDVNODEPATHINFO copies a ~2 KB struct per call, so doing it
        // unconditionally for every PID on the system was the dominant
        // cost of this scan loop.
        let cwd = if is_shell(&name) {
            get_cwd_macos(pid as i32)
        } else {
            None
        };

        // Only spend a sysctl roundtrip on processes that might be Claude
        // Code: node-shipped CLI, shells (we read argv0 for shell detection
        // elsewhere), or anything whose p_comm has been spoofed to a version
        // string (recent claude.exe). Other processes aren't relevant and
        // we don't want to pay for argv on every PID.
        let argv0 = if name == "node" || is_shell(&name) || looks_like_version_string(&name) {
            read_argv0(pid as i32).unwrap_or_default()
        } else {
            String::new()
        };

        out.push(ProcInfo {
            pid,
            ppid,
            pgid,
            tpgid,
            tdev,
            name,
            argv0,
            cwd,
        });
    }

    out
}

#[cfg(not(target_os = "macos"))]
pub fn scan_processes() -> Vec<ProcInfo> {
    Vec::new()
}

pub fn pid_exists(pid: u32) -> bool {
    if pid == 0 {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        proc_pid::name(pid as i32).is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Determine if a shell process is a user terminal (not a `zsh -c` subshell,
/// not a daemon shell, not spawned by claude as a tool-call helper).
fn is_user_terminal(shell: &ProcInfo, by_pid: &HashMap<u32, &ProcInfo>) -> bool {
    if !is_shell(&shell.name) {
        return false;
    }
    // Needs a controlling terminal. Subshells (`zsh -c "..."`) typically
    // inherit no ctty and report tdev=0.
    if shell.tdev == 0 || shell.tdev == u32::MAX {
        return false;
    }
    // Direct parent must not be a shell, claude, or launchd.
    // - shell/claude: this is a subshell
    // - launchd (pid 1): some stray daemon shell, not an interactive terminal
    if shell.ppid == 1 {
        return false;
    }
    if let Some(parent) = by_pid.get(&shell.ppid) {
        if is_shell(&parent.name) || is_claude(parent) {
            return false;
        }
    }
    true
}

/// Find the foreground command running in a shell, if any. Returns something
/// like "claude" or "bun run tauri dev" — just the primary process name.
fn find_fg_command(
    shell: &ProcInfo,
    by_pid: &HashMap<u32, &ProcInfo>,
    all: &[ProcInfo],
) -> Option<String> {
    // If the TTY's foreground pg is the shell's own pg, nothing's running.
    if shell.tpgid == 0 || shell.tpgid == shell.pgid {
        return None;
    }

    // Prefer the process whose PID matches tpgid — that's the pg leader.
    if let Some(leader) = by_pid.get(&shell.tpgid) {
        return Some(leader.name.clone());
    }

    // Fallback: any process whose pgid == tpgid (the leader may have exited).
    all.iter()
        .find(|p| p.pgid == shell.tpgid)
        .map(|p| p.name.clone())
}

/// Compute title from cwd: use the basename.
fn title_from_pwd(pwd: &str) -> String {
    pwd.rsplit('/').next().unwrap_or("").to_string()
}

fn reconcile(app_handle: &tauri::AppHandle, app_state: &Arc<Mutex<AppState>>) {
    let procs = scan_processes();
    if procs.is_empty() {
        return;
    }

    // Index for O(1) parent/pg lookups.
    let mut by_pid: HashMap<u32, &ProcInfo> = HashMap::with_capacity(procs.len());
    for p in &procs {
        by_pid.insert(p.pid, p);
    }

    // All claude processes seen this scan (any process that passes is_claude).
    // Used for two things: marking the corresponding sessions as claude-proc,
    // and shielding them from zombie cleanup.
    let claude_pids: std::collections::HashSet<u32> = procs
        .iter()
        .filter(|p| is_claude(p))
        .map(|p| p.pid)
        .collect();

    // Map: shell_pid -> claude_pid (for every claude, find its ancestor shell).
    let mut shell_has_claude: HashMap<u32, u32> = HashMap::new();
    for p in &procs {
        if !is_claude(p) {
            continue;
        }
        let mut cursor = p.ppid;
        let mut steps = 0;
        while cursor != 0 && steps < 6 {
            if let Some(anc) = by_pid.get(&cursor) {
                if is_shell(&anc.name) && is_user_terminal(anc, &by_pid) {
                    shell_has_claude.insert(anc.pid, p.pid);
                    break;
                }
                cursor = anc.ppid;
            } else {
                break;
            }
            steps += 1;
        }
    }

    // All user-terminal shells we discovered this pass.
    let live_terminals: Vec<&ProcInfo> = procs
        .iter()
        .filter(|p| is_user_terminal(p, &by_pid))
        .collect();

    let now = crate::helpers::now_secs();
    let mut st = app_state.lock().unwrap();

    // (1) Drop zombie sessions: in state but not a live user-terminal AND not
    //     an alive claude process. (Claude sessions are created by hooks
    //     against the claude PID — they're legitimate even though not shells.)
    let zombies: Vec<u32> = st
        .sessions
        .keys()
        .copied()
        .filter(|&pid| {
            pid != 0
                && !live_terminals.iter().any(|t| t.pid == pid)
                && !claude_pids.contains(&pid)
        })
        .collect();
    for pid in &zombies {
        crate::app_log!("[proc_scan] dropping zombie session pid={}", pid);
        st.sessions.remove(pid);
    }

    // (2) Create/update a session for every live user-terminal shell.
    for t in &live_terminals {
        let entry = st
            .sessions
            .entry(t.pid)
            .or_insert_with(|| crate::state::Session::new_idle(now));

        // OS-authoritative: always refresh from libproc.
        if let Some(cwd) = &t.cwd {
            if !cwd.is_empty() {
                entry.pwd = cwd.clone();
                entry.title = title_from_pwd(cwd);
            }
        }

        // Fill TTY name (e.g. "ttys001") from the shell's tdev.
        if let Some(name) = tty_name_from_dev(t.tdev) {
            entry.tty = format!("/dev/{}", name);
        }

        // Foreground command (what the user is actively running).
        entry.fg_cmd = find_fg_command(t, &by_pid, &procs).unwrap_or_default();

        // Claude attachment (set/cleared each scan based on current state).
        entry.has_claude = shell_has_claude.contains_key(&t.pid);
        entry.claude_pid = shell_has_claude.get(&t.pid).copied();
    }

    // (3) Mark sessions whose PID is itself a claude process. The UI hides
    //     these so they don't appear as standalone "PID 17258" rows.
    for (pid, session) in st.sessions.iter_mut() {
        session.is_claude_proc = claude_pids.contains(pid);
    }

    // Fire `status-changed` / `sessions-changed` if this pass actually
    // mutated anything the UI cares about. Before this, proc_scan mutated
    // silently and the frontend had to poll.
    crate::state::emit_if_changed(app_handle, &mut st);
}

pub fn start_proc_scanner(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    crate::app_log!(
        "[proc_scan] starting (interval={}s)",
        SCAN_INTERVAL_SECS
    );

    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(SCAN_INTERVAL_SECS));
        reconcile(&app_handle, &app_state);
    });
}
