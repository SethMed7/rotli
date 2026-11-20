//! The workspace's note listing (`rotli notes list`, MCP `rotli_list`): the
//! newest rows a remote agent may see, and the folders beside them.
//!
//! Gating a row is the expensive part — a file's whole bytes are read and
//! secret-scanned before even its name is shown — so it is proportional to
//! the answer, not to the vault. Rows are gated in the walk's order until the
//! limit is met. Past it, every row read as Markdown is still gated (its
//! shelf is read from its frontmatter), but a board or a file only when its
//! path alone could add a folder (the memex `Storage` destination) no gated
//! row has added yet. The
//! answer is the one gating every row would give: a vault's
//! `storage/` held thousands of files and the listing took minutes
//! (2026-11-20).

use super::*;
use std::collections::HashSet;

#[cfg(test)]
thread_local! {
    /// Rows gated by this thread's listings, for the proportionality test.
    pub(super) static ROWS_GATED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

impl Workspace {
    pub(super) fn list_remote(&mut self, limit: usize) -> Result<CorpusList, String> {
        let cap = limit.min(500);
        let notes = self.store.list()?.notes;
        // the folders a row adds nothing to: the walked directories, then the
        // backing chain of every row gated so far (`ensure_backing_folders`)
        let mut known: HashSet<String> = self.store.folders_for_ai(&[])?.into_iter().map(|folder| folder.id).collect();
        let mut kept = Vec::with_capacity(cap.min(notes.len()));
        let mut backing = Vec::new();
        for meta in notes {
            let shown = kept.len() < cap;
            // a row read as Markdown takes its folder from its frontmatter (a
            // shelf), which may have changed since the walk: past the limit,
            // only a folder read from a board's or a file's path is trusted
            let path_folder = meta.kind != NoteKind::Note && !crate::corpus::ai_rows::reads_as_markdown(&meta.id);
            if !shown && path_folder && adds_no_folder(&known, &meta.folder_id) {
                continue;
            }
            let Some(row) = self.remote_row(&meta) else {
                continue;
            };
            remember_chain(&mut known, &row.folder_id);
            if shown {
                kept.push(row);
            } else {
                backing.push(row);
            }
        }
        // directories, and the shelves of the rows an agent may see
        let gated: Vec<NoteMeta> = kept.iter().chain(&backing).cloned().collect();
        let folders = self.store.folders_for_ai(&gated)?;
        let folders = folders.into_iter().filter(|folder| self.store.agent_listable_folder(&folder.id)).collect::<Vec<_>>();
        Ok(CorpusList {
            notes: kept.into_iter().map(|meta| self.prefix_meta(meta)).collect(),
            folders: folders.into_iter().map(|folder| self.prefix_folder(folder)).collect(),
            // an agent's listing names no file the person's own notice names
            // (a hard-linked file's path may sit in a secure home)
            skipped: Vec::new(),
        })
    }

    /// The row a remote agent may see for a walked row: a note's from the one
    /// read the gate approved, a board's or a file's from its path, in its
    /// own lane. None when refused.
    pub(super) fn remote_row(&mut self, meta: &NoteMeta) -> Option<NoteMeta> {
        #[cfg(test)]
        ROWS_GATED.with(|count| count.set(count.get() + 1));
        match meta.kind {
            NoteKind::Note => self.store.note_row_for_ai(&meta.id, false),
            _ if self.remote_meta_visible(meta) => self.store.row_for_ai(&meta.id, false).map(|marked| marked.row),
            _ => None,
        }
    }
}

fn adds_no_folder(known: &HashSet<String>, folder_id: &str) -> bool {
    folder_id.is_empty() || known.contains(folder_id)
}

/// Mark `folder_id` and its ancestors known, as `ensure_backing_folders`
/// would synthesize them.
fn remember_chain(known: &mut HashSet<String>, folder_id: &str) {
    let mut path = folder_id;
    while !adds_no_folder(known, path) {
        known.insert(path.to_string());
        path = path.rsplit_once('/').map_or("", |(parent, _)| parent);
    }
}
