//! Filesystem ops: dirs, zip extraction, install/uninstall, startup scan.

use std::collections::HashMap;
use std::path::PathBuf;
use serde::Serialize;
use crate::plugin::manifest::{Manifest, WindowConfig};

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

use crate::plugin::manifest::{canonicalize_entry, ManifestError};

#[derive(Debug)]
pub enum InstallError {
    Io(std::io::Error),
    Extract(ExtractError),
    ManifestMissing,
    Manifest(ManifestError),
    AlreadyInstalled(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::Extract(e) => write!(f, "extract failed: {}", e),
            Self::ManifestMissing => write!(f, "manifest.json missing from zip"),
            Self::Manifest(e) => write!(f, "{}", e),
            Self::AlreadyInstalled(id) => write!(f, "plugin '{}' already installed", id),
        }
    }
}

impl std::error::Error for InstallError {}

impl From<std::io::Error> for InstallError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
impl From<ExtractError> for InstallError {
    fn from(e: ExtractError) -> Self {
        Self::Extract(e)
    }
}
impl From<ManifestError> for InstallError {
    fn from(e: ManifestError) -> Self {
        Self::Manifest(e)
    }
}

/// Install a plugin from `zip_path` into `plugins_root` (typically
/// the value returned by `plugins_root()`, but tests pass a tempdir).
///
/// Steps: stage in sibling dir → validate → atomic rename to final dest.
pub fn install_plugin_from_zip(
    zip_path: &Path,
    plugins_root: &Path,
) -> Result<Manifest, InstallError> {
    std::fs::create_dir_all(plugins_root)?;

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let staging = plugins_root.join(format!(".staging-{}", nanos));
    std::fs::create_dir(&staging)?;

    let result = (|| -> Result<Manifest, InstallError> {
        extract_zip_safe(zip_path, &staging)?;

        let manifest_path = staging.join("manifest.json");
        if !manifest_path.is_file() {
            return Err(InstallError::ManifestMissing);
        }
        let manifest_json = std::fs::read_to_string(&manifest_path)?;
        let manifest: Manifest = serde_json::from_str(&manifest_json)
            .map_err(|e| InstallError::Manifest(ManifestError::InvalidJson(e.to_string())))?;
        manifest.validate()?;
        canonicalize_entry(&staging, &manifest.entry)?;

        let dest = plugins_root.join(&manifest.id);
        if dest.exists() {
            return Err(InstallError::AlreadyInstalled(manifest.id.clone()));
        }
        std::fs::rename(&staging, &dest)?;
        Ok(manifest)
    })();

    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

#[derive(Debug)]
pub enum UninstallError {
    Io(std::io::Error),
    NotInstalled(String),
    InvalidId(String),
}

impl std::fmt::Display for UninstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "io error: {}", e),
            Self::NotInstalled(id) => write!(f, "plugin '{}' not installed", id),
            Self::InvalidId(id) => write!(f, "invalid plugin id: {}", id),
        }
    }
}

impl std::error::Error for UninstallError {}

impl From<std::io::Error> for UninstallError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// Remove the plugin's directory entirely. Caller is responsible for
/// updating AppState (Task 12).
pub fn uninstall_plugin(id: &str, plugins_root: &Path) -> Result<(), UninstallError> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id == ".." || id == "." {
        return Err(UninstallError::InvalidId(id.into()));
    }
    let dir = plugins_root.join(id);
    if !dir.is_dir() {
        return Err(UninstallError::NotInstalled(id.into()));
    }
    let dir_canonical = dir.canonicalize()?;
    let root_canonical = plugins_root.canonicalize()?;
    if !dir_canonical.starts_with(&root_canonical) {
        return Err(UninstallError::InvalidId(id.into()));
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

/// Scan `plugins_root` for installed plugins. Returns a map keyed by
/// the directory name (which equals the manifest `id` for valid plugins,
/// or whatever the dir is called for broken plugins). Plugins whose
/// manifest parses but fails validation are returned with
/// `PluginStatus::Error(reason)` so the UI can show them.
///
/// Hidden directories (names starting with '.') are skipped — this
/// excludes `.staging-*` dirs from in-progress installs.
pub fn scan_plugins(plugins_root: &Path) -> HashMap<String, PluginRecord> {
    let mut out = HashMap::new();
    let entries = match std::fs::read_dir(plugins_root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        if dir_name.starts_with('.') {
            continue;
        }

        match load_plugin_dir(&path) {
            Ok(manifest) => {
                out.insert(
                    manifest.id.clone(),
                    PluginRecord {
                        manifest,
                        enabled: true,
                        status: PluginStatus::Loaded,
                        webview_label: None,
                    },
                );
            }
            Err(reason) => {
                let placeholder = Manifest {
                    id: dir_name.clone(),
                    name: dir_name.clone(),
                    version: "0.0.0".to_string(),
                    description: String::new(),
                    author: String::new(),
                    entry: String::new(),
                    icon: None,
                    hotkey: None,
                    capabilities: Vec::new(),
                    window: WindowConfig {
                        width: 1,
                        height: 1,
                        resizable: false,
                        always_on_top: false,
                        transparent: false,
                        decorations: true,
                    },
                };
                out.insert(
                    dir_name,
                    PluginRecord {
                        manifest: placeholder,
                        enabled: false,
                        status: PluginStatus::Error(reason),
                        webview_label: None,
                    },
                );
            }
        }
    }
    out
}

fn load_plugin_dir(plugin_dir: &Path) -> Result<Manifest, String> {
    let manifest_path = plugin_dir.join("manifest.json");
    let json = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("manifest.json: {}", e))?;
    let manifest: Manifest = serde_json::from_str(&json)
        .map_err(|e| format!("manifest.json parse: {}", e))?;
    manifest.validate().map_err(|e| e.to_string())?;
    canonicalize_entry(plugin_dir, &manifest.entry).map_err(|e| e.to_string())?;
    Ok(manifest)
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

    fn minimal_manifest_json(id: &str) -> String {
        format!(
            r#"{{
                "id": "{id}",
                "name": "Test",
                "version": "0.1.0",
                "entry": "index.html",
                "capabilities": ["window"],
                "window": {{ "width": 100, "height": 100 }}
            }}"#
        )
    }

    fn build_plugin_zip(id: &str, extra: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let manifest = minimal_manifest_json(id);
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(manifest.as_bytes()).unwrap();
        w.start_file("index.html", opts).unwrap();
        w.write_all(b"<html></html>").unwrap();
        for (name, content) in extra {
            w.start_file(*name, opts).unwrap();
            w.write_all(content).unwrap();
        }
        w.finish().unwrap();
        f
    }

    #[test]
    fn install_plugin_extracts_and_validates() {
        let zip = build_plugin_zip("translator", &[]);
        let root = TempDir::new().unwrap();
        let manifest = install_plugin_from_zip(zip.path(), root.path()).expect("ok");
        assert_eq!(manifest.id, "translator");
        assert!(root.path().join("translator/manifest.json").is_file());
        assert!(root.path().join("translator/index.html").is_file());
        let staging_remnants: Vec<_> = std::fs::read_dir(root.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".staging-"))
            .collect();
        assert!(staging_remnants.is_empty(), "staging not cleaned up");
    }

    #[test]
    fn install_plugin_rejects_id_collision() {
        let root = TempDir::new().unwrap();
        let zip1 = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip1.path(), root.path()).expect("first install ok");

        let zip2 = build_plugin_zip("translator", &[]);
        let err = install_plugin_from_zip(zip2.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::AlreadyInstalled(_)));
    }

    #[test]
    fn install_plugin_rejects_missing_manifest() {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("index.html", opts).unwrap();
        w.write_all(b"<html></html>").unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::ManifestMissing));
    }

    #[test]
    fn install_plugin_rejects_invalid_manifest() {
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(br#"{"id": "BadID", "name":"X", "version":"0.1.0", "entry":"i.html", "capabilities":[], "window":{"width":1,"height":1}}"#).unwrap();
        w.start_file("i.html", opts).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::Manifest(_)));
    }

    #[test]
    fn install_plugin_rejects_missing_entry_file() {
        let manifest_json = r#"{
            "id": "x",
            "name": "X",
            "version": "0.1.0",
            "entry": "missing.html",
            "capabilities": [],
            "window": { "width": 100, "height": 100 }
        }"#;
        let f = tempfile::NamedTempFile::new().unwrap();
        let mut w = ZipWriter::new(f.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        w.start_file("manifest.json", opts).unwrap();
        w.write_all(manifest_json.as_bytes()).unwrap();
        w.finish().unwrap();

        let root = TempDir::new().unwrap();
        let err = install_plugin_from_zip(f.path(), root.path()).unwrap_err();
        assert!(matches!(err, InstallError::Manifest(_)));
    }

    #[test]
    fn uninstall_plugin_removes_dir() {
        let root = TempDir::new().unwrap();
        let zip = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip.path(), root.path()).expect("install");
        assert!(root.path().join("translator").is_dir());

        uninstall_plugin("translator", root.path()).expect("uninstall");
        assert!(!root.path().join("translator").exists());
    }

    #[test]
    fn uninstall_plugin_errors_when_missing() {
        let root = TempDir::new().unwrap();
        let err = uninstall_plugin("nope", root.path()).unwrap_err();
        assert!(matches!(err, UninstallError::NotInstalled(_)));
    }

    #[test]
    fn uninstall_plugin_rejects_path_escape_id() {
        let root = TempDir::new().unwrap();
        let err = uninstall_plugin("../etc", root.path()).unwrap_err();
        assert!(!matches!(err, UninstallError::Io(_)));
        assert!(!root.path().parent().unwrap().join("etc").exists());
    }

    #[test]
    fn scan_plugins_returns_empty_for_missing_root() {
        let root = TempDir::new().unwrap();
        let missing = root.path().join("does-not-exist");
        let records = scan_plugins(&missing);
        assert!(records.is_empty());
    }

    #[test]
    fn scan_plugins_finds_installed() {
        let root = TempDir::new().unwrap();
        let zip = build_plugin_zip("translator", &[]);
        install_plugin_from_zip(zip.path(), root.path()).expect("install");

        let records = scan_plugins(root.path());
        assert_eq!(records.len(), 1);
        let rec = records.get("translator").unwrap();
        assert_eq!(rec.manifest.id, "translator");
        assert!(rec.enabled, "scanned plugins default to enabled");
        assert!(matches!(rec.status, PluginStatus::Loaded));
        assert!(rec.webview_label.is_none());
    }

    #[test]
    fn scan_plugins_marks_broken_manifest_as_error() {
        let root = TempDir::new().unwrap();
        let plugin_dir = root.path().join("broken");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(plugin_dir.join("manifest.json"), b"not json").unwrap();

        let records = scan_plugins(root.path());
        let rec = records.get("broken").expect("present");
        assert!(matches!(rec.status, PluginStatus::Error(_)));
    }

    #[test]
    fn scan_plugins_ignores_staging_dirs() {
        let root = TempDir::new().unwrap();
        std::fs::create_dir_all(root.path().join(".staging-123")).unwrap();
        let records = scan_plugins(root.path());
        assert!(records.is_empty());
    }
}
