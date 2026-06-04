//! Plugin WebView runtime: id↔label mapping, the injected `window.ani`
//! SDK script, and the spawn function used by the `launch_plugin` command.

use crate::plugin::loader::PluginStatus;
use crate::state::AppState;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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
    },
    clipboard: {
      history: function () { return invoke('clipboard', 'history'); },
      copy: function (text) { return invoke('clipboard', 'copy', { text: text }); },
      remove: function (text) { return invoke('clipboard', 'remove', { text: text }); },
      clear: function () { return invoke('clipboard', 'clear'); }
    }
  };

  // Default: Escape, or Cmd/Ctrl+W, closes the plugin window unless the
  // plugin handled it.
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    var quickClose = (e.metaKey || e.ctrlKey) && (e.key === 'w' || e.key === 'W');
    if (e.key === 'Escape' || quickClose) {
      if (quickClose) e.preventDefault();
      window.ani.window.close();
    }
  });
})();
"#;

/// Spawn (or re-focus) the WebView for plugin `id`.
///
/// Idempotent: if the window already exists it is shown and focused.
/// Otherwise it is built from `plugin://<id>/<entry>`, sized from the
/// manifest, with `ANI_SDK_JS` injected. The live label is recorded on
/// the `PluginRecord` and cleared on window destroy.
pub fn launch_plugin_webview(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let label = webview_label_for_id(id);

    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    // Read name + entry + window config from state, then release the lock.
    let (name, entry, wcfg) = {
        let state = app.state::<Arc<Mutex<AppState>>>();
        let guard = state.lock().map_err(|_| "state lock poisoned")?;
        let rec = guard
            .plugins
            .get(id)
            .ok_or_else(|| format!("plugin '{}' not installed", id))?;
        if !rec.enabled {
            return Err("plugin not enabled".into());
        }
        if let PluginStatus::Error(reason) = &rec.status {
            return Err(format!("plugin in error state: {}", reason));
        }
        (
            rec.manifest.name.clone(),
            rec.manifest.entry.clone(),
            rec.manifest.window.clone(),
        )
    };

    let url = format!("plugin://{}/{}", id, entry);
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("invalid plugin url '{}': {}", url, e))?;

    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(parsed))
        .title(&name)
        .inner_size(wcfg.width as f64, wcfg.height as f64)
        .resizable(wcfg.resizable)
        .always_on_top(wcfg.always_on_top)
        .decorations(wcfg.decorations)
        .transparent(wcfg.transparent)
        .visible(true)
        .initialization_script(ANI_SDK_JS)
        .build()
        .map_err(|e| format!("failed to build plugin window: {}", e))?;

    {
        let state = app.state::<Arc<Mutex<AppState>>>();
        let mut guard = state.lock().map_err(|_| "state lock poisoned")?;
        if let Some(rec) = guard.plugins.get_mut(id) {
            rec.webview_label = Some(label.clone());
        }
    }

    // Clear the recorded label when the window is destroyed so a later
    // launch rebuilds it instead of trying to reuse a dead label.
    let app_for_event = app.clone();
    let id_for_event = id.to_string();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(state) = app_for_event.try_state::<Arc<Mutex<AppState>>>() {
                if let Ok(mut guard) = state.lock() {
                    if let Some(rec) = guard.plugins.get_mut(&id_for_event) {
                        rec.webview_label = None;
                    }
                }
            }
        }
    });

    crate::app_log!("[plugin] launched webview for {}", id);
    Ok(())
}

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
