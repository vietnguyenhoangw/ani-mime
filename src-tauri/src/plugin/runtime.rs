//! Plugin WebView runtime: id↔label mapping, the injected `window.ani`
//! SDK script, and the spawn function used by the `launch_plugin` command.

/// Prefix applied to every plugin WebView label so plugin windows are
/// distinguishable from the app's fixed windows (main/settings/etc.).
pub const LABEL_PREFIX: &str = "plugin-";

/// `"translator"` → `"plugin-translator"`.
pub fn webview_label_for_id(id: &str) -> String {
    format!("{}{}", LABEL_PREFIX, id)
}

/// `"plugin-translator"` → `Some("translator")`; non-plugin labels → `None`.
pub fn id_from_label(label: &str) -> Option<String> {
    label.strip_prefix(LABEL_PREFIX).map(|s| s.to_string())
}

/// JavaScript injected into every plugin WebView before its own scripts
/// run. Defines `window.ani`, whose methods all funnel through the single
/// `plugin_call` command so the host can enforce declared capabilities.
/// `withGlobalTauri` is off in this app, so we call the always-injected
/// `window.__TAURI_INTERNALS__.invoke` rather than `window.__TAURI__`.
pub const ANI_SDK_JS: &str = r#"
;(function () {
  function invoke(capability, method, args) {
    return window.__TAURI_INTERNALS__.invoke('plugin_call', {
      capability: capability,
      method: method,
      args: args || {}
    });
  }

  window.ani = {
    window: {
      show: function () { return invoke('window', 'show'); },
      hide: function () { return invoke('window', 'hide'); },
      resize: function (width, height) { return invoke('window', 'resize', { width: width, height: height }); },
      close: function () { return invoke('window', 'close'); }
    },
    hotkey: {},
    storage: {
      get: function (key) { return invoke('storage', 'get', { key: key }); },
      set: function (key, value) { return invoke('storage', 'set', { key: key, value: value }); },
      delete: function (key) { return invoke('storage', 'delete', { key: key }); }
    }
  };

  // Default: Escape closes the plugin window unless the plugin handled it.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      window.ani.window.close();
    }
  });
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_for_id_prefixes() {
        assert_eq!(webview_label_for_id("translator"), "plugin-translator");
    }

    #[test]
    fn id_from_label_strips_prefix() {
        assert_eq!(id_from_label("plugin-translator"), Some("translator".to_string()));
    }

    #[test]
    fn id_from_label_rejects_non_plugin_label() {
        assert_eq!(id_from_label("settings"), None);
        assert_eq!(id_from_label("main"), None);
    }

    #[test]
    fn label_round_trips() {
        let id = "quick-translate";
        let label = webview_label_for_id(id);
        assert_eq!(id_from_label(&label).as_deref(), Some(id));
    }

    #[test]
    fn sdk_script_exposes_window_ani_namespaces() {
        assert!(ANI_SDK_JS.contains("window.ani"));
        assert!(ANI_SDK_JS.contains("storage"));
        assert!(ANI_SDK_JS.contains("window:"));
        assert!(ANI_SDK_JS.contains("plugin_call"));
        assert!(ANI_SDK_JS.contains("__TAURI_INTERNALS__"));
    }

    #[test]
    fn sdk_script_declares_all_storage_methods() {
        assert!(ANI_SDK_JS.contains("get:"));
        assert!(ANI_SDK_JS.contains("set:"));
        assert!(ANI_SDK_JS.contains("delete:"));
    }
}
