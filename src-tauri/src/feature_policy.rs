//! Build-only promotion policy. Persisted settings and process environment at
//! runtime cannot enable a capability in the public binary.
fn breve_enabled_for(channel: &str) -> bool {
    channel == "dev"
}

pub(crate) fn breve_enabled() -> bool {
    breve_enabled_for(env!("ROTLI_BUILD_CHANNEL"))
}

pub(crate) fn require_breve() -> Result<(), String> {
    if breve_enabled() { Ok(()) } else { Err("Breve is available only in development builds".into()) }
}

/// Agent integrations: the stdio/loopback MCP server, `rotli agent …`, and the
/// remote relay connector. Out of production until refined (2026-09-11); the
/// plain JSON CLI (`rotli notes …`, `rotli views …`) stays available.
fn agents_enabled_for(channel: &str) -> bool {
    channel == "dev"
}

pub(crate) fn agents_enabled() -> bool {
    agents_enabled_for(env!("ROTLI_BUILD_CHANNEL"))
}

pub(crate) const AGENTS_UNAVAILABLE: &str =
    "MCP and agent integrations are available only in development builds";

pub(crate) fn require_agents() -> Result<(), String> {
    if agents_enabled() { Ok(()) } else { Err(AGENTS_UNAVAILABLE.into()) }
}

/// The CLI commands that are agent integrations: the MCP servers (the full
/// workspace and the Librarian route, `rotli mcp --librarian`), `rotli agent …`,
/// and the person's side of the Librarian route (`rotli librarian …`). The
/// route stays in development builds until its 2026-11-09 review findings are
/// fixed (docs/design/librarian-mcp-and-t3-chat.md, "Before this route leaves
/// development builds").
fn cli_gate_for(command: &str, channel: &str) -> Result<(), String> {
    let integration = matches!(command, "mcp" | "agent" | "librarian");
    if integration && !agents_enabled_for(channel) { Err(AGENTS_UNAVAILABLE.into()) } else { Ok(()) }
}

/// `run_cli` asks this once, before any command runs.
pub(crate) fn cli_gate(command: &str) -> Result<(), String> {
    cli_gate_for(command, env!("ROTLI_BUILD_CHANNEL"))
}

/// JSON Canvas `.canvas` files (2026-10-06): development builds only. In the
/// public binary a `.canvas` is withheld (2026-10-15): the walk leaves it out
/// of every listing and Main (`corpus_files.rs` `is_withheld_canvas`), it stays
/// on disk untouched, and Rotli never creates one.
fn canvas_enabled_for(channel: &str) -> bool {
    channel == "dev"
}

pub(crate) fn canvas_enabled() -> bool {
    canvas_enabled_for(env!("ROTLI_BUILD_CHANNEL"))
}

pub(crate) fn require_canvas() -> Result<(), String> {
    if canvas_enabled() { Ok(()) } else { Err("Canvases are available only in development builds".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_build_refuses_key_commands_before_credential_access() {
        if env!("ROTLI_BUILD_CHANNEL") == "stable" {
            let expected = "Breve is available only in development builds";
            assert_eq!(crate::breve::breve_store_resend_key("synthetic".into()).unwrap_err(), expected);
            assert_eq!(crate::breve::breve_remove_resend_key().unwrap_err(), expected);
        }
    }

    #[test]
    fn public_and_unknown_channels_refuse_breve() {
        assert!(!breve_enabled_for("stable"));
        assert!(!breve_enabled_for(""));
        assert!(!breve_enabled_for("preview"));
        assert!(breve_enabled_for("dev"));
    }

    #[test]
    fn public_and_unknown_channels_refuse_canvases() {
        assert!(!canvas_enabled_for("stable"));
        assert!(!canvas_enabled_for(""));
        assert!(canvas_enabled_for("dev"));
    }

    #[test]
    fn public_and_unknown_channels_refuse_agent_integrations() {
        assert!(!agents_enabled_for("stable"));
        assert!(!agents_enabled_for(""));
        assert!(!agents_enabled_for("preview"));
        assert!(agents_enabled_for("dev"));
    }

    /// Every way into the Librarian agent route, on both channels: one gate,
    /// the one the rest of `rotli mcp` uses (2026-11-09: the route stays in
    /// development builds until its review findings are fixed).
    #[test]
    fn the_librarian_route_is_refused_in_stable_and_open_in_dev() {
        let mut entries: Vec<Vec<&str>> =
            vec![vec!["mcp", "--librarian"], vec!["mcp", "--librarian", "--vault", "/v"], vec!["mcp", "config", "--librarian"], vec!["librarian"]];
        // every person command the route has, so a new one is checked too
        entries.extend(crate::workspace::librarian::PERSON_COMMANDS.iter().map(|command| vec!["librarian", command, "01PROPOSAL"]));
        for entry in entries {
            assert_eq!(cli_gate_for(entry[0], "stable"), Err(AGENTS_UNAVAILABLE.to_string()), "{entry:?}");
            assert_eq!(cli_gate_for(entry[0], ""), Err(AGENTS_UNAVAILABLE.to_string()), "{entry:?}");
            assert_eq!(cli_gate_for(entry[0], "dev"), Ok(()), "{entry:?}");
        }
        // the plain JSON CLI is not an agent integration
        for open in ["notes", "views", "main", "boards", "version", "help"] {
            assert_eq!(cli_gate_for(open, "stable"), Ok(()), "{open}");
        }
    }

    #[test]
    fn stable_build_refuses_every_librarian_entry() {
        if env!("ROTLI_BUILD_CHANNEL") == "stable" {
            let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
            for entry in [
                &["rotli", "mcp", "--librarian"][..],
                &["rotli", "mcp", "config", "--librarian"],
                &["rotli", "librarian", "status"],
                &["rotli", "librarian", "apply", "01PROPOSAL"],
            ] {
                assert_eq!(crate::workspace::run_if_requested(&args(entry)), Some(1), "{entry:?}");
            }
        }
    }

    /// A new way into the Librarian route must come through the gate. The
    /// route's module is reached only from `run_cli`, after `cli_gate`, and
    /// nothing in the app or the web build reads its switch.
    #[test]
    fn no_librarian_entry_bypasses_the_gate() {
        let src = |path: &str| std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/").to_string() + path).unwrap();
        let workspace = src("workspace.rs");
        let production = workspace.split("#[cfg(test)]").next().unwrap();
        let run_cli = production.find("fn run_cli(").expect("run_cli");
        let body_end = run_cli + production[run_cli + 1..].find("\nfn ").expect("a fn after run_cli") + 1;
        let gate = run_cli
            + production[run_cli..body_end].find("crate::feature_policy::cli_gate(command)?").expect("run_cli calls the gate");
        for (at, _) in production.match_indices("librarian::") {
            let call = &production[at..(at + 40).min(production.len())];
            if call.starts_with("librarian::enabled(") {
                continue; // the switch itself refuses outside development builds
            }
            assert!(
                (call.starts_with("librarian::serve(") || call.starts_with("librarian::cli(")) && at > gate && at < body_end,
                "a Librarian entry outside run_cli's gate (add it to the gate test above): {call}"
            );
        }
        let route = src("workspace_librarian.rs");
        assert!(!route.contains("#[tauri::command]"), "the route has no app command");
        assert!(route.contains("crate::feature_policy::agents_enabled()"), "the switch reads the gate");
        for dir in ["src-tauri/src", "src"] {
            let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(dir);
            for entry in walkdir_files(&root) {
                let name = entry.to_string_lossy().to_string();
                let text = std::fs::read_to_string(&entry).unwrap_or_default();
                // the route itself, this test, and the file that defines the switch
                let defines = text.contains("pub(crate) const LIBRARIAN_MCP_SETTING");
                if name.contains("workspace_librarian") || name.ends_with("feature_policy.rs") || defines {
                    continue;
                }
                assert!(!text.contains("librarianMcp") && !text.contains("LIBRARIAN_MCP_SETTING"), "{name} reads the Librarian route's switch");
            }
        }
    }

    fn walkdir_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(walkdir_files(&path));
            } else if path.extension().is_some_and(|ext| ["rs", "ts", "tsx"].contains(&ext.to_str().unwrap_or(""))) {
                out.push(path);
            }
        }
        out
    }

    #[test]
    fn stable_build_refuses_mcp_and_agent_cli_but_keeps_the_notes_cli_recognized() {
        if env!("ROTLI_BUILD_CHANNEL") == "stable" {
            let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
            assert_eq!(crate::workspace::run_if_requested(&args(&["rotli", "mcp"])), Some(1));
            assert_eq!(crate::workspace::run_if_requested(&args(&["rotli", "agent", "config"])), Some(1));
            assert_eq!(crate::workspace::run_if_requested(&args(&["rotli", "help"])), Some(0));
        }
    }
}
