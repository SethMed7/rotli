//! Chat front — the on-device model bridge. The webview CSP only allows `ipc:`,
//! so the model call goes through Rust: POST the local MLX server (Ollama
//! `/api/generate` shape, the same one Breve uses), and return the assistant
//! text. No streaming yet (Increment 1). Endpoint + model are overridable;
//! defaults match Breve's MLX tier (Seth, 2026-06-26).

use std::time::Duration;

const DEFAULT_ENDPOINT: &str = "http://localhost:11435";
const DEFAULT_MODEL: &str = "gemma-3-12b-it-qat-4bit";

/// One-shot completion: send `prompt` to the on-device model, return its reply.
/// Errors are returned as a string the Chat surface shows in-line (e.g. the model
/// isn't running) — never a panic.
#[tauri::command]
pub fn chat_complete(
    prompt: String,
    endpoint: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let endpoint = endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "stream": false, "prompt": prompt });
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(120))
        .send_json(body)
        .map_err(|e| format!("local model unreachable ({e}) — is it running on {endpoint}?"))?;
    let json: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("bad model response: {e}"))?;
    Ok(json
        .get("response")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string())
}
