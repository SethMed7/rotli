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
//! - Gemini CLI (`docs/reference/policy-engine.md`, `docs/tools/file-system.md`
//!   and `docs/reference/tools.md` in google-gemini/gemini-cli): `[[rule]]`
//!   tables with `toolName`, `argsPattern` (an RE2 regex tested against the
//!   call's arguments as a JSON string), `decision = "deny"` and `priority`,
//!   read from `~/.gemini/policies/*.toml` (the workspace tier is documented
//!   as non-functional). `read_file`, `write_file` and `replace` take
//!   `file_path`; `list_directory` takes `dir_path`; for `glob` and
//!   `grep_search` the two pages disagree (`path` against `dir_path`), so both
//!   keys are denied. `read_many_files` takes `include`, undocumented as a
//!   type and often relative, so it is denied whole. The docs have no example
//!   that denies a path: those rules are built from the schema and its
//!   examples, and the output says so.
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
/// the file tools, the shell and T3's own tools. It is the deny list in the
/// Librarian protocol's settings file (`vault-thread-protocol.md` §3.2), and a
/// test reads that file, so the two can't drift apart.
const INSIDE_VAULT_DENY: [&str; 9] = ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "mcp__t3-code"];

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

/// Cursor's: a plain absolute glob. Its globs are not gitignore patterns and
/// its docs give no escape for `*` and `?`, so a path holding either gets no
/// rule (a rule that names more than the vault would be a wrong one).
fn cursor_rule(tool: &str, path: &str) -> Option<String> {
    if path.contains(['*', '?']) {
        return None;
    }
    Some(format!("{tool}({}/**)", path.trim_end_matches('/')))
}

/// `path` as the registered spelling and, when it differs, the canonical one
/// (`canonicalize`: symlinks resolved): a rule on one doesn't match a tool
/// that reaches the vault through the other. Other casings of the same folder
/// are not covered: a path an agent types in a different case may not match a
/// rule, whatever the volume.
fn spellings(path: &str) -> Vec<String> {
    let mut all = vec![path.to_string()];
    if let Ok(real) = std::fs::canonicalize(path) {
        let real = real.display().to_string();
        if real != path {
            all.push(real);
        }
    }
    all
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

/// Gemini CLI policy rules that deny each tool that names a path, under
/// `path` (the folder itself or anything in it). The arguments reach
/// `argsPattern` as JSON, so the path is matched as JSON-escaped text.
fn gemini_rules(path: &str) -> String {
    let json_path = serde_json::to_string(path.trim_end_matches('/')).unwrap_or_default();
    let literal = regex_literal(&json_path[1..json_path.len() - 1]);
    GEMINI_PATH_ARGS
        .iter()
        .map(|(tool, key)| {
            let pattern = format!("\"{key}\":\"{literal}(?:/|\")");
            format!("[[rule]]\ntoolName = \"{tool}\"\nargsPattern = {}\ndecision = \"deny\"\npriority = 900\n", toml_string(&pattern))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// (tool, the argument that names its path) for Gemini's file tools.
const GEMINI_PATH_ARGS: [(&str, &str); 8] = [
    ("read_file", "file_path"),
    ("write_file", "file_path"),
    ("replace", "file_path"),
    ("list_directory", "dir_path"),
    ("glob", "dir_path"),
    ("glob", "path"),
    ("grep_search", "dir_path"),
    ("grep_search", "path"),
];

/// `@` paths read through this tool, whose `include` can't be fenced by a folder.
const GEMINI_WHOLE_TOOL: &str = "[[rule]]\ntoolName = \"read_many_files\"\ndecision = \"deny\"\npriority = 900\n";

fn toml_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
}

/// The deny setup for every vault in `vaults` as `(label, absolute path)`.
/// Every rule is printed for the registered spelling of each path and, where
/// it differs, the canonical one.
pub(crate) fn vault_access(vaults: &[(String, String)]) -> Value {
    let registered = !vaults.is_empty();
    let vaults: Vec<(String, String)> = if registered { vaults.to_vec() } else { vec![("Your vault".into(), PLACEHOLDER.into())] };
    let mut seen = std::collections::HashSet::new();
    let paths: Vec<String> = vaults.iter().flat_map(|(_, path)| spellings(path)).filter(|path| seen.insert(path.clone())).collect();
    let claude_deny: Vec<String> = paths.iter().flat_map(|path| [claude_rule("Read", path), claude_rule("Edit", path)]).collect();
    let cursor_deny: Vec<String> = paths.iter().filter_map(|path| cursor_rule("Read", path).zip(cursor_rule("Write", path))).flat_map(|(read, write)| [read, write]).collect();
    let cursor_skipped: Vec<&String> = paths.iter().filter(|path| cursor_rule("Read", path).is_none()).collect();
    let codex_entries: String = paths.iter().map(|path| format!("{} = \"deny\"\n", toml_string(path))).collect();
    let gemini_toml = format!("{}\n{GEMINI_WHOLE_TOOL}", paths.iter().map(|path| gemini_rules(path)).collect::<Vec<_>>().join("\n"));
    json!({
        "warning": WARNING,
        "registered": registered,
        "vaults": vaults.iter().map(|(label, path)| {
            let mut entry = json!({ "label": label, "path": path });
            let also: Vec<String> = spellings(path).into_iter().skip(1).collect();
            if !also.is_empty() {
                entry["alsoKnownAs"] = json!(also);
            }
            entry
        }).collect::<Vec<_>>(),
        "ifNoVault": if registered { Value::Null } else {
            json!("No vault is registered with Rotli on this Mac yet. Open Rotli once, then run this again, or replace the placeholder path with your vault's folder.")
        },
        "claudeCode": {
            "appliesTo": "Claude Code, and T3 Code threads (T3 runs Claude Code and loads the same settings files)",
            "anySession": {
                "file": "~/.claude/settings.json",
                "settings": { "permissions": { "deny": claude_deny } },
                "covers": "Read and Edit on the vault from any folder. Claude Code applies a Read rule best-effort to Grep and Glob, and to cat, head, tail and sed on that path. It does not cover a shell that reads without naming the path (python, grep -r from inside the folder)."
            },
            "sessionsInsideTheVault": vaults.iter().map(|(label, path)| json!({
                "vault": label,
                "file": format!("{}/.claude/settings.json", path.trim_end_matches('/')),
                "settings": { "permissions": { "deny": INSIDE_VAULT_DENY } },
                "covers": "Removes the file tools, the shell and T3's own tools from a session started in this vault folder. It is the Librarian protocol's list. The agent keeps Rotli's MCP tools."
            })).collect::<Vec<_>>(),
            "note": "Grep(path) and Glob(path) rules are accepted by Claude Code but match nothing, so only Read is printed for them. Bash rules match command text, not folders: the whole-tool deny above is the only way here to fence a shell, and only for sessions started in the vault."
        },
        "cursor": {
            "file": "<project>/.cursor/cli.json or ~/.cursor/cli-config.json",
            "settings": { "permissions": { "deny": cursor_deny } },
            "skipped": cursor_skipped,
            "limit": "Shell(...) rules match a command's first token, not a folder, so a shell can't be fenced. A path holding * or ? gets no rule (listed under skipped) because Cursor's docs give no way to write it literally."
        },
        "codex": {
            "file": "~/.codex/config.toml",
            "toml": format!("default_permissions = \"rotli-vault-guard\"\n\n[permissions.rotli-vault-guard]\nextends = \":workspace\"\n\n[permissions.rotli-vault-guard.filesystem]\n{codex_entries}"),
            "limit": "Codex marks permission profiles beta. They govern sandboxed commands; its documentation doesn't say its own file tools honour them. A profile can't be combined with sandbox_mode: remove that key and any [sandbox_workspace_write] table."
        },
        "gemini": {
            "file": "~/.gemini/policies/rotli-vault-guard.toml",
            "toml": gemini_toml,
            "limit": "Fences the file tools Gemini documents: read_file, write_file, replace, list_directory, glob and grep_search are denied under the vault, and read_many_files (what @ paths use) is denied everywhere, because its include globs can't be fenced by a folder. A shell (run_shell_command) can't be fenced by path, and a glob or grep_search call with no path searches the working folder, so run Gemini from a folder outside the vault. Built from Gemini's documented rule fields and tool arguments; its docs have no example that denies a path, so try one read_file on the vault after adding it. The rules match absolute paths, so a relative path from a nearby folder isn't matched. Policies apply to every Gemini session (the workspace tier is documented as non-functional)."
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
            json!({ "permissions": { "deny": ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "mcp__t3-code"] } })
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

    /// The deny list in the Librarian protocol's own settings file (§3.2): the
    /// printed vault-session settings must be the list people already trust.
    fn protocol_deny_list() -> Vec<String> {
        deny_list_under(include_str!("../../docs/architecture/vault-thread-protocol.md"), "### 3.2 ")
    }

    /// The first `"deny": [...]` after the heading that starts with `heading`,
    /// so an example added earlier in the document can't be read by mistake.
    fn deny_list_under(doc: &str, heading: &str) -> Vec<String> {
        let section = &doc[doc.find(heading).unwrap_or_else(|| panic!("no section {heading}"))..];
        let from = section.find("\"deny\": [").expect("the section's settings file names a deny list") + "\"deny\": ".len();
        let list = &section[from..from + section[from..].find(']').unwrap() + 1];
        serde_json::from_str(list).expect("the deny list is JSON")
    }

    #[test]
    fn the_vault_session_settings_are_the_librarian_protocols_list_including_t3s_own_tools() {
        let protocol = protocol_deny_list();
        assert!(protocol.contains(&"mcp__t3-code".to_string()));
        assert_eq!(INSIDE_VAULT_DENY.to_vec(), protocol, "one list, so a change to either shows up in both");
        let access = vault_access(&one("/Users/test/vault"));
        assert_eq!(access["claudeCode"]["sessionsInsideTheVault"][0]["settings"]["permissions"]["deny"], json!(protocol));
    }

    #[test]
    fn gemini_is_fenced_for_every_documented_tool_that_names_a_path_and_read_many_files_is_denied_whole() {
        let toml = vault_access(&one("/Users/test/vault"))["gemini"]["toml"].as_str().unwrap().to_string();
        for (tool, key) in [
            ("read_file", "file_path"),
            ("write_file", "file_path"),
            ("replace", "file_path"),
            ("list_directory", "dir_path"),
            ("glob", "dir_path"),
            ("glob", "path"),
            ("grep_search", "dir_path"),
            ("grep_search", "path"),
        ] {
            let rule = format!("toolName = \"{tool}\"\nargsPattern = \"\\\"{key}\\\":\\\"/Users/test/vault(?:/|\\\")\"\ndecision = \"deny\"");
            assert!(toml.contains(&rule), "{tool} {key} is not denied under the vault:\n{toml}");
        }
        // `@` paths read through read_many_files, whose `include` globs can't be fenced by a folder
        assert!(toml.contains("toolName = \"read_many_files\"\ndecision = \"deny\"\npriority = 900\n"), "{toml}");
        assert_eq!(toml.matches("read_many_files").count(), 1, "one whole-tool rule, however many vaults");
    }

    #[test]
    fn gemini_says_what_it_cannot_fence() {
        let limit = vault_access(&one("/v"))["gemini"]["limit"].as_str().unwrap().to_string();
        for word in ["run_shell_command", "read_many_files", "can't be fenced"] {
            assert!(limit.contains(word), "{word}: {limit}");
        }
        assert!(!limit.contains("keep"), "no claim that the rules keep Gemini out: {limit}");
    }

    #[test]
    fn a_vault_reached_through_a_symlink_is_denied_under_both_spellings() {
        let real = tempfile::TempDir::new().unwrap();
        let link_home = tempfile::TempDir::new().unwrap();
        let link = link_home.path().join("Notes link");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        let registered = link.display().to_string();
        let canonical = std::fs::canonicalize(real.path()).unwrap().display().to_string();
        assert_ne!(registered, canonical);
        let access = vault_access(&one(&registered));
        assert_eq!(access["vaults"][0]["path"], registered.as_str());
        assert_eq!(access["vaults"][0]["alsoKnownAs"], json!([canonical]));
        let deny = access["claudeCode"]["anySession"]["settings"]["permissions"]["deny"].to_string();
        assert!(deny.contains(&format!("Read(/{registered}/**)")), "{deny}");
        assert!(deny.contains(&format!("Read(/{canonical}/**)")), "{deny}");
        for client in ["cursor", "codex"] {
            assert!(access[client].to_string().contains(&canonical), "{client} misses the canonical spelling");
        }
        // Gemini's rules are regexes: the canonical path, escaped, then TOML-escaped
        let regex = regex_literal(&canonical).replace('\\', "\\\\");
        assert!(access["gemini"]["toml"].as_str().unwrap().contains(&regex), "gemini misses the canonical spelling");
        // a path that is already canonical says nothing extra
        assert!(vault_access(&one(&canonical))["vaults"][0].get("alsoKnownAs").is_none());
    }

    #[test]
    fn cursor_gets_no_rule_for_a_path_its_globs_would_read_as_wildcards() {
        let access = vault_access(&[("A".into(), "/Users/test/Notes*".into()), ("B".into(), "/Users/test/ok".into())]);
        assert_eq!(access["cursor"]["settings"], json!({ "permissions": { "deny": ["Read(/Users/test/ok/**)", "Write(/Users/test/ok/**)"] } }));
        assert_eq!(access["cursor"]["skipped"], json!(["/Users/test/Notes*"]));
        // brackets and backslashes are not wildcards in its globs: kept as written
        assert_eq!(cursor_rule("Read", "/a/b[1]").unwrap(), "Read(/a/b[1]/**)");
    }

    #[test]
    fn a_quote_in_a_path_is_escaped_wherever_the_output_is_json_or_toml() {
        let access = vault_access(&one("/Users/test/say \"hi\""));
        let printed = access.to_string();
        assert!(serde_json::from_str::<Value>(&printed).is_ok());
        assert!(access["codex"]["toml"].as_str().unwrap().contains("\"/Users/test/say \\\"hi\\\"\" = \"deny\""));
        let pattern = r#""file_path":"/Users/test/say \\"hi\\"(?:/|")"#;
        assert!(access["gemini"]["toml"].as_str().unwrap().contains(&toml_string(pattern)), "{}", access["gemini"]["toml"]);
    }

    #[test]
    fn a_path_that_is_one_vaults_canonical_and_anothers_registered_spelling_is_ruled_once() {
        let real = tempfile::TempDir::new().unwrap();
        let link_home = tempfile::TempDir::new().unwrap();
        let link = link_home.path().join("Alias");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();
        let canonical = std::fs::canonicalize(real.path()).unwrap().display().to_string();
        // A is the symlink (it resolves to B's path), then a third vault, then B itself: not adjacent
        let vaults = vec![("A".into(), link.display().to_string()), ("C".into(), "/Users/test/other".into()), ("B".into(), canonical.clone())];
        let deny = vault_access(&vaults)["claudeCode"]["anySession"]["settings"]["permissions"]["deny"].clone();
        let rules: Vec<&str> = deny.as_array().unwrap().iter().map(|rule| rule.as_str().unwrap()).collect();
        let mut unique = rules.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(rules.len(), unique.len(), "a rule printed twice: {rules:?}");
        assert_eq!(rules.len(), 6, "three distinct paths, a Read and an Edit each: {rules:?}");
        // order is the vaults' own order, the registered spelling first
        assert!(rules[0].contains(&link.display().to_string()), "{rules:?}");
    }

    #[test]
    fn the_protocol_list_is_read_from_the_settings_file_under_its_own_heading() {
        let doc = "## 1\n```json\n{ \"permissions\": { \"deny\": [\"Wrong\"] } }\n```\n### 3.2 Option A: files\n```json\n{ \"permissions\": { \"deny\": [\"Right\", \"Also\"] } }\n```\n### 3.3 Option B\n```json\n{ \"deny\": [\"Later\"] }\n```\n";
        assert_eq!(deny_list_under(doc, "### 3.2 "), vec!["Right".to_string(), "Also".to_string()]);
        assert!(std::panic::catch_unwind(|| deny_list_under(doc, "### 9.9 ")).is_err(), "a missing heading is an error, not a guess");
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
