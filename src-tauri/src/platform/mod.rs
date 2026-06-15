#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::{
    open_local_network_settings, open_path, open_url, run_update_command,
    set_dock_visibility, set_window_movable, setup_main_window, show_choose_list, show_dialog,
};

#[cfg(target_os = "linux")]
pub use linux::{
    open_local_network_settings, open_path, open_url, run_update_command,
    set_dock_visibility, set_window_movable, setup_main_window, show_choose_list, show_dialog,
};
