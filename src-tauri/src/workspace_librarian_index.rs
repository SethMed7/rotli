//! The Librarian's index and log. They are not vault notes: Rotli keeps them
//! in two JSONL sidecars it alone creates, `.rotli/librarian/index.jsonl`
//! (`{id, summary}` per note) and `.rotli/librarian/log.jsonl` (`{at, text,
//! ids}`), and renders them through the read gate each time they are read. An
//! entry shows only while every note it names is readable now, under the
//! note's live title, so a note that turns secure simply drops out: the
//! stored text is never edited, and nothing is discovered, adopted, or
//! recognised by a marker (Seth's redesign after three reviews of PR #295
//! found the note-based pages couldn't be made safe). `.rotli/` is outside the
//! walk, so neither file is ever listed, searched, or read as a note.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::containment::{open_sidecar, Sidecar};
use crate::corpus::NoteKind;

use super::super::{now_millis, Workspace};
use super::{one_line, MAX_REASON};

const INDEX: &str = ".rotli/librarian/index.jsonl";
const LOG: &str = ".rotli/librarian/log.jsonl";
/// The newest log lines a read renders.
pub(super) const LOG_LINES: usize = 50;

/// One index line: a note's summary, or (`summary: None`) its removal. The
/// last line for a note wins.
#[derive(Serialize, Deserialize)]
struct IndexRow {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
}

/// One log line: what happened, when, and the notes it concerns, by id.
#[derive(Serialize, Deserialize)]
struct LogRow {
    at: i64,
    text: String,
    #[serde(default)]
    ids: Vec<String>,
}

/// The local id of a note an agent may read now, from the id it was given.
fn readable(ws: &mut Workspace, id: &str) -> Result<String, String> {
    let local = ws.local_id(id)?;
    match ws.store.read_for_ai(&local, false) {
        Ok(_) => Ok(local),
        Err(_) => Err(format!("{id} is not a note you can read")),
    }
}

fn append(root: &Path, file: &str, row: &impl Serialize) -> Result<(), String> {
    let line = serde_json::to_string(row).map_err(|e| e.to_string())?;
    let handle = open_sidecar(root, Path::new(file), Sidecar::Append).map_err(|e| format!("librarian: {e}"))?;
    writeln!(handle.ok_or("librarian: could not be created")?, "{line}").map_err(|e| format!("librarian: {e}"))
}

/// Every well-formed row of one sidecar, oldest first. A file that can't be
/// opened safely (a link, a hard link) reads as empty.
fn rows<T: for<'de> Deserialize<'de>>(root: &Path, file: &str) -> Vec<T> {
    let mut text = String::new();
    let opened = open_sidecar(root, Path::new(file), Sidecar::Read).ok().flatten();
    if opened.is_none_or(|mut handle| handle.read_to_string(&mut text).is_err()) {
        return Vec::new();
    }
    text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
}

/// `librarian_index {entries, remove}`: set or remove the summaries of notes,
/// each named by id. Every id must be a note the agent can read now, and every
/// summary one line with nothing secret-shaped; one bad entry refuses all.
pub(super) fn write_index(ws: &mut Workspace, entries: &[Value], remove: &[Value]) -> Result<Value, String> {
    let mut rows = Vec::new();
    for entry in entries {
        let id = readable(ws, entry["id"].as_str().unwrap_or_default())?;
        let summary = one_line(entry["summary"].as_str().unwrap_or_default(), MAX_REASON, "summary")?;
        rows.push(IndexRow { id, summary: Some(summary) });
    }
    for id in remove {
        rows.push(IndexRow { id: ws.local_id(id.as_str().unwrap_or_default())?, summary: None });
    }
    for row in &rows {
        append(&ws.root.path, INDEX, row)?;
    }
    Ok(json!({ "written": rows.len() }))
}

/// `librarian_log {entry, ids}`: one line of what happened, with the notes it
/// concerns by id (never by name: a name can't be withdrawn when its note
/// turns secure, an id is checked every time the log is read).
pub(super) fn append_log(ws: &mut Workspace, entry: &str, ids: &[String]) -> Result<(), String> {
    let text = one_line(entry, MAX_REASON, "entry")?;
    let ids = ids.iter().map(|id| readable(ws, id)).collect::<Result<Vec<_>, _>>()?;
    append(&ws.root.path, LOG, &LogRow { at: now_millis(), text, ids })
}

/// The index and the newest log lines as they may be shown now. An index
/// entry shows while its note is readable; a log line while every note it
/// names is. Titles come from the live notes; stored text is checked again
/// (one line, nothing secret-shaped), so a hand-edited row shows nothing it
/// couldn't have been written with.
pub(super) fn render(ws: &mut Workspace, log_lines: usize) -> Result<Value, String> {
    let titles: HashMap<String, String> =
        ws.store.list()?.notes.into_iter().filter(|meta| meta.kind == NoteKind::Note).map(|meta| (meta.id, meta.title)).collect();
    let mut shown: HashMap<String, Option<Value>> = HashMap::new();
    let mut note = |ws: &mut Workspace, local: &str| -> Option<Value> {
        shown
            .entry(local.to_string())
            .or_insert_with(|| {
                let title = titles.get(local)?;
                ws.store.read_for_ai(local, false).ok()?;
                Some(json!({ "id": ws.wire(local), "title": title }))
            })
            .clone()
    };
    let mut summaries: Vec<(String, Option<String>)> = Vec::new();
    for row in rows::<IndexRow>(&ws.root.path, INDEX) {
        summaries.retain(|(id, _)| *id != row.id);
        summaries.push((row.id, row.summary));
    }
    let mut index = Vec::new();
    for (id, summary) in summaries {
        let Some(summary) = summary.and_then(|text| one_line(&text, MAX_REASON, "summary").ok()) else { continue };
        if let Some(mut entry) = note(ws, &id) {
            entry["summary"] = json!(summary);
            index.push(entry);
        }
    }
    let mut log = Vec::new();
    for row in rows::<LogRow>(&ws.root.path, LOG).into_iter().rev() {
        if log.len() == log_lines {
            break;
        }
        let Ok(text) = one_line(&row.text, MAX_REASON, "entry") else { continue };
        let notes: Option<Vec<Value>> = row.ids.iter().map(|id| note(ws, id)).collect();
        if let Some(notes) = notes {
            log.push(json!({ "at": row.at, "text": text, "notes": notes }));
        }
    }
    log.reverse();
    Ok(json!({ "index": index, "log": log }))
}
