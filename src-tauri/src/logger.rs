use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

const MAX_LOG_ENTRIES: usize = 1000;

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: &'static str,
    pub message: String,
}

static LOG_BUFFER: Mutex<Vec<LogEntry>> = Mutex::new(Vec::new());

pub fn push_log(level: &'static str, msg: String) {
    // Forward to log crate (tauri-plugin-log picks this up → file + stdout + webview)
    match level {
        "error" => log::error!("{}", msg),
        "warn" => log::warn!("{}", msg),
        _ => log::info!("{}", msg),
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let mut buf = LOG_BUFFER.lock().unwrap();
    buf.push(LogEntry { timestamp, level, message: msg });
    let len = buf.len();
    if len > MAX_LOG_ENTRIES {
        buf.drain(..len - MAX_LOG_ENTRIES);
    }
}

pub fn get_all_logs() -> Vec<LogEntry> {
    LOG_BUFFER.lock().unwrap().clone()
}

pub fn clear_logs() {
    LOG_BUFFER.lock().unwrap().clear();
}

#[macro_export]
macro_rules! app_log {
    ($($arg:tt)*) => {
        $crate::logger::push_log("info", format!($($arg)*))
    };
}

#[macro_export]
macro_rules! app_warn {
    ($($arg:tt)*) => {
        $crate::logger::push_log("warn", format!($($arg)*))
    };
}

#[macro_export]
macro_rules! app_error {
    ($($arg:tt)*) => {
        $crate::logger::push_log("error", format!($($arg)*))
    };
}
