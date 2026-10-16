//! Settings → General → Link format (owner decisions 2026-10-13): rewrite the
//! Rotli-only links older notes carry into the forms every Markdown app reads.
//! A `storage:` link becomes a standard path from the note's folder (what a
//! new image gets, `noteImageLink` in src/editor/imageSource.ts), and a whole
//! ```board / ```sheet / ```document fence becomes Obsidian's `![[path]]`.
//! The person previews the counts and a few examples first; nothing changes
//! until they apply. Only a Rotli vault is converted — a folder opened in
//! place keeps every link as the person wrote it.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses
//! the store's own gates and document helpers.

use std::fs;

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;

use super::{folder_of, raw_frontmatter_block, CorpusStore, NoteKind};

/// `encodeURIComponent`'s unreserved set, minus `(` and `)`, which would end a
/// Markdown link early: the escaping `noteImageLink` uses.
const LINK_SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'');

/// The Markdown path from a note's folder to a vault file — the twin of
/// `noteImageLink` (parity fixture `noteImageLink`). A `root:` prefix is dropped.
pub(crate) fn note_image_link(wire: &str, folder: &str) -> String {
    let rel = match wire.split_once(':') {
        Some((root, rest)) if !root.is_empty() && !root.contains('/') && !rest.starts_with('/') => rest,
        _ => wire,
    };
    link_from(folder, rel)
}

/// The encoded Markdown path from `folder` to the vault file `rel`.
pub(crate) fn link_from(folder: &str, rel: &str) -> String {
    let target: Vec<&str> = rel.split('/').filter(|part| !part.is_empty()).collect();
    let from: Vec<&str> = folder.split('/').filter(|part| !part.is_empty()).collect();
    let mut shared = 0;
    while shared < from.len() && shared + 1 < target.len() && from[shared] == target[shared] {
        shared += 1;
    }
    let mut parts: Vec<String> = from[shared..].iter().map(|_| "..".to_string()).collect();
    parts.extend(target[shared..].iter().map(|part| utf8_percent_encode(part, LINK_SEGMENT).to_string()));
    parts.join("/")
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkConvertExample {
    pub title: String,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkConvertReport {
    /// Notes with at least one link to convert (or converted, when applied).
    pub notes: usize,
    /// `storage:` links found (or rewritten).
    pub links: usize,
    /// Embed fences found (or rewritten).
    pub embeds: usize,
    /// A few before → after lines for the preview.
    pub examples: Vec<LinkConvertExample>,
}

const EMBED_LANGS: [&str; 3] = ["board", "sheet", "document"];

/// One line's `](storage:X)` links rewritten (outside inline code), with how
/// many changed. `actual` maps a `storage/…` path to the file's real casing.
fn convert_line(line: &str, folder: &str, actual: &dyn Fn(&str) -> String) -> (String, usize) {
    let mut out = String::with_capacity(line.len());
    let mut changed = 0;
    let mut rest = line;
    while let Some(at) = rest.find("](storage:") {
        let before = &rest[..at];
        let in_code = (out.matches('`').count() + before.matches('`').count()) % 2 == 1;
        let after = &rest[at + "](storage:".len()..];
        let Some(end) = after.find(')') else { break };
        out.push_str(before);
        if in_code {
            out.push_str("](storage:");
            rest = after;
            continue;
        }
        let name = &after[..end];
        let decoded = percent_encoding::percent_decode_str(name).decode_utf8_lossy().into_owned();
        let rel = actual(&format!("storage/{decoded}"));
        out.push_str("](");
        out.push_str(&note_image_link(&rel, folder));
        out.push(')');
        changed += 1;
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    (out, changed)
}

/// A note body's Rotli-only links rewritten: `](storage:X)` → a path from the
/// note's folder, and a whole embed fence → `![[path]]`. Every other fenced
/// block is left as it is. Returns the body and the (links, embeds) counts.
pub(crate) fn convert_body(body: &str, folder: &str, actual: &dyn Fn(&str) -> String) -> (String, usize, usize) {
    let lines: Vec<&str> = body.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let (mut links, mut embeds) = (0, 0);
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fence = &trimmed[..3];
            let lang = trimmed[3..].trim();
            // a whole embed fence: open, one id line, close
            if EMBED_LANGS.contains(&lang)
                && i + 2 < lines.len()
                && lines[i + 2].trim() == fence
                && !lines[i + 1].trim().is_empty()
            {
                let id = lines[i + 1].trim();
                let rel = match id.split_once(':') {
                    Some((root, rest)) if !root.contains('/') => rest,
                    _ => id,
                };
                out.push(format!("{}![[{rel}]]", &line[..line.len() - trimmed.len()]));
                embeds += 1;
                i += 3;
                continue;
            }
            // any other fenced block stays exactly as written
            out.push(line.to_string());
            i += 1;
            while i < lines.len() {
                out.push(lines[i].to_string());
                let closes = lines[i].trim_start().starts_with(fence);
                i += 1;
                if closes {
                    break;
                }
            }
            continue;
        }
        let (next, changed) = convert_line(line, folder, actual);
        links += changed;
        out.push(next);
        i += 1;
    }
    (out.join("\n"), links, embeds)
}

fn first_change(before: &str, after: &str) -> Option<(String, String)> {
    before
        .lines()
        .zip(after.lines())
        .find(|(a, b)| a != b)
        .map(|(a, b)| (a.trim().to_string(), b.trim().to_string()))
}

impl CorpusStore {
    /// Count (and with `apply`, rewrite) the Rotli-only links across the vault.
    pub fn convert_links(&mut self, apply: bool) -> Result<LinkConvertReport, String> {
        if self.adopted {
            return Err("A folder opened in place keeps every link as you wrote it.".into());
        }
        if apply {
            self.mutation_allowed()?;
        }
        let notes = self.list()?.notes;
        let mut report = LinkConvertReport::default();
        for note in notes.iter().filter(|note| note.kind == NoteKind::Note) {
            let Ok(rel) = self.resolve_note_rel(&note.id) else { continue };
            let path = self.abs(&rel);
            let Ok(text) = fs::read_to_string(&path) else { continue };
            let folder = folder_of(&rel);
            let actual = |storage_rel: &str| self.actual_storage_rel(storage_rel);
            let block = raw_frontmatter_block(&text);
            let (body, links, embeds) = convert_body(&text[block.len()..], &folder, &actual);
            if links + embeds == 0 {
                continue;
            }
            let example = first_change(&text[block.len()..], &body);
            let rewrite = |store: &Self, current: &str| {
                let block = raw_frontmatter_block(current);
                let actual = |storage_rel: &str| store.actual_storage_rel(storage_rel);
                let (body, links, embeds) = convert_body(&current[block.len()..], &folder, &actual);
                (links + embeds > 0).then(|| format!("{block}{body}"))
            };
            // a read-only location keeps its links (rewrite_note_locked)
            if apply && !self.rewrite_note_locked(&rel, rewrite)? {
                continue;
            }
            report.notes += 1;
            report.links += links;
            report.embeds += embeds;
            if let (Some((before, after)), true) = (example, report.examples.len() < 5) {
                report.examples.push(LinkConvertExample { title: note.title.clone(), before, after });
            }
        }
        Ok(report)
    }

    /// A `storage/…` path with the casing the file actually has: a plain Rotli
    /// folder keeps its files in `Storage/`, which a lowercase link reaches only
    /// on a disk that ignores case.
    fn actual_storage_rel(&self, storage_rel: &str) -> String {
        if self.abs(storage_rel).exists() {
            return storage_rel.to_string();
        }
        let capital = format!("Storage{}", &storage_rel["storage".len()..]);
        if self.abs(&capital).exists() {
            capital
        } else {
            storage_rel.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn same(rel: &str) -> String {
        rel.to_string()
    }

    #[test]
    fn storage_links_become_paths_from_the_note_and_fences_become_embeds() {
        let body = "# Plan\n![Shot|300](storage:images/a%20b.png) and [spec](storage:docs/spec.pdf)\n```sheet\nstorage/rotli/budget.xlsx\n```\n```board\nwork:storage/excalidraw/map.excalidraw\n```\n";
        let (out, links, embeds) = convert_body(body, "wiki/_inbox", &same);
        assert_eq!(
            out,
            "# Plan\n![Shot|300](../../storage/images/a%20b.png) and [spec](../../storage/docs/spec.pdf)\n![[storage/rotli/budget.xlsx]]\n![[storage/excalidraw/map.excalidraw]]\n"
        );
        assert_eq!((links, embeds), (2, 2));
    }

    #[test]
    fn code_stays_exactly_as_written() {
        let body = "`![x](storage:a.png)` stays\n```md\n![x](storage:a.png)\n```sheet\n```\n~~~\n```board\nx\n```\n~~~\n";
        let (out, links, embeds) = convert_body(body, "", &same);
        assert_eq!(out, body);
        assert_eq!((links, embeds), (0, 0));
    }

    #[test]
    fn a_plain_rotli_folder_links_its_capital_storage_folder() {
        let actual = |rel: &str| format!("S{}", &rel[1..]);
        let (out, _, _) = convert_body("![](storage:x.png)", "Notes", &actual);
        assert_eq!(out, "![](../Storage/x.png)");
    }

    #[test]
    fn the_pass_previews_then_rewrites_and_keeps_frontmatter_bytes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("rotli-notes");
        let mut store = CorpusStore::open(root.clone()).unwrap();
        let note = store.create("Inbox", "# Trip\n\n![](storage:images/beach.png)\n").unwrap();
        let rel = store.resolve_note_rel(&note.id).unwrap();
        let before = fs::read_to_string(root.join(&rel)).unwrap();

        let preview = store.convert_links(false).unwrap();
        assert_eq!((preview.notes, preview.links, preview.embeds), (1, 1, 0));
        assert_eq!(preview.examples[0].after, "![](../storage/images/beach.png)");
        assert_eq!(fs::read_to_string(root.join(&rel)).unwrap(), before, "a preview writes nothing");

        let done = store.convert_links(true).unwrap();
        assert_eq!((done.notes, done.links), (1, 1));
        let after = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(after.contains("![](../storage/images/beach.png)"), "{after}");
        let block = raw_frontmatter_block(&before);
        assert!(after.starts_with(block), "frontmatter bytes kept");
        assert_eq!(store.convert_links(false).unwrap().notes, 0, "nothing left to convert");
    }

    #[test]
    fn a_folder_opened_in_place_is_never_converted() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("obsidian-vault");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.md"), "![](storage:x.png)\n").unwrap();
        let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
        assert!(store.convert_links(true).unwrap_err().contains("opened in place"));
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "![](storage:x.png)\n");
    }
}
