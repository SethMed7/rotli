//! The memex-ai model registry, read-only: the chat-capable models in
//! `~/.memex/ai/registry.json`, each with its provider's endpoint and wire
//! shape, or the single MLX default when there is no store yet. chat.rs owns
//! what may call them; this owns what the store says.

use crate::chat::{DEFAULT_API, DEFAULT_ENDPOINT, DEFAULT_MODEL};

/// One chat-capable model the memex-ai store can serve. `api` is the server wire
/// shape ("generate" = Ollama `/api/generate` · "openai" = `/v1/chat/completions`).
#[derive(serde::Serialize)]
pub struct ChatModel {
    pub(crate) id: String,
    label: String,
    pub(crate) provider: String,
    pub(crate) endpoint: String,
    api: String,
    /// Can this model see images? Gates the composer's image-attach affordance.
    /// Read from the registry's `vision: true` (text-only models omit it).
    vision: bool,
    #[serde(rename = "isDefault")]
    is_default: bool,
    /// Is this the shared MLX server's PINNED DEFAULT (its launchd env)? Since
    /// server 0.3 every installed mlx model serves on demand (the request's
    /// `model` swaps the slot), so this no longer gates the picker — it marks
    /// which model no-model callers (Breve, warmup) get, and what Settings
    /// badges as "default". llama.cpp models are never the mlx default.
    #[serde(rename = "localDefault")]
    local_default: bool,
    /// Listed in the memex-ai registry, so actually installed. The built-in
    /// fallback (no registry yet) is not: setup reads this to tell a Mac with
    /// a local model from one with none.
    registered: bool,
}

/// What the store declares, or the built-in default so the picker is never empty.
pub(crate) fn models() -> Vec<ChatModel> {
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
        local_default: true, // the sole fallback model IS the pinned one
        registered: false,
    }]
}

fn read_models() -> Option<Vec<ChatModel>> {
    let home = std::env::var("HOME").ok()?;
    let path = std::path::Path::new(&home).join(".memex/ai/registry.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let reg: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let providers = reg.get("providers")?;
    let models = reg.get("models")?.as_array()?;

    // which mlx model the shared server is PINNED to (its launchd env) — the
    // default for no-model callers; every registered mlx model serves on demand
    let default_mlx = crate::localmodel::local_model_default();

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
        let api = if api_desc.contains("openai") {
            "openai"
        } else {
            "generate"
        }
        .to_string();
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
        // the shared server's pinned default (a badge + the no-model fallback,
        // NOT a usability gate — server 0.3 swaps to any requested mlx model)
        let model_path = m.get("path").and_then(|v| v.as_str());
        let local_default = if provider == "mlx" {
            match (model_path, default_mlx.as_deref()) {
                (Some(p), Some(a)) => same_model_path(p, a),
                // no plist yet (fresh setup / no launchd) → trust the registry default
                (Some(_), None) => is_default,
                _ => false,
            }
        } else {
            false
        };
        out.push(ChatModel {
            label: format!("{id} · {}", provider_human(&provider)),
            id,
            provider,
            endpoint,
            api,
            vision,
            is_default,
            local_default,
            registered: true,
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

/// Two on-disk model paths refer to the same model — trailing-slash tolerant,
/// canonicalized when both resolve (a symlinked store, `..`), else trimmed
/// string equality (the common case: the registry path IS the plist env).
fn same_model_path(a: &str, b: &str) -> bool {
    let trim = |s: &str| s.trim_end_matches('/').to_string();
    if trim(a) == trim(b) {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(pa), Ok(pb)) => pa == pb,
        _ => false,
    }
}

fn provider_human(provider: &str) -> &str {
    match provider {
        "mlx" => "MLX",
        "llamacpp" => "llama.cpp",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_model_is_not_reported_as_installed() {
        let fallback = serde_json::to_value(default_models()).unwrap();
        assert_eq!(fallback[0]["registered"], serde_json::json!(false));
    }
}
