//! The one rule an agent lane asks before a vault path, a folder, or a path
//! a row names (its id, its shelf `folderId`) reaches an agent:
//! `protected_path`. A path is protected when any of its components, after
//! normalising and resolving symlinks against the vault root, is a secure
//! home or carries one of the vault's secure keywords, compared the way the
//! Mac's disk compares names (Unicode case folding, NFC/NFD-insensitive).
//!
//! The case-by-case checks it replaces each compared one spelling: an exact
//! lower-case prefix for the secure homes and the leaf name only for the
//! keywords. `wiki/_ſecure`, a keyword on a parent folder, `..`, `\`, or a
//! symlink each walked past them (Codex re-checks of pull request 302,
//! 2026-11-20). The flag is set only on a store a workspace agent opened
//! (`Workspace::open_target`); the app's own store, the Librarian, and the
//! organizer keep their checks unchanged.
//!
//! Declared as a child of `corpus` (`#[path]` mod in corpus.rs).

use super::{lifecycle_disk_folder, CorpusStore, NoteDoc, NoteMeta, SECURE_NOTES_FOLDER};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// The secure homes, as vault-relative paths (either layout).
const SECURE_HOMES: [&str; 2] = ["wiki/_secure", SECURE_NOTES_FOLDER];

/// A name folded the way APFS compares names: canonical decomposition, full
/// case folding (`ß` → `ss`, `ſ` → `s`, `ﬃ` → `ffi`, final `ς` → `σ`), then
/// recomposed. Lowering, uppering, and lowering again turns each character
/// into its full fold without a case-folding table.
pub(crate) fn fold(name: &str) -> String {
    name.nfd()
        .flat_map(char::to_lowercase)
        .flat_map(char::to_uppercase)
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .nfc()
        .collect()
}

/// A path's components with `\` read as a separator and empty and `.`
/// components dropped. None when any component is `..`: a path that climbs
/// is never judged safe.
pub(crate) fn components(rel: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return None,
            part => parts.push(part.to_string()),
        }
    }
    Some(parts)
}

/// Is `rel` already in the one spelling `components` would give it?
pub(crate) fn is_clean(rel: &str) -> bool {
    components(rel).is_some_and(|parts| parts.join("/") == rel)
}

/// Do these components sit in a secure home, or name a secure keyword in any
/// component? Each component is matched both as written, the way the
/// leaf-name check always matched it (a decomposed `Cafe\u{301}` still holds
/// the word `cafe`), and folded (`STRASSE` holds `Straße`).
fn names_protected(parts: &[String], keywords: &Keywords) -> bool {
    let folded: Vec<String> = parts.iter().map(|part| fold(part)).collect();
    // a secure home anywhere in the path, not only at its start: a trashed
    // or archived copy (`trash/wiki/_secure/…`) is still the secure home's
    // (final review threads on pull request 304, hold 2)
    let in_home = SECURE_HOMES.iter().any(|home| {
        let home: Vec<String> = home.split('/').map(fold).collect();
        folded.windows(home.len()).any(|run| run == &home[..])
    });
    let named = |name: &String, keywords: &[String]| crate::librarian_rules::secure_by_name(name, name, keywords);
    in_home || parts.iter().any(|name| named(name, &keywords.raw)) || folded.iter().any(|name| named(name, &keywords.folded))
}

/// The vault's secure keywords as written and folded.
#[derive(Clone)]
struct Keywords {
    raw: Vec<String>,
    folded: Vec<String>,
}

/// One directory's entries by stored name, each with whether it must be
/// resolved on disk (a symlink, or an entry whose type couldn't be read:
/// unknown is resolved, never trusted). None when the directory isn't there.
type Entries = Option<HashMap<String, bool>>;

/// What an agent store remembers while it lives (one CLI or MCP call, a
/// workspace opens its own store per call): the keywords, the vault root's
/// real path, each directory's entries, and each path's verdict. Everything
/// is dropped when the store's change generation moves. A store that isn't an
/// agent's (the app's, asked by the document bridge) uses a fresh one per
/// question, so nothing there goes stale (Opus review of pull request 304:
/// settings were re-read and the root re-resolved on every question).
#[derive(Default)]
pub(crate) struct AgentLane {
    on: bool,
    generation: RefCell<Option<u64>>,
    keywords: RefCell<Option<Result<Keywords, String>>>,
    real_root: RefCell<Option<Option<PathBuf>>>,
    dirs: RefCell<HashMap<PathBuf, Option<Entries>>>,
    verdicts: RefCell<HashMap<String, bool>>,
}

impl AgentLane {
    fn current(&self, generation: u64) {
        if *self.generation.borrow() != Some(generation) {
            *self.generation.borrow_mut() = Some(generation);
            self.keywords.take();
            self.real_root.take();
            self.dirs.borrow_mut().clear();
            self.verdicts.borrow_mut().clear();
        }
    }

    fn keywords(&self, read: impl FnOnce() -> Result<Vec<String>, String>) -> Result<Keywords, String> {
        self.keywords
            .borrow_mut()
            .get_or_insert_with(|| read().map(|raw| Keywords { folded: raw.iter().map(|k| fold(k)).collect(), raw }))
            .clone()
    }

    fn real_root(&self, root: &Path) -> Option<PathBuf> {
        self.real_root.borrow_mut().get_or_insert_with(|| std::fs::canonicalize(root).ok()).clone()
    }

    /// `dir`'s entries; Some(None) when it isn't there, None when it can't be
    /// read (which protects).
    fn entries(&self, dir: &Path) -> Option<Entries> {
        if let Some(known) = self.dirs.borrow().get(dir) {
            return known.clone();
        }
        let read = match std::fs::read_dir(dir) {
            Ok(entries) => Some(Some(
                entries
                    .filter_map(Result::ok)
                    .map(|entry| (entry.file_name().to_string_lossy().into_owned(), entry.file_type().map_or(true, |t| t.is_symlink())))
                    .collect(),
            )),
            Err(error) if is_absent(&error) => Some(None),
            Err(_) => None,
        };
        self.dirs.borrow_mut().insert(dir.to_path_buf(), read.clone());
        read
    }
}

fn is_absent(error: &std::io::Error) -> bool {
    matches!(error.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory)
}

/// The vault-relative components `parts` really point at, read directory by
/// directory: a name stored as given is taken from the directory's entries;
/// a symlink, or a name the disk opens under another spelling (case, `ſ`, a
/// composed form), is canonicalized to the name stored on disk; the first
/// missing component and everything after it stay as given. None when a
/// directory can't be read, or a symlink can't be resolved or leaves the
/// vault.
fn resolved(lane: &AgentLane, root: &Path, parts: &[String]) -> Option<Vec<String>> {
    let real_root = lane.real_root(root)?;
    let mut dir = real_root.clone();
    let mut out: Vec<String> = Vec::new();
    for (at, part) in parts.iter().enumerate() {
        let Some(entries) = lane.entries(&dir)? else {
            out.extend(parts[at..].iter().cloned());
            return Some(out);
        };
        match entries.get(part) {
            Some(false) => {
                dir.push(part);
                out.push(part.clone());
                continue;
            }
            Some(true) => {}
            None => match std::fs::symlink_metadata(dir.join(part)) {
                Ok(_) => {}
                Err(error) if is_absent(&error) => {
                    out.extend(parts[at..].iter().cloned());
                    return Some(out);
                }
                Err(_) => return None,
            },
        }
        let real = std::fs::canonicalize(dir.join(part)).ok()?;
        out = real.strip_prefix(&real_root).ok()?.iter().map(|part| part.to_string_lossy().into_owned()).collect();
        dir = real;
    }
    Some(out)
}

impl CorpusStore {
    /// Mark this store as a workspace agent's: its AI gates then ask
    /// `protected_path` too.
    pub(crate) fn set_agent_lane(&mut self) {
        self.agent.on = true;
    }

    pub(crate) fn is_agent_lane(&self) -> bool {
        self.agent.on
    }

    /// The vault's secure keywords for classification, read once per agent
    /// store and change generation.
    pub(super) fn agent_keywords(&self) -> Option<Result<Vec<String>, String>> {
        if !self.agent.on {
            return None;
        }
        self.agent.current(self.suppress.generation());
        Some(self.agent.keywords(|| self.read_keywords_for_classification()).map(|k| k.raw))
    }

    /// THE rule: may an agent never be shown this vault-relative path, or
    /// anything at or under it? Fails closed: a path that climbs (`..`), a
    /// symlink that can't be resolved or leaves the vault, or keyword settings
    /// that can't be read all answer yes. The spelling given and the path it
    /// resolves to are both judged.
    pub(crate) fn protected_path(&self, rel: &str) -> bool {
        if !self.agent.on {
            return self.judge_path(&AgentLane::default(), rel);
        }
        self.agent.current(self.suppress.generation());
        if let Some(&known) = self.agent.verdicts.borrow().get(rel) {
            return known;
        }
        let verdict = self.judge_path(&self.agent, rel);
        self.agent.verdicts.borrow_mut().insert(rel.to_string(), verdict);
        verdict
    }

    fn judge_path(&self, lane: &AgentLane, rel: &str) -> bool {
        if self.raw.is_some() {
            return true;
        }
        let Some(parts) = components(&lifecycle_disk_folder(self.layout, rel)) else {
            return true;
        };
        if parts.is_empty() {
            return false;
        }
        let Ok(keywords) = lane.keywords(|| self.read_keywords_for_classification()) else {
            return true;
        };
        if names_protected(&parts, &keywords) {
            return true;
        }
        match resolved(lane, &self.root, &parts) {
            Some(real) => names_protected(&real, &keywords),
            None => true,
        }
    }

    /// The sidebar's secure mark belongs to the person's own answers: a write,
    /// create or move an agent lane makes never says the note is protected.
    pub(crate) fn person_only(&self, mark: bool) -> bool {
        mark && !self.agent.on
    }

    /// An agent lane's row, made safe to show: refused when its id is a path
    /// in a protected place; its `folderId` (a shelf from frontmatter) falls
    /// back to the folder the note lives in when the shelf isn't clean or is
    /// protected. Unchanged outside an agent lane.
    pub(crate) fn agent_row(&self, mut row: NoteMeta) -> Option<NoteMeta> {
        if !self.agent.on {
            return Some(row);
        }
        if !self.agent_id_shown(&row.id) {
            return None;
        }
        row.folder_id = self.agent_folder(&row.folder_id, &row.disk_folder_id)?;
        row.origin = self.agent_origin(row.origin);
        // the sidebar's mark is for the person's own listing; an agent is never
        // told which of the notes it may see are protected
        row.secure = false;
        Some(row)
    }

    /// `agent_row` for a read note.
    pub(crate) fn agent_doc(&self, mut doc: NoteDoc) -> Result<NoteDoc, String> {
        if !self.agent.on {
            return Ok(doc);
        }
        let refused = || "not available to agents".to_string();
        if !self.agent_id_shown(&doc.id) {
            return Err(refused());
        }
        doc.folder_id = self.agent_folder(&doc.folder_id, &doc.disk_folder_id).ok_or_else(refused)?;
        doc.origin = self.agent_origin(doc.origin);
        Ok(doc)
    }

    /// A row's id may be shown: a ULID, or a path that is clean and
    /// unprotected (a hand-written id can be any text).
    pub(crate) fn agent_id_shown(&self, id: &str) -> bool {
        !id.contains(['/', '\\']) || (is_clean(id) && !self.names_protected_path(id))
    }

    /// Text that may name a vault path (an id, a shelf, an origin, a journal
    /// path, a frontmatter value), judged as written and as YAML, a wikilink,
    /// or a wire id would read it: unquoted, unwrapped from `[[…]]` (and its
    /// `|alias`), and after every `:` (any `word:` prefix, any number of
    /// them). A leading quote or prefix walked past the rule (final check of
    /// pull request 304, B3, and its review threads).
    pub(crate) fn names_protected_path(&self, text: &str) -> bool {
        let bare = text.trim_matches(|c: char| c == '"' || c == '\'' || c.is_whitespace());
        let bare = bare.strip_prefix("[[").and_then(|inner| inner.strip_suffix("]]")).unwrap_or(bare);
        let bare = bare.split_once('|').map_or(bare, |(target, _)| target);
        // after any number of `word:` prefixes, not only a known root's
        // (`evil:`, `x:y:`; final review threads on pull request 304, hold 1)
        let tails = bare.match_indices(':').map(|(at, _)| &bare[at + 1..]);
        [text, bare].into_iter().chain(tails).any(|candidate| self.protected_path(candidate))
    }

    /// The folder a row shows: its shelf when that is a clean, unprotected
    /// path, else the folder it lives in. None (the row is refused) when the
    /// folder it lives in is itself protected. That folder comes from the walk,
    /// not from an agent or from frontmatter, so it need not be "clean": a
    /// folder named `A\B` on disk keeps its notes listed (Opus re-check of
    /// #304, N3); `protected_path` still reads its `\` as a separator, which
    /// only ever protects more.
    fn agent_folder(&self, folder: &str, disk_folder: &str) -> Option<String> {
        if self.protected_path(disk_folder) {
            return None;
        }
        if is_clean(folder) && !self.names_protected_path(folder) {
            return Some(folder.to_string());
        }
        Some(disk_folder.to_string())
    }

    /// `origin`, the folder an archived or trashed note came from (Rotli
    /// writes it on the move): shown only when it is a clean, unprotected
    /// path (Opus review of pull request 304).
    fn agent_origin(&self, origin: Option<String>) -> Option<String> {
        origin.filter(|origin| is_clean(origin) && !self.names_protected_path(origin))
    }
}

#[cfg(test)]
#[path = "corpus_protected_path_tests.rs"]
mod tests;
