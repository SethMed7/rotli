//! The vault-folder part of `rotli agent config` (audit of 2026-11-24, row 3).
//!
//! Rotli's secure-note rules hold for what an agent asks Rotli for. A
//! client's own file tools open the vault's files directly and skip them, so
//! the setup also prints, per vault, the deny rules each client documents for
//! keeping its own tools out of that folder. Rotli prints these and never
//! writes them; a client's configuration is the person's.
//!
//! Each syntax below was read from the client's documentation on 2026-11-24:
//! - Claude Code (`https://code.claude.com/docs/en/permissions`): Read rules
//!   use gitignore patterns; `//path` is an absolute path (a single leading
//!   slash anchors at the settings file's folder). A `Read` deny is applied
//!   "on a best-effort basis" to Grep and Glob; a `Grep(path)` or `Glob(path)`
//!   rule is accepted and does nothing, so none is printed. Bash rules match
//!   command text, not paths, and a deny isn't a boundary around the shell.
//! - Cursor CLI (`https://cursor.com/docs/cli/reference/permissions`):
//!   `Read(pathOrGlob)` and `Write(pathOrGlob)` in `.cursor/cli.json`; an
//!   absolute path may name files outside the project; `Shell(base)` matches
//!   the command's first token only.
//! - Codex (`https://learn.chatgpt.com/codex/permissions`, marked beta): a
//!   named permission profile with `"<absolute path>" = "deny"` under
//!   `[permissions.<name>.filesystem]`, switched on by `default_permissions`,
//!   not combinable with `sandbox_mode`. It governs sandboxed commands; the
//!   page doesn't say that Codex's own file tools honour it.
//! - Gemini CLI (`docs/reference/policy-engine.md` and `docs/tools/file-system.md`
//!   in google-gemini/gemini-cli): `[[rule]]` tables with `toolName`,
//!   `argsPattern` (an RE2 regex tested against the call's arguments as a JSON
//!   string), `decision = "deny"` and `priority`, read from
//!   `~/.gemini/policies/*.toml` (the workspace tier is documented as
//!   non-functional). `read_file` takes `file_path`, `list_directory` takes
//!   `dir_path`; `glob` and `grep_search` take an optional `path`. The docs
//!   have no example that denies a path, so that rule is built from the
//!   schema and its examples and is labelled so in the output.
//! - Claude Desktop reads MCP servers from its config file and has no deny
//!   list.

use serde_json::{json, Value};

/// Shown where no vault is registered yet.
const PLACEHOLDER: &str = "/path/to/your/vault";

const WARNING: &str = "Rotli's secure-note rules cover what an agent asks Rotli for. A client's own file tools \
(Claude Code's Read, Grep, Glob and Bash; the shells of Codex, Cursor and Gemini) open the vault's files directly and \
bypass them, so an agent that has them can read the secure notes. Deny them for the vault \
folder below, or keep that agent out of the folder.";

/// Everything a Claude Code session started inside the vault folder loses:
/// the file tools and the shell, as the Librarian protocol's own file does
/// (`vault-thread-protocol.md` §3.2).
const INSIDE_VAULT_DENY: [&str; 8] = ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"];

/// One pattern for everything under `path`, in gitignore syntax (the
/// characters a pattern reads as wildcards are escaped).
fn under(path: &str) -> String {
    let mut out = String::new();
    for ch in path.trim_end_matches('/').chars() {
        if matches!(ch, '\\' | '*' | '?' | '[' | ']') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push_str("/**");
    out
}

/// Claude Code's absolute-path form: `//Users/me/vault/**`.
fn claude_rule(tool: &str, path: &str) -> String {
    format!("{tool}(/{})", under(path))
}

/// Cursor's: a plain absolute glob.
fn cursor_rule(tool: &str, path: &str) -> String {
    format!("{tool}({})", under(path))
}

/// `text` as an RE2 literal (what `argsPattern` reads).
fn regex_literal(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if "\\.+*?()|[]{}^$".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Gemini CLI policy rules that deny `read_file` and `list_directory` under
/// `path`. The arguments reach `argsPattern` as JSON, so the path is matched
/// as JSON-escaped text.
fn gemini_rules(path: &str) -> String {
    let json_path = serde_json::to_string(path.trim_end_matches('/')).unwrap_or_default();
    let json_path = json_path.trim_matches('"');
    [("read_file", "file_path"), ("list_directory", "dir_path")]
        .iter()
        .map(|(tool, key)| {
            let pattern = format!("\"{key}\":\"{}", regex_literal(json_path));
            format!("[[rule]]\ntoolName = \"{tool}\"\nargsPattern = {}\ndecision = \"deny\"\npriority = 900\n", toml_string(&pattern))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn toml_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
}

/// The deny setup for every vault in `vaults` as `(label, absolute path)`.
pub(crate) fn vault_access(vaults: &[(String, String)]) -> Value {
    let registered = !vaults.is_empty();
    let vaults: Vec<(String, String)> = if registered { vaults.to_vec() } else { vec![("Your vault".into(), PLACEHOLDER.into())] };
    let paths: Vec<&str> = vaults.iter().map(|(_, path)| path.as_str()).collect();
    let claude_deny: Vec<String> = paths.iter().flat_map(|path| [claude_rule("Read", path), claude_rule("Edit", path)]).collect();
    let cursor_deny: Vec<String> = paths.iter().flat_map(|path| [cursor_rule("Read", path), cursor_rule("Write", path)]).collect();
    let codex_entries: String = paths.iter().map(|path| format!("{} = \"deny\"\n", toml_string(path))).collect();
    json!({
        "warning": WARNING,
        "registered": registered,
        "vaults": vaults.iter().map(|(label, path)| json!({ "label": label, "path": path })).collect::<Vec<_>>(),
        "ifNoVault": if registered { Value::Null } else {
            json!("No vault is registered with Rotli on this Mac yet. Open Rotli once, then run this again, or replace the placeholder path with your vault's folder.")
        },
        "claudeCode": {
            "appliesTo": "Claude Code, and T3 Code threads (T3 runs Claude Code and loads the same settings files)",
            "anySession": {
                "file": "~/.claude/settings.json",
                "settings": { "permissions": { "deny": claude_deny } },
                "covers": "Read, Edit and Write on the vault from any folder. A Read rule is applied to Grep and Glob best-effort, and to cat, head, tail and sed on that path. It does not stop a shell that reads without naming the path (python, grep -r from inside the folder)."
            },
            "sessionsInsideTheVault": vaults.iter().map(|(label, path)| json!({
                "vault": label,
                "file": format!("{}/.claude/settings.json", path.trim_end_matches('/')),
                "settings": { "permissions": { "deny": INSIDE_VAULT_DENY } },
                "covers": "Removes the file tools and the shell from a session whose folder is this vault, which is the only place a shell can't be fenced by path. The agent keeps Rotli's MCP tools."
            })).collect::<Vec<_>>(),
            "note": "Grep(path) and Glob(path) rules are accepted by Claude Code but match nothing, so only Read is printed for them. Bash rules match command text, not folders; use the second block, or a sandbox, to keep a shell out."
        },
        "cursor": {
            "file": "<project>/.cursor/cli.json or ~/.cursor/cli-config.json",
            "settings": { "permissions": { "deny": cursor_deny } },
            "limit": "Shell(...) rules match a command's first token, not a folder, so they can't fence the vault; keep Cursor's agent out of the folder if it has a shell."
        },
        "codex": {
            "file": "~/.codex/config.toml",
            "toml": format!("default_permissions = \"rotli-vault-guard\"\n\n[permissions.rotli-vault-guard]\nextends = \":workspace\"\n\n[permissions.rotli-vault-guard.filesystem]\n{codex_entries}"),
            "limit": "Codex marks permission profiles beta. They govern sandboxed commands; its documentation doesn't say its own file tools honour them. A profile can't be combined with sandbox_mode: remove that key and any [sandbox_workspace_write] table."
        },
        "gemini": {
            "file": "~/.gemini/policies/rotli-vault-guard.toml",
            "toml": paths.iter().map(|path| gemini_rules(path)).collect::<Vec<_>>().join("\n"),
            "limit": "Built from Gemini's documented rule fields; its docs have no example that denies a path, so try one read_file on the vault after adding it. Policies apply to every Gemini session (the workspace tier is documented as non-functional). glob and grep_search take an optional path that defaults to the working folder, and a shell can't be fenced by path, so none is printed for them: keep Gemini's working folder away from the vault."
        },
        "claudeDesktop": "Claude Desktop has no deny list for file access: its config file lists MCP servers. Don't add a filesystem server or extension that includes the vault folder."
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(path: &str) -> Vec<(String, String)> {
        vec![("Notes".into(), path.into())]
    }

    #[test]
    fn claude_code_gets_an_absolute_read_and_edit_deny_for_the_vault() {
        let access = vault_access(&one("/Users/test/My Vault"));
        assert_eq!(
            access["claudeCode"]["anySession"]["settings"],
            json!({ "permissions": { "deny": ["Read(//Users/test/My Vault/**)", "Edit(//Users/test/My Vault/**)"] } })
        );
        assert_eq!(access["claudeCode"]["anySession"]["file"], "~/.claude/settings.json");
    }

    #[test]
    fn claude_code_gets_no_path_rule_for_grep_or_glob_because_those_match_nothing() {
        let access = vault_access(&one("/v"));
        let rules = access["claudeCode"]["anySession"]["settings"]["permissions"]["deny"].as_array().unwrap().clone();
        assert!(rules.iter().all(|rule| !rule.as_str().unwrap().starts_with("Grep(") && !rule.as_str().unwrap().starts_with("Glob(")));
        assert!(access["claudeCode"]["note"].as_str().unwrap().contains("match nothing"));
    }

    #[test]
    fn a_session_inside_the_vault_loses_the_file_tools_and_the_shell() {
        let access = vault_access(&one("/Users/test/vault/"));
        let inside = &access["claudeCode"]["sessionsInsideTheVault"][0];
        assert_eq!(inside["file"], "/Users/test/vault/.claude/settings.json");
        assert_eq!(
            inside["settings"],
            json!({ "permissions": { "deny": ["Read", "Grep", "Glob", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"] } })
        );
    }

    #[test]
    fn a_path_with_wildcard_characters_is_escaped_so_it_names_only_itself() {
        assert_eq!(claude_rule("Read", "/Users/test/Notes [old]*"), "Read(//Users/test/Notes \\[old\\]\\*/**)");
        assert_eq!(under("/a?b\\c"), "/a\\?b\\\\c/**");
    }

    #[test]
    fn every_vault_gets_its_own_rules() {
        let vaults = vec![("Notes".into(), "/a/notes".into()), ("Work".into(), "/b/work".into())];
        let access = vault_access(&vaults);
        let deny = access["claudeCode"]["anySession"]["settings"]["permissions"]["deny"].as_array().unwrap();
        assert_eq!(deny.len(), 4);
        assert_eq!(access["claudeCode"]["sessionsInsideTheVault"].as_array().unwrap().len(), 2);
        assert!(access["codex"]["toml"].as_str().unwrap().contains("\"/b/work\" = \"deny\""));
    }

    #[test]
    fn cursor_gets_read_and_write_denies_in_its_own_syntax() {
        let access = vault_access(&one("/Users/test/vault"));
        assert_eq!(
            access["cursor"]["settings"],
            json!({ "permissions": { "deny": ["Read(/Users/test/vault/**)", "Write(/Users/test/vault/**)"] } })
        );
    }

    #[test]
    fn codex_gets_a_permission_profile_that_denies_the_vault_folder() {
        let access = vault_access(&one("/Users/test/vault"));
        assert_eq!(
            access["codex"]["toml"],
            "default_permissions = \"rotli-vault-guard\"\n\n[permissions.rotli-vault-guard]\nextends = \":workspace\"\n\n[permissions.rotli-vault-guard.filesystem]\n\"/Users/test/vault\" = \"deny\"\n"
        );
    }

    #[test]
    fn the_warning_says_the_clients_own_file_tools_bypass_rotli() {
        let access = vault_access(&one("/v"));
        let warning = access["warning"].as_str().unwrap();
        assert!(warning.contains("bypass"));
        assert!(warning.contains("Read, Grep, Glob and Bash"));
        assert!(warning.contains("secure"));
    }

    #[test]
    fn gemini_gets_policy_rules_for_the_two_tools_that_take_a_path_it_can_match() {
        let access = vault_access(&one("/Users/test/my.vault"));
        assert_eq!(
            access["gemini"]["toml"],
            "[[rule]]\ntoolName = \"read_file\"\nargsPattern = \"\\\"file_path\\\":\\\"/Users/test/my\\\\.vault\"\ndecision = \"deny\"\npriority = 900\n\n[[rule]]\ntoolName = \"list_directory\"\nargsPattern = \"\\\"dir_path\\\":\\\"/Users/test/my\\\\.vault\"\ndecision = \"deny\"\npriority = 900\n"
        );
        assert!(access["gemini"]["limit"].as_str().unwrap().contains("shell can't be fenced"));
        assert_eq!(access["gemini"]["file"], "~/.gemini/policies/rotli-vault-guard.toml");
    }

    #[test]
    fn claude_desktop_says_it_has_no_deny_list_instead_of_inventing_a_rule() {
        let access = vault_access(&one("/v"));
        assert!(access["claudeDesktop"].as_str().unwrap().contains("no deny list"));
    }

    #[test]
    fn with_no_vault_registered_the_blocks_use_a_placeholder_and_say_so() {
        let access = vault_access(&[]);
        assert_eq!(access["registered"], false);
        assert_eq!(access["vaults"][0]["path"], PLACEHOLDER);
        assert!(access["ifNoVault"].as_str().unwrap().contains("Open Rotli once"));
        assert_eq!(access["claudeCode"]["anySession"]["settings"]["permissions"]["deny"][0], "Read(//path/to/your/vault/**)");
        assert_eq!(vault_access(&one("/v"))["registered"], true);
        assert_eq!(vault_access(&one("/v"))["ifNoVault"], Value::Null);
    }
}
