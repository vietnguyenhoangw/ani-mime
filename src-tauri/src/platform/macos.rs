use tauri::Manager;

/// Apply macOS-specific window customizations:
/// - Transparent background
/// - No shadow
/// - Visible on all workspaces
/// - WebView transparent background
pub fn setup_macos_window(app: &tauri::App) {
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

    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSColor, NSWindow};
        use cocoa::base::{id, nil, NO};

        match window.ns_window() {
            Ok(ns_win) => {
                let ns_win = ns_win as id;
                unsafe {
                    ns_win.setOpaque_(NO);
                    ns_win.setBackgroundColor_(NSColor::clearColor(nil));

                    // Remove corner radius from window chrome to eliminate visible boundary
                    let content_view: id = ns_win.contentView();
                    let superview: id = msg_send![content_view, superview];
                    if superview != nil {
                        let _: () = msg_send![superview, setWantsLayer: 1i8];
                        let layer: id = msg_send![superview, layer];
                        if layer != nil {
                            let _: () = msg_send![layer, setCornerRadius: 0.0f64];
                        }
                    }

                    // Opt out of macOS Sequoia window tiling/snapping:
                    // canJoinAllSpaces (1<<0) | fullScreenNone (1<<9) | stationary (1<<4)
                    let behavior: u64 = (1 << 0) | (1 << 9) | (1 << 4);
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
            use cocoa::base::{nil, NO};
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
}
