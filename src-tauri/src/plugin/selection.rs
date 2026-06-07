//! Capture the text currently selected in the frontmost application.
//!
//! Used by the `selection` plugin capability: when a `selection`-capable plugin
//! is launched via its global hotkey, the source app is still frontmost, so we
//! grab its selection and stash it for the plugin to read on load.
//!
//! macOS strategy: synthesize ⌘C, read the pasteboard, then restore the prior
//! clipboard contents. This works across terminals/browsers/native apps where a
//! direct Accessibility read (`AXSelectedText`) often returns nothing. It
//! requires the macOS Accessibility permission.

/// Whether the OS lets us read the selection (macOS Accessibility permission).
/// On non-macOS this is always `true` (the capture itself is a no-op).
pub fn accessibility_trusted() -> bool {
    imp::accessibility_trusted()
}

/// Ask the OS for Accessibility permission (shows the system prompt and adds the
/// app to the Accessibility list on macOS). No-op elsewhere.
pub fn prompt_accessibility() {
    imp::prompt_accessibility()
}

/// Capture the frontmost app's current selection, or `None` if nothing is
/// selected / permission is missing / unsupported platform. The user's previous
/// clipboard contents are preserved.
pub fn capture_selection() -> Option<String> {
    imp::capture_selection()
}

#[cfg(target_os = "macos")]
mod imp {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::time::Duration;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    /// Virtual key code for the "C" key on a US layout (`kVK_ANSI_C`).
    const KEY_C: CGKeyCode = 8;

    pub fn accessibility_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn prompt_accessibility() {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let value = CFBoolean::true_value();
            let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
            let _ = AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef());
        }
        crate::app_log!("[selection] requested Accessibility permission");
    }

    pub fn capture_selection() -> Option<String> {
        if !accessibility_trusted() {
            prompt_accessibility();
            return None;
        }

        use cocoa::base::{id, nil};
        use cocoa::foundation::NSString;

        unsafe {
            let pasteboard: id = msg_send![class!(NSPasteboard), generalPasteboard];
            // NSPasteboardTypeString UTI.
            let str_type = NSString::alloc(nil).init_str("public.utf8-plain-text");

            let prev_change: i64 = msg_send![pasteboard, changeCount];
            let prev_contents: id = msg_send![pasteboard, stringForType: str_type];
            let prev_owned = nsstring_to_string(prev_contents);

            if !synthesize_copy() {
                return None;
            }

            // Give the frontmost app a moment to service the copy.
            std::thread::sleep(Duration::from_millis(120));

            let new_change: i64 = msg_send![pasteboard, changeCount];
            let captured = if new_change != prev_change {
                let s: id = msg_send![pasteboard, stringForType: str_type];
                nsstring_to_string(s)
            } else {
                None
            };

            // Restore the user's previous clipboard regardless of outcome.
            let _: () = msg_send![pasteboard, clearContents];
            if let Some(prev) = prev_owned {
                let prev_ns = NSString::alloc(nil).init_str(&prev);
                let _: bool = msg_send![pasteboard, setString: prev_ns forType: str_type];
            }

            captured.filter(|s| !s.trim().is_empty())
        }
    }

    /// Post a synthetic ⌘C key down/up. Returns false if the event source
    /// couldn't be created (e.g. permission revoked between checks).
    fn synthesize_copy() -> bool {
        let src = match CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let down = match CGEvent::new_keyboard_event(src.clone(), KEY_C, true) {
            Ok(e) => e,
            Err(_) => return false,
        };
        down.set_flags(CGEventFlags::CGEventFlagCommand);
        down.post(CGEventTapLocation::HID);

        let up = match CGEvent::new_keyboard_event(src, KEY_C, false) {
            Ok(e) => e,
            Err(_) => return false,
        };
        up.set_flags(CGEventFlags::CGEventFlagCommand);
        up.post(CGEventTapLocation::HID);
        true
    }

    unsafe fn nsstring_to_string(s: cocoa::base::id) -> Option<String> {
        if s == cocoa::base::nil {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![s, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn accessibility_trusted() -> bool {
        true
    }
    pub fn prompt_accessibility() {}
    pub fn capture_selection() -> Option<String> {
        None
    }
}
