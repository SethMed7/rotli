//! The Librarian route's proposals: `librarian_file` and `librarian_link`
//! append to `.rotli/librarian/proposals.jsonl`; only a person applies one
//! (`rotli librarian apply ID`). The file is a deletable sidecar anyone with
//! the vault's files can edit, so apply trusts none of it: every stored field
//! is checked as strictly as the tool arguments were, the link target is
//! resolved again through the read gate, and the note must still be the
//! revision the proposal was made for (review 2026-11-09, #3 and #7).

use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::containment::{open_sidecar, Sidecar};
use crate::corpus::NoteKind;

use super::super::{json_value, now_millis, Workspace};
use super::{append_log, one_line, MAX_REASON, MAX_TARGET, PROPOSALS};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct Proposal {
    pub(super) id: String,
    pub(super) ts: i64,
    /// "file" or "link".
    pub(super) kind: String,
    pub(super) note: String,
    pub(super) note_title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target: Option<String>,
    /// The note `target` named when the link was proposed. Review checks this
    /// exact note, never whatever the title or an alias names later. Rows
    /// written before it existed carry only `target`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) target_id: Option<String>,
    /// The note's revision when the proposal was made. Apply refuses once the
    /// note has changed since; rows written before it existed can't be applied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) revision: Option<String>,
    pub(super) reason: String,
    /// "pending", "applied", or "dismissed". A later line for the same id wins.
    pub(super) status: String,
}

/// A folder a note may be filed in: a plain vault-relative path.
fn plain_folder(value: &str) -> Result<String, String> {
    let folder = value.trim_matches('/').to_string();
    if folder.split('/').any(|part| part.is_empty() || part == ".." || part.starts_with('.')) {
        return Err("folder must be a plain vault-relative path such as projects/payments".into());
    }
    Ok(folder)
}

/// The one page `[[title]]` names: an agent may read it, its title is exactly
/// `title`, and no other readable note claims that name as a title or alias.
/// Returns its local id.
fn exact_target(ws: &mut Workspace, title: &str) -> Result<String, String> {
    if title.contains(['[', ']', '|', '#']) {
        return Err("target is a page title, without [[ ]], | or #".into());
    }
    let resolved = ws.resolve_note_selector(title)?;
    let exact = ws.store.list()?.notes.iter().any(|meta| meta.id == resolved && meta.kind == NoteKind::Note && meta.title == title);
    if !exact {
        return Err(format!("target must be the exact title of a page you can read; {title:?} isn't one"));
    }
    Ok(resolved)
}

pub(super) fn propose(ws: &mut Workspace, kind: &str, id: &str, value: &str, reason: &str) -> Result<Proposal, String> {
    let reason = one_line(reason, MAX_REASON, "reason")?;
    let local = ws.local_id(id)?;
    let note = ws.read_note(&local)?;
    let value = one_line(value, MAX_TARGET, if kind == "file" { "folder" } else { "target" })?;
    let (folder, target, target_id) = if kind == "file" {
        (Some(plain_folder(&value)?), None, None)
    } else {
        let target_id = exact_target(ws, &value)?;
        (None, Some(value), Some(target_id))
    };
    let title = crate::corpus::title_of(&note.note.body).to_string();
    let proposal = Proposal {
        id: ulid::Ulid::new().to_string(),
        ts: now_millis(),
        kind: kind.into(),
        note: note.note.id.clone(),
        note_title: title,
        folder,
        target,
        target_id,
        revision: Some(note.revision.clone()),
        reason,
        status: "pending".into(),
    };
    // a repeat is the same change to the same version of the note, aimed at
    // the same page, and only one `librarian_review` would still show
    // the page's title is part of it: a page renamed since gets a new link
    let same = |p: &Proposal| {
        (&p.kind, &p.note, &p.folder, &p.target_id, &p.target, &p.revision)
            == (&proposal.kind, &proposal.note, &proposal.folder, &proposal.target_id, &proposal.target, &proposal.revision)
    };
    if let Some(existing) = visible_pending(ws).into_iter().find(same) {
        return Ok(existing);
    }
    append_proposal(&ws.root.path, &proposal)?;
    // the log names the notes by id; their titles are rendered live
    let (what, ids) = match (&proposal.folder, &proposal.target_id) {
        (Some(folder), _) => (format!("Proposed filing in {folder}"), vec![proposal.note.clone()]),
        (_, Some(target)) => ("Proposed a link".to_string(), vec![proposal.note.clone(), ws.wire(target)]),
        _ => (String::new(), Vec::new()),
    };
    let _ = append_log(ws, &what, &ids);
    Ok(proposal)
}

/// What `librarian_review` shows an agent: the pending proposals whose note,
/// and link target, it may still read. A proposal carries a title and the
/// agent's reason, so one made before the person marked a note secure must
/// not keep showing them. The target is the exact note recorded when the link
/// was proposed: resolving the title again would let another public note's
/// alias stand in for a page that has since turned secure. An older row with
/// only the title shows when exactly one note has that title and it is
/// readable. The person's own list (`rotli librarian proposals`) keeps every
/// proposal.
pub(super) fn visible_pending(ws: &mut Workspace) -> Vec<Proposal> {
    let mut visible = pending(&ws.root.path);
    visible.retain(|p| {
        let note = ws.local_id(&p.note).ok();
        let target = match (&p.target_id, &p.target) {
            (_, None) => None,
            (Some(id), Some(_)) => Some(Some(id.clone())),
            (None, Some(title)) => Some(only_note_titled(ws, title)),
        };
        let readable = |ws: &mut Workspace, id: Option<String>| id.is_some_and(|id| ws.store.read_for_ai(&id, false).is_ok());
        readable(ws, note) && target.is_none_or(|id| readable(ws, id))
    });
    visible
}

/// The one note with exactly this title, readable or not; None when there are
/// none or several.
fn only_note_titled(ws: &mut Workspace, title: &str) -> Option<String> {
    let notes = ws.store.list().ok()?.notes;
    let mut titled = notes.into_iter().filter(|meta| meta.kind == NoteKind::Note && meta.title == title);
    let first = titled.next()?;
    titled.next().is_none().then_some(first.id)
}

/// The proposals file is opened inside the vault one folder at a time,
/// never following a link, and must be a plain file with no other name
/// (containment.rs `open_sidecar`), so neither a planted link nor a hard link
/// carries a write out of the vault or reads a file from outside it.
pub(super) fn append_proposal(root: &Path, proposal: &Proposal) -> Result<(), String> {
    let line = serde_json::to_string(proposal).map_err(|e| e.to_string())?;
    let file = open_sidecar(root, Path::new(PROPOSALS), Sidecar::Append).map_err(|e| format!("proposals: {e}"))?;
    let mut file = file.ok_or("proposals: could not be created")?;
    writeln!(file, "{line}").map_err(|e| format!("proposals: {e}"))
}

/// Every proposal, folded by id (last line wins), oldest first. A malformed
/// line is skipped, and a file that can't be opened safely reads as none: the
/// file is a deletable sidecar, never vault truth.
pub(super) fn all_proposals(root: &Path) -> Vec<Proposal> {
    let mut out: Vec<Proposal> = Vec::new();
    let text = open_sidecar(root, Path::new(PROPOSALS), Sidecar::Read).ok().flatten().and_then(|mut file| {
        let mut text = String::new();
        file.read_to_string(&mut text).ok().map(|_| text)
    });
    for line in text.unwrap_or_default().lines() {
        let Ok(row) = serde_json::from_str::<Proposal>(line) else { continue };
        match out.iter_mut().find(|p| p.id == row.id) {
            Some(slot) => *slot = row,
            None => out.push(row),
        }
    }
    out
}

pub(super) fn pending(root: &Path) -> Vec<Proposal> {
    all_proposals(root).into_iter().filter(|p| p.status == "pending").collect()
}

/// A person's decision on one proposal. Applying runs through the same
/// workspace seams an agent edit would, so secure, locked, and person-written
/// rules still hold; a refusal leaves the proposal pending. Dismissing never
/// needs the row to be valid.
pub(super) fn decide(ws: &mut Workspace, id: &str, apply: bool) -> Result<Value, String> {
    let mut proposal = pending(&ws.root.path)
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("no pending proposal {id}"))?;
    if apply {
        apply_proposal(ws, &proposal)?;
    }
    proposal.status = if apply { "applied" } else { "dismissed" }.into();
    proposal.ts = now_millis();
    append_proposal(&ws.root.path, &proposal)?;
    json_value(proposal)
}

/// The stored row, held to the rules the tool arguments were.
fn checked(p: &Proposal) -> Result<(), String> {
    one_line(&p.reason, MAX_REASON, "reason")?;
    one_line(&p.note_title, MAX_TARGET * 5, "note title")?;
    let revision = p.revision.as_deref().ok_or("this proposal records no revision of its note; dismiss it and let the Librarian propose again")?;
    one_line(revision, 128, "revision")?;
    match (p.kind.as_str(), &p.folder, &p.target, &p.target_id) {
        ("file", Some(folder), None, None) if plain_folder(&one_line(folder, MAX_TARGET, "folder")?)? == *folder => Ok(()),
        ("link", None, Some(target), Some(_)) => one_line(target, MAX_TARGET, "target").map(|_| ()),
        _ => Err("this proposal isn't a well-formed filing or link; dismiss it".into()),
    }
}

fn apply_proposal(ws: &mut Workspace, p: &Proposal) -> Result<(), String> {
    checked(p)?;
    let local = ws.local_id(&p.note)?;
    let current = ws.read_note(&local)?;
    if p.revision.as_deref() != Some(current.revision.as_str()) {
        return Err(format!("{} has changed since this was proposed; dismiss it and let the Librarian propose again", p.note_title));
    }
    // the title the person approved by is the note's own, read through the gate
    let title = crate::corpus::title_of(&current.note.body);
    if title != p.note_title {
        return Err(format!("this proposal's note title {:?} isn't the note's title {title:?}; dismiss it", p.note_title));
    }
    match (&p.folder, &p.target, &p.target_id) {
        (Some(folder), _, _) => ws.move_note(&local, folder).map(|_| ()),
        (_, Some(target), Some(target_id)) => {
            // the page, through the gate, still the one `[[target]]` names
            let now = exact_target(ws, target).map_err(|why| format!("the link's target can't be used: {why}"))?;
            if now != *target_id {
                return Err(format!("the link's target {target:?} now names a different page than the one proposed"));
            }
            let link = format!("[[{target}]]");
            if current.note.body.contains(&link) {
                return Ok(());
            }
            let body = with_related(&current.note.body, &link);
            ws.update_note(&local, &body, &current.revision).map(|_| ())
        }
        _ => Err("proposal has nothing to apply".into()),
    }
}

/// Add a wikilink to the note's closing `Related:` line, starting one if the
/// note doesn't end with it. The person's prose above is untouched.
pub(super) fn with_related(body: &str, link: &str) -> String {
    let trimmed = body.trim_end();
    match trimmed.rsplit_once('\n') {
        Some((head, last)) if last.starts_with("Related: ") => format!("{head}\n{last}, {link}\n"),
        _ if trimmed.starts_with("Related: ") && !trimmed.contains('\n') => format!("{trimmed}, {link}\n"),
        _ => format!("{trimmed}\n\nRelated: {link}\n"),
    }
}
