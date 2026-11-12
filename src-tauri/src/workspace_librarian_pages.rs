//! The Librarian's own two pages, "Librarian index" and "Librarian log": the
//! only notes the route rewrites. They are ordinary public notes, so a line
//! about a note that has since turned secure would keep its title and summary
//! in two searchable pages. Every route call first withdraws such lines, and
//! no write puts one back (review 2026-11-09, #2).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::ai_edit_policy::Creator;
use crate::containment::{open_sidecar, Sidecar};
use crate::corpus::NoteKind;

use super::super::{note_markdown, validate_note_title, Workspace, MAIN_ROOT};
use super::{one_line, INDEX_TITLE, LOG_TITLE, MAX_REASON};
use serde_json::Value;

/// Which note is the Librarian's index and which its log, by id: a person may
/// retitle either page, and it stays the Librarian's (independent review of
/// PR #295). A deletable cache; every entry is checked against the page.
const PAGES: &str = ".rotli/librarian/pages.jsonl";

/// One line of [`PAGES`]: `id: None` records that no such page exists yet.
#[derive(Serialize, Deserialize)]
struct PageRecord {
    page: String,
    id: Option<String>,
}

/// Whether note `id` is the Librarian's own `page`: the `created_by:
/// librarian` stamp AND the `librarian_page: index|log` marker that only this
/// route's page creation writes, a Rotli-reserved key no agent, no metadata
/// editor, and no other creator can set. The stamp alone also matches the
/// People notes Rotli's Librarian makes, which may be called "Librarian
/// index"; a title or alias matches anything. A page an agent can't read is
/// never its own.
fn is_own(ws: &mut Workspace, id: &str, page: &str) -> bool {
    let (stamp, marker) = (Creator::Librarian.line(), crate::corpus::librarian_page_line(page));
    let Ok(text) = ws.store.read_for_ai(id, false) else { return false };
    let foreign = crate::corpus::parse_document(&text).0.map(|fm| fm.foreign).unwrap_or_default();
    let has = |line: &str| foreign.iter().any(|l| l.trim() == line);
    has(&stamp) && has(&marker)
}

/// The last record for `page`: None when there is none (or the file can't be
/// opened safely), Some(None) when it records that no page exists.
fn recorded(root: &Path, page: &str) -> Option<Option<String>> {
    let mut text = String::new();
    open_sidecar(root, Path::new(PAGES), Sidecar::Read).ok().flatten()?.read_to_string(&mut text).ok()?;
    text.lines().filter_map(|line| serde_json::from_str::<PageRecord>(line).ok()).rfind(|r| r.page == page).map(|r| r.id)
}

/// Best effort: the record is a cache, and a file that can't be opened safely
/// (a link) is left alone.
fn record(root: &Path, page: &str, id: Option<&str>) {
    let Ok(line) = serde_json::to_string(&PageRecord { page: page.into(), id: id.map(str::to_string) }) else { return };
    if let Ok(Some(mut file)) = open_sidecar(root, Path::new(PAGES), Sidecar::Append) {
        let _ = writeln!(file, "{line}");
    }
}

/// The Librarian's own `page`, if it has made one: the recorded note when it
/// still is that page, else the oldest note carrying the page's marker, found
/// once by looking at every note and then recorded.
fn find_own_page(ws: &mut Workspace, page: &str) -> Result<Option<String>, String> {
    match recorded(&ws.root.path, page) {
        Some(Some(id)) if is_own(ws, &id, page) => return Ok(Some(id)),
        Some(None) => return Ok(None),
        _ => {}
    }
    let mut mine = Vec::new();
    for meta in ws.store.list()?.notes {
        if meta.kind == NoteKind::Note && is_own(ws, &meta.id, page) {
            mine.push((meta.created_at, meta.id));
        }
    }
    let found = mine.into_iter().min().map(|(_, id)| id);
    record(&ws.root.path, page, found.as_deref());
    Ok(found)
}

/// Find one of the Librarian's own pages, creating it on first use.
fn own_page(ws: &mut Workspace, title: &str, page: &str) -> Result<String, String> {
    if let Some(id) = find_own_page(ws, page)? {
        return Ok(id);
    }
    let markdown = note_markdown(validate_note_title(title)?, "")?;
    let intake = ws.store.layout().intake_dir();
    let meta = ws.store.create_librarian_page(intake, &markdown, page)?;
    record(&ws.root.path, page, Some(&meta.id));
    if ws.root.is_default {
        ws.main_add(&meta.id, MAIN_ROOT)?;
    }
    Ok(meta.id)
}

/// Every `[[target]]` in one line, code spans included (their text shows all
/// the same), as the lower-cased names the link resolves by: no `|label`,
/// `#heading`, or `.md` in any case, and for a path-style link
/// (`[[projects/Plan]]`) its last segment as well, which is the note's file
/// name.
fn link_names(line: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let name = after[..end].split(['|', '#']).next().unwrap_or_default().trim().to_lowercase();
        let name = name.strip_suffix(".md").unwrap_or(&name).to_string();
        if let Some((_, last)) = name.rsplit_once('/') {
            names.push(last.trim().to_string());
        }
        names.push(name);
        rest = &after[end + 2..];
    }
    names
}

/// The body without every line that links to a note an agent may not read.
/// A link names every note whose id, title or alias it matches (case aside,
/// as links resolve), and one unreadable match is enough: a public note that
/// shares the name must not keep a secure note's line alive. A link that names
/// no note is left alone.
pub(super) fn withdrawn(ws: &mut Workspace, body: &str) -> Result<String, String> {
    let mut names: HashMap<String, bool> = body.lines().flat_map(link_names).map(|name| (name, true)).collect();
    if names.is_empty() {
        return Ok(body.to_string());
    }
    for meta in ws.store.list()?.notes {
        let names_of = [meta.id.to_lowercase(), meta.title.to_lowercase()];
        let claims: Vec<String> = names_of.into_iter().chain(meta.aliases.iter().map(|a| a.to_lowercase())).collect();
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
        let Some(id) = find_own_page(ws, page)? else { continue };
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
