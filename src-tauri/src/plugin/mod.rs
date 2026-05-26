//! Plugin system (mini-app extensions).
//!
//! Slice 1 scope: manifest parsing, filesystem operations
//! (install/uninstall, startup scan), and the `plugin://` URI
//! scheme handler. No WebView, no hotkeys, no UI yet.

pub mod loader;
pub mod manifest;
pub mod protocol;

pub use loader::PluginRecord;
