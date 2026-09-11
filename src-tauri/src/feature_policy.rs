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
    fn public_and_unknown_channels_refuse_agent_integrations() {
        assert!(!agents_enabled_for("stable"));
        assert!(!agents_enabled_for(""));
        assert!(!agents_enabled_for("preview"));
        assert!(agents_enabled_for("dev"));
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
