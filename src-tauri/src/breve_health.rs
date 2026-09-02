//! Breve health and notification projections — what the app can say about the
//! scheduler from its durable ledger (`scheduler-state.json`) and its sanitized
//! log tail, without either becoming a second store (audit 2026-09-02 §1.1).

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::breve::{read_json, BreveConfig, BreveNotification};
use crate::routines;

/// One routine's last scheduler outcome, projected from
/// `.rotli/breve/scheduler-state.json` (the supervisor's durable job ledger).
/// This is what lets the app say "no brief since …" instead of "Managed by
/// Rotli" while every slot has been failing (audit 2026-09-02 §1.1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BreveRoutineHealth {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_slot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_slot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_started: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_finished: Option<String>,
    /// Sanitized: the scheduler's one-line reason, never stderr, paths, or
    /// prompts (the same rule the notification projection applies).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}


const BREVE_NOTIFICATION_TAIL_BYTES: u64 = 512 * 1024;
pub(crate) const BREVE_NOTIFICATION_LIMIT: usize = 48;

fn read_tail(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max_bytes);
    if start > 0 {
        file.seek(SeekFrom::Start(start)).ok()?;
    }
    let mut bytes = Vec::with_capacity((len - start).min(max_bytes) as usize);
    file.read_to_end(&mut bytes).ok()?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        let newline = text.find('\n')?;
        text.drain(..=newline);
    }
    Some(text)
}

fn routine_label(config: &BreveConfig, id: &str) -> String {
    config
        .routines
        .iter()
        .find(|routine| routine.id == id)
        .map(|routine| routine.label.trim().to_string())
        .filter(|label| !label.is_empty())
        .unwrap_or_else(|| {
            let mut label = id.replace('-', " ");
            if let Some(first) = label.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            label
        })
}

pub(crate) fn notification_from_scheduler_line(
    line: &str,
    config: &BreveConfig,
    ordinal: usize,
) -> Option<BreveNotification> {
    let (at, event) = line.trim().split_once(' ')?;
    if at.len() < 20 || !at.contains('T') {
        return None;
    }

    let (routine, kind, title, detail) = if let Some(rest) = event.strip_prefix('[') {
        let (id, message) = rest.split_once("] ")?;
        let label = routine_label(config, id);
        if message.starts_with("start:") {
            (
                Some(id.to_string()),
                "running",
                format!("{label} started"),
                "Breve started this routine for the current vault.".into(),
            )
        } else if message.starts_with("complete") {
            (
                Some(id.to_string()),
                "success",
                format!("{label} completed"),
                "The routine completed and its vault state is current.".into(),
            )
        } else if message.starts_with("failed") || message.contains("run error") {
            (
                Some(id.to_string()),
                "warning",
                format!("{label} needs attention"),
                "The routine failed. Its detailed local log remains private in this vault.".into(),
            )
        } else if message.starts_with("skipped:") {
            (
                Some(id.to_string()),
                "info",
                format!("{label} was already running"),
                "Breve skipped a duplicate run to keep delivery idempotent.".into(),
            )
        } else if id == "signal" && message.starts_with("starting managed daemon") {
            (
                Some(id.to_string()),
                "success",
                "Signal assistant started".into(),
                "The vault-owned Breve assistant is available.".into(),
            )
        } else if id == "signal" && message.starts_with("exited") {
            (
                Some(id.to_string()),
                "warning",
                "Signal assistant restarted".into(),
                "Breve scheduled a bounded restart after the assistant exited.".into(),
            )
        } else {
            return None;
        }
    } else if event.starts_with("Rotli scheduler online") {
        (
            None,
            "success",
            "Breve is online".into(),
            "Rotli is managing routines for this vault.".into(),
        )
    } else if event.starts_with("fatal:")
        || event.starts_with("tick error:")
        || event.starts_with("config unavailable:")
    {
        (
            None,
            "warning",
            "Breve needs attention".into(),
            "The scheduler reported a local problem. Open Breve Settings to review it.".into(),
        )
    } else {
        return None;
    };

    Some(BreveNotification {
        id: format!("{at}:{ordinal}"),
        at: at.to_string(),
        routine,
        kind: kind.into(),
        title,
        detail,
    })
}

pub(crate) fn recent_notifications(active_root: &Path, config: &BreveConfig) -> Vec<BreveNotification> {
    let path = active_root
        .join(routines::MANAGED_DIR)
        .join("logs/rotli-scheduler.log");
    let Some(text) = read_tail(&path, BREVE_NOTIFICATION_TAIL_BYTES) else {
        return Vec::new();
    };
    text.lines()
        .rev()
        .enumerate()
        .filter_map(|(ordinal, line)| notification_from_scheduler_line(line, config, ordinal))
        .take(BREVE_NOTIFICATION_LIMIT)
        .collect()
}

/// Project the supervisor's job ledger into per-routine health, in the
/// config's routine order so the UI can line it up with the routine list.
/// Unknown ledger keys (retired routines) are dropped; a routine the
/// scheduler has never run is absent rather than invented.
/// The supervisor's ledger file and the job fields Rotli reads back
/// (`rotli-scheduler.ts` `JobState`); `breve.rs` seeds the same keys.
pub(crate) const LEDGER_FILE: &str = "scheduler-state.json";
pub(crate) const LEDGER_LAST_OK: &str = "lastOk";
pub(crate) const LEDGER_LAST_SLOT: &str = "lastSlot";
pub(crate) const LEDGER_LAST_STARTED: &str = "lastStarted";
const LEDGER_PENDING_SLOT: &str = "pendingSlot";
const LEDGER_LAST_FINISHED: &str = "lastFinished";
const LEDGER_LAST_ERROR: &str = "lastError";

pub(crate) fn routine_health(home: &Path, config: &BreveConfig) -> Vec<BreveRoutineHealth> {
    let Some(ledger) = read_json::<serde_json::Value>(&home.join(LEDGER_FILE)) else {
        return Vec::new();
    };
    let Some(jobs) = ledger.get("jobs").and_then(|jobs| jobs.as_object()) else {
        return Vec::new();
    };
    let field = |job: &serde_json::Value, name: &str| {
        job.get(name)
            .and_then(|value| value.as_str())
            .map(|value| value.chars().take(240).collect::<String>())
    };
    config
        .routines
        .iter()
        .filter_map(|routine| {
            let job = jobs.get(&routine.id)?;
            Some(BreveRoutineHealth {
                id: routine.id.clone(),
                last_ok: job.get(LEDGER_LAST_OK).and_then(|value| value.as_bool()),
                last_slot: field(job, LEDGER_LAST_SLOT),
                pending_slot: field(job, LEDGER_PENDING_SLOT),
                last_started: field(job, LEDGER_LAST_STARTED),
                last_finished: field(job, LEDGER_LAST_FINISHED),
                last_error: field(job, LEDGER_LAST_ERROR),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::breve::{default_config, snapshot_at, write_json, CONFIG_FILE, ROUTINES_DIR};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn snapshot_projects_scheduler_health_in_routine_order() {
        let root = tempdir().unwrap();
        let home = root.path().join(routines::MANAGED_DIR);
        fs::create_dir_all(root.path().join(ROUTINES_DIR)).unwrap();
        fs::create_dir_all(&home).unwrap();
        write_json(&root.path().join(CONFIG_FILE), &default_config(true)).unwrap();
        fs::write(
            home.join(LEDGER_FILE),
            r#"{"version":1,"jobs":{
              "morning":{"lastOk":false,"lastSlot":"2026-07-01","pendingSlot":"2026-07-19",
                         "lastStarted":"2026-07-19T11:50:39Z","lastFinished":"2026-07-19T11:50:42Z",
                         "lastError":"no markdown at briefs/2026-07-19.md"},
              "doctor":{"lastOk":true,"lastStarted":"2026-07-19T11:41:39Z"},
              "retired-routine":{"lastOk":true}
            }}"#,
        )
        .unwrap();
        let snapshot = snapshot_at(root.path(), None);
        let ids: Vec<&str> = snapshot.health.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, ["morning", "doctor"], "config order, unknown keys dropped");
        let morning = &snapshot.health[0];
        assert_eq!(morning.last_ok, Some(false));
        assert_eq!(morning.last_slot.as_deref(), Some("2026-07-01"));
        assert_eq!(morning.pending_slot.as_deref(), Some("2026-07-19"));
        assert_eq!(
            morning.last_error.as_deref(),
            Some("no markdown at briefs/2026-07-19.md")
        );
        assert_eq!(snapshot.health[1].last_ok, Some(true));
        assert!(snapshot.health[1].last_error.is_none());
        // no ledger at all → empty, never invented
        let bare = tempdir().unwrap();
        assert!(snapshot_at(bare.path(), None).health.is_empty());
    }
}
