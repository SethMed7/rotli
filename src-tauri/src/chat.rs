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
/// pub(crate): the organizer daemon journals which model produced a proposal.
pub(crate) const DEFAULT_MODEL: &str = "gemma-3-12b-it-qat-4bit";
const DEFAULT_API: &str = "generate";

/// The interactive paths wait up to two minutes; the background daemon uses a
/// much shorter caller-set timeout so it never camps on the model server.
const CHAT_TIMEOUT: Duration = Duration::from_secs(120);

/// One chat-capable model the memex-ai store can serve. `api` is the server wire
/// shape ("generate" = Ollama `/api/generate` · "openai" = `/v1/chat/completions`).
#[derive(serde::Serialize)]
pub struct ChatModel {
    id: String,
    label: String,
    provider: String,
    endpoint: String,
    api: String,
    /// Can this model see images? Gates the composer's image-attach affordance.
    /// Read from the registry's `vision: true` (text-only models omit it).
    vision: bool,
    #[serde(rename = "isDefault")]
    is_default: bool,
}

/// One-shot completion: send `prompt` to the chosen on-device model, return its
/// reply. Errors come back as a string the Chat surface shows in-line (e.g. the
/// model isn't running) — never a panic. `endpoint`/`model`/`api` are optional and
/// default to the MLX tier; the Chat surface fills them from the picked model.
#[tauri::command]
pub fn chat_complete(
    state: tauri::State<crate::organizer::OrganizerState>,
    prompt: String,
    endpoint: Option<String>,
    model: Option<String>,
    api: Option<String>,
) -> Result<String, String> {
    // Held for the whole call: the organizer daemon yields to interactive work
    // (its gate checks the counter before every model call — doc §2).
    let _interactive = state.0.interactive_guard();
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
        vision: true, // gemma-3 is natively multimodal (served once mlx-vlm is wired)
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
        // vision capability: the model entry opts in with `vision: true`.
        let vision = m.get("vision").and_then(|v| v.as_bool()).unwrap_or(false);
        out.push(ChatModel {
            label: format!("{id} · {}", provider_human(&provider)),
            id,
            provider,
            endpoint,
            api,
            vision,
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

// ── multi-turn bridge (the agentic client) ────────────────────────────────────

/// One conversation message from the agent loop. `images` are base64 (raw or a
/// full `data:` URL); only the openai/vision path consumes them today.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireMsg {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
}

/// Multi-turn completion for the agent loop. Same providers as `chat_complete`,
/// but it takes a `messages` array — the loop re-sends the growing transcript each
/// step. MLX flattens to one prompt (+ optional `format:"json"` coercion); llama.cpp
/// gets a real messages array, the Bearer key (fixes the 401), and image parts.
#[tauri::command]
pub fn chat_messages(
    state: tauri::State<crate::organizer::OrganizerState>,
    messages: Vec<WireMsg>,
    endpoint: Option<String>,
    model: Option<String>,
    api: Option<String>,
    format_json: Option<bool>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    // Chat AND vision ride this command — holding the yield guard here closes
    // the whole interactive surface to daemon contention (doc §2).
    let _interactive = state.0.interactive_guard();
    let endpoint = endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let api = api.unwrap_or_else(|| DEFAULT_API.to_string());
    let base = endpoint.trim_end_matches('/');
    let temperature = temperature.unwrap_or(0.4);
    let max_tokens = max_tokens.unwrap_or(1024);
    if api == "openai" {
        messages_openai(base, &model, &messages, temperature, max_tokens, &endpoint)
    } else {
        messages_generate(base, &model, &messages, format_json.unwrap_or(false), temperature, max_tokens, &endpoint, CHAT_TIMEOUT)
    }
}

/// The organizer daemon's transport (doc §2): the MLX `/api/generate` bridge with
/// a caller-set (short) timeout. LOCAL ONLY by construction — never the
/// openai/:11436 path, never a web tool: the daemon reads real `_inbox` captures
/// and nothing may leave the machine.
pub fn complete_local(
    messages: &[WireMsg],
    format_json: bool,
    temperature: f32,
    max_tokens: u32,
    timeout: Duration,
) -> Result<String, String> {
    let base = DEFAULT_ENDPOINT.trim_end_matches('/');
    messages_generate(base, DEFAULT_MODEL, messages, format_json, temperature, max_tokens, DEFAULT_ENDPOINT, timeout)
}

/// MLX `/api/generate` — flatten the transcript to one prompt; optionally force a
/// JSON object (the server appends its JSON guard + extracts the first object).
fn messages_generate(
    base: &str,
    model: &str,
    messages: &[WireMsg],
    format_json: bool,
    temperature: f32,
    max_tokens: u32,
    endpoint: &str,
    timeout: Duration,
) -> Result<String, String> {
    let url = format!("{base}/api/generate");
    let mut body = serde_json::json!({
        "model": model,
        "stream": false,
        "prompt": flatten_messages(messages),
        "options": { "temperature": temperature, "num_predict": max_tokens },
    });
    if format_json {
        body["format"] = serde_json::Value::String("json".to_string());
    }
    let resp = ureq::post(&url)
        .timeout(timeout)
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

/// Flatten a transcript into one prompt for MLX `/api/generate` (which wraps the
/// whole string as a single user turn). A lone user message passes through
/// verbatim; multiple turns get role labels and a trailing `Assistant:` cue.
fn flatten_messages(messages: &[WireMsg]) -> String {
    if let [only] = messages {
        if only.role == "user" {
            return only.content.clone();
        }
    }
    let mut s = String::new();
    for m in messages {
        let label = match m.role.as_str() {
            "system" => "System",
            "assistant" => "Assistant",
            _ => "User",
        };
        s.push_str(label);
        s.push_str(": ");
        s.push_str(&m.content);
        s.push_str("\n\n");
    }
    s.push_str("Assistant:");
    s
}

/// llama.cpp `/v1/chat/completions` — real roles preserved, the on-demand server
/// kicked up first, the Bearer key attached, images as OpenAI content-parts.
fn messages_openai(
    base: &str,
    model: &str,
    messages: &[WireMsg],
    temperature: f32,
    max_tokens: u32,
    endpoint: &str,
) -> Result<String, String> {
    ensure_llamacpp_up(endpoint);
    let url = format!("{base}/v1/chat/completions");
    let msgs: Vec<serde_json::Value> = messages.iter().map(wire_to_openai).collect();
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": msgs,
    });
    let mut req = ureq::post(&url).timeout(Duration::from_secs(120));
    if let Some(key) = read_api_key() {
        req = req.set("Authorization", &format!("Bearer {key}"));
    }
    let resp = req
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

/// A WireMsg → an OpenAI message value. With images, `content` becomes the
/// text+image_url parts array (works once llama-server runs with `--mmproj`).
fn wire_to_openai(m: &WireMsg) -> serde_json::Value {
    if m.images.is_empty() {
        return serde_json::json!({ "role": m.role, "content": m.content });
    }
    let mut parts = vec![serde_json::json!({ "type": "text", "text": m.content })];
    for img in &m.images {
        let url = if img.starts_with("data:") {
            img.clone()
        } else {
            format!("data:image/png;base64,{img}")
        };
        parts.push(serde_json::json!({ "type": "image_url", "image_url": { "url": url } }));
    }
    serde_json::json!({ "role": m.role, "content": parts })
}

/// The 0600 local API key the llama.cpp supervisor expects (`--api-key`). None if
/// absent (e.g. the MLX-only setup), in which case no auth header is sent.
fn read_api_key() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".memex/ai/.api-key");
    let key = std::fs::read_to_string(path).ok()?.trim().to_string();
    (!key.is_empty()).then_some(key)
}

/// Best-effort: kick the on-demand llama.cpp supervisor so the first openai call
/// doesn't hit a dead socket. No `-k` (don't restart a warm server); errors ignored.
fn ensure_llamacpp_up(endpoint: &str) {
    if !endpoint.contains("11436") {
        return; // only the memex llama.cpp tier is launchd-managed
    }
    let uid = match std::process::Command::new("id").arg("-u").output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return,
    };
    let _ = std::process::Command::new("launchctl")
        .args(["kickstart", &format!("gui/{uid}/com.sethmedina.memex-llamacpp")])
        .output();
}
