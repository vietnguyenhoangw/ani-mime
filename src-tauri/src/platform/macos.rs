use tauri::Manager;

/// Trigger macOS Local Network permission dialog via Apple's DNS-SD API.
///
/// The `mdns-sd` crate uses raw UDP sockets which bypass Apple's Bonjour framework,
/// so macOS never prompts for Local Network permission. This function calls Apple's
/// native `DNSServiceBrowse` (part of libSystem) to trigger the prompt. Should be
/// called once at startup before `mdns-sd` begins.
pub fn trigger_local_network_prompt() {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};

    type DNSServiceRef = *mut c_void;

    extern "C" fn noop_callback(
        _: DNSServiceRef, _: u32, _: u32, _: i32,
        _: *const c_char, _: *const c_char, _: *const c_char, _: *mut c_void,
    ) {}

    extern "C" {
        fn DNSServiceBrowse(
            sdRef: *mut DNSServiceRef,
            flags: u32,
            interfaceIndex: u32,
            regtype: *const c_char,
            domain: *const c_char,
            callBack: extern "C" fn(
                DNSServiceRef, u32, u32, i32,
                *const c_char, *const c_char, *const c_char, *mut c_void,
            ),
            context: *mut c_void,
        ) -> i32;
        fn DNSServiceRefDeallocate(sdRef: DNSServiceRef);
    }

    let regtype = CString::new("_ani-mime._tcp").unwrap();
    let mut sd_ref: DNSServiceRef = std::ptr::null_mut();

    unsafe {
        let err = DNSServiceBrowse(
            &mut sd_ref,
            0,
            0,
            regtype.as_ptr(),
            std::ptr::null(),
            noop_callback,
            std::ptr::null_mut(),
        );

        if err == 0 && !sd_ref.is_null() {
            crate::app_log!("[platform] DNS-SD browse initiated — Local Network prompt should appear");
            // Keep the connection alive briefly so macOS registers the access
            std::thread::sleep(std::time::Duration::from_secs(2));
            DNSServiceRefDeallocate(sd_ref);
        } else {
            crate::app_warn!("[platform] DNS-SD browse failed (err={}), Local Network prompt may not appear", err);
        }
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
