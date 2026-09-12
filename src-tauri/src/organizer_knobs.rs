//! The organizer's settings.json knobs — frontend-owned, Rust READS only —
//! and the one decision that rides on them: which lane files notes this
//! cycle. Split from organizer.rs so the lane choice has a small, testable
//! home.

use std::time::Duration;

use crate::organizer::Trust;

/// Knob defaults — knob-not-constant per §6.4; the settings.json keys
/// (`organizerThreshold` / `organizerQuietSecs`) override per cycle.
pub(crate) const DEFAULT_THRESHOLD: f64 = 0.8;
/// Default quiet window: organize a note only after it's sat UNTOUCHED this long
/// ("watch the file, wait 5 minutes, then organize"). The `organizerQuietSecs`
/// knob overrides it per cycle.
pub(crate) const DEFAULT_QUIET: Duration = Duration::from_secs(300);

/// Connected clients the Librarian may file through: the official clients the
/// chat lanes already use, minus Cursor (a read-only code-chat lane that never
/// participates in background work). Byte-identical to LIBRARIAN_LANES in
/// src/ai/librarianLane.ts.
pub(crate) const LIBRARIAN_LANES: &[&str] = &["claude", "codex", "antigravity"];

/// Which model the organizer runs. `Connected` names one of `LIBRARIAN_LANES`;
/// anything else — including the legacy remote ids and Cursor — parses to
/// Local, so an old or hand-edited settings file can never route notes to a
/// client the user did not pick.
#[derive(Clone, PartialEq, Debug)]
pub(crate) enum OrgModel {
    Local,
    Connected(String),
}

impl OrgModel {
    pub(crate) fn parse(s: &str) -> Self {
        let id = s.trim().to_ascii_lowercase();
        if LIBRARIAN_LANES.contains(&id.as_str()) {
            OrgModel::Connected(id)
        } else {
            OrgModel::Local
        }
    }
}

pub(crate) struct Knobs {
    /// The vault's Brain master switch (decision 2026-07-26, vault-vs-brain):
    /// false = a RAW vault — no cycles, no sweeps, no model calls, ever.
    /// Missing from settings ⇒ true (existing vaults keep today's behavior
    /// byte-for-byte; the field is additive and no migration writes it).
    pub(crate) brain_enabled: bool,
    pub(crate) trust: Option<Trust>,
    pub(crate) threshold: f64,
    pub(crate) quiet: Duration,
    pub(crate) model: OrgModel,
}

pub(crate) fn parse_knobs(settings_json: &str) -> Knobs {
    let v: serde_json::Value =
        serde_json::from_str(settings_json).unwrap_or(serde_json::Value::Null);
    Knobs {
        brain_enabled: v
            .get("brainEnabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        trust: v
            .get("organizerTrust")
            .and_then(|t| t.as_str())
            .map(Trust::parse),
        threshold: v
            .get("organizerThreshold")
            .and_then(serde_json::Value::as_f64)
            .filter(|t| (0.0..=1.0).contains(t))
            .unwrap_or(DEFAULT_THRESHOLD),
        quiet: v
            .get("organizerQuietSecs")
            .and_then(serde_json::Value::as_f64)
            .filter(|q| q.is_finite() && *q >= 0.0)
            .map(Duration::from_secs_f64)
            .unwrap_or(DEFAULT_QUIET),
        model: v
            .get("organizerModel")
            .and_then(|m| m.as_str())
            .map(OrgModel::parse)
            .unwrap_or(OrgModel::Local),
    }
}

/// The connected client the organizer files through this cycle.
#[derive(Clone, PartialEq, Debug)]
pub(crate) struct ConnectedLane {
    pub(crate) provider: String,
    /// The user's per-provider default (`providerDefaults`) when it names an
    /// allowlisted model, else the lane's first allowlisted model.
    pub(crate) model: String,
}

/// Some only when the chosen lane is ALSO turned on in Connections
/// (`aiProviders`): choosing a Librarian lane and connecting it are two
/// separate consents, and the second gates the first. Everything else — Local,
/// a lane switched off, an unknown provider — files on this Mac.
pub(crate) fn connected_lane(settings_json: &str) -> Option<ConnectedLane> {
    let OrgModel::Connected(provider) = parse_knobs(settings_json).model else {
        return None;
    };
    let v: serde_json::Value =
        serde_json::from_str(settings_json).unwrap_or(serde_json::Value::Null);
    let enabled = v
        .get("aiProviders")
        .and_then(|p| p.get(&provider))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return None;
    }
    let chosen = v
        .get("providerDefaults")
        .and_then(|d| d.get(&provider))
        .and_then(|m| m.as_str())
        .filter(|m| crate::provider_lane::model_allowed(&provider, m))
        .map(str::to_string);
    let model = chosen.or_else(|| crate::provider_lane::default_model(&provider).map(str::to_string))?;
    Some(ConnectedLane { provider, model })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knobs_fall_back_and_never_explode() {
        let k = parse_knobs("{\"organizerTrust\":\"organize\",\"organizerThreshold\":0.6,\"organizerQuietSecs\":10}");
        assert_eq!(k.trust, Some(Trust::Organize));
        assert_eq!(k.threshold, 0.6);
        assert_eq!(k.quiet, Duration::from_secs(10));
        let k = parse_knobs("{\"organizerThreshold\":7}");
        assert_eq!(
            k.threshold, DEFAULT_THRESHOLD,
            "out-of-band threshold → default"
        );
        assert_eq!(k.trust, None);
        let k = parse_knobs("not json");
        assert_eq!(k.threshold, DEFAULT_THRESHOLD);
        assert_eq!(k.quiet, DEFAULT_QUIET);
        assert_eq!(
            k.model,
            OrgModel::Local,
            "absent/garbage organizerModel → on-device"
        );
        // a Librarian lane parses case-insensitively; Cursor, the legacy
        // remote ids, and junk fail closed to the on-device lane
        assert_eq!(
            parse_knobs("{\"organizerModel\":\"claude\"}").model,
            OrgModel::Connected("claude".into())
        );
        assert_eq!(
            parse_knobs("{\"organizerModel\":\"Claude\"}").model,
            OrgModel::Connected("claude".into())
        );
        assert_eq!(
            parse_knobs("{\"organizerModel\":\"antigravity\"}").model,
            OrgModel::Connected("antigravity".into())
        );
        for legacy in ["gemini35", "local", "gpt", "cursor", ""] {
            assert_eq!(
                parse_knobs(&format!("{{\"organizerModel\":\"{legacy}\"}}")).model,
                OrgModel::Local,
                "{legacy} must stay on this Mac"
            );
        }
    }

    #[test]
    fn a_librarian_lane_needs_the_provider_switched_on_too() {
        // chosen but not connected → on this Mac
        assert_eq!(
            connected_lane("{\"organizerModel\":\"claude\"}"),
            None
        );
        assert_eq!(
            connected_lane("{\"organizerModel\":\"claude\",\"aiProviders\":{\"claude\":false}}"),
            None
        );
        // chosen and connected → the lane, with the first allowlisted model
        let lane = connected_lane("{\"organizerModel\":\"claude\",\"aiProviders\":{\"claude\":true}}")
            .expect("lane");
        assert_eq!(lane.provider, "claude");
        assert_eq!(
            Some(lane.model.as_str()),
            crate::provider_lane::default_model("claude")
        );
        // the user's own default wins when it is allowlisted; junk does not
        let picked = connected_lane(
            "{\"organizerModel\":\"claude\",\"aiProviders\":{\"claude\":true},\"providerDefaults\":{\"claude\":\"not-a-model\"}}",
        )
        .expect("lane");
        assert_eq!(Some(picked.model.as_str()), crate::provider_lane::default_model("claude"));
        // the user's own default wins when it IS allowlisted
        let last = crate::provider::spec("claude").unwrap().models.last().copied().unwrap();
        let own = connected_lane(&format!(
            "{{\"organizerModel\":\"claude\",\"aiProviders\":{{\"claude\":true}},\"providerDefaults\":{{\"claude\":\"{last}\"}}}}"
        ))
        .expect("lane");
        assert_eq!(own.model, last);
        // Cursor and the legacy ids never file notes
        assert_eq!(
            connected_lane("{\"organizerModel\":\"cursor\",\"aiProviders\":{\"cursor\":true}}"),
            None
        );
        assert_eq!(
            connected_lane("{\"organizerModel\":\"gemini35\",\"aiProviders\":{\"antigravity\":true}}"),
            None
        );
    }
}
