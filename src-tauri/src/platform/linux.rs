use tauri::Manager;

pub fn setup_main_window(app: &tauri::App) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            crate::app_error!("[platform] main window not found");
            return;
        }
    };

    if let Err(e) = window.set_shadow(false) {
        crate::app_warn!("[platform] failed to disable shadow: {}", e);
    }
    if let Err(e) = window.set_always_on_top(true) {
        crate::app_warn!("[platform] failed to set always on top: {}", e);
    }
    if let Err(e) = window.set_visible_on_all_workspaces(true) {
        crate::app_warn!("[platform] failed to set visible on all workspaces: {}", e);
    }

    // Keep GTK-level always-above as a best-effort hint for native Linux compositors.
    // Do NOT use WindowTypeHint::Notification — WSLg's RAIL bridge skips notification
    // windows and they never get a proper Windows HWND, making them unfindable by
    // the PowerShell approach below.
    match window.gtk_window() {
        Ok(gtk_win) => {
            use gtk::prelude::GtkWindowExt;
            gtk_win.set_keep_above(true);
        }
        Err(e) => crate::app_warn!("[platform] gtk_window() unavailable: {}", e),
    }

    // WSLg: GTK/X11 z-order hints live inside the Linux compositor and never cross
    // the RDP/RAIL bridge into Windows DWM.  The only fix is calling Windows'
    // SetWindowPos(HWND_TOPMOST) via PowerShell, which WSL2 can invoke directly.
    //
    // A one-shot call at startup is not enough: WSLg resets WS_EX_TOPMOST every
    // time another window gains focus.  We re-assert it on every Focused(false)
    // event so the pet pops back on top within ~150 ms of losing focus.
    if is_wsl() {
        crate::app_log!("[platform] WSLg detected — will set HWND_TOPMOST via PowerShell");

        // Initial: wait for WSLg RAIL to register the HWND with Windows DWM.
        std::thread::spawn(|| {
            for attempt in 1u8..=5 {
                std::thread::sleep(std::time::Duration::from_millis(
                    if attempt == 1 { 2000 } else { 1500 },
                ));
                if apply_wsl_topmost("Ani-Mime") {
                    return;
                }
                crate::app_warn!("[platform] WSLg topmost attempt {} — not found yet", attempt);
            }
            crate::app_error!("[platform] WSLg topmost: gave up after 5 attempts");
        });

        // Re-assert on every focus-lost: WSLg resets WS_EX_TOPMOST when another
        // window gains focus, so we re-fire SetWindowPos(HWND_TOPMOST) each time.
        window.on_window_event(|event| {
            if let tauri::WindowEvent::Focused(false) = event {
                std::thread::spawn(|| {
                    // Brief delay so DWM finishes raising the other window first.
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    apply_wsl_topmost("Ani-Mime");
                });
            }
        });
    }

    crate::app_log!("[platform] linux main window configured");
}

/// Returns `true` when running inside Windows Subsystem for Linux (WSL2 / WSLg).
fn is_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|s| s.to_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

/// Set `WS_EX_TOPMOST` on the Windows HWND for the given window title via
/// PowerShell P/Invoke.  Returns `true` when the HWND was found and raised.
///
/// Uses `EnumWindows` (not `FindWindow`) so it:
///   - Handles titles that differ from what GTK exposes (RAIL can mangle them)
///   - Works even if the HWND is a child of the WSLg compositor window
///   - Logs all visible window titles on failure so we can see the real title
fn apply_wsl_topmost(title: &str) -> bool {
    // C# class in a single-quoted PS string (no single-quotes inside, so no escaping).
    // EnumWindows + case-insensitive IndexOf so minor title differences don't matter.
    // On success prints "ok", on failure prints "not-found:<title1>;<title2>;..."
    let type_def = r#"using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;public class AniMimeW{public delegate bool EnumWinProc(IntPtr h,IntPtr l);[DllImport("user32")]public static extern bool EnumWindows(EnumWinProc p,IntPtr l);[DllImport("user32")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int m);[DllImport("user32")]public static extern bool SetWindowPos(IntPtr h,IntPtr i,int x,int y,int cx,int cy,uint f);public static string FindAndPin(string search){var titles=new List<string>();IntPtr target=IntPtr.Zero;EnumWindows((h,l)=>{if(!IsWindowVisible(h))return true;var sb=new StringBuilder(512);GetWindowText(h,sb,512);var t=sb.ToString();if(t.Length>0){titles.Add(t);if(target==IntPtr.Zero&&t.IndexOf(search,StringComparison.OrdinalIgnoreCase)>=0)target=h;}return true;},IntPtr.Zero);if(target!=IntPtr.Zero){SetWindowPos(target,new IntPtr(-1),0,0,0,0,3);return"ok";}return"not-found:"+string.Join(";",titles);}}"#;

    let ps = format!(
        "Add-Type -TypeDefinition '{type_def}';Write-Host ([AniMimeW]::FindAndPin('{title}'))"
    );

    match std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .output()
    {
        Ok(o) => {
            let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if out == "ok" {
                crate::app_log!("[platform] WSLg: HWND_TOPMOST applied for '{}'", title);
                true
            } else if let Some(rest) = out.strip_prefix("not-found:") {
                // Log the real window titles so we can see what RAIL exposes
                crate::app_log!(
                    "[platform] WSLg: '{}' not found. Visible HWNDs: {}",
                    title, rest
                );
                false
            } else {
                crate::app_warn!("[platform] WSLg topmost unexpected output: {}", out);
                false
            }
        }
        Err(_) => false, // powershell.exe not available — native Linux, ignore
    }
}

/// Linux has no global dock concept; `skipTaskbar: true` in tauri.conf.json already
/// hides the window from the taskbar. Nothing to toggle at runtime.
pub fn set_dock_visibility(_app: &tauri::AppHandle, visible: bool) {
    crate::app_log!("[platform] linux dock visibility requested ({}) — no-op", if visible { "visible" } else { "hidden" });
}

/// macOS-Sequoia drag-to-tile doesn't exist on Linux; no-op.
pub fn set_window_movable(_app: &tauri::AppHandle, _movable: bool) {}

pub fn open_path(path: &std::path::Path) {
    if let Err(e) = std::process::Command::new("xdg-open").arg(path).spawn() {
        crate::app_error!("[platform] xdg-open path failed: {}", e);
    }
}

pub fn open_url(url: &str) {
    if let Err(e) = std::process::Command::new("xdg-open").arg(url).spawn() {
        crate::app_error!("[platform] xdg-open url failed: {}", e);
    }
}

fn zenity_available() -> bool {
    std::process::Command::new("zenity")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Show a native Linux dialog via zenity. Returns the button text the user clicked.
///
/// Contract:
/// - `buttons.len() == 1`: info/OK dialog. Always returns `buttons[0]`.
/// - `buttons.len() == 2`: question with OK/Cancel labels. Returns `buttons[0]` on accept, `buttons[1]` on reject.
/// - `buttons.len() >= 3`: question with --extra-button entries. Clicking the default OK button returns `buttons[0]`;
///   clicking an extra button returns its label; dismissing returns `buttons[1]` as a sensible "cancel".
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    if buttons.is_empty() {
        crate::app_warn!("[platform] show_dialog called with no buttons");
        return String::new();
    }

    if !zenity_available() {
        crate::app_error!("[platform] zenity not installed — cannot show dialog '{}'. Install with 'sudo apt install zenity'", title);
        return String::new();
    }

    let mut cmd = std::process::Command::new("zenity");
    cmd.arg(format!("--title={}", title));

    match buttons.len() {
        1 => {
            cmd.arg("--info");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
        }
        2 => {
            cmd.arg("--question");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
            cmd.arg(format!("--cancel-label={}", buttons[1]));
        }
        _ => {
            cmd.arg("--question");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
            cmd.arg(format!("--cancel-label={}", buttons[1]));
            for extra in &buttons[2..] {
                cmd.arg(format!("--extra-button={}", extra));
            }
        }
    }

    match cmd.output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let button = if o.status.success() {
                buttons[0].to_string()
            } else if !stdout.is_empty() && buttons[2..].iter().any(|b| *b == stdout.as_str()) {
                stdout
            } else {
                buttons[1].to_string()
            };
            crate::app_log!("[platform] dialog '{}': user pressed '{}'", title, button);
            button
        }
        Err(e) => {
            crate::app_error!("[platform] failed to run zenity for '{}': {}", title, e);
            String::new()
        }
    }
}

/// Show a multi-select list dialog via zenity --list --checklist.
pub fn show_choose_list(title: &str, message: &str, items: &[&str]) -> Vec<String> {
    if items.is_empty() {
        return vec![];
    }

    if !zenity_available() {
        crate::app_error!("[platform] zenity not installed — cannot show list for '{}'", title);
        return vec![];
    }

    let mut cmd = std::process::Command::new("zenity");
    cmd.arg("--list")
        .arg("--checklist")
        .arg(format!("--title={}", title))
        .arg(format!("--text={}", message))
        .arg("--column=Pick")
        .arg("--column=Item")
        .arg("--separator=|");

    for item in items {
        cmd.arg("FALSE").arg(*item);
    }

    match cmd.output() {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !o.status.success() || result.is_empty() {
                crate::app_log!("[platform] choose list '{}': user cancelled", title);
                return vec![];
            }
            let selected: Vec<String> = result.split('|').map(|s| s.to_string()).collect();
            crate::app_log!("[platform] choose list '{}': user selected {:?}", title, selected);
            selected
        }
        Err(e) => {
            crate::app_error!("[platform] failed to run zenity list for '{}': {}", title, e);
            vec![]
        }
    }
}

/// Linux has no single "local network privacy" panel. mDNS works without a prompt,
/// subject to firewall rules, so this is a no-op with a log line.
pub fn open_local_network_settings() {
    crate::app_log!("[platform] linux has no local network privacy panel — no-op");
}

/// Linux has no auto-install path yet; open the release page so the user can
/// download the AppImage or .deb manually.
pub fn run_update_command(release_url: &str) {
    crate::app_log!("[platform] opening release page for manual upgrade: {}", release_url);
    open_url(release_url);
}

/// Linux v1 does not enumerate specific browsers — the picker is macOS-only.
pub fn list_browsers() -> Vec<(String, String)> {
    Vec::new()
}

/// Linux ignores `bundle_id` and opens in the OS default browser.
pub fn open_url_in(_bundle_id: Option<&str>, url: &str) {
    open_url(url);
}
