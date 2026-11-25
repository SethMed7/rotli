//! Connected lanes the owner has paused. A paused lane stays listed (its models
//! show, labelled `PAUSED_LABEL`) but never runs: every turn, Settings test,
//! Helper call and model discovery is refused here before a process starts.
//! The TypeScript side keeps its own copy of the same list and refuses first
//! (src/lib/lanePause.ts); scripts/fixtures/parity.json pins the two equal.
//!
//! Cursor, 2026-11-24 (chat audit S6): Cursor has no flag to skip the user's
//! `~/.cursor/mcp.json`, and its project state for a Rotli scratch workspace
//! shows MCP sign-ins for the user's own servers. Lift it once a signed-in
//! probe proves no MCP tool reaches the model.

pub(crate) const PAUSED_PROVIDERS: &[&str] = &["cursor"];

/// The picker's wording (shown by the TS side only), kept here so the parity
/// fixture pins both copies.
#[cfg(test)]
pub(crate) const PAUSED_LABEL: &str = "Paused for a privacy check";

pub(crate) const PAUSED_MESSAGE: &str =
    "Cursor chats are paused for a privacy check. Rotli is making sure Cursor can't reach your notes through tools of its own. Pick another model to keep going.";

pub(crate) fn lane_paused(provider: &str) -> bool {
    PAUSED_PROVIDERS.contains(&provider)
}

/// Refuse a paused lane with the message the chat shows in place of an answer.
pub(crate) fn refuse_paused(provider: &str) -> Result<(), String> {
    if lane_paused(provider) {
        return Err(PAUSED_MESSAGE.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_is_paused_and_every_other_lane_runs() {
        assert!(lane_paused("cursor"));
        let refusal = refuse_paused("cursor").unwrap_err();
        assert!(refusal.contains("paused for a privacy check"), "{refusal}");
        for open in ["claude", "codex", "antigravity"] {
            assert!(!lane_paused(open));
            assert!(refuse_paused(open).is_ok());
        }
    }

    #[test]
    fn a_paused_lane_is_refused_by_the_shared_provider_policy() {
        let refusal = crate::provider::connected_provider_execution_allowed("cursor").unwrap_err();
        assert_eq!(refusal, PAUSED_MESSAGE);
        assert!(crate::provider::connected_provider_execution_allowed("codex").is_ok());
    }

    /// Settings' status check starts nothing for a paused lane: no
    /// `--version`, no `status` (on a Mac with Cursor installed and signed
    /// in, both would otherwise answer).
    #[test]
    fn settings_never_starts_a_paused_client() {
        let detected = crate::provider::detect("cursor").unwrap();
        assert!(detected.version.is_none(), "no --version probe");
        assert!(!detected.authenticated, "no status probe");
    }

    #[test]
    fn a_paused_lane_never_reaches_a_spawn() {
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};
        let children = Arc::new(Mutex::new(HashMap::new()));
        let turn = crate::provider_lane::complete_blocking(
            &children,
            "paused",
            "cursor",
            "grok-4.6",
            "hello",
            std::time::Duration::from_secs(1),
            None,
            None,
            None,
        );
        assert_eq!(turn.unwrap_err(), PAUSED_MESSAGE);
        assert!(children.lock().unwrap().is_empty());
        // model discovery would start the Cursor agent, and with it the
        // user's MCP servers: it is refused too
        assert_eq!(crate::provider_models::discover("cursor", true).unwrap_err(), PAUSED_MESSAGE);
    }
}
