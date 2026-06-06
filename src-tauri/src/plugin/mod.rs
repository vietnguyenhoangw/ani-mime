//! Plugin system (mini-app extensions).
//!
//! Backend: manifest parsing/validation, install/uninstall, startup scan,
//! the `plugin://` URI scheme (`protocol`), per-plugin WebView spawning and
//! the injected `window.ani` SDK (`runtime`), the gated `plugin_call`
//! dispatcher (`gateway`), and per-plugin key/value storage (`storage`).
//! Not yet: global hotkeys (Slice 3) and the Plugin Manager UI (Slice 4).

pub mod clipboard;
pub mod gateway;
pub mod hotkey;
pub mod loader;
pub mod manifest;
pub mod protocol;
pub mod runtime;
pub mod storage;
pub mod translate;

pub use loader::PluginRecord;
pub use manifest::Manifest;
