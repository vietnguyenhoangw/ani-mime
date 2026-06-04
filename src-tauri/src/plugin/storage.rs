//! Per-plugin key/value storage backed by `<data_dir>/store.json`.
//!
//! The store is a flat JSON object. All functions take the plugin's
//! `data_dir` explicitly so they are pure and testable; callers
//! (the `plugin_call` gateway) pass `loader::plugin_data_dir(id)`.

use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

fn store_path(data_dir: &Path) -> PathBuf {
    data_dir.join("store.json")
}

/// Read the whole store as a JSON object. A missing or corrupt file
/// reads as an empty object (never errors) so a bad write can't brick
/// the plugin.
fn read_store(data_dir: &Path) -> Map<String, Value> {
    let path = store_path(data_dir);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str::<Value>(&s)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    }
}

fn write_store(data_dir: &Path, map: &Map<String, Value>) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let json = serde_json::to_string_pretty(&Value::Object(map.clone()))
        .unwrap_or_else(|_| "{}".to_string());
    std::fs::write(store_path(data_dir), json)
}

/// Return the value for `key`, or `Value::Null` if absent.
pub fn get(data_dir: &Path, key: &str) -> std::io::Result<Value> {
    Ok(read_store(data_dir).get(key).cloned().unwrap_or(Value::Null))
}

/// Set `key` to `value`, creating the data dir and store file as needed.
pub fn set(data_dir: &Path, key: &str, value: &Value) -> std::io::Result<()> {
    let mut map = read_store(data_dir);
    map.insert(key.to_string(), value.clone());
    write_store(data_dir, &map)
}

/// Remove `key`. Removing an absent key is a no-op success.
pub fn delete(data_dir: &Path, key: &str) -> std::io::Result<()> {
    let mut map = read_store(data_dir);
    if map.remove(key).is_some() {
        write_store(data_dir, &map)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn get_missing_key_returns_null() {
        let dir = TempDir::new().unwrap();
        assert_eq!(get(dir.path(), "nope").unwrap(), Value::Null);
    }

    #[test]
    fn set_then_get_round_trips() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "count", &serde_json::json!(42)).unwrap();
        assert_eq!(get(dir.path(), "count").unwrap(), serde_json::json!(42));
    }

    #[test]
    fn set_creates_data_dir_if_missing() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("does/not/exist/yet");
        set(&nested, "k", &serde_json::json!("v")).unwrap();
        assert!(nested.join("store.json").is_file());
        assert_eq!(get(&nested, "k").unwrap(), serde_json::json!("v"));
    }

    #[test]
    fn set_overwrites_existing_key() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "k", &serde_json::json!(1)).unwrap();
        set(dir.path(), "k", &serde_json::json!(2)).unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), serde_json::json!(2));
    }

    #[test]
    fn set_preserves_other_keys() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "a", &serde_json::json!(1)).unwrap();
        set(dir.path(), "b", &serde_json::json!(2)).unwrap();
        assert_eq!(get(dir.path(), "a").unwrap(), serde_json::json!(1));
        assert_eq!(get(dir.path(), "b").unwrap(), serde_json::json!(2));
    }

    #[test]
    fn delete_removes_key() {
        let dir = TempDir::new().unwrap();
        set(dir.path(), "k", &serde_json::json!("v")).unwrap();
        delete(dir.path(), "k").unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), Value::Null);
    }

    #[test]
    fn delete_missing_key_is_ok() {
        let dir = TempDir::new().unwrap();
        delete(dir.path(), "nope").unwrap();
    }

    #[test]
    fn corrupt_store_reads_as_empty() {
        let dir = TempDir::new().unwrap();
        std::fs::write(store_path(dir.path()), b"not json").unwrap();
        assert_eq!(get(dir.path(), "k").unwrap(), Value::Null);
    }
}
