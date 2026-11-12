//! The Librarian's own two pages, "Librarian index" and "Librarian log": the
//! only notes the route rewrites. They are ordinary public notes, so a line
//! about a note that has since turned secure would keep its title and summary
//! in two searchable pages. Every route call first withdraws such lines, and
//! no write puts one back (review 2026-11-09, #2).

use std::collections::HashMap;

use crate::ai_edit_policy::Creator;
use crate::corpus::NoteKind;

use super::super::{note_markdown, validate_note_title, Workspace, MAIN_ROOT};
use super::{one_line, INDEX_TITLE, LOG_TITLE, MAX_REASON};
use serde_json::Value;

/// The Librarian's own page with this title, if it has made one. Its own
/// means the exact title AND the `librarian_page: index|log` marker that only
/// this route's page creation writes: a Rotli-reserved key no agent, no
/// metadata editor, and no other creator can set. Matching by selector also
/// matched aliases; matching on `created_by: librarian` also matched the
/// People notes Rotli's Librarian makes, which may be called "Librarian index".
fn find_own_page(ws: &mut Workspace, title: &str, page: &str) -> Result<Option<String>, String> {
    let (stamp, marker) = (Creator::Librarian.line(), crate::corpus::librarian_page_line(page));
    let mut mine = Vec::new();
    for meta in ws.store.list()?.notes {
        if meta.kind != NoteKind::Note || meta.title != title {
            continue;
        }
        let Ok(text) = ws.store.read_for_ai(&meta.id, false) else { continue };
        let foreign = crate::corpus::parse_document(&text).0.map(|fm| fm.foreign).unwrap_or_default();
        let has = |line: &str| foreign.iter().any(|l| l.trim() == line);
        if has(&stamp) && has(&marker) {
            mine.push((meta.created_at, meta.id));
        }
    }
    Ok(mine.into_iter().min().map(|(_, id)| id))
}

/// Find one of the Librarian's own pages, creating it on first use.
fn own_page(ws: &mut Workspace, title: &str, page: &str) -> Result<String, String> {
    if let Some(id) = find_own_page(ws, title, page)? {
        return Ok(id);
    }
    let markdown = note_markdown(validate_note_title(title)?, "")?;
    let intake = ws.store.layout().intake_dir();
    let meta = ws.store.create_librarian_page(intake, &markdown, page)?;
    if ws.root.is_default {
        ws.main_add(&meta.id, MAIN_ROOT)?;
    }
    Ok(meta.id)
}

/// Every `[[target]]` in one line, code spans included (their text shows all
/// the same), as the lower-cased names the link resolves by: no `|label`,
/// `#heading`, or `.md`, and for a path-style link (`[[projects/Plan]]`) its
/// last segment as well, which is the note's file name.
fn link_names(line: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let name = after[..end].split(['|', '#']).next().unwrap_or_default().trim();
        let name = name.strip_suffix(".md").unwrap_or(name).to_lowercase();
        if let Some((_, last)) = name.rsplit_once('/') {
            names.push(last.trim().to_string());
        }
        names.push(name);
        rest = &after[end + 2..];
    }
    names
}

/// The body without every line that links to a note an agent may not read.
/// A link names every note whose title or alias it matches (case aside, as
/// links resolve), and one unreadable match is enough: a public note that
/// shares the name must not keep a secure note's line alive. A link that names
/// no note is left alone.
pub(super) fn withdrawn(ws: &mut Workspace, body: &str) -> Result<String, String> {
    let mut names: HashMap<String, bool> = body.lines().flat_map(link_names).map(|name| (name, true)).collect();
    if names.is_empty() {
        return Ok(body.to_string());
    }
    for meta in ws.store.list()?.notes {
        let claims: Vec<String> = std::iter::once(meta.title.to_lowercase()).chain(meta.aliases.iter().map(|a| a.to_lowercase())).collect();
        if !claims.iter().any(|name| names.get(name) == Some(&true)) {
            continue;
        }
        if ws.store.read_for_ai(&meta.id, false).is_err() {
            for name in claims {
                if let Some(readable) = names.get_mut(&name) {
                    *readable = false;
                }
            }
        }
    }
    let kept: Vec<&str> = body.lines().filter(|line| link_names(line).iter().all(|name| names.get(name) != Some(&false))).collect();
    let mut out = kept.join("\n");
    if body.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}

/// Withdraw, from both pages as they stand, every line about a note an agent
/// may no longer read. Runs before every route call. A page the agent can't
/// read is skipped (it never reaches an agent); a page that needs a change
/// Rotli can't write refuses the call rather than serve the line.
pub(super) fn withdraw_from_own_pages(ws: &mut Workspace) -> Result<(), String> {
    for (title, page) in [(INDEX_TITLE, "index"), (LOG_TITLE, "log")] {
        let Some(id) = find_own_page(ws, title, page)? else { continue };
        let Ok(current) = ws.read_note(&id) else { continue };
        let kept = withdrawn(ws, &current.note.body)?;
        if kept != current.note.body {
            ws.update_note(&id, &kept, &current.revision)
                .map_err(|why| format!("the {title} names a note that is secure now, and Rotli couldn't remove that line: {why}"))?;
        }
    }
    Ok(())
}

pub(super) fn write_index(ws: &mut Workspace, body: &str) -> Result<Value, String> {
    let local = own_page(ws, INDEX_TITLE, "index")?;
    let current = ws.read_note(&local)?;
    let body = withdrawn(ws, &format!("# {INDEX_TITLE}\n\n{}\n", body.trim()))?;
    super::super::json_value(ws.update_note(&local, &body, &current.revision)?)
}

pub(super) fn append_log(ws: &mut Workspace, entry: &str) -> Result<(), String> {
    let entry = one_line(entry, MAX_REASON, "entry")?;
    let local = own_page(ws, LOG_TITLE, "log")?;
    let current = ws.read_note(&local)?;
    let stamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map(|s| s.get(..16).unwrap_or_default().replace('T', " "))
        .unwrap_or_default();
    let body = withdrawn(ws, &format!("{}\n- {stamp} · {entry}\n", current.note.body.trim_end()))?;
    ws.update_note(&local, &body, &current.revision).map(|_| ())
}
