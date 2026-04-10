use tauri::Manager;

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/vietnguyenhoangw/ani-mime/releases/latest";

/// Check GitHub for a newer release and show a native dialog if one exists.
/// Runs in a background thread, non-blocking.
pub fn check_for_updates(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Small delay so the app window appears first
        std::thread::sleep(std::time::Duration::from_secs(3));

        let current = env!("CARGO_PKG_VERSION");
        crate::app_log!("[updater] checking for updates (current: v{})", current);

        let latest = match fetch_latest_version() {
            Some(v) => v,
            None => {
                crate::app_log!("[updater] could not fetch latest version, skipping");
                return;
            }
        };

        crate::app_log!("[updater] latest release: v{}", latest);

        if !is_newer(&latest, current) {
            crate::app_log!("[updater] already up to date");
            return;
        }

        // Check if user previously skipped this version
        let app_data_dir = match app_handle.path().app_data_dir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let store_path = app_data_dir.join("settings.json");
        if let Ok(content) = std::fs::read_to_string(&store_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(skipped) = json.get("skippedVersion").and_then(|v| v.as_str()) {
                    if skipped == latest {
                        crate::app_log!("[updater] v{} was skipped by user", latest);
                        return;
                    }
                }
            }
        }

        show_update_dialog(&app_handle, current, &latest);
    });
}

/// Manual check from menu — always shows a dialog (up-to-date or update available).
pub fn check_for_updates_manual(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let current = env!("CARGO_PKG_VERSION");
        crate::app_log!("[updater] manual check (current: v{})", current);

        let latest = match fetch_latest_version() {
            Some(v) => v,
            None => {
                let _ = std::process::Command::new("osascript")
                    .arg("-e")
                    .arg("display alert \"Update Check Failed\" message \"Could not reach GitHub. Please check your internet connection.\" buttons {\"OK\"} default button \"OK\"")
                    .output();
                return;
            }
        };

        if !is_newer(&latest, current) {
            crate::app_log!("[updater] manual check: up to date");
            let script = format!(
                "display alert \"You are up to date\" message \"Ani-Mime v{} is the latest version.\" buttons {{\"OK\"}} default button \"OK\"",
                current
            );
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .output();
            return;
        }

        crate::app_log!("[updater] manual check: update available v{}", latest);
        show_update_dialog(&app_handle, current, &latest);
    });
}

fn show_update_dialog(app_handle: &tauri::AppHandle, current: &str, latest: &str) {
    let release_url = format!("https://github.com/vietnguyenhoangw/ani-mime/releases/tag/v{}", latest);

    loop {
        let script = format!(
            "display alert \"Ani-Mime v{latest} Available\" message \"You are currently on v{current}.\\n\\nA new version is ready with improvements and bug fixes.\\nTap Changelog to see what is new.\" buttons {{\"Later\", \"Changelog\", \"Update Now\"}} default button \"Update Now\"",
            latest = latest,
            current = current,
        );

        match std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
        {
            Ok(o) => {
                let result = String::from_utf8_lossy(&o.stdout).to_string();
                let button = result
                    .split("button returned:")
                    .nth(1)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                crate::app_log!("[updater] user pressed: {}", button);

                match button.as_str() {
                    "Update Now" => {
                        update_now();
                        break;
                    }
                    "Changelog" => {
                        crate::app_log!("[updater] opening changelog: {}", release_url);
                        let _ = std::process::Command::new("open")
                            .arg(&release_url)
                            .spawn();
                        continue;
                    }
                    _ => {
                        crate::app_log!("[updater] user chose Later or dismissed");
                        break;
                    }
                }
            }
            Err(e) => {
                crate::app_error!("[updater] failed to show dialog: {}", e);
                break;
            }
        }
    }
}

fn fetch_latest_version() -> Option<String> {
    let mut response = ureq::get(GITHUB_RELEASES_URL)
        .header("User-Agent", "ani-mime-updater")
        .call()
        .ok()?;

    let json: serde_json::Value = response.body_mut().read_json().ok()?;
    let tag = json.get("tag_name")?.as_str()?;

    // Strip leading 'v' if present
    Some(tag.trim_start_matches('v').to_string())
}

fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    l > c
}

fn update_now() {
    crate::app_log!("[updater] user chose: Update");
    let script = r#"tell application "Terminal"
    activate
    do script "brew update && brew upgrade --cask ani-mime"
end tell"#;
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn();
}


fn save_skipped_version(store_path: &std::path::Path, version: &str) {
    let mut json: serde_json::Value = if store_path.exists() {
        std::fs::read_to_string(store_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    json["skippedVersion"] = serde_json::Value::String(version.to_string());

    if let Ok(s) = serde_json::to_string_pretty(&json) {
        let _ = std::fs::write(store_path, s);
        crate::app_log!("[updater] saved skipped version: v{}", version);
    }
}
