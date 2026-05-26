//! Filesystem ops: dirs, zip extraction, install/uninstall, startup scan.

use std::path::PathBuf;
use serde::Serialize;
use crate::plugin::manifest::Manifest;

/// State of a plugin in `AppState.plugins`. Returned to the frontend
/// over the `get_plugins` Tauri command.
#[derive(Clone, Debug, Serialize)]
pub struct PluginRecord {
    pub manifest: Manifest,
    pub enabled: bool,
    pub status: PluginStatus,
    /// Set when a WebView is currently spawned for this plugin (Slice 2).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webview_label: Option<String>,
}

/// Either `Loaded` (manifest valid, files present) or `Error(reason)`
/// (manifest revalidation failed at scan time).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "reason")]
pub enum PluginStatus {
    Loaded,
    Error(String),
}

/// Returns `~/.ani-mime/plugins/`.
pub fn plugins_root() -> std::io::Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no home dir"))?;
    Ok(home.join(".ani-mime").join("plugins"))
}

/// Returns `~/.ani-mime/plugins/<id>/`.
pub fn plugin_dir(id: &str) -> std::io::Result<PathBuf> {
    Ok(plugins_root()?.join(id))
}

/// Returns `~/.ani-mime/plugins/<id>/data/` — created lazily by callers.
pub fn plugin_data_dir(id: &str) -> std::io::Result<PathBuf> {
    Ok(plugin_dir(id)?.join("data"))
}

use std::path::Path;

#[derive(Debug)]
pub enum ExtractError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    UnsafePath(String),
}

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::Zip(e) => write!(f, "zip error: {}", e),
            Self::UnsafePath(p) => write!(f, "unsafe entry path: {}", p),
        }
    }
}

impl std::error::Error for ExtractError {}

impl From<std::io::Error> for ExtractError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<zip::result::ZipError> for ExtractError {
    fn from(e: zip::result::ZipError) -> Self {
        Self::Zip(e)
    }
}

/// Extract `zip_path` into `dest_dir`, rejecting any entry whose
/// resolved path escapes `dest_dir`. `dest_dir` must already exist.
pub fn extract_zip_safe(zip_path: &Path, dest_dir: &Path) -> Result<(), ExtractError> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let dest_canonical = dest_dir.canonicalize()?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| ExtractError::UnsafePath(entry.name().to_string()))?
            .to_path_buf();

        let out_path = dest_canonical.join(&rel);

        if !out_path.starts_with(&dest_canonical) {
            return Err(ExtractError::UnsafePath(entry.name().to_string()));
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_root_is_under_home_ani_mime() {
        let root = plugins_root().expect("home dir available");
        assert!(root.ends_with(".ani-mime/plugins"), "got {:?}", root);
    }

    #[test]
    fn plugin_dir_appends_id() {
        let dir = plugin_dir("translator").expect("home dir available");
        assert!(dir.ends_with(".ani-mime/plugins/translator"), "got {:?}", dir);
    }

    #[test]
    fn plugin_data_dir_appends_data() {
        let dir = plugin_data_dir("translator").expect("home dir available");
        assert!(
            dir.ends_with(".ani-mime/plugins/translator/data"),
            "got {:?}",
            dir
        );
    }

    use std::fs::File;
    use std::io::Write;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn build_zip(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        for (name, content) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(content).unwrap();
        }
        w.finish().unwrap();
        f
    }

    #[test]
    fn extract_zip_safe_writes_files() {
        let zip = build_zip(&[
            ("manifest.json", b"{}"),
            ("index.html", b"<html></html>"),
            ("assets/main.js", b"console.log(1)"),
        ]);
        let dest = TempDir::new().unwrap();
        extract_zip_safe(zip.path(), dest.path()).expect("ok");
        assert!(dest.path().join("manifest.json").is_file());
        assert!(dest.path().join("index.html").is_file());
        assert!(dest.path().join("assets/main.js").is_file());
        assert_eq!(
            std::fs::read(dest.path().join("index.html")).unwrap(),
            b"<html></html>"
        );
    }

    #[test]
    fn extract_zip_safe_blocks_parent_traversal() {
        let zip = build_zip(&[("../escape.txt", b"oops")]);
        let dest = TempDir::new().unwrap();
        let result = extract_zip_safe(zip.path(), dest.path());
        assert!(matches!(result, Err(ExtractError::UnsafePath(_))));
        let parent = dest.path().parent().unwrap();
        assert!(!parent.join("escape.txt").exists());
    }

    #[test]
    fn extract_zip_safe_blocks_absolute_path() {
        let zip = build_zip(&[("/tmp/escape.txt", b"oops")]);
        let dest = TempDir::new().unwrap();
        let result = extract_zip_safe(zip.path(), dest.path());
        assert!(matches!(result, Err(ExtractError::UnsafePath(_))));
    }

    #[test]
    fn extract_zip_safe_creates_intermediate_dirs() {
        let zip = build_zip(&[("a/b/c/d.txt", b"x")]);
        let dest = TempDir::new().unwrap();
        extract_zip_safe(zip.path(), dest.path()).expect("ok");
        assert!(dest.path().join("a/b/c/d.txt").is_file());
    }
}
