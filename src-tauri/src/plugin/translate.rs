//! Quick Translate backend: URL builders + a `ureq` call to Google's free
//! (unofficial) translate endpoint, with response parsing. Kept out of
//! `gateway.rs` so the URL/parse logic is unit-testable without a WebView.

/// Result of a translation. `detected_source` is the language Google reports
/// it detected (useful when the user picked "auto").
#[derive(Debug, serde::Serialize)]
pub struct TranslateResult {
    pub text: String,
    #[serde(rename = "detectedSource")]
    pub detected_source: Option<String>,
}

/// Build the URL for Google's free unofficial translate endpoint.
/// `source == "auto"` is passed through as `sl=auto`.
pub fn api_url(q: &str, source: &str, target: &str) -> String {
    format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl={}&dt=t&q={}",
        urlencoding::encode(source),
        urlencoding::encode(target),
        urlencoding::encode(q)
    )
}

/// Build the user-facing Google Translate web URL (for the "Open in Google" button).
pub fn web_url(q: &str, source: &str, target: &str) -> String {
    format!(
        "https://translate.google.com/?sl={}&tl={}&text={}&op=translate",
        urlencoding::encode(source),
        urlencoding::encode(target),
        urlencoding::encode(q)
    )
}

/// Parse the array response from the free endpoint:
/// `[[["<translated>","<src>",...], ...], null, "<detected>", ...]`.
/// Concatenates every sentence chunk; reads the detected language at index 2.
pub fn parse_response(json: &serde_json::Value) -> Result<TranslateResult, String> {
    let chunks = json
        .get(0)
        .and_then(|v| v.as_array())
        .ok_or_else(|| "unexpected response shape".to_string())?;
    let mut text = String::new();
    for c in chunks {
        if let Some(s) = c.get(0).and_then(|v| v.as_str()) {
            text.push_str(s);
        }
    }
    if text.is_empty() {
        return Err("empty translation".to_string());
    }
    let detected = json
        .get(2)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Ok(TranslateResult {
        text,
        detected_source: detected,
    })
}

/// Call the endpoint and parse the result. Non-2xx and network failures map
/// to `Err`. The caller (gateway) surfaces the error to the UI.
pub fn translate(q: &str, source: &str, target: &str) -> Result<TranslateResult, String> {
    use std::time::Duration;
    let url = api_url(q, source, target);
    let agent = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(10)))
            .build(),
    );
    let mut response = agent
        .get(&url)
        .header("User-Agent", "ani-mime-translate")
        .call()
        .map_err(|e| format!("translate request failed: {e}"))?;
    let json: serde_json::Value = response
        .body_mut()
        .read_json()
        .map_err(|e| format!("translate bad response: {e}"))?;
    parse_response(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_encodes_query_and_passes_langs() {
        let u = api_url("hello world", "en", "vi");
        assert!(u.starts_with("https://translate.googleapis.com/translate_a/single?"));
        assert!(u.contains("sl=en"));
        assert!(u.contains("tl=vi"));
        assert!(u.contains("q=hello%20world"));
        assert!(u.contains("client=gtx"));
        assert!(u.contains("dt=t"));
    }

    #[test]
    fn api_url_passes_auto_source() {
        let u = api_url("x", "auto", "en");
        assert!(u.contains("sl=auto"));
    }

    #[test]
    fn web_url_encodes_query() {
        let u = web_url("a&b c", "en", "vi");
        assert!(u.starts_with("https://translate.google.com/?"));
        assert!(u.contains("sl=en"));
        assert!(u.contains("tl=vi"));
        assert!(u.contains("op=translate"));
        assert!(u.contains("text=a%26b%20c"));
    }

    #[test]
    fn parse_response_joins_chunks_and_reads_detected() {
        let json = serde_json::json!([
            [
                ["Xin ", "Hello ", null, null],
                ["chào", "world", null, null]
            ],
            null,
            "en"
        ]);
        let r = parse_response(&json).expect("ok");
        assert_eq!(r.text, "Xin chào");
        assert_eq!(r.detected_source.as_deref(), Some("en"));
    }

    #[test]
    fn parse_response_rejects_wrong_shape() {
        let json = serde_json::json!({ "not": "an array" });
        assert!(parse_response(&json).is_err());
    }

    #[test]
    fn parse_response_rejects_empty_text() {
        let json = serde_json::json!([[], null, "en"]);
        assert!(parse_response(&json).is_err());
    }

    #[test]
    fn parse_response_rejects_null_root() {
        assert!(parse_response(&serde_json::Value::Null).is_err());
    }
}
