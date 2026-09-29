//! Clean up the aliases a note picked up before Round Three stopped making
//! them (the owner, 2026-09-28: "“untitled” should never be in the
//! metadata", then "a full clean up removing all of the untitles").
//!
//! Since #99 a note no longer gains `Untitled` / `untitled (7)` placeholders,
//! or the half-typed titles autosave used to record (`Round`, `Round Three -`),
//! but the ones already written stay until that note is renamed. This pass
//! finds them in every note and, on the person's go-ahead, removes them. An
//! alias some note links to (`[[Round Three]]`) is kept, so no link breaks.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses
//! the store's own gates and document helpers.

use std::collections::HashSet;
use std::fs;

use serde::Serialize;

use super::{
    alias_values, compose_document, filename_stem, is_placeholder_alias, parse_document, slugify,
    CorpusState, CorpusStore, NoteKind,
};

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AliasCleanupReport {
    /// Notes with at least one leftover (found, or cleaned when applied).
    pub notes: usize,
    /// Leftover aliases found (or removed when applied).
    pub aliases: usize,
    /// Leftovers kept because a link somewhere uses them.
    pub kept_linked: usize,
}

/// An alias that only repeats the start of the note's current title or file
/// name: what autosave recorded while the title was still being typed.
fn is_typing_leftover(alias: &str, title: &str, stem: &str) -> bool {
    let alias = alias.trim().to_lowercase();
    if alias.is_empty() {
        return false;
    }
    let title = title.trim().to_lowercase();
    let slug_title = slugify(&title);
    let stem = stem.trim().to_lowercase();
    let prefix_of = |whole: &str| whole != alias && whole.starts_with(&alias);
    prefix_of(&title) || prefix_of(&slug_title) || prefix_of(&stem)
}

/// Which of a note's aliases are leftovers, and which of those a link keeps.
pub(crate) fn leftover_aliases(
    aliases: &[String],
    title: &str,
    stem: &str,
    linked: &HashSet<String>,
) -> (Vec<String>, usize) {
    let mut kept = 0;
    let leftovers = aliases
        .iter()
        .filter(|alias| is_placeholder_alias(alias) || is_typing_leftover(alias, title, stem))
        .filter(|alias| {
            let is_linked = linked.contains(&alias.trim().to_lowercase());
            if is_linked {
                kept += 1;
            }
            !is_linked
        })
        .cloned()
        .collect();
    (leftovers, kept)
}

/// Every `[[target]]` in a note (also `[[target|label]]`, `[[target#h]]`,
/// and `![[embed]]`), lowercased.
pub(crate) fn link_targets(body: &str, into: &mut HashSet<String>) {
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let inner = &rest[..end];
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() {
            into.insert(target.to_lowercase());
        }
        rest = &rest[end + 2..];
    }
}

/// The aliases line rewritten without `remove`; None when nothing changes.
fn without_aliases(text: &str, remove: &[String]) -> Option<String> {
    let (fm, raw) = parse_document(text);
    let mut fm = fm?;
    let before = alias_values(&fm);
    let after: Vec<String> = before
        .iter()
        .filter(|alias| !remove.iter().any(|r| r == *alias))
        .cloned()
        .collect();
    if after.len() == before.len() {
        return None;
    }
    let at = fm
        .foreign
        .iter()
        .position(|line| line.split_once(':').is_some_and(|(key, _)| key == "aliases"))?;
    if after.is_empty() {
        fm.foreign.remove(at);
    } else {
        fm.foreign[at] = format!("aliases: {}", serde_json::to_string(&after).ok()?);
    }
    Some(compose_document(&fm, raw))
}

impl CorpusStore {
    /// Find (and with `apply`, remove) leftover aliases across the vault.
    pub fn alias_cleanup(&mut self, apply: bool) -> Result<AliasCleanupReport, String> {
        if apply {
            self.mutation_allowed()?;
        }
        let notes = self.list()?.notes;
        let mut texts = Vec::new();
        let mut linked = HashSet::new();
        for note in notes.iter().filter(|note| note.kind == NoteKind::Note) {
            let Ok(rel) = self.resolve_note_rel(&note.id) else { continue };
            let Ok(text) = fs::read_to_string(self.abs(&rel)) else { continue };
            // the whole file: frontmatter `links: [[…]]` count as links too
            link_targets(&text, &mut linked);
            texts.push((rel, note.title.clone(), text));
        }
        let mut report = AliasCleanupReport::default();
        for (rel, title, text) in texts {
            let Some(fm) = parse_document(&text).0 else { continue };
            let (leftovers, kept) =
                leftover_aliases(&alias_values(&fm), &title, &filename_stem(&rel), &linked);
            report.kept_linked += kept;
            if leftovers.is_empty() {
                continue;
            }
            if apply {
                // a read-only location keeps its aliases; everything else is
                // re-read under the file lock so a concurrent save isn't lost
                if self.writable(&rel).is_err() {
                    continue;
                }
                let path = self.abs(&rel);
                let removed = crate::fsutil::with_file_lock(&path, || {
                    let current = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                    let Some(next) = without_aliases(&current, &leftovers) else {
                        return Ok(false);
                    };
                    self.suppress.mark(&path);
                    super::atomic_write(&path, &next)?;
                    Ok(true)
                })?;
                if !removed {
                    continue;
                }
            }
            report.notes += 1;
            report.aliases += leftovers.len();
        }
        Ok(report)
    }
}

/// Settings → General → Leftover note names: count, or clean up, in the
/// default vault.
#[tauri::command]
pub fn corpus_alias_cleanup(
    state: tauri::State<'_, CorpusState>,
    apply: bool,
) -> Result<AliasCleanupReport, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| store.alias_cleanup(apply))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn placeholders_and_typing_trails_are_leftovers_and_real_names_are_not() {
        // the shape of the owner's own note, 2026-09-28
        let aliases: Vec<String> = [
            "Untitled",
            "untitled (4)",
            "Launch",
            "Launch plan",
            "launch-plan",
            "Launch plan -",
            "Q3 notes",
        ]
        .map(String::from)
        .to_vec();
        let (leftovers, kept) = leftover_aliases(
            &aliases,
            "Launch plan -  Q3 review",
            "launch-plan-q3-review",
            &HashSet::new(),
        );
        assert_eq!(
            leftovers,
            ["Untitled", "untitled (4)", "Launch", "Launch plan", "launch-plan", "Launch plan -"]
        );
        assert_eq!(kept, 0);
    }

    #[test]
    fn a_leftover_some_note_links_to_is_kept() {
        let aliases: Vec<String> = ["Round Three", "Untitled"].map(String::from).to_vec();
        let (leftovers, kept) =
            leftover_aliases(&aliases, "Round Three plan", "round-three-plan", &set(&["round three"]));
        assert_eq!(leftovers, ["Untitled"]);
        assert_eq!(kept, 1);
    }

    #[test]
    fn link_targets_read_labels_headings_and_embeds() {
        let mut targets = HashSet::new();
        link_targets("See [[Round Three|the plan]], [[Budget#Q3]] and ![[Chart]]. [[ ]]", &mut targets);
        assert_eq!(targets, set(&["round three", "budget", "chart"]));
    }

    #[test]
    fn rewriting_keeps_everything_but_the_leftovers() {
        let text = "---\nid: 01ABC\naliases: [\"Untitled\",\"Launch notes\"]\ntags: [a]\n---\n\n# Plan\n\nBody.\n";
        let next = without_aliases(text, &["Untitled".to_string()]).unwrap();
        assert!(next.contains("aliases: [\"Launch notes\"]"));
        assert!(next.contains("id: 01ABC") && next.contains("tags: [a]") && next.ends_with("# Plan\n\nBody.\n"));
        // the last one gone: the aliases line goes with it
        let bare = without_aliases(&next, &["Launch notes".to_string()]).unwrap();
        assert!(!bare.contains("aliases"));
        // nothing to remove: no rewrite
        assert_eq!(without_aliases(&bare, &["Untitled".to_string()]), None);
    }

    #[test]
    fn the_vault_pass_counts_first_then_cleans_and_keeps_linked_aliases() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().join("brain");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::write(
            root.join("memex.json"),
            "{\"id\":\"mx_alias\",\"contract\":\"3.4\",\"apps\":{}}",
        )
        .unwrap();
        for d in ["self", "chats", "archive", "trash"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        let plan = "---\nid: 01PLAN000000000000000000AA\naliases: [\"Untitled\",\"untitled (7)\",\"Round\",\"Round Three\"]\n---\n\n# Round Three plan\n\nBody.\n";
        let other = "---\nid: 01OTHER00000000000000000AA\n---\n\n# Other\n\nSee [[Round Three]].\n";
        fs::write(root.join("wiki/round-three-plan.md"), plan).unwrap();
        fs::write(root.join("wiki/other.md"), other).unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();

        let found = store.alias_cleanup(false).unwrap();
        assert_eq!(found, AliasCleanupReport { notes: 1, aliases: 3, kept_linked: 1 });
        // counting writes nothing
        assert_eq!(fs::read_to_string(root.join("wiki/round-three-plan.md")).unwrap(), plan);

        let cleaned = store.alias_cleanup(true).unwrap();
        assert_eq!(cleaned, found);
        let after = fs::read_to_string(root.join("wiki/round-three-plan.md")).unwrap();
        assert!(after.contains("aliases: [\"Round Three\"]"), "{after}");
        assert!(after.ends_with("# Round Three plan\n\nBody.\n"));
        // and a second run finds nothing left
        assert_eq!(store.alias_cleanup(false).unwrap(), AliasCleanupReport { notes: 0, aliases: 0, kept_linked: 1 });
    }
}
