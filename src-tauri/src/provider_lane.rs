//! One blocking completion on a connected client, shared by the `cli_complete`
//! IPC command (chat) and the organizer's connected lane. Every caller passes
//! the same gates in the same order: provider policy, the secret scan, then
//! the binary and model allowlists — so a background lane can never reach a
//! client on looser terms than a chat turn.

use std::collections::HashMap;
use std::path::Path;
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

/// Whether `model` is on the lane's allowlist: a static id, or one the client
/// itself reported (asked once, bounded, when the cache has never seen it).
pub(crate) fn model_allowed(provider_id: &str, model: &str) -> bool {
    crate::provider_models::ensure_allowed(provider_id, model)
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
    complete_blocking_consented(
        children, request_id, provider_id, model, prompt, timeout, reasoning_effort, service_tier, staged, &[],
    )
}

/// `complete_blocking` with the person's own messages they chose to send
/// anyway (remote_block.rs); a chat turn's lane. Background lanes (the
/// Librarian) call `complete_blocking`, which consents to nothing.
#[allow(clippy::too_many_arguments)]
pub(crate) fn complete_blocking_consented(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    provider_id: &str,
    model: &str,
    prompt: &str,
    timeout: Duration,
    reasoning_effort: Option<&str>,
    service_tier: Option<&str>,
    staged: Option<&ImageFiles>,
    consented: &[String],
) -> Result<String, String> {
    provider::connected_provider_execution_allowed(provider_id)?;
    // the CLI lane is remote by definition — same egress law as chat.rs
    if let Some(block) = crate::remote_block::remote_block(prompt, consented) {
        return Err(block.message());
    }
    let bin = provider::resolve_bin(provider::spec(provider_id)?)
        .ok_or_else(|| format!("{provider_id} isn't installed (checked its usual homes)"))?;
    run_on_bin(children, request_id, provider_id, &bin, model, prompt, timeout, reasoning_effort, service_tier, staged)
}

/// Everything after the binary is found: the version floor, the argv, the
/// lane's environment, the spawn. Split out so tests drive it with a fake
/// client and prove the wiring, not only the helpers.
#[allow(clippy::too_many_arguments)]
fn run_on_bin(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    provider_id: &str,
    bin: &Path,
    model: &str,
    prompt: &str,
    timeout: Duration,
    reasoning_effort: Option<&str>,
    service_tier: Option<&str>,
    staged: Option<&ImageFiles>,
) -> Result<String, String> {
    // fail closed: a Codex that can't skip the user's config.toml never runs
    if provider_id == "codex" {
        crate::cli_isolation::codex_supported(bin)?;
    }
    // a discovered id the cache has not seen since launch is re-read from the
    // client before the argv builder (which reads the cache only) decides
    let _ = model_allowed(provider_id, model);
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
            (antigravity::runtime_env(bin)?, antigravity::env_remove_keys())
        } else {
            (Vec::new(), Vec::new())
        };
        let images = staged.map(|s| s.paths.as_slice()).unwrap_or(&[]);
        let turn = acp::AcpTurn { lane, bin, args: &args, env, env_remove, model, images };
        return acp::run_acp_registered(children, request_id, turn, prompt, timeout);
    }
    let cmd = lane_command(provider_id, bin, &args);
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

/// A print-mode lane's process with that lane's environment: Claude from a
/// cleared, allowlisted one; Codex without the variables that load code.
fn lane_command(provider_id: &str, bin: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    crate::cli_isolation::apply_lane_env(provider_id, &mut cmd);
    cmd
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
        assert!(secret.unwrap_err().starts_with("rotli-blocked:pattern "));
        assert!(children.lock().unwrap().is_empty(), "a refused prompt never registers a child");
    }

    #[cfg(unix)]
    fn fake_client(dir: &Path, version: &str, reply: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("client");
        let d = dir.display();
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo '{version}'; exit 0; fi\nprintf '%s\\n' \"$@\" > '{d}/argv'\nenv > '{d}/env'\ncat > /dev/null\nprintf '%s\\n' '{reply}'\n"
        );
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    #[cfg(unix)]
    fn run(provider: &str, model: &str, bin: &Path) -> Result<String, String> {
        let children = Arc::new(Mutex::new(HashMap::new()));
        run_on_bin(&children, "wiring", provider, bin, model, "hi", Duration::from_secs(10), None, None, None)
    }

    /// S1 wiring: the lane itself asks the installed Codex its version and
    /// refuses an old one before the turn starts.
    #[cfg(unix)]
    #[test]
    fn the_codex_lane_refuses_an_old_codex_before_the_turn() {
        let dir = tempfile::tempdir().unwrap();
        let reply = r#"{"type":"item.completed","item":{"type":"agent_message","text":"answered"}}"#;
        let old = fake_client(dir.path(), crate::cli_isolation::test_banners::BELOW_FLOOR, reply);
        assert!(run("codex", "gpt-5.6-sol", &old).unwrap_err().contains(crate::cli_isolation::test_banners::FLOOR));
        assert!(!dir.path().join("argv").exists(), "an old Codex never gets the prompt");
    }

    #[cfg(unix)]
    #[test]
    fn the_codex_lane_runs_a_current_codex_with_the_user_config_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let reply = r#"{"type":"item.completed","item":{"type":"agent_message","text":"answered"}}"#;
        let new = fake_client(dir.path(), "codex-cli 0.172.0", reply);
        assert_eq!(run("codex", "gpt-5.6-sol", &new).unwrap(), "answered");
        let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
        for arg in crate::cli_isolation::CODEX_ISOLATION_ARGS {
            assert!(argv.lines().any(|line| line == *arg), "{arg} reached codex");
        }
    }

    /// S5 wiring: what the one-shot Claude process actually receives is the
    /// allowlist, not Rotli's environment (cargo's own CARGO_* vars included).
    #[cfg(unix)]
    #[test]
    fn the_claude_lane_spawns_with_only_the_allowlisted_environment() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_client(dir.path(), "2.1.0 (Claude Code)", r#"{"type":"result","is_error":false,"result":"answered"}"#);
        assert_eq!(run("claude", "sonnet", &bin).unwrap(), "answered");
        let env = std::fs::read_to_string(dir.path().join("env")).unwrap();
        for line in env.lines() {
            let key = line.split('=').next().unwrap_or_default();
            // what /bin/sh sets for itself
            if matches!(key, "PWD" | "OLDPWD" | "SHLVL" | "_") {
                continue;
            }
            assert!(crate::cli_isolation::claude_env_allowed(key), "{key} reached claude");
        }
    }

    #[test]
    fn the_codex_command_drops_code_loading_variables() {
        let cmd = lane_command("codex", Path::new("/usr/bin/true"), &[]);
        let removed: Vec<_> = cmd.get_envs().filter(|(_, v)| v.is_none()).map(|(k, _)| k.to_owned()).collect();
        assert!(removed.iter().any(|k| k == "NODE_OPTIONS"), "NODE_OPTIONS is removed");
    }

    #[test]
    fn lane_models_come_from_the_allowlist() {
        let first = default_model("claude").expect("claude has models");
        assert!(model_allowed("claude", first));
        assert!(!model_allowed("claude", "not-a-model"));
        assert_eq!(default_model("nope"), None);
    }
}
