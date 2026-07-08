//! Routines engine glue (Breve → rotli merge, P0 — breve-merge.md §4, §9).
//!
//! rotli's Rust shell runs each scheduled routine by spawning the Bun
//! routines-engine sidecar (`src/routines/engine.entry.ts`) once per job — the
//! same shell-out pattern `memex.rs` uses for `validate.ts`. At P0 the sidecar's
//! handlers are STUBS: this proves the job → result contract end to end; the live
//! scheduler that CALLS this (and real generation/delivery) is P1+. Nothing here
//! is wired into the app yet, hence the module-wide dead-code allowance until the
//! scheduler lands.
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::memex::find_bun;

/// A job handed to the sidecar. `kind` is a `RoutineKind` string
/// (brief/creators/watchers/doctor/signal — mirrors `src/routines/types.ts`).
#[derive(Debug, Clone, Serialize)]
pub struct RoutineJob {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// What the sidecar returns. Mirrors `RoutineResult` in `engine.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct RoutineResult {
    pub ok: bool,
    // `runJob` always emits a `kind`, but tolerate its absence too (belt + braces)
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub artifacts: Vec<String>,
    #[serde(default)]
    pub log: String,
    #[serde(default)]
    pub error: Option<String>,
}

/// Absolute path to the Bun sidecar entry. P0 resolves the in-repo source via
/// `CARGO_MANIFEST_DIR` (works in `cargo test` and `tauri dev`); wiring the bundled
/// resource path is P1 (with the scheduler + packaging).
fn engine_entry() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/routines/engine.entry.ts"))
}

/// Serialize a job to the single JSON argv the sidecar reads (pure — unit-tested).
fn job_descriptor(job: &RoutineJob) -> Result<String, String> {
    serde_json::to_string(job).map_err(|e| format!("encode routine job: {e}"))
}

/// Parse the sidecar's stdout into a `RoutineResult` (pure — unit-tested). The
/// sidecar prints ONLY the JSON payload, so the whole (trimmed) stdout is it.
fn parse_result(stdout: &str) -> Result<RoutineResult, String> {
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("decode routine result: {e} (stdout: {stdout:?})"))
}

/// Run one routine job through the Bun sidecar: spawn `bun engine.entry.ts <json>`,
/// capture stdout, decode the result. Blocking — the P1 scheduler calls it off the
/// async lanes.
pub fn run_routine_job(job: &RoutineJob) -> Result<RoutineResult, String> {
    let descriptor = job_descriptor(job)?;
    let out = Command::new(find_bun())
        .arg(engine_entry())
        .arg(&descriptor)
        .output()
        .map_err(|e| format!("spawn routines sidecar: {e}"))?;
    parse_result(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_descriptor_is_stable_json() {
        let job = RoutineJob { id: "m".into(), kind: "brief".into(), params: None };
        assert_eq!(job_descriptor(&job).unwrap(), r#"{"id":"m","kind":"brief"}"#);
    }

    #[test]
    fn job_descriptor_includes_params_when_present() {
        let job = RoutineJob {
            id: "m".into(),
            kind: "brief".into(),
            params: Some(serde_json::json!({ "briefKind": "night" })),
        };
        assert!(job_descriptor(&job).unwrap().contains(r#""briefKind":"night""#));
    }

    #[test]
    fn parse_result_decodes_a_stub() {
        let r = parse_result(r#"{"ok":true,"kind":"brief","artifacts":[],"log":"[P0 stub] x"}"#).unwrap();
        assert!(r.ok);
        assert_eq!(r.kind, "brief");
        assert!(r.error.is_none());
    }

    #[test]
    fn parse_result_errors_on_garbage() {
        assert!(parse_result("not json").is_err());
    }

    #[test]
    fn parse_result_tolerates_a_kindless_error_payload() {
        // runJob always emits a kind, but the decoder must never choke if it's
        // absent — a malformed-descriptor result stays parseable (reviewer P0)
        let r = parse_result(r#"{"ok":false,"error":"unknown routine kind: unknown"}"#).unwrap();
        assert!(!r.ok);
        assert_eq!(r.kind, "");
    }

    /// End-to-end through a real `bun` — proves the sidecar contract, but needs
    /// bun + the repo checkout, so it's opt-in (`cargo test -- --ignored`).
    #[test]
    #[ignore]
    fn spawns_the_bun_sidecar_end_to_end() {
        let job = RoutineJob { id: "e2e".into(), kind: "doctor".into(), params: None };
        let r = run_routine_job(&job).unwrap();
        assert!(r.ok);
        assert_eq!(r.kind, "doctor");
    }
}
