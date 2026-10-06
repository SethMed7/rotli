//! The Links projection — the Graph view's data (exploration 2026-10-05).
//!
//! Every live Markdown note with the raw `[[target]]`s its body writes, derived
//! per call from the SAME cached walk Tasks rides (no second read pass).
//! Markdown stays the only truth: nothing here is stored. Targets are returned
//! RAW (`Note|label`, `Note#heading`) so TypeScript resolves them with the one
//! resolver the editor already uses (`src/editor/wikilink.ts`) — two resolvers
//! would drift.
//!
//! Trash/Archive/chats/boards are excluded; fenced and inline code is skipped.
//! The frontmatter `links:` line (the Librarian's related notes) rides along
//! SEPARATELY as `suggested`, so the Graph can draw it apart from what the
//! person wrote (owner decision 2026-10-06: shown by default, dashed, with a
//! switch). Only the one-line form the Librarian writes (`links: [[a]], [[b]]`)
//! is read; a multi-line YAML list never reaches the cached metadata
//! projection and draws nothing. Secure notes are INCLUDED with their `secure` flag (the
//! user's own local screen, like Tasks); their raw link targets reach only
//! the webview's Graph and Canvas, which show a secure note's title and never
//! its text. Secure = the flag, the chat taint, the secret detector, or a
//! secure folder — the same rule as Rotli Web (webLinks.ts). This projection
//! is not agent-exposed: no AI tool or MCP verb may return it.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses
//! the store's walk cache.

use serde::Serialize;

use super::{
    is_archive_folder, is_chats_folder, is_trash_folder, CorpusState, CorpusStore, Layout,
    NoteKind,
};

/// One note's outgoing link targets, as written.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub note_id: String,
    pub secure: bool,
    /// Distinct raw wikilink insides, in first-seen order.
    pub targets: Vec<String>,
    /// The raw targets of the frontmatter `links:` line, same rules.
    pub suggested: Vec<String>,
}

/// The raw `[[…]]` insides of a note's frontmatter `links:` line. `fields` is
/// frontmatter lines joined by newlines; the key must start the line exactly
/// (an indented `links:` belongs to some other value). `links: []` is empty.
pub(crate) fn metadata_link_targets(fields: &str) -> Vec<String> {
    fields
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key == "links").then_some(value)
        })
        .map(body_link_targets)
        .unwrap_or_default()
}

/// The raw `[[…]]` insides of a body: fenced blocks and inline code skipped,
/// `![[…]]` counted (it names the note too), duplicates collapsed.
/// A fence line's run — three or more of one fence character, as CommonMark
/// has it — and what follows it. An opening backtick run may not carry another
/// backtick after it.
fn fence_run(line: &str) -> Option<(char, usize, &str)> {
    let trimmed = line.trim_start();
    let first = trimmed.chars().next()?;
    if first != '`' && first != '~' {
        return None;
    }
    let len = trimmed.chars().take_while(|c| *c == first).count();
    if len < 3 {
        return None;
    }
    let rest = &trimmed[len..];
    if first == '`' && rest.contains('`') {
        return None;
    }
    Some((first, len, rest))
}

/// A line with its code spans blanked: a run of N backticks opens a span only
/// when a run of exactly N closes it later on the line; a run with no match
/// is literal text (CommonMark).
fn outside_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut prose = String::with_capacity(line.len());
    let mut at = 0;
    while at < chars.len() {
        if chars[at] != '`' {
            prose.push(chars[at]);
            at += 1;
            continue;
        }
        let run = chars[at..].iter().take_while(|c| **c == '`').count();
        let mut close = None;
        let mut next = at + run;
        while next < chars.len() {
            if chars[next] != '`' {
                next += 1;
                continue;
            }
            let other = chars[next..].iter().take_while(|c| **c == '`').count();
            if other == run {
                close = Some(next);
                break;
            }
            next += other;
        }
        match close {
            None => {
                prose.extend(&chars[at..at + run]);
                at += run;
            }
            Some(end) => {
                prose.push(' ');
                at = end + run;
            }
        }
    }
    prose
}

pub(crate) fn body_link_targets(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    // the open fence: it closes only on the same character, at least as long
    let mut fence: Option<(char, usize)> = None;
    for line in body.lines() {
        let found = fence_run(line);
        if let Some((open_char, open_len)) = fence {
            if let Some((c, len, rest)) = found {
                if c == open_char && len >= open_len && rest.trim().is_empty() {
                    fence = None;
                }
            }
            continue;
        }
        if let Some((c, len, _)) = found {
            fence = Some((c, len));
            continue;
        }
        let prose = outside_code(line);
        let mut rest = prose.as_str();
        while let Some(start) = rest.find("[[") {
            let after = &rest[start + 2..];
            let Some(end) = after.find("]]") else { break };
            let inner = after[..end].trim();
            if !inner.is_empty() && !inner.contains('[') && !out.iter().any(|t| t == inner) {
                out.push(inner.to_string());
            }
            rest = &after[end + 2..];
        }
    }
    out
}

/// A note filed in a secure folder — the legacy `Secure notes` or a memex's
/// `wiki/_secure` — is secure whatever its frontmatter says.
pub(crate) fn in_secure_folder(folder: &str) -> bool {
    [super::SECURE_NOTES_FOLDER, "wiki/_secure"]
        .iter()
        .any(|root| folder == *root || folder.starts_with(&format!("{root}/")))
}

impl CorpusStore {
    pub(crate) fn links(&mut self) -> Result<Vec<NoteLinks>, String> {
        self.ensure_walked()?;
        let layout = self.layout;
        let cache = self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache");
        let mut out = Vec::new();
        for meta in &cache.list.notes {
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || is_archive_folder(&meta.folder_id)
                || (layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let Some(text) = cache.texts.get(&meta.id) else {
                continue;
            };
            out.push(NoteLinks {
                note_id: meta.id.clone(),
                // one rule on the Mac and the web (audit 2026-10-06): the flag,
                // the chat taint, the secret detector, or a secure folder
                secure: text.secure || in_secure_folder(&meta.folder_id) || in_secure_folder(&meta.disk_folder_id),
                targets: body_link_targets(&text.body),
                suggested: metadata_link_targets(&text.metadata),
            });
        }
        Ok(out)
    }
}

/// The Links projection over the DEFAULT corpus. Read-only; off the main
/// thread like `corpus_tasks`.
#[tauri::command]
pub async fn corpus_links_list(app: tauri::AppHandle) -> Result<Vec<NoteLinks>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        let default_id = state
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?
            .default_id
            .clone();
        state.route(&default_id, |s| s.links())
    })
    .await
    .map_err(|e| format!("corpus links worker failed ({e})"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn targets_skip_code_and_collapse_duplicates() {
        let body = "See [[Books]] and [[Philosophy|phil]].\n\
                    `[[not a link]]` but ![[Diagram]] is.\n\
                    ```\n[[fenced]]\n```\n\
                    Again [[Books]] and [[René Descartes#Life]].\n[[]] [[ ]]";
        assert_eq!(
            body_link_targets(body),
            vec!["Books", "Philosophy|phil", "Diagram", "René Descartes#Life"]
        );
    }

    #[test]
    fn a_secure_folder_makes_a_note_secure() {
        assert!(in_secure_folder("Secure notes"));
        assert!(in_secure_folder("Secure notes/Banking"));
        assert!(in_secure_folder("wiki/_secure"));
        assert!(in_secure_folder("wiki/_secure/2026/q4"));
        assert!(!in_secure_folder("Secure notesX"));
        assert!(!in_secure_folder("wiki/_securely"));
        assert!(!in_secure_folder("Inbox"));
    }

    #[test]
    fn suggested_targets_come_from_the_links_line_only() {
        assert_eq!(
            metadata_link_targets("area: work\nlinks: [[Pricing]], [[Q3 plan|plan]]\ntags: [a]"),
            vec!["Pricing", "Q3 plan|plan"]
        );
        assert!(metadata_link_targets("links: []").is_empty());
        assert!(metadata_link_targets("summary: see [[Pricing]]").is_empty());
        assert!(metadata_link_targets(" links: [[indented]]").is_empty());
        assert!(metadata_link_targets("").is_empty());
    }

    #[test]
    fn links_project_live_notes_with_their_secure_flag() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let a = store
            .create("Inbox", "# Alpha\n\nLinks to [[Beta]].\n")
            .unwrap();
        store.create("Inbox", "# Beta\n\nNo links.\n").unwrap();
        let sunk = store.create("Inbox", "# Sunk\n\n[[Alpha]]\n").unwrap();
        store.move_note(&sunk.id, "Archive").unwrap();

        let links = store.links().unwrap();
        assert!(
            links.iter().all(|l| l.targets != vec!["Alpha"]),
            "archived notes leave the graph"
        );
        let alpha = links.iter().find(|l| l.note_id == a.id).unwrap();
        assert_eq!(alpha.targets, vec!["Beta"]);
        assert!(alpha.suggested.is_empty());
        assert!(!alpha.secure);
    }

    #[test]
    fn the_librarians_links_line_rides_along_as_suggested() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("corpus");
        let mut store = CorpusStore::open(root.clone()).unwrap();
        let g = store.create("Inbox", "# Gamma\n\nSee [[Alpha]].\n").unwrap();
        // the line the Librarian's enrich step writes into a note's frontmatter
        let path = root.join(store.path_of(&g.id).unwrap());
        let text = std::fs::read_to_string(&path).unwrap();
        let enriched = text.replacen("---\n", "---\nlinks: [[Beta]], [[Alpha]]\n", 1);
        assert_ne!(enriched, text, "a created note has frontmatter to enrich");
        std::fs::write(&path, enriched).unwrap();
        // an edit from outside Rotli: the watcher bumps the walk generation
        store.suppress.bump();

        let links = store.links().unwrap();
        let gamma = links.iter().find(|l| l.note_id == g.id).unwrap();
        assert_eq!(gamma.targets, vec!["Alpha"]);
        assert_eq!(gamma.suggested, vec!["Beta", "Alpha"]);
    }
}
