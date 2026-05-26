//! `plugin://<id>/<path>` URI scheme handler.

use std::path::{Path, PathBuf};

/// MIME type for a path, derived from extension. Plain-text fallback
/// keeps WebView from refusing unknown types.
pub fn mime_from_path(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()) {
        Some(ref e) if e == "html" || e == "htm" => "text/html",
        Some(ref e) if e == "js" || e == "mjs" => "application/javascript",
        Some(ref e) if e == "css" => "text/css",
        Some(ref e) if e == "json" => "application/json",
        Some(ref e) if e == "png" => "image/png",
        Some(ref e) if e == "jpg" || e == "jpeg" => "image/jpeg",
        Some(ref e) if e == "svg" => "image/svg+xml",
        Some(ref e) if e == "gif" => "image/gif",
        Some(ref e) if e == "webp" => "image/webp",
        Some(ref e) if e == "woff" => "font/woff",
        Some(ref e) if e == "woff2" => "font/woff2",
        Some(ref e) if e == "ttf" => "font/ttf",
        Some(ref e) if e == "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

#[derive(Debug)]
pub enum ResolveError {
    InvalidPath,
    NotFound,
    Escape,
}

/// Resolve a request path (relative, e.g. "index.html" or "assets/main.js")
/// against `plugin_dir` and return the canonical PathBuf, refusing any
/// path that escapes `plugin_dir`.
pub fn resolve_plugin_file(plugin_dir: &Path, request_path: &str) -> Result<PathBuf, ResolveError> {
    // URL request paths start with '/'; strip exactly one leading slash so that
    // "/index.html" → "index.html".  Any path that is still absolute after
    // stripping one slash (e.g. "//etc" → "/etc") is an escape attempt.
    let trimmed = request_path.strip_prefix('/').unwrap_or(request_path);
    if trimmed.is_empty() {
        return Err(ResolveError::InvalidPath);
    }
    if Path::new(trimmed).is_absolute() {
        return Err(ResolveError::Escape);
    }
    // Reject ".." components early — they are always an escape attempt.
    // This lets us return Escape (rather than NotFound) for "../etc" even
    // when the target doesn't exist on disk.
    if Path::new(trimmed)
        .components()
        .any(|c| c == std::path::Component::ParentDir)
    {
        return Err(ResolveError::Escape);
    }

    let plugin_dir_canonical = plugin_dir.canonicalize().map_err(|_| ResolveError::NotFound)?;
    let joined = plugin_dir_canonical.join(trimmed);

    // Security: if the original request_path was absolute (e.g. "/etc/passwd"),
    // the absolute path may reference a real file outside plugin_dir even though
    // the *joined* path (plugin_dir + "etc/passwd") doesn't exist.  Detect this
    // by canonicalizing the *original absolute path* directly.  If it resolves to
    // a real location outside plugin_dir, that is an escape.  We only do this
    // check when the original request_path was absolute to avoid spurious hits.
    if Path::new(request_path).is_absolute() {
        if let Ok(abs_canonical) = Path::new(request_path).canonicalize() {
            if !abs_canonical.starts_with(&plugin_dir_canonical) {
                return Err(ResolveError::Escape);
            }
        }
        // If the absolute path doesn't canonicalize (doesn't exist), fall through
        // to the joined-path check below which will return NotFound.
    }

    let canonical = joined.canonicalize().map_err(|_| ResolveError::NotFound)?;
    if !canonical.starts_with(&plugin_dir_canonical) {
        return Err(ResolveError::Escape);
    }
    if !canonical.is_file() {
        return Err(ResolveError::NotFound);
    }
    Ok(canonical)
}

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use tauri::http::{Request, Response, StatusCode};
use tauri::Manager;

use crate::plugin::loader::plugin_dir;
use crate::state::AppState;

/// Tauri URI scheme handler for `plugin://<id>/<path>`.
///
/// On macOS/Linux, `uri.host()` returns the plugin id and `uri.path()`
/// returns "/<path>". On Windows, Tauri rewrites to `http://plugin.localhost/<id>/<path>`;
/// that branch isn't covered in this slice (ani-mime's primary target is macOS).
pub fn handle_plugin_protocol(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri();
    let plugin_id = match uri.host() {
        Some(h) if !h.is_empty() => h.to_string(),
        _ => return status(StatusCode::BAD_REQUEST, b"missing plugin id"),
    };
    let request_path = uri.path();

    let state = app.state::<Arc<Mutex<AppState>>>();
    let plugin_dir_path = {
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return status(StatusCode::INTERNAL_SERVER_ERROR, b"state lock poisoned"),
        };
        let record = match guard.plugins.get(&plugin_id) {
            Some(r) => r,
            None => return status(StatusCode::NOT_FOUND, b"plugin not installed"),
        };
        if !record.enabled {
            return status(StatusCode::FORBIDDEN, b"plugin disabled");
        }
        match plugin_dir(&plugin_id) {
            Ok(p) => p,
            Err(_) => return status(StatusCode::INTERNAL_SERVER_ERROR, b"plugin dir resolve failed"),
        }
    };

    match resolve_plugin_file(&plugin_dir_path, request_path) {
        Ok(file_path) => match std::fs::read(&file_path) {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime_from_path(&file_path))
                .header("Access-Control-Allow-Origin", "null")
                .body(Cow::Owned(bytes))
                .unwrap(),
            Err(_) => status(StatusCode::NOT_FOUND, b"read failed"),
        },
        Err(ResolveError::Escape) => status(StatusCode::FORBIDDEN, b"path escape"),
        Err(ResolveError::NotFound) => status(StatusCode::NOT_FOUND, b"not found"),
        Err(ResolveError::InvalidPath) => status(StatusCode::BAD_REQUEST, b"invalid path"),
    }
}

fn status(code: StatusCode, msg: &'static [u8]) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(code)
        .body(Cow::Borrowed(msg))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::write;
    use tempfile::TempDir;

    #[test]
    fn mime_html() {
        assert_eq!(mime_from_path(Path::new("a/b/index.html")), "text/html");
        assert_eq!(mime_from_path(Path::new("INDEX.HTM")), "text/html");
    }

    #[test]
    fn mime_javascript() {
        assert_eq!(mime_from_path(Path::new("main.js")), "application/javascript");
        assert_eq!(mime_from_path(Path::new("mod.mjs")), "application/javascript");
    }

    #[test]
    fn mime_unknown_falls_back_to_octet_stream() {
        assert_eq!(mime_from_path(Path::new("a.xyz")), "application/octet-stream");
        assert_eq!(mime_from_path(Path::new("README")), "application/octet-stream");
    }

    #[test]
    fn resolve_in_dir_file() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path().join("index.html"), b"x").unwrap();
        let r = resolve_plugin_file(tmp.path(), "index.html").expect("ok");
        assert!(r.ends_with("index.html"));
    }

    #[test]
    fn resolve_nested_file() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("assets")).unwrap();
        write(tmp.path().join("assets/main.js"), b"y").unwrap();
        let r = resolve_plugin_file(tmp.path(), "assets/main.js").expect("ok");
        assert!(r.ends_with("assets/main.js"));
    }

    #[test]
    fn resolve_strips_leading_slash() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path().join("index.html"), b"x").unwrap();
        let r = resolve_plugin_file(tmp.path(), "/index.html").expect("ok");
        assert!(r.ends_with("index.html"));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "../etc").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound | ResolveError::Escape));
    }

    #[test]
    fn resolve_rejects_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "/etc/passwd").unwrap_err();
        assert!(matches!(err, ResolveError::Escape));
    }

    #[test]
    fn resolve_rejects_missing_file() {
        let tmp = TempDir::new().unwrap();
        let err = resolve_plugin_file(tmp.path(), "no-such-file").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound));
    }

    #[test]
    fn resolve_rejects_directory() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join("subdir")).unwrap();
        let err = resolve_plugin_file(tmp.path(), "subdir").unwrap_err();
        assert!(matches!(err, ResolveError::NotFound));
    }
}
