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
//! resolves each one's provider endpoint + API shape (the maintainer, 2026-06-26).

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
    /// Is this the shared MLX server's PINNED DEFAULT (its launchd env)? Since
    /// server 0.3 every installed mlx model serves on demand (the request's
    /// `model` swaps the slot), so this no longer gates the picker — it marks
    /// which model no-model callers (Breve, warmup) get, and what Settings
    /// badges as "default". llama.cpp models are never the mlx default.
    #[serde(rename = "localDefault")]
    local_default: bool,
}

// The one-shot `chat_complete` command lived here until the 2026-07 audit (#68):
// registered with zero frontend callers, it was unregistered and removed — the
// multi-turn `chat_messages` below is the only interactive bridge. Re-add it from
// git history if a one-shot caller ever appears.

/// Whether a model ENDPOINT is local to this machine — the host is loopback
/// (localhost / 127.0.0.0/8 / ::1). The secure-note gate derives locality from
/// the endpoint itself, never from a webview-asserted flag (#2, audit 2026-07).
/// Anything unparseable is NOT local (fail closed). Mirrors `endpointIsLocal`
/// in src/ai/guard.ts.
pub(crate) fn endpoint_is_local(endpoint: &str) -> bool {
    let rest = endpoint.trim();
    let Some(rest) = rest
        .strip_prefix("http://")
        .or_else(|| rest.strip_prefix("https://"))
    else {
        return false; // no scheme / unknown scheme ⇒ fail closed
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(v6) = host_port.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // a REAL loopback IP only ("127.0.0.1.evil.com" is a DNS name, not an IP)
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

/// A secure-note reader must be an actual registered on-device model, not just
/// any service reachable through localhost (which could be a proxy to a remote
/// provider). Both the registry identity and loopback endpoint must agree.
pub(crate) fn model_is_local(model_id: &str, endpoint: &str) -> bool {
    if !endpoint_is_local(endpoint) {
        return false;
    }
    read_models()
        .unwrap_or_else(default_models)
        .iter()
        .any(|model| {
            model.id == model_id
                && model.endpoint.trim_end_matches('/') == endpoint.trim_end_matches('/')
                && matches!(model.provider.as_str(), "mlx" | "llamacpp" | "ollama")
        })
}

/// Whether an id belongs to a registered on-device chat model. Breve uses this
/// to normalize legacy remote model policy without trusting a webview label.
pub(crate) fn is_registered_local_model_id(model_id: &str) -> bool {
    read_models()
        .unwrap_or_else(default_models)
        .iter()
        .any(|model| {
            model.id == model_id
                && endpoint_is_local(&model.endpoint)
                && matches!(model.provider.as_str(), "mlx" | "llamacpp" | "ollama")
        })
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
        local_default: true, // the sole fallback model IS the pinned one
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
#[allow(clippy::too_many_arguments)] // the wire command mirrors the chat request shape 1:1
pub async fn chat_messages(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::organizer::OrganizerState>,
    compute: tauri::State<'_, crate::compute::ComputeState>,
    messages: Vec<WireMsg>,
    endpoint: Option<String>,
    model: Option<String>,
    api: Option<String>,
    format_json: Option<bool>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    request_id: Option<String>,
) -> Result<String, String> {
    // ASYNC command: a sync command runs on the MAIN thread, and this one holds
    // a blocking HTTP request for a whole model generation — the entire app
    // beachballed for every local reply (the maintainer, 2026-07-30). The blocking work
    // moves to a worker; the main thread keeps painting.
    let handle = state.0.clone();
    let compute = compute.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Chat AND vision ride this command — holding the yield guard here closes
        // the whole interactive surface to daemon contention (doc §2).
        let _interactive = handle.interactive_guard();
        let endpoint = endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
        let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
        // Destination clamp (audit 2026-07, egress #3): the webview may only name
        // KNOWN endpoints — anything else is refused before any bytes ride.
        endpoint_permitted(&endpoint)?;
        // #2's SEND-side backstop (review, 2026-07): corpus_read_ai refuses secure
        // text to a non-local endpoint, but THIS command is the transport that
        // actually ships bytes — so the invariant is re-derived at the egress too.
        egress_allowed(&endpoint, &model, &messages)?;
        let api = api.unwrap_or_else(|| DEFAULT_API.to_string());
        let base = endpoint.trim_end_matches('/');
        let temperature = temperature.unwrap_or(0.4);
        let max_tokens = max_tokens.unwrap_or(1024);
        let dispatch = || {
            if api == "openai" {
                messages_openai(base, &model, &messages, temperature, max_tokens, &endpoint)
            } else {
                messages_generate(
                    base,
                    &model,
                    &messages,
                    format_json.unwrap_or(false),
                    temperature,
                    max_tokens,
                    &endpoint,
                    CHAT_TIMEOUT,
                )
            }
        };
        // COMPUTE GUARDRAILS (the maintainer, 2026-08-01 — docs/design/local-compute-guardrails.md):
        // the LOCAL lane shares one model slot on one Mac, so admission is gated
        // on MEASURED headroom, never a chat count. A request that doesn't fit
        // queues here (the surface says so, and the user can prioritize it)
        // instead of piling generations onto a Mac that can't hold them. Remote
        // endpoints skip this entirely — they have provider-side capacity.
        if !endpoint_is_local(&endpoint) {
            return dispatch();
        }
        let knobs = crate::compute::knobs_from(&app);
        // an id-less caller (a lane-verification ping) still queues fairly; it
        // just isn't cancellable from the surface, having nothing to cancel by
        let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        crate::compute::with_slot(&compute, &request_id, &model, &knobs, dispatch)
    })
    .await
    .map_err(|e| format!("chat worker: {e}"))?
}

/// STREAMING completion, ON-DEVICE ONLY (the "answers as it thinks" path). Same
/// gates and compute admission as `chat_messages`, but it asks the MLX server
/// for `stream:true` and forwards each NDJSON token to the webview over a Tauri
/// Channel as it arrives, then returns the full reply. Kept separate from
/// `chat_messages`/`complete_local` so the organizer's buffered path is
/// untouched. A remote endpoint is refused — remote lanes carry their own
/// streaming and never ride this command. Stop aborts mid-stream via the compute
/// queue's abort flag (`local_queue_cancel`), which drops the connection and
/// frees the model slot; whatever text already arrived is kept by the surface.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // mirrors the chat request shape 1:1
pub async fn chat_messages_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::organizer::OrganizerState>,
    compute: tauri::State<'_, crate::compute::ComputeState>,
    messages: Vec<WireMsg>,
    endpoint: Option<String>,
    model: Option<String>,
    format_json: Option<bool>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    request_id: Option<String>,
    on_token: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    let handle = state.0.clone();
    let compute = compute.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _interactive = handle.interactive_guard();
        let endpoint = endpoint.unwrap_or_else(|| DEFAULT_ENDPOINT.to_string());
        let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
        endpoint_permitted(&endpoint)?;
        // Streaming is on-device only. A non-local endpoint (a frontier proxy,
        // a bring-your-own-key base) is refused outright — this command never
        // ships bytes off the machine, so the egress detector isn't even the
        // relevant seam here; the destination class is.
        if !endpoint_is_local(&endpoint) {
            return Err("streaming is only available for on-device models.".into());
        }
        // Symmetric with chat_messages: a local model passes, but keep the seam.
        egress_allowed(&endpoint, &model, &messages)?;
        let base = endpoint.trim_end_matches('/').to_string();
        let temperature = temperature.unwrap_or(0.4);
        let max_tokens = max_tokens.unwrap_or(1024);
        let request_id = request_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let format_json = format_json.unwrap_or(false);
        let knobs = crate::compute::knobs_from(&app);
        let dispatch = || {
            messages_generate_stream(
                &base,
                &model,
                &messages,
                format_json,
                temperature,
                max_tokens,
                &endpoint,
                CHAT_TIMEOUT,
                &on_token,
                &compute,
                &request_id,
            )
        };
        let result = crate::compute::with_slot(&compute, &request_id, &model, &knobs, dispatch);
        // whether it finished, errored, or was aborted, drop the abort flag
        compute.0.clear_abort(&request_id);
        result
    })
    .await
    .map_err(|e| format!("chat stream worker: {e}"))?
}

/// The transport accepts only KNOWN destinations (audit 2026-07, egress #3):
/// a loopback endpoint (on-device by construction), a registry-declared
/// provider endpoint. `endpoint` is
/// webview-supplied, so without this clamp a future (or compromised) TS path
/// could legally ship an ordinary — non-secret-shaped — transcript to any host
/// it names; the secret scan alone does not bound the DESTINATION class.
/// Trailing-slash tolerant, same as `model_is_local`.
fn endpoint_permitted(endpoint: &str) -> Result<(), String> {
    if endpoint_is_local(endpoint) {
        return Ok(());
    }
    Err(format!(
        "cloud model endpoints are unavailable — chat only talks to on-device model servers (refused \"{endpoint}\")."
    ))
}

/// The secure-egress law at the SEND seam (review follow-up to #2, 2026-07):
/// "secure text never leaves the device" was enforced only where text is READ
/// (`corpus_read_ai` derives locality from the endpoint), which holds only as
/// long as TS passes the SAME endpoint to both commands. A future TS path that
/// diverges — a fallback that retries a failed local model against a remote
/// one, a per-tool endpoint override — could read a secure note locally and
/// legally ship it here. So the transport re-derives locality and scans the
/// OUTGOING transcript itself: a non-local endpoint refuses secret-shaped
/// content, symmetric with web.rs's `looks_secure` gate on search/fetch.
/// Only a registered on-device model is unrestricted. A localhost frontier
/// proxy is still remote for this policy.
fn egress_allowed(endpoint: &str, model: &str, messages: &[WireMsg]) -> Result<(), String> {
    if model_is_local(model, endpoint) {
        return Ok(());
    }
    // Provider-account policy is stronger than the secret detector: no remote
    // transcript may leave this command at all. Keep the scan below as useful
    // error specificity and defense-in-depth for future authorized API lanes.
    if messages
        .iter()
        .any(|m| crate::secret::blocked_for_remote(&m.content))
    {
        return Err(
            "This conversation carries secret-shaped content and can't be sent to a remote model — switch to a local model to continue.".into(),
        );
    }
    Err("Cloud model execution is unavailable — switch to an on-device model to continue.".into())
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
    messages_generate(
        base,
        DEFAULT_MODEL,
        messages,
        format_json,
        temperature,
        max_tokens,
        DEFAULT_ENDPOINT,
        timeout,
    )
}

/// MLX `/api/generate` — flatten the transcript to one prompt; optionally force a
/// JSON object (the server appends its JSON guard + extracts the first object).
#[allow(clippy::too_many_arguments)] // carries the full request shape to the MLX lane
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
    // Vision (#8, audit 2026-07): the Ollama-generate wire carries attachments as
    // a top-level `images` array of RAW base64 — the mlx server routes to the vlm
    // sidecar only when the body has them, so dropping them here meant the
    // composer's vision model never saw the image. Flattening loses per-turn
    // placement anyway, so collect every attachment across the transcript.
    let images = generate_images(messages);
    if !images.is_empty() {
        body["images"] = serde_json::json!(images);
    }
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

/// Streaming twin of `messages_generate`: POST with `stream:true` and read the
/// server's NDJSON line-by-line, forwarding each token over `on_token` as it
/// arrives and accumulating the full reply to return. Between tokens it polls
/// the compute abort flag — a Stop drops out of the loop, and returning drops
/// the reader (closing the connection) so the MLX server sees the hang-up and
/// frees its model slot; the partial text gathered so far is still returned.
#[allow(clippy::too_many_arguments)] // carries the full request shape + the sink
fn messages_generate_stream(
    base: &str,
    model: &str,
    messages: &[WireMsg],
    format_json: bool,
    temperature: f32,
    max_tokens: u32,
    endpoint: &str,
    timeout: Duration,
    on_token: &tauri::ipc::Channel<String>,
    compute: &crate::compute::ComputeState,
    request_id: &str,
) -> Result<String, String> {
    use std::io::BufRead;
    let url = format!("{base}/api/generate");
    let mut body = serde_json::json!({
        "model": model,
        "stream": true,
        "prompt": flatten_messages(messages),
        "options": { "temperature": temperature, "num_predict": max_tokens },
    });
    let images = generate_images(messages);
    if !images.is_empty() {
        body["images"] = serde_json::json!(images);
    }
    if format_json {
        body["format"] = serde_json::Value::String("json".to_string());
    }
    let resp = ureq::post(&url)
        .timeout(timeout)
        .send_json(body)
        .map_err(|e| format!("local model unreachable ({e}) — is it running on {endpoint}?"))?;
    let reader = std::io::BufReader::new(resp.into_reader());
    let mut full = String::new();
    for line in reader.lines() {
        // Stop, mid-stream: quit reading — the drop below closes the socket and
        // the server frees its slot; the surface keeps `full` so far.
        if compute.0.is_aborted(request_id) {
            break;
        }
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(chunk) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // tolerate a stray non-JSON line
        };
        if let Some(err) = chunk.get("error").and_then(|v| v.as_str()) {
            return Err(format!("model error: {err}"));
        }
        if let Some(tok) = chunk.get("response").and_then(|v| v.as_str()) {
            if !tok.is_empty() {
                full.push_str(tok);
                // a receiver that's already gone (Stop) just drops this token
                let _ = on_token.send(tok.to_string());
            }
        }
        if chunk.get("done").and_then(|v| v.as_bool()).unwrap_or(false) {
            break;
        }
    }
    Ok(full)
}

/// Every attachment in the transcript as RAW base64 for the generate body — the
/// webview sends full `data:image/…;base64,…` URLs (the openai path wants those);
/// the Ollama-generate shape wants the bare payload after `base64,`.
fn generate_images(messages: &[WireMsg]) -> Vec<String> {
    messages
        .iter()
        .flat_map(|m| m.images.iter())
        .map(|img| match img.split_once("base64,") {
            Some((prefix, raw)) if prefix.starts_with("data:") => raw.to_string(),
            _ => img.clone(),
        })
        .collect()
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
    let url = openai_url(base);
    let msgs: Vec<serde_json::Value> = messages.iter().map(wire_to_openai).collect();
    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": msgs,
    });
    let mut req = ureq::post(&url).timeout(Duration::from_secs(120));
    if let Some(key) = openai_bearer(base) {
        req = req.set("Authorization", &format!("Bearer {key}"));
    }
    let resp = req
        .send_json(body)
        .map_err(|e| format!("model unreachable ({e}) — endpoint {endpoint}"))?;
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

/// The chat-completions URL for a local OpenAI-shaped server (llama.cpp).
fn openai_url(base: &str) -> String {
    format!("{base}/v1/chat/completions")
}

/// A local llama.cpp base gets the supervisor's 0600 file key, absent = no header.
/// The file key guards the LOOPBACK supervisor ONLY — it must never ride to a
/// non-local base (audit 2026-07, egress #2: before this gate, any remote
/// "openai" endpoint received it as a Bearer).
fn openai_bearer(base: &str) -> Option<String> {
    if endpoint_is_local(base) {
        return read_api_key();
    }
    None
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
        .args(["kickstart", &format!("gui/{uid}/com.rotli.memex-llamacpp")])
        .output();
}

// ─── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_local_accepts_loopback_only() {
        assert!(endpoint_is_local("http://localhost:11435"));
        assert!(endpoint_is_local("http://LOCALHOST:11435/api"));
        assert!(endpoint_is_local("http://127.0.0.1:11436"));
        assert!(endpoint_is_local("http://127.9.9.9/v1"));
        assert!(endpoint_is_local("http://[::1]:11435"));
        assert!(endpoint_is_local("https://localhost"));
        // remote / lookalike hosts are NOT local
        assert!(!endpoint_is_local("https://api.openai.com/v1"));
        assert!(!endpoint_is_local("http://localhost.evil.com:11435"));
        assert!(!endpoint_is_local("http://127.0.0.1.evil.com"));
        assert!(!endpoint_is_local("http://user@evil.com:11435"));
        assert!(!endpoint_is_local("http://10.0.0.5:11435"));
        // unparseable ⇒ fail closed
        assert!(!endpoint_is_local(""));
        assert!(!endpoint_is_local("localhost:11435"));
        assert!(!endpoint_is_local("file:///etc/hosts"));
    }

    #[test]
    fn endpoint_is_local_ignores_userinfo_tricks() {
        // loopback hidden behind userinfo still resolves to the REAL host
        assert!(endpoint_is_local("http://evil.com@127.0.0.1:11435"));
        assert!(!endpoint_is_local("http://127.0.0.1@evil.com:11435"));
    }

    #[test]
    fn openai_url_is_local_llamacpp_shape() {
        assert_eq!(
            openai_url("http://localhost:11436"),
            "http://localhost:11436/v1/chat/completions"
        );
    }

    #[test]
    fn generate_images_collects_and_strips_data_urls() {
        // the vision fix (#8): data URLs → raw base64; raw base64 passes through;
        // attachments are collected across the whole transcript
        let msgs = vec![
            WireMsg {
                role: "user".into(),
                content: "what is this?".into(),
                images: vec!["data:image/png;base64,AAAA".into(), "BBBB".into()],
            },
            WireMsg {
                role: "assistant".into(),
                content: "hm".into(),
                images: vec![],
            },
            WireMsg {
                role: "user".into(),
                content: "and this?".into(),
                images: vec!["data:image/jpeg;base64,CCCC".into()],
            },
        ];
        assert_eq!(generate_images(&msgs), vec!["AAAA", "BBBB", "CCCC"]);
        // a text-only transcript adds NO images key to the body
        let none = vec![WireMsg {
            role: "user".into(),
            content: "hi".into(),
            images: vec![],
        }];
        assert!(generate_images(&none).is_empty());
    }

    /// The send-side secure backstop (review follow-up to #2): a non-local
    /// endpoint refuses a transcript with secret-shaped content; a local one
    /// never objects — the read seam already decided secure text may reach it.
    #[test]
    fn egress_refuses_secrets_to_a_remote_endpoint_only() {
        let secret = vec![WireMsg {
            role: "user".into(),
            content: "summarize: card 4242-4242-4242-4242".into(),
            images: vec![],
        }];
        let clean = vec![WireMsg {
            role: "user".into(),
            content: "hi there".into(),
            images: vec![],
        }];
        // local endpoint: secure content rides fine
        assert!(egress_allowed(DEFAULT_ENDPOINT, DEFAULT_MODEL, &secret).is_ok());
        // every remote endpoint is refused, whether or not content is secret
        assert!(egress_allowed("https://api.example.com/v1", DEFAULT_MODEL, &secret).is_err());
        assert!(egress_allowed("https://api.example.com/v1", DEFAULT_MODEL, &clean).is_err());
        // a frontier model behind localhost is still denied
        assert!(egress_allowed(DEFAULT_ENDPOINT, "claude-proxy", &secret).is_err());
        // ANY turn carrying the secret trips it, not just the last
        let buried = vec![
            WireMsg {
                role: "assistant".into(),
                content: "ssn: 123-45-6789".into(),
                images: vec![],
            },
            WireMsg {
                role: "user".into(),
                content: "go on".into(),
                images: vec![],
            },
        ];
        assert!(egress_allowed("https://api.example.com/v1", DEFAULT_MODEL, &buried).is_err());
        // unparseable endpoint ⇒ NOT local ⇒ fail closed on secrets
        assert!(egress_allowed("", DEFAULT_MODEL, &secret).is_err());
    }

    /// The destination clamp is local-only. No remote provider base passes.
    #[test]
    fn endpoint_permitted_clamps_to_known_destinations() {
        assert!(endpoint_permitted(DEFAULT_ENDPOINT).is_ok());
        assert!(endpoint_permitted("http://127.0.0.1:11436").is_ok());
        assert!(
            endpoint_permitted("https://generativelanguage.googleapis.com/v1beta/openai").is_err()
        );
        // arbitrary remote hosts are refused — the transcript-egress class
        assert!(endpoint_permitted("https://attacker.example/v1").is_err());
        assert!(endpoint_permitted("https://api.openai.com/v1").is_err());
        // lookalikes of the Gemini base don't pass the prefix test
        assert!(endpoint_permitted(
            "https://generativelanguage.googleapis.com.evil.tld/v1beta/openai"
        )
        .is_err());
        // unparseable ⇒ fail closed
        assert!(endpoint_permitted("").is_err());
    }

    /// The local supervisor's 0600 file key never rides to a remote base
    /// (audit 2026-07, egress #2).
    #[test]
    fn local_api_key_never_rides_to_a_remote_base() {
        assert_eq!(openai_bearer("https://attacker.example/v1"), None);
        assert_eq!(openai_bearer("https://api.openai.com/v1"), None);
    }

    #[test]
    fn flatten_messages_passes_a_lone_user_turn_verbatim() {
        let msgs = vec![WireMsg {
            role: "user".into(),
            content: "hi".into(),
            images: vec![],
        }];
        assert_eq!(flatten_messages(&msgs), "hi");
    }

    #[test]
    fn flatten_messages_labels_multi_turn_and_cues_assistant() {
        let msgs = vec![
            WireMsg {
                role: "system".into(),
                content: "be kind".into(),
                images: vec![],
            },
            WireMsg {
                role: "user".into(),
                content: "hi".into(),
                images: vec![],
            },
            WireMsg {
                role: "assistant".into(),
                content: "hello".into(),
                images: vec![],
            },
        ];
        let s = flatten_messages(&msgs);
        assert!(s.starts_with("System: be kind\n\n"));
        assert!(s.contains("User: hi\n\n"));
        assert!(s.contains("Assistant: hello\n\n"));
        assert!(s.ends_with("Assistant:"));
    }
}
