//! One blocking completion on a connected client, shared by the `cli_complete`
//! IPC command (chat) and the organizer's connected lane. Every caller passes
//! the same gates in the same order: provider policy, the secret scan, then
//! the binary and model allowlists — so a background lane can never reach a
//! client on looser terms than a chat turn.

use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::provider::{
    self, acp, antigravity, ImageFiles, PromptVia, Running, CONNECTED_PROVIDER_POLICY_MESSAGE,
};

pub(crate) const SECRET_MESSAGE: &str = "This conversation carries secret-shaped content and can't be sent to a connected model — switch to a local model to continue.";

/// The lane's first allowlisted model — what the organizer uses when the user
/// set no per-provider default.
pub(crate) fn default_model(provider_id: &str) -> Option<&'static str> {
    provider::spec(provider_id).ok()?.models.first().copied()
}

/// Whether `model` is on the lane's allowlist (the same check the argv builder
/// applies; exposed so a settings choice can be validated before a spawn).
pub(crate) fn model_allowed(provider_id: &str, model: &str) -> bool {
    provider::spec(provider_id).is_ok_and(|s| s.models.contains(&model))
}

/// Run one prompt through a connected client and return its reply text.
#[allow(clippy::too_many_arguments)]
pub(crate) fn complete_blocking(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    provider_id: &str,
    model: &str,
    prompt: &str,
    timeout: Duration,
    reasoning_effort: Option<&str>,
    service_tier: Option<&str>,
    staged: Option<&ImageFiles>,
) -> Result<String, String> {
    provider::connected_provider_execution_allowed(provider_id)?;
    // the CLI lane is remote by definition — same egress law as chat.rs
    if crate::secret::blocked_for_remote(prompt) {
        return Err(SECRET_MESSAGE.into());
    }
    let bin = provider::resolve_bin(provider::spec(provider_id)?)
        .ok_or_else(|| format!("{provider_id} isn't installed (checked its usual homes)"))?;
    let (args, via) = provider::build_args_tuned(
        provider_id,
        model,
        prompt,
        timeout.as_secs(),
        reasoning_effort,
        service_tier,
        staged,
    )?;
    if matches!(via, PromptVia::Acp) {
        let lane = acp::AcpLane::for_provider(provider_id)
            .ok_or_else(|| format!("{provider_id} has no ACP lane"))?;
        let (env, env_remove) = if lane == acp::AcpLane::Antigravity {
            (antigravity::runtime_env(&bin)?, antigravity::env_remove_keys())
        } else {
            (Vec::new(), Vec::new())
        };
        let images = staged.map(|s| s.paths.as_slice()).unwrap_or(&[]);
        let turn = acp::AcpTurn { lane, bin: &bin, args: &args, env, env_remove, model, images };
        return acp::run_acp_registered(children, request_id, turn, prompt, timeout);
    }
    let mut cmd = Command::new(&bin);
    cmd.args(&args);
    let payload = matches!(via, PromptVia::Stdin).then_some(prompt);
    let (stdout, stderr, ok) = provider::run_registered(children, request_id, cmd, payload, timeout)?;
    let parsed = match provider_id {
        "claude" => provider::parse_claude_json(&stdout),
        "codex" => provider::parse_codex_jsonl(&stdout),
        _ => Err(CONNECTED_PROVIDER_POLICY_MESSAGE.into()),
    };
    match parsed {
        Ok(text) => Ok(text),
        Err(e) if !ok => Err(provider::with_stderr_tail(&e, &stderr, " — ", "")),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lane_gates_run_before_any_spawn() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let unknown = complete_blocking(&children, "t", "cursor-x", "m", "hi", Duration::from_secs(1), None, None, None);
        assert!(unknown.unwrap_err().contains("unknown provider"));
        let secret = complete_blocking(
            &children,
            "t",
            "claude",
            default_model("claude").unwrap(),
            "card 4242 4242 4242 4242",
            Duration::from_secs(1),
            None,
            None,
            None,
        );
        assert_eq!(secret.unwrap_err(), SECRET_MESSAGE);
        assert!(children.lock().unwrap().is_empty(), "a refused prompt never registers a child");
    }

    #[test]
    fn lane_models_come_from_the_allowlist() {
        let first = default_model("claude").expect("claude has models");
        assert!(model_allowed("claude", first));
        assert!(!model_allowed("claude", "not-a-model"));
        assert_eq!(default_model("nope"), None);
    }
}
