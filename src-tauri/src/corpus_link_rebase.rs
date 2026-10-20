//! A note that moves keeps its links working (slice 4c-1b,
//! docs/design/vault-copy-and-obsidian-compatibility.md). Markdown links and
//! embeds are relative to the note's folder — the form Rotli writes for a new
//! image (`noteImageLink`) and Obsidian writes for an attachment — so a move to
//! another depth would break them. The moved note's own links are rebased to
//! its new folder, and links in other notes that name it follow it. A note's
//! id is stable across a move (`.rotli/index.json`), so Main and named views
//! need nothing. `[[wikilinks]]` resolve by name and are never touched. A link that names
//! something outside the vault, or a file that isn't there, stays as written.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses
//! the store's walk cache and its one safe note rewrite.

use super::link_convert::link_from;
use super::{folder_of, locked_field, parse_document, CorpusStore, NoteKind};

/// One body with every relative Markdown link outside code passed to `map`,
/// which gets the vault path the link names and answers the new link (or
/// `None` to keep it). Returns the body and how many links changed.
pub(crate) fn rewrite_links(body: &str, folder: &str, map: &dyn Fn(&str) -> Option<String>) -> (String, usize) {
    let mut out: Vec<String> = Vec::new();
    let mut changed = 0;
    let mut fence: Option<&str> = None;
    for line in body.split('\n') {
        let trimmed = line.trim_start();
        if let Some(open) = fence {
            if trimmed.starts_with(open) {
                fence = None;
            }
            out.push(line.to_string());
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = Some(&trimmed[..3]);
            out.push(line.to_string());
            continue;
        }
        let (next, n) = rewrite_line(line, folder, map);
        changed += n;
        out.push(next);
    }
    (out.join("\n"), changed)
}

fn rewrite_line(line: &str, folder: &str, map: &dyn Fn(&str) -> Option<String>) -> (String, usize) {
    let mut out = String::with_capacity(line.len());
    let mut changed = 0;
    let mut rest = line;
    while let Some(at) = rest.find("](") {
        let (before, after) = (&rest[..at], &rest[at + 2..]);
        out.push_str(before);
        out.push_str("](");
        rest = after;
        // inside an inline code span (an odd count of backticks so far)
        if out.matches('`').count() % 2 == 1 {
            continue;
        }
        let Some((target, suffix, len)) = link_target(after) else {
            continue;
        };
        let replaced = resolve(folder, target).and_then(|rel| map(&rel));
        match replaced {
            Some(link) if link != target => {
                out.push_str(&link);
                out.push_str(suffix);
                changed += 1;
            }
            _ => out.push_str(&after[..len]),
        }
        rest = &after[len..];
    }
    out.push_str(rest);
    (out, changed)
}

/// The destination right after `](`: its path (without `<>`), the `#…`/`?…`
/// part kept as written, and how many bytes the destination spans (up to,
/// not including, a title or the closing `)`).
fn link_target(after: &str) -> Option<(&str, &str, usize)> {
    let (dest, len) = if let Some(inner) = after.strip_prefix('<') {
        let end = inner.find('>')?;
        (&inner[..end], end + 2)
    } else {
        let end = after.find([' ', ')'])?;
        (&after[..end], end)
    };
    let split = dest.find(['#', '?']).unwrap_or(dest.len());
    let (path, suffix) = dest.split_at(split);
    let external = path.is_empty()
        || path.starts_with('/')
        || path.split('/').next().is_some_and(|first| first.contains(':'));
    (!external).then_some((path, suffix, len))
}

/// The vault path a relative link from `folder` names, or `None` when it
/// climbs out of the vault.
fn resolve(folder: &str, target: &str) -> Option<String> {
    let decoded = percent_encoding::percent_decode_str(target).decode_utf8().ok()?;
    let mut parts: Vec<&str> = folder.split('/').filter(|p| !p.is_empty()).collect();
    for part in decoded.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            name => parts.push(name),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A note's links after a batch of moves. `from` and `to` are the note's
/// folder before and after (equal when it stayed); `moved` answers where a
/// moved file went. Only a link that involves a move is rewritten, and only
/// to a file that is there (`exists`).
pub(crate) fn rebase_body(
    body: &str,
    from: &str,
    to: &str,
    moved: &dyn Fn(&str) -> Option<String>,
    exists: &dyn Fn(&str) -> bool,
) -> (String, usize) {
    rewrite_links(body, from, &|target| {
        let went = moved(target);
        if from == to && went.is_none() {
            return None;
        }
        let dest = went.unwrap_or_else(|| target.to_string());
        exists(&dest).then(|| link_from(to, &dest))
    })
}

impl CorpusStore {
    /// The notes whose relative links name `rel`, with whether each is locked.
    /// Read from the walk cache; a body is parsed only when it mentions the
    /// file's name, so a move stays cheap in a large vault.
    pub(crate) fn linkers_of(&mut self, rel: &str) -> Result<Vec<(String, bool)>, String> {
        self.ensure_walked()?;
        let name = rel.rsplit('/').next().unwrap_or(rel);
        let encoded = link_from("", name);
        let cache = self.list_cache.as_ref().expect("ensure_walked fills the cache");
        let mentions: Vec<(String, String)> = cache
            .list
            .notes
            .iter()
            .filter(|meta| meta.kind == NoteKind::Note)
            .filter_map(|meta| {
                let body = &cache.texts.get(&meta.id)?.body;
                (body.contains(name) || body.contains(&encoded)).then(|| (meta.id.clone(), body.clone()))
            })
            .collect();
        let mut out = Vec::new();
        for (id, body) in mentions {
            let Ok(linker) = self.resolve_note_rel(&id) else { continue };
            if linker == rel || !names(&body, &folder_of(&linker), rel) {
                continue;
            }
            let text = std::fs::read_to_string(self.abs(&linker)).unwrap_or_default();
            out.push((linker, is_locked(&text)));
        }
        Ok(out)
    }

    /// After a batch of moves (`(old, new)` vault paths, notes and files
    /// alike), every relative link they touch is pointed at where things are
    /// now: a moved note's own links, and links in other notes to a moved
    /// file. One walk for the whole batch, so the order of the moves doesn't
    /// matter. A locked note is never written. Returns the notes written.
    pub(crate) fn follow_moves(&mut self, moves: &[(String, String)]) -> Result<Vec<String>, String> {
        let moves: Vec<&(String, String)> = moves.iter().filter(|(old, new)| old != new).collect();
        if moves.is_empty() {
            return Ok(Vec::new());
        }
        let went_to = |old: &str| moves.iter().find(|(o, _)| o == old).map(|(_, n)| n.clone());
        let came_from = |new: &str| moves.iter().find(|(_, n)| n == new).map(|(o, _)| o.clone());
        let names: Vec<(String, String)> = moves
            .iter()
            .map(|(old, _)| {
                let name = old.rsplit('/').next().unwrap_or(old).to_string();
                let encoded = link_from("", &name);
                (name, encoded)
            })
            .collect();
        self.ensure_walked()?;
        let cache = self.list_cache.as_ref().expect("ensure_walked fills the cache");
        let ids: Vec<String> = cache
            .list
            .notes
            .iter()
            .filter(|meta| meta.kind == NoteKind::Note)
            .filter(|meta| {
                cache.texts.get(&meta.id).is_some_and(|text| {
                    names.iter().any(|(name, encoded)| text.body.contains(name) || text.body.contains(encoded))
                })
            })
            .map(|meta| meta.id.clone())
            .collect();
        let mut notes: Vec<String> = ids.iter().filter_map(|id| self.resolve_note_rel(id).ok()).collect();
        for (_, new) in &moves {
            if new.to_ascii_lowercase().ends_with(".md") && !notes.contains(new) {
                notes.push(new.clone());
            }
        }
        let mut written = Vec::new();
        for rel in notes {
            let to = folder_of(&rel);
            let from = came_from(&rel).map_or_else(|| to.clone(), |old| folder_of(&old));
            let wrote = self.rewrite_note_locked(&rel, |store, text| {
                if is_locked(text) {
                    return None;
                }
                let head = super::raw_frontmatter_block(text);
                let exists = |dest: &str| store.abs(dest).exists();
                let (body, n) = rebase_body(&text[head.len()..], &from, &to, &went_to, &exists);
                (n > 0).then(|| format!("{head}{body}"))
            })?;
            if wrote {
                written.push(rel);
            }
        }
        Ok(written)
    }

    /// An AI move (the Librarian's, an agent's) may not break a locked note's
    /// link: nothing edits a locked note, so the move is refused instead.
    pub(crate) fn refuse_breaking_locked_links(&mut self, rel: &str) -> Result<(), String> {
        match self.linkers_of(rel)?.into_iter().find(|(_, locked)| *locked) {
            Some((linker, _)) => Err(format!("a locked note links to it by path ({linker}) — it stays where it is")),
            None => Ok(()),
        }
    }
}

/// Whether `body` (from `folder`) has a relative link naming `rel`.
fn names(body: &str, folder: &str, rel: &str) -> bool {
    rewrite_links(body, folder, &|named| (named == rel).then(|| String::from("\u{0}"))).1 > 0
}

fn is_locked(text: &str) -> bool {
    parse_document(text)
        .0
        .is_some_and(|fm| fm.foreign.iter().any(|line| locked_field(line) == Some(true)))
}

#[cfg(test)]
#[path = "corpus_link_rebase_tests.rs"]
mod tests;
