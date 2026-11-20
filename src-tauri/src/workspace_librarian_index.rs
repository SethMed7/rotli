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
/// last line for a note wins. A row with any other field is not one Rotli
/// wrote and is skipped.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct IndexRow {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
}

/// One log line: what happened, when, and the notes it concerns, by id.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LogRow {
    at: i64,
    text: String,
    #[serde(default)]
    ids: Vec<String>,
}

/// Whether the note an agent may read now under `local` carries that id in
/// its own frontmatter. A note without one is known by its path, and a
/// different file put at that path would inherit the id, so an entry could
/// follow the path to another note (Codex review of 7f542f5b); only an id the
/// note carries itself is followed.
///
/// An id two files carry names no one note either: the walk gives it to
/// whichever it reads first, so a public copy sorting before a secure
/// original took the id and the original's summary showed under the copy's
/// title (Codex review round 5). Such an id is refused and hidden. Residual:
/// once the original is deleted the copy holds the id alone, and entries
/// written about the original show under the copy.
fn owns_its_id(ws: &mut Workspace, local: &str) -> Result<(), String> {
    let text = ws.store.read_for_ai(local, false).map_err(|_| "not a note you can read".to_string())?;
    if crate::corpus::parse_document(&text).0.and_then(|fm| fm.id).as_deref() != Some(local) {
        return Err("a note without a Rotli id of its own (known only by its path), so the index can't follow it".into());
    }
    if ws.store.ids_held_twice()?.contains(local) {
        return Err("an id more than one file carries, so it names no one note".into());
    }
    Ok(())
}

/// The local id of a note an agent may read now, carrying its own id.
fn readable(ws: &mut Workspace, id: &str) -> Result<String, String> {
    let local = ws.local_id(id)?;
    owns_its_id(ws, &local).map_err(|why| format!("{id} is {why}"))?;
    Ok(local)
}

/// Text compared for names, built one character at a time so both sides of
/// a comparison fold the same way whatever surrounds them (Codex review round
/// 5: lowercasing a whole string turns a Greek final sigma into ς in one and
/// σ in the other). NFKC first (full-width forms, ligatures), then each
/// character folded: ß and ẞ to "ss", ς to σ, every other character
/// lower-cased on its own; spaces collapsed.
fn folded(text: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let mut out = String::with_capacity(text.len());
    for c in text.nfkc() {
        match c {
            'ß' | 'ẞ' => out.push_str("ss"),
            'ς' => out.push('σ'),
            c if crate::frontmatter_keys::is_js_space(c) => out.push(' '),
            c => out.extend(c.to_lowercase()),
        }
    }
    out.split(' ').filter(|word| !word.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Scripts written without spaces between words, where a name can sit inside
/// a run of letters (Han, kana, Thai, Lao, Khmer, Myanmar): no word boundary
/// is needed there, so a mention is never missed.
fn unspaced(c: char) -> bool {
    matches!(c as u32,
        0x0E00..=0x0EFF | 0x1000..=0x109F | 0x1780..=0x17FF | 0x3040..=0x30FF | 0x31F0..=0x31FF
        | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF66..=0xFF9F | 0x20000..=0x3FFFF)
}

/// Whether folded `text` mentions folded `name` as a whole word (Codex review
/// round 5: a secure note titled "A" refused "Updated the roadmap."). A name
/// counts unless a letter or digit runs straight into it on either side, so a
/// possessive ("ΑΡΗΣ’s") and punctuation still match; in a script without
/// spaces any occurrence counts.
fn mentions(text: &str, name: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || c == '_';
    let joined = |edge: Option<char>, beside: Option<char>| match (edge, beside) {
        (Some(edge), Some(beside)) => word(edge) && word(beside) && !unspaced(edge) && !unspaced(beside),
        _ => false,
    };
    let (first, last) = (name.chars().next(), name.chars().next_back());
    text.match_indices(name).any(|(at, _)| {
        !joined(first, text[..at].chars().next_back()) && !joined(last, text[at + name.len()..].chars().next())
    })
}

/// The names (titles and aliases, normalised) of every note, to check text
/// against. Built from the walk's metadata; a note is read through the gate
/// only when its name occurs in the text being checked.
fn note_names(ws: &mut Workspace) -> Result<Vec<(String, String)>, String> {
    let mut names = Vec::new();
    for meta in ws.store.list()?.notes {
        for name in std::iter::once(&meta.title).chain(meta.aliases.iter()) {
            let name = folded(name);
            if !name.is_empty() {
                names.push((name, meta.id.clone()));
            }
        }
    }
    Ok(names)
}

/// Whether `text` names, by title or alias, a note the agent may not read.
/// Fails closed: any match to an unreadable note hides the text, however
/// short the name (Codex review of 7f542f5b: a summary naming a note that
/// turned secure kept its name public).
fn names_a_hidden_note(ws: &mut Workspace, names: &[(String, String)], hidden: &mut HashMap<String, bool>, text: &str) -> bool {
    let text = folded(text);
    names.iter().filter(|(name, _)| mentions(&text, name)).any(|(_, id)| {
        *hidden.entry(id.clone()).or_insert_with(|| ws.store.read_for_ai(id, false).is_err())
    })
}

/// The text a summary or log line may carry: one line, nothing secret-shaped,
/// and no title or alias of a note the agent can't read.
fn checked_text(ws: &mut Workspace, names: &[(String, String)], text: &str, what: &str) -> Result<String, String> {
    let text = one_line(text, MAX_REASON, what)?;
    if names_a_hidden_note(ws, names, &mut HashMap::new(), &text) {
        return Err(format!("{what} can't be kept as written; name notes by id, not in the text"));
    }
    Ok(text)
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

/// The index as it stands: each note's latest summary, `None` once removed.
fn summaries(root: &Path) -> Vec<(String, Option<String>)> {
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    for row in rows::<IndexRow>(root, INDEX) {
        out.retain(|(id, _)| *id != row.id);
        out.push((row.id, row.summary));
    }
    out
}

/// `librarian_index {entries, remove}`: set or remove the summaries of notes,
/// each named by id. Every id must be a note the agent can read now, and every
/// summary one line with nothing secret-shaped; one bad entry refuses all.
pub(super) fn write_index(ws: &mut Workspace, entries: &[Value], remove: &[Value]) -> Result<Value, String> {
    let names = note_names(ws)?;
    let mut rows = Vec::new();
    for entry in entries {
        let id = readable(ws, entry["id"].as_str().unwrap_or_default())?;
        let summary = checked_text(ws, &names, entry["summary"].as_str().unwrap_or_default(), "summary")?;
        rows.push(IndexRow { id, summary: Some(summary) });
    }
    // a removal names an entry the index holds now, for a note the agent may
    // still read: no row is ever written for a secure or a missing note
    let indexed = summaries(&ws.root.path);
    for id in remove {
        let given = id.as_str().unwrap_or_default();
        let local = readable(ws, given)?;
        if !indexed.iter().any(|(entry, summary)| *entry == local && summary.is_some()) {
            return Err(format!("{given} is not in the index"));
        }
        rows.push(IndexRow { id: local, summary: None });
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
    let names = note_names(ws)?;
    let text = checked_text(ws, &names, entry, "entry")?;
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
    let names = note_names(ws)?;
    let mut hidden: HashMap<String, bool> = HashMap::new();
    let mut shown: HashMap<String, Option<Value>> = HashMap::new();
    let mut note = |ws: &mut Workspace, local: &str| -> Option<Value> {
        shown
            .entry(local.to_string())
            .or_insert_with(|| {
                let title = titles.get(local)?;
                owns_its_id(ws, local).ok()?;
                Some(json!({ "id": ws.wire(local), "title": title }))
            })
            .clone()
    };
    let mut index = Vec::new();
    for (id, summary) in summaries(&ws.root.path) {
        let Some(summary) = summary.and_then(|text| one_line(&text, MAX_REASON, "summary").ok()) else { continue };
        if names_a_hidden_note(ws, &names, &mut hidden, &summary) {
            continue;
        }
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
        if names_a_hidden_note(ws, &names, &mut hidden, &text) {
            continue;
        }
        let notes: Option<Vec<Value>> = row.ids.iter().map(|id| note(ws, id)).collect();
        if let Some(notes) = notes {
            log.push(json!({ "at": row.at, "text": text, "notes": notes }));
        }
    }
    log.reverse();
    Ok(json!({ "index": index, "log": log }))
}

#[cfg(test)]
mod tests {
    use super::{folded, mentions};

    /// One form for every comparison, character by character.
    #[test]
    fn names_fold_the_same_way_on_both_sides() {
        for (label, form) in [
            ("ΟΔΥΣΣΕΥΣ", "οδυσσευσ"),
            ("οδυσσευς", "οδυσσευσ"),
            ("ΟΔΥΣΣΕΥΣ’ voyage", "οδυσσευσ’ voyage"),
            ("Weißbier", "weissbier"),
            ("WEISSBIER", "weissbier"),
            ("ẞ", "ss"),
            ("İstanbul", "i\u{307}stanbul"),
            ("ISTANBUL", "istanbul"),
            ("ＲＯＴＬＩ　plan", "rotli plan"),
            ("ﬁle", "file"),
        ] {
            assert_eq!(folded(label), form, "{label}");
        }
    }

    #[test]
    fn a_name_matches_whole_words_and_runs_of_unspaced_script() {
        assert!(!mentions(&folded("A banana cake"), "b"));
        assert!(mentions(&folded("Plan B, then"), "b"));
        assert!(mentions(&folded("ΟΔΥΣΣΕΥΣ’ voyage"), &folded("Οδυσσευς")));
        assert!(mentions(&folded("see (A), then"), "a"));
        assert!(!mentions(&folded("Planet nine"), "plan"));
        assert!(mentions(&folded("我们的公司计划"), &folded("公司")), "no spaces between Han words");
    }
}
