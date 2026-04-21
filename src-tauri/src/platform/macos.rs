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
    if let Err(e) = window.set_visible_on_all_workspaces(true) {
        crate::app_warn!("[platform] failed to set visible on all workspaces: {}", e);
    }

    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil, NO};

    match window.ns_window() {
        Ok(ns_win) => {
            let ns_win = ns_win as id;
            unsafe {
                ns_win.setOpaque_(NO);
                ns_win.setBackgroundColor_(NSColor::clearColor(nil));

                let content_view: id = ns_win.contentView();
                let superview: id = msg_send![content_view, superview];
                if superview != nil {
                    let _: () = msg_send![superview, setWantsLayer: 1i8];
                    let layer: id = msg_send![superview, layer];
                    if layer != nil {
                        let _: () = msg_send![layer, setCornerRadius: 0.0f64];
                    }
                }

                // Stay on all spaces including full-screen apps:
                // canJoinAllSpaces (1<<0) | fullScreenAuxiliary (1<<8) | stationary (1<<4)
                let behavior: u64 = (1 << 0) | (1 << 8) | (1 << 4);
                let _: () = msg_send![ns_win, setCollectionBehavior: behavior];
            }
            crate::app_log!("[platform] NSWindow configured (transparent, no-tile, no-radius)");
        }
        Err(e) => {
            crate::app_error!("[platform] failed to get NSWindow: {:?}", e);
        }
    }

    if let Err(e) = window.with_webview(|webview| {
        use cocoa::appkit::NSColor;
        use cocoa::base::{id, nil, NO};
        use cocoa::foundation::NSString;
        let wk: id = webview.inner() as id;
        unsafe {
            let no: id = msg_send![class!(NSNumber), numberWithBool: NO];
            let key = NSString::alloc(nil).init_str("drawsBackground");
            let _: () = msg_send![wk, setValue: no forKey: key];

            // Set under-page background to clear (prevents visible rectangle on macOS 12+)
            let clear = NSColor::clearColor(nil);
            let _: () = msg_send![wk, setUnderPageBackgroundColor: clear];
        }
        crate::app_log!("[platform] WebView background disabled");
    }) {
        crate::app_error!("[platform] failed to configure WebView: {:?}", e);
    }
}

/// Toggle dock icon visibility at runtime.
/// `visible = false` → Accessory (no dock, no Cmd+Tab)
/// `visible = true`  → Regular (normal dock app)
pub fn set_dock_visibility(app: &tauri::AppHandle, visible: bool) {
    if visible {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    } else {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    crate::app_log!("[platform] dock visibility -> {}", if visible { "visible" } else { "hidden" });
}

pub fn open_path(path: &std::path::Path) {
    if let Err(e) = std::process::Command::new("open").arg(path).spawn() {
        crate::app_error!("[platform] open path failed: {}", e);
    }
}

pub fn open_url(url: &str) {
    if let Err(e) = std::process::Command::new("open").arg(url).spawn() {
        crate::app_error!("[platform] open url failed: {}", e);
    }
}

/// Show a native macOS dialog. Returns the button text the user clicked.
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    let buttons_str = buttons
        .iter()
        .map(|b| format!("\"{}\"", b))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        r#"display dialog "{}" with title "{}" buttons {{{}}} default button 1"#,
        message.replace('"', "\\\""),
        title.replace('"', "\\\""),
        buttons_str
    );

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).to_string();
            let button = result
                .split("button returned:")
                .nth(1)
                .unwrap_or("")
                .trim()
                .to_string();
            crate::app_log!("[platform] dialog '{}': user pressed '{}'", title, button);
            button
        }
        Err(e) => {
            crate::app_error!("[platform] failed to show dialog '{}': {}", title, e);
            String::new()
        }
    }
}

/// Show a macOS "choose from list" dialog. Returns selected items.
pub fn show_choose_list(title: &str, message: &str, items: &[&str]) -> Vec<String> {
    let items_str = items
        .iter()
        .map(|i| format!("\"{}\"", i))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        r#"choose from list {{{}}} with title "{}" with prompt "{}" with multiple selections allowed"#,
        items_str,
        title.replace('"', "\\\""),
        message.replace('"', "\\\""),
    );

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if result == "false" || result.is_empty() {
                crate::app_log!("[platform] choose list '{}': user cancelled", title);
                return vec![];
            }
            let selected: Vec<String> = result.split(", ").map(|s| s.to_string()).collect();
            crate::app_log!("[platform] choose list '{}': user selected {:?}", title, selected);
            selected
        }
        Err(e) => {
            crate::app_error!("[platform] failed to show choose list '{}': {}", title, e);
            vec![]
        }
    }
}

/// Open System Settings → Privacy & Security → Local Network so the user can
/// grant mDNS permission manually when the first-run probe was denied.
///
/// The `x-apple.systempreferences:` URL scheme opens the right pane but
/// — starting with Sonoma — silently ignores the `?Privacy_LocalNetwork`
/// anchor, leaving the user at the top of Privacy & Security. AppleScript
/// `reveal anchor` still works and actually scrolls the view to the
/// Local Network row, so we use osascript as the primary path and fall
/// back to the URL scheme only if scripting the app fails (e.g. if
/// System Settings isn't automation-approved yet).
pub fn open_local_network_settings() {
    // Ventura+ — app is called "System Settings", pane lives under
    // com.apple.settings.PrivacySecurity.extension
    let modern = std::process::Command::new("osascript")
        .arg("-e")
        .arg(
            r#"tell application "System Settings"
    activate
    reveal anchor "Privacy_LocalNetwork" of pane id "com.apple.settings.PrivacySecurity.extension"
end tell"#,
        )
        .status();

    if matches!(modern, Ok(s) if s.success()) {
        return;
    }

    // Monterey and older — app is "System Preferences", pane is
    // com.apple.preference.security. The anchor does still scroll on
    // this older stack.
    let legacy = std::process::Command::new("osascript")
        .arg("-e")
        .arg(
            r#"tell application "System Preferences"
    activate
    reveal anchor "Privacy_LocalNetwork" of pane id "com.apple.preference.security"
end tell"#,
        )
        .status();

    if matches!(legacy, Ok(s) if s.success()) {
        return;
    }

    // Last-ditch fallback — open the pane even if we can't reach the row.
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_LocalNetwork")
        .spawn();
}

/// Kick off the Homebrew cask upgrade flow in a new Terminal window.
/// The app is expected to exit after this returns so the cask operation can replace it.
pub fn run_update_command(_release_url: &str) {
    let script = r#"tell application "Terminal"
    activate
    do script "echo '🐕 Updating Ani-Mime...' && sleep 1 && brew update && brew upgrade --cask ani-mime && echo '✅ Update complete! Reopening Ani-Mime...' && open -a 'Ani-Mime'"
end tell"#;

    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn();
}
