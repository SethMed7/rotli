//! What a connected CLI may pick up from the user's own machine. Rotli runs
//! the official Claude Code and Codex clients, and both read ambient config
//! (MCP servers, skills, plugins, instructions) and the parent environment.
//! A tool that arrives that way never passes Rotli's secure-note gates, so
//! each lane starts from a known-empty configuration instead (chat audit
//! 2026-11-24, S1 and S5).

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// The oldest Codex that can run with nothing of the user's and no way to read
/// a file. 0.121.0 rejects `--ignore-user-config`; 0.122.0 accepts it and
/// still starts `config.toml` MCP servers; up to 0.146.x `view_image` (which
/// reads any image file the user can) can't be turned off and
/// `agents.enabled` is a config error. Probed 2026-11-24 with
/// scripts/probe-codex-isolation.sh on 0.121.0–0.172.0.
pub(crate) const CODEX_MIN_VERSION: (u32, u32, u32) = (0, 147, 0);

/// `codex exec` arguments that drop everything the user's Codex setup would
/// add, and every built-in tool that reads files or leaves the turn.
/// `--ignore-user-config` skips `$CODEX_HOME/config.toml` (its MCP servers,
/// profiles and providers) while auth still comes from `CODEX_HOME`. The `-c`
/// keys turn off the skills catalog, a planted `AGENTS.md` in the scratch dir,
/// ChatGPT apps, plugins and remote plugins, sub-agents, `view_image`, image
/// generation, goals, sleep and Codex's own web search.
///
/// What stays (scripts/probe-codex-isolation.sh shows it on 0.147.0 and
/// 0.172.0): code-mode `exec`, a JavaScript isolate with no file system,
/// network, `require` or `fetch`; `apply_patch`, refused by the read-only
/// sandbox, though its "lines not found" error confirms or denies a guessed
/// line in a file; `update_plan`, `request_user_input`, the clock, and the MCP
/// resource tools with no server to ask. System (`/etc/codex/config.toml`) and
/// managed config layers still load; the threat model records both.
pub(crate) const CODEX_ISOLATION_ARGS: &[&str] = &[
    "--ignore-user-config",
    "-c",
    "skills.include_instructions=false",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "features.apps=false",
    "-c",
    "features.plugins=false",
    "-c",
    "features.remote_plugin=false",
    "-c",
    "agents.enabled=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.multi_agent_v2=false",
    "-c",
    "features.view_image=false",
    "-c",
    "features.image_generation=false",
    "-c",
    "features.goals=false",
    "-c",
    "features.sleep_tool=false",
    "-c",
    "web_search=\"disabled\"",
];

pub(crate) fn codex_version_message() -> String {
    let (major, minor, patch) = CODEX_MIN_VERSION;
    format!(
        "{} needs Codex {major}.{minor}.{patch} or newer to keep your own Codex tools and MCP servers out of this chat. Update Codex, then try again.",
        crate::app_identity::app_name()
    )
}

/// `codex --version` prints `codex-cli 0.169.0`. Only the version right after
/// the `codex-cli` word counts, so a wrapper's own banner can't stand in for
/// it; the flag says whether it carries a pre-release suffix.
pub(crate) fn parse_codex_version(line: &str) -> Option<((u32, u32, u32), bool)> {
    let mut words = line.split_whitespace();
    words.by_ref().find(|word| *word == "codex-cli")?;
    let word = words.next()?;
    let (core, suffix) = match word.find(['-', '+']) {
        Some(at) => (&word[..at], true),
        None => (word, false),
    };
    let mut parts = core.split('.');
    let version = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some((version, suffix))
}

/// Fail closed: no version, an unreadable one, or one below the floor all
/// refuse the lane.
pub(crate) fn codex_version_gate(version_line: Option<&str>) -> Result<(), String> {
    match version_line.and_then(parse_codex_version) {
        // a pre-release of the floor itself may predate the fix
        Some((version, pre)) if version > CODEX_MIN_VERSION || (version == CODEX_MIN_VERSION && !pre) => Ok(()),
        _ => Err(codex_version_message()),
    }
}

type Fingerprint = (PathBuf, u64, Option<SystemTime>);

static CODEX_SUPPORTED: Mutex<Option<HashSet<Fingerprint>>> = Mutex::new(None);

/// The gate for the installed binary. A pass is cached per binary path, size
/// and modification time, so a turn costs one `--version` only after Codex is
/// installed or updated. A refusal is asked again next turn, so a probe that
/// timed out once doesn't keep the lane closed.
pub(crate) fn codex_supported(bin: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(bin).map_err(|_| codex_version_message())?;
    let key = (bin.to_path_buf(), meta.len(), meta.modified().ok());
    if CODEX_SUPPORTED.lock().unwrap().as_ref().is_some_and(|seen| seen.contains(&key)) {
        return Ok(());
    }
    codex_version_gate(version_line(bin).as_deref())?;
    CODEX_SUPPORTED.lock().unwrap().get_or_insert_with(HashSet::new).insert(key);
    Ok(())
}

fn version_line(bin: &Path) -> Option<String> {
    let out = crate::cli_probe::probe(bin, &["--version"], crate::cli_probe::PROBE_DEADLINE)?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").to_string())
}

/// Variables to take out of a Codex process: ones that load code into it (an
/// npm-installed `codex` is a Node script). Everything else stays, since
/// Codex reads its own `CODEX_HOME`, proxy and sign-in variables.
pub(crate) fn codex_env_removals<I>(keys: I) -> Vec<String>
where
    I: IntoIterator<Item = OsString>,
{
    const ALWAYS: &[&str] = &["NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "LD_PRELOAD"];
    let mut removed: Vec<String> = ALWAYS.iter().map(|key| key.to_string()).collect();
    for key in keys.into_iter().filter_map(|key| key.into_string().ok()) {
        if (key.starts_with("DYLD_") || key.starts_with("LD_")) && !removed.contains(&key) {
            removed.push(key);
        }
    }
    removed
}

/// Whether one parent variable may reach a Claude Code process: the OS basics
/// a GUI app already gets from launchd, locale, network proxy and CA settings,
/// and the variables Claude Code reads for sign-in. Everything else stays out,
/// above all what a Claude Code or T3 session leaves behind (`CLAUDECODE`,
/// `CLAUDE_CODE_*`) and anything that runs code inside the CLI (`NODE_OPTIONS`).
pub(crate) fn claude_env_allowed(key: &str) -> bool {
    const KEYS: &[&str] = &[
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "TMPDIR",
        "TZ",
        "LANG",
        "__CF_USER_TEXT_ENCODING",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "CLAUDE_CONFIG_DIR",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
    ];
    const PROXIES: &[&str] = &["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
    KEYS.contains(&key) || key.starts_with("LC_") || PROXIES.contains(&key.to_ascii_uppercase().as_str())
}

/// The parent environment filtered down to what Claude Code needs.
pub(crate) fn claude_env<I>(vars: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    vars.into_iter()
        .filter(|(key, _)| key.to_str().is_some_and(claude_env_allowed))
        .collect()
}

/// The environment a lane's process gets, for a turn or a Settings check
/// alike: Claude's cleared allowlist, Codex without code-loading variables.
pub(crate) fn apply_lane_env(provider: &str, cmd: &mut std::process::Command) {
    match provider {
        "claude" => apply_claude_env(cmd),
        "codex" => {
            for key in codex_env_removals(std::env::vars_os().map(|(key, _)| key)) {
                cmd.env_remove(key);
            }
        }
        _ => {}
    }
}

/// Clear `cmd`'s inherited environment and give it only the allowed part of
/// Rotli's own.
pub(crate) fn apply_claude_env(cmd: &mut std::process::Command) {
    cmd.env_clear().envs(claude_env(std::env::vars_os()));
}

/// Banners the lane tests share (here and in provider_lane.rs).
#[cfg(test)]
pub(crate) mod test_banners {
    /// The last Codex that can't turn `view_image` off (it reads any image
    /// file the user can) and errors on `agents.enabled`.
    pub(crate) const BELOW_FLOOR: &str = "codex-cli 0.146.1";
    /// What every refusal names.
    pub(crate) const FLOOR: &str = "0.147.0";
}

#[cfg(test)]
mod tests {
    use super::test_banners::{BELOW_FLOOR, FLOOR};
    use super::*;

    fn os(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))).collect()
    }

    #[test]
    fn codex_versions_parse_from_the_cli_banner() {
        assert_eq!(parse_codex_version("codex-cli 0.169.0"), Some(((0, 169, 0), false)));
        assert_eq!(parse_codex_version("codex-cli 0.170.0-alpha.2\n"), Some(((0, 170, 0), true)));
        assert_eq!(parse_codex_version("codex-cli 1.2.3"), Some(((1, 2, 3), false)));
        assert_eq!(parse_codex_version("codex-cli"), None);
        assert_eq!(parse_codex_version("codex-cli 0.169"), None);
        assert_eq!(parse_codex_version(""), None);
        // only the number after `codex-cli` counts: a wrapper's own banner
        // can't lift an old Codex over the floor
        assert_eq!(parse_codex_version("npm 10.9.9 codex-cli 0.122.0"), Some(((0, 122, 0), false)));
        assert_eq!(parse_codex_version("wrapper 9.9.9"), None);
    }

    #[test]
    fn the_codex_lane_refuses_a_version_that_would_load_user_config() {
        assert!(codex_version_gate(Some("codex-cli 0.147.0")).is_ok());
        assert!(codex_version_gate(Some("codex-cli 0.172.0")).is_ok());
        assert!(codex_version_gate(Some("codex-cli 1.0.0")).is_ok());
        // 0.122.0 takes --ignore-user-config and still starts config.toml MCP
        // servers; up to 0.146.x `view_image` and the agent tools can't be off
        for old in [BELOW_FLOOR, "codex-cli 0.123.0", "codex-cli 0.122.0", "codex-cli 0.99.9"] {
            let refusal = codex_version_gate(Some(old)).unwrap_err();
            assert!(refusal.contains(FLOOR), "names the minimum: {refusal}");
        }
        // no answer, or one Rotli can't read, is a refusal too
        assert!(codex_version_gate(None).unwrap_err().contains(FLOOR));
        assert!(codex_version_gate(Some("codex dev build")).is_err());
        assert!(codex_version_gate(Some("wrapper 9.9.9 codex-cli 0.122.0")).is_err());
        // a pre-release of the floor may predate the fix; one past it is fine
        assert!(codex_version_gate(Some("codex-cli 0.147.0-alpha.1")).is_err());
        assert!(codex_version_gate(Some("codex-cli 0.148.0-alpha.1")).is_ok());
    }

    #[cfg(unix)]
    fn fake_codex(dir: &Path, banner: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("codex");
        std::fs::write(&bin, format!("#!/bin/sh\necho '{banner}'\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    #[cfg(unix)]
    #[test]
    fn the_installed_codex_is_asked_its_version() {
        let old = tempfile::tempdir().unwrap();
        assert!(codex_supported(&fake_codex(old.path(), BELOW_FLOOR))
            .unwrap_err()
            .contains(FLOOR));
        let new = tempfile::tempdir().unwrap();
        assert!(codex_supported(&fake_codex(new.path(), "codex-cli 0.169.0")).is_ok());
        let missing = tempfile::tempdir().unwrap();
        assert!(codex_supported(&missing.path().join("codex")).is_err());
    }

    #[test]
    fn codex_isolation_turns_off_every_ambient_source_probed() {
        let args = CODEX_ISOLATION_ARGS;
        assert_eq!(args[0], "--ignore-user-config");
        for key in [
            "skills.include_instructions=false",
            "project_doc_max_bytes=0",
            "features.apps=false",
            "features.plugins=false",
            "features.remote_plugin=false",
            // what code mode and the classic tool list still offered on
            // 0.172.0 (probed with a fake model): sub-agents, image reads,
            // image generation, goals, sleep and Codex's own web search
            "agents.enabled=false",
            "features.multi_agent=false",
            "features.multi_agent_v2=false",
            "features.view_image=false",
            "features.image_generation=false",
            "features.goals=false",
            "features.sleep_tool=false",
            "web_search=\"disabled\"",
        ] {
            let at = args.iter().position(|a| *a == key).unwrap_or_else(|| panic!("missing {key}"));
            assert_eq!(args[at - 1], "-c");
        }
    }

    /// The probe script runs Codex with the lane's own flags, so a flag added
    /// here and not there would go unproven.
    #[test]
    fn the_probe_script_runs_codex_with_exactly_these_flags() {
        let script = include_str!("../../scripts/probe-codex-isolation.sh");
        let block = script
            .split("ISOLATION=(\n")
            .nth(1)
            .and_then(|rest| rest.split("\n)").next())
            .expect("the script has an ISOLATION=( … ) block");
        let probed: Vec<String> = block
            .split_whitespace()
            .map(|word| word.trim_matches('\'').to_string())
            .collect();
        let lane: Vec<String> = CODEX_ISOLATION_ARGS.iter().map(|arg| arg.to_string()).collect();
        assert_eq!(probed, lane);
    }

    #[test]
    fn codex_never_gets_a_variable_that_runs_code_inside_it() {
        let parent = os(&[
            ("PATH", "/usr/bin"),
            ("CODEX_HOME", "/Users/probe/.codex"),
            ("DYLD_INSERT_LIBRARIES", "/tmp/x.dylib"),
            ("LD_PRELOAD", "/tmp/x.so"),
        ]);
        let removed = codex_env_removals(parent.iter().map(|(k, _)| k.clone()));
        let has = |key: &str| removed.iter().any(|k| k == key);
        // fixed names go even when Rotli's own environment lacks them
        assert!(has("NODE_OPTIONS") && has("DYLD_INSERT_LIBRARIES") && has("LD_PRELOAD"));
        assert!(!has("PATH") && !has("CODEX_HOME"), "auth and lookup stay");
    }

    #[test]
    fn claude_keeps_only_what_it_needs_from_the_parent_environment() {
        let parent = os(&[
            ("PATH", "/usr/bin:/bin"),
            ("HOME", "/Users/probe"),
            ("USER", "probe"),
            ("TMPDIR", "/tmp/probe"),
            ("LANG", "en_US.UTF-8"),
            ("LC_ALL", "en_US.UTF-8"),
            ("HTTPS_PROXY", "http://proxy.example:8080"),
            ("no_proxy", "localhost"),
            ("NODE_EXTRA_CA_CERTS", "/etc/ca.pem"),
            ("CLAUDE_CONFIG_DIR", "/Users/probe/.claude-work"),
            ("ANTHROPIC_API_KEY", "sk-ant-synthetic"),
            ("CLAUDE_CODE_OAUTH_TOKEN", "synthetic"),
            // what a Claude Code or T3 session leaves in the environment
            ("CLAUDECODE", "1"),
            ("CLAUDE_CODE_ENTRYPOINT", "cli"),
            ("CLAUDE_CODE_SESSION_ID", "s1"),
            ("CLAUDE_CODE_SSE_PORT", "4242"),
            ("CLAUDE_CODE_MESSAGING_SOCKET", "/tmp/sock"),
            // ways to run code or reroute traffic inside the CLI
            ("NODE_OPTIONS", "--require /tmp/x.js"),
            ("DYLD_INSERT_LIBRARIES", "/tmp/x.dylib"),
            ("ANTHROPIC_BASE_URL", "http://127.0.0.1:9"),
            ("OPENAI_API_KEY", "sk-synthetic"),
            ("AWS_SECRET_ACCESS_KEY", "synthetic"),
            ("GITHUB_TOKEN", "synthetic"),
        ]);
        let kept: Vec<String> = claude_env(parent)
            .into_iter()
            .map(|(k, _)| k.into_string().unwrap())
            .collect();
        for key in [
            "PATH",
            "HOME",
            "USER",
            "TMPDIR",
            "LANG",
            "LC_ALL",
            "HTTPS_PROXY",
            "no_proxy",
            "NODE_EXTRA_CA_CERTS",
            "CLAUDE_CONFIG_DIR",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_OAUTH_TOKEN",
        ] {
            assert!(kept.iter().any(|k| k == key), "{key} must reach claude");
        }
        for key in [
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_SESSION_ID",
            "CLAUDE_CODE_SSE_PORT",
            "CLAUDE_CODE_MESSAGING_SOCKET",
            "NODE_OPTIONS",
            "DYLD_INSERT_LIBRARIES",
            "ANTHROPIC_BASE_URL",
            "OPENAI_API_KEY",
            "AWS_SECRET_ACCESS_KEY",
            "GITHUB_TOKEN",
        ] {
            assert!(!kept.iter().any(|k| k == key), "{key} must not reach claude");
        }
    }

    #[test]
    fn each_lane_gets_its_own_environment() {
        let mut codex = std::process::Command::new("/usr/bin/true");
        apply_lane_env("codex", &mut codex);
        assert!(codex.get_envs().any(|(k, v)| k == "NODE_OPTIONS" && v.is_none()), "codex drops NODE_OPTIONS");
        let mut claude = std::process::Command::new("/usr/bin/true");
        claude.env("CLAUDECODE", "1");
        apply_lane_env("claude", &mut claude);
        assert!(!claude.get_envs().any(|(k, v)| k == "CLAUDECODE" && v.is_some()), "claude is cleared");
        let mut other = std::process::Command::new("/usr/bin/true");
        apply_lane_env("antigravity", &mut other);
        assert_eq!(other.get_envs().count(), 0, "other lanes keep their own handling");
    }

    #[test]
    fn a_claude_command_starts_from_an_empty_environment() {
        let mut cmd = std::process::Command::new("/usr/bin/true");
        cmd.env("CLAUDECODE", "1");
        apply_claude_env(&mut cmd);
        let set: Vec<_> = cmd.get_envs().collect();
        // a cleared command lists only what it sets; CLAUDECODE is gone
        assert!(!set.iter().any(|(k, v)| *k == "CLAUDECODE" && v.is_some()));
        let kept = claude_env(std::env::vars_os());
        assert_eq!(set.iter().filter(|(_, v)| v.is_some()).count(), kept.len());
    }
}
