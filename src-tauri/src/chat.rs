//! Chat front — the on-device model bridge + the memex-ai model registry reader.
//! The webview CSP only allows `ipc:`, so the model call goes through Rust: POST
//! the local model server and return the assistant text. No streaming yet
//! (Increment 1). Two server wire shapes are supported: Ollama-generate (MLX, the
//! Mac default at :11435) and OpenAI chat-completions (llama.cpp at :11436).
//!
//! The model LIST is read from the shared memex-ai store
//! (`~/.memex/ai/registry.json`) so the Chat surface offers exactly "what we have
//! in the memex ai" — the same on-device store Breve and voz draw from. We never
//! write it; rotli only reads the chat-capable (`kind: "llm-chat"`) entries and
//! resolves each one's provider endpoint + API shape (Seth, 2026-06-26).

use std::time::Duration;

const DEFAULT_ENDPOINT: &str = "http://localhost:11435";
const DEFAULT_MODEL: &str = "gemma-3-12b-it-qat-4bit";
const DEFAULT_API: &str = "generate";

/// One chat-capable model the memex-ai store can serve. `api` is the server wire
/// shape ("generate" = Ollama `/api/generate` · "openai" = `/v1/chat/completions`).
#[derive(serde::Serialize)]
pub struct ChatModel {
    id: String,
    label: String,
    provider: String,
    endpoint: String,
    api: String,
    #[serde(rename = "isDefault")]
    is_default: bool,
}

/// One-shot completion: send `prompt` to the chosen on-device model, return its
/// reply. Errors come back as a string the Chat surface shows in-line (e.g. the
/// model isn't running) — never a panic. `endpoint`/`model`/`api` are optional and
/// default to the MLX tier; the Chat surface fills them from the picked model.
#[tauri::command]
pub fn chat_complete(
    prompt: String,
    endpoint: Option<String>,
    model: Option<String>,
    api: Option<String>,
) -> Result<String, String> {
    let endpoint = endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let api = api.unwrap_or_else(|| DEFAULT_API.to_string());
    let base = endpoint.trim_end_matches('/');
    if api == "openai" {
        complete_openai(base, &model, &prompt, &endpoint)
    } else {
        complete_generate(base, &model, &prompt, &endpoint)
    }
}

/// Ollama `/api/generate` shape (MLX) — `{ model, stream:false, prompt }` → `response`.
fn complete_generate(base: &str, model: &str, prompt: &str, endpoint: &str) -> Result<String, String> {
    let url = format!("{base}/api/generate");
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

/// OpenAI `/v1/chat/completions` shape (llama.cpp) — the flattened prompt rides as
/// one user message → `choices[0].message.content`.
fn complete_openai(base: &str, model: &str, prompt: &str, endpoint: &str) -> Result<String, String> {
    let url = format!("{base}/v1/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(120))
        .send_json(body)
        .map_err(|e| format!("local model unreachable ({e}) — is it running on {endpoint}?"))?;
    let json: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("bad model response: {e}"))?;
    Ok(json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string())
}

/// The chat-capable models the memex-ai store declares (`kind: "llm-chat"`). Read
/// from `~/.memex/ai/registry.json`; each model's provider supplies the endpoint +
/// wire shape. If the store is missing or unreadable we fall back to the single
/// MLX default so the picker is never empty.
#[tauri::command]
pub fn chat_models() -> Vec<ChatModel> {
    read_models().unwrap_or_else(default_models)
}

fn default_models() -> Vec<ChatModel> {
    vec![ChatModel {
        id: DEFAULT_MODEL.to_string(),
        label: format!("{DEFAULT_MODEL} · MLX"),
        provider: "mlx".to_string(),
        endpoint: DEFAULT_ENDPOINT.to_string(),
        api: DEFAULT_API.to_string(),
        is_default: true,
    }]
}

fn read_models() -> Option<Vec<ChatModel>> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".memex/ai/registry.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let reg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let providers = reg.get("providers")?;
    let models = reg.get("models")?.as_array()?;

    let mut out: Vec<ChatModel> = Vec::new();
    let mut picked_default = false;
    for m in models {
        if m.get("kind").and_then(|v| v.as_str()) != Some("llm-chat") {
            continue;
        }
        let id = match m.get("id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let provider = m
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("mlx")
            .to_string();
        let p = providers.get(&provider);
        let endpoint = p
            .and_then(|v| v.get("endpoint"))
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_ENDPOINT)
            .to_string();
        // map the provider's descriptive `api` ("openai (...)" / "ollama-generate
        // (...)") down to the wire shape the bridge speaks
        let api_desc = p
            .and_then(|v| v.get("api"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let api = if api_desc.contains("openai") { "openai" } else { "generate" }.to_string();
        // the default = the first chat model on the provider flagged default:true
        let provider_default = p
            .and_then(|v| v.get("default"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_default = provider_default && !picked_default;
        if is_default {
            picked_default = true;
        }
        out.push(ChatModel {
            label: format!("{id} · {}", provider_human(&provider)),
            id,
            provider,
            endpoint,
            api,
            is_default,
        });
    }
    if out.is_empty() {
        return None;
    }
    // if nothing was flagged default, the first entry wins
    if !picked_default {
        if let Some(first) = out.first_mut() {
            first.is_default = true;
        }
    }
    Some(out)
}

fn provider_human(provider: &str) -> &str {
    match provider {
        "mlx" => "MLX",
        "llamacpp" => "llama.cpp",
        other => other,
    }
}
