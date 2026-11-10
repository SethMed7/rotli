//! The rows an AI lane may show (split out of corpus.rs, 2026-11-09): a search
//! hit, a listing row, and the folders beside them, built from ONE read the AI
//! gate approved and from nothing else.
//!
//! Structural on purpose (second review, 2026-11-09): the first version took
//! the walk cache's row and replaced the fields it thought of, so a field it
//! didn't (the shelf behind `folderId`, the dates) still carried an older,
//! secure version out. Nothing here takes a cached `NoteMeta` or `SearchHit`:
//! the only input is an id, every row is built by the walk's own builders
//! (`note_row`, `reference_row`) from the `Approved` snapshot, and a source
//! test keeps it that way (`no_cached_row_reaches_an_ai_row`).

use std::ops::{Deref, DerefMut};
use std::path::PathBuf;

use super::{
    corpus_list_inner, split_root_id, CorpusState, NoteKind, DEFAULT_ROOT_ID,
    board_row, editor_body, ensure_backing_folders, file_row, leading_snippet, note_row,
    parse_document, reference_row, search_match, searchable_metadata, surfaced, CorpusStore,
    CorpusAiRead, FolderMeta, NoteMeta, SearchHit, SearchMatch, Surface,
};

/// A row as an AI lane shows it, and whether the gate approved it only
/// because the reader is on-device: the same bytes would be refused to a
/// remote model (fourth review of pull request 267). The app carries that
/// fact into a conversation, which then never continues on a remote model.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRow<T> {
    #[serde(flatten)]
    pub row: T,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub on_device_only: bool,
}

impl<T> Deref for AiRow<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.row
    }
}

impl<T> DerefMut for AiRow<T> {
    fn deref_mut(&mut self) -> &mut T {
        &mut self.row
    }
}

/// One note's text exactly as the AI read gate approved it, and where it
/// lives. Only `CorpusStore::approved` makes one.
struct Approved {
    id: String,
    rel: String,
    abs: PathBuf,
    text: String,
    on_device_only: bool,
}

/// The row and the parsed parts of an approved snapshot.
struct Parsed {
    row: NoteMeta,
    body: String,
    metadata: String,
}

impl CorpusStore {
    fn approved(&mut self, id: &str, model_is_local: bool) -> Option<Approved> {
        let text = self.read_for_ai(id, model_is_local).ok()?;
        let rel = self.resolve_note_rel(id).ok()?;
        let abs = self.guard_rel(&rel).ok()?;
        let on_device_only = self.only_on_device(&rel, &text, model_is_local);
        Some(Approved { id: id.to_string(), rel, abs, text, on_device_only })
    }

    /// Did the gate pass `text` only because the reader is on-device? The
    /// same judgement a remote reader gets, on the same bytes.
    pub(crate) fn only_on_device(&mut self, rel: &str, text: &str, model_is_local: bool) -> bool {
        model_is_local && self.judge_for_ai(rel, text, false).is_err()
    }

    fn parse_approved(&self, snapshot: Approved) -> Parsed {
        let (fm, raw) = parse_document(&snapshot.text);
        let had_fm = fm.is_some();
        let body = if had_fm { editor_body(raw) } else { raw };
        let fm = fm.unwrap_or_default();
        let row = if surfaced(self.layout, &snapshot.rel) == Surface::Reference {
            reference_row(&snapshot.rel, &snapshot.abs, &fm, body)
        } else {
            note_row(self.layout, snapshot.id, &snapshot.rel, &snapshot.abs, &fm, body)
        };
        let metadata = if had_fm { searchable_metadata(&fm) } else { String::new() };
        Parsed { row, body: body.to_string(), metadata }
    }

    /// The listing row an AI lane may show for `id`, in its own lane: a
    /// Markdown note from one approved read; a board or any other file from
    /// its path alone, once the AI file policy allows it (the bytes are read
    /// later, through `read_file_bytes_for_ai`). None when refused.
    pub(crate) fn row_for_ai(&mut self, id: &str, model_is_local: bool) -> Option<AiRow<NoteMeta>> {
        if id.to_ascii_lowercase().ends_with(".md") || !id.contains('.') {
            return self.note_ai_row(id, model_is_local);
        }
        let abs = self.file_for_ai(id, model_is_local).ok()?;
        if !std::fs::symlink_metadata(&abs).is_ok_and(|m| crate::fsutil::has_one_name(&m)) {
            return None;
        }
        let (prefix, name) = id.rsplit_once('/').unwrap_or(("", id));
        if id.to_ascii_lowercase().ends_with(".excalidraw") {
            // a board's scene is judged like a note's text (a secret-shaped
            // scene keeps even its name from a remote model)
            let scene = crate::fsutil::read_own_text(&abs).ok()?;
            self.judge_for_ai(id, &scene, model_is_local).ok()?;
            let on_device_only = self.only_on_device(id, &scene, model_is_local);
            return Some(AiRow { row: board_row(id, prefix, &abs), on_device_only });
        }
        let on_device_only = model_is_local && self.file_is_protected(id);
        Some(AiRow { row: file_row(self.layout, id, name.to_string(), prefix, &abs), on_device_only })
    }

    /// The listing row an AI lane may show for note `id`, or None when the
    /// gate refuses it.
    pub(crate) fn note_row_for_ai(&mut self, id: &str, model_is_local: bool) -> Option<NoteMeta> {
        self.note_ai_row(id, model_is_local).map(|marked| marked.row)
    }

    /// `note_row_for_ai`, with whether only an on-device reader may see it.
    pub(crate) fn note_ai_row(&mut self, id: &str, model_is_local: bool) -> Option<AiRow<NoteMeta>> {
        let snapshot = self.approved(id, model_is_local)?;
        let on_device_only = snapshot.on_device_only;
        Some(AiRow { row: self.parse_approved(snapshot).row, on_device_only })
    }

    /// Note `id`'s row and the very text the gate approved, from one read
    /// (a query matches on the text and shows the row: two reads let them
    /// disagree; third review, 2026-11-09).
    pub(crate) fn note_for_ai(&mut self, id: &str, model_is_local: bool) -> Option<(NoteMeta, String)> {
        let snapshot = self.approved(id, model_is_local)?;
        let text = snapshot.text.clone();
        Some((self.parse_approved(snapshot).row, text))
    }

    /// The search hit an AI lane may show for note `id` and `query`. A note the
    /// approved bytes no longer match is dropped; a fuzzy (typo-tolerant) hit
    /// stays only when the index saw exactly these bytes, so a search can't
    /// confirm a word a secure version once held.
    pub(crate) fn search_row_for_ai(&mut self, query: &str, id: &str, model_is_local: bool) -> Option<AiRow<SearchHit>> {
        let snapshot = self.approved(id, model_is_local)?;
        let on_device_only = snapshot.on_device_only;
        let Parsed { row, body, metadata } = self.parse_approved(snapshot);
        let aliases = row.aliases.join("\n");
        let found = search_match(query, &row.title, &body, &row.snippet)
            .or_else(|| search_match(query, &row.title, &metadata, &row.snippet))
            .or_else(|| search_match(query, &row.title, &aliases, &row.snippet));
        let m = match found {
            Some(m) => m,
            None => {
                let indexed = self.list_cache.as_ref().and_then(|cache| cache.texts.get(id));
                if !indexed.is_some_and(|cached| cached.body == body && cached.metadata == metadata) {
                    return None;
                }
                SearchMatch {
                    rank: crate::search_match::RANK_FUZZY,
                    snippet: leading_snippet(&body),
                    match_start: 0,
                    match_len: 0,
                    spans: Vec::new(),
                }
            }
        };
        let row = SearchHit {
            id: row.id,
            title: row.title,
            folder_id: row.folder_id,
            kind: row.kind,
            rank: m.rank,
            snippet: m.snippet,
            match_start: m.match_start,
            match_len: m.match_len,
            spans: m.spans,
            updated_at: row.updated_at,
        };
        Some(AiRow { row, on_device_only })
    }

    /// The folder rows an AI lane may show beside `rows`: the vault's walked
    /// directories, and the shelves of exactly these rows. A shelf comes from
    /// a note's content, so one synthesized from a note the lane may not see
    /// (or from its older, secure version) never appears.
    pub(crate) fn folders_for_ai(&mut self, rows: &[NoteMeta]) -> Result<Vec<FolderMeta>, String> {
        self.ensure_walked()?;
        let mut folders = self.list_cache.as_ref().map(|cache| cache.dir_folders.clone()).unwrap_or_default();
        ensure_backing_folders(&mut folders, rows);
        folders.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(folders)
    }
}

/// The files (not notes, not boards) a model may name, each from its path in
/// the AI file lane: what the chat's file tools resolve a name against. The
/// person's own listing showed a model the names of files in a secure home
/// (third review, 2026-11-09). No file is read here.
#[tauri::command]
pub fn corpus_files_ai(
    state: tauri::State<'_, CorpusState>,
    model_id: String,
    endpoint: String,
) -> Result<Vec<AiRow<NoteMeta>>, String> {
    files_ai_inner(&state, crate::chat::model_is_local(&model_id, &endpoint))
}

pub(crate) fn files_ai_inner(state: &CorpusState, model_is_local: bool) -> Result<Vec<AiRow<NoteMeta>>, String> {
    let mut permitted = Vec::new();
    for meta in corpus_list_inner(state, false)?.notes.into_iter().filter(|m| m.kind == NoteKind::File) {
        let (root, rel) = split_root_id(&meta.id);
        if let Ok(Some(mut shown)) = state.route(&root, |s| Ok(s.row_for_ai(&rel, model_is_local))) {
            shown.id = meta.id;
            permitted.push(shown);
        }
    }
    Ok(permitted)
}

/// What the Librarian's prompt is built from, besides the open note: the
/// vault's directories (its areas; walked folders only, no shelf synthesized
/// from a note) and its People notes, each row from one approved read.
#[derive(serde::Serialize)]
pub struct LibrarianListing {
    pub(crate) folders: Vec<FolderMeta>,
    pub(crate) people: Vec<AiRow<NoteMeta>>,
}

/// Is `folder` wiki/People or under it (any case), as librarianPeople.ts
/// `peopleNotes` reads it?
fn in_people(folder: &str) -> bool {
    let lower = folder.to_ascii_lowercase();
    lower == "wiki/people" || lower.starts_with("wiki/people/")
}

impl CorpusStore {
    /// Proportional on purpose (third review, 2026-11-09): the People list
    /// had come from the whole gated listing, every note read on every send.
    /// Only the notes the walk last saw under wiki/People are read now, each
    /// through the gate for this model; a note moved there since the walk is
    /// simply not listed yet.
    pub(crate) fn librarian_listing(&mut self, model_is_local: bool) -> Result<LibrarianListing, String> {
        self.ensure_walked()?;
        let cache = self.list_cache.as_ref().expect("ensure_walked fills the cache");
        let folders = cache.dir_folders.clone();
        let candidates: Vec<String> = cache
            .list
            .notes
            .iter()
            .filter(|m| m.kind == NoteKind::Note && in_people(&m.disk_folder_id))
            .map(|m| m.id.clone())
            .collect();
        // secure People never reach the Librarian, on-device or remote (sixth
        // review of pull request 267): listing People must not mark a
        // conversation that then can't write anything
        let people = candidates
            .iter()
            .filter_map(|id| self.note_ai_row(id, model_is_local))
            .filter(|row| !row.on_device_only)
            .collect();
        Ok(LibrarianListing { folders, people })
    }
}

/// The Librarian's areas and People notes for one model (the vault's own
/// root; a connected brain has no People list of its own here).
#[tauri::command]
pub async fn corpus_librarian_ai(
    app: tauri::AppHandle,
    model_id: String,
    endpoint: String,
) -> Result<LibrarianListing, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        librarian_ai_inner(&state, model_is_local)
    })
    .await
    .map_err(|e| format!("librarian listing worker failed ({e})"))?
}

pub(crate) fn librarian_ai_inner(state: &CorpusState, model_is_local: bool) -> Result<LibrarianListing, String> {
    state.route(DEFAULT_ROOT_ID, |store| store.librarian_listing(model_is_local))
}

/// `corpus_read_ai`'s work: the gate's read of one note for a model, with
/// its revision, the editor's copy when asked for, and whether the gate passed
/// it only because the reader is on-device (fourth review of pull request 267).
pub(crate) fn read_ai_versioned(
    store: &mut CorpusStore,
    rel: &str,
    model_is_local: bool,
    with_editor: bool,
) -> Result<CorpusAiRead, String> {
    let body = store.read_for_ai(rel, model_is_local)?;
    let path = store.resolve_note_rel(rel)?;
    let on_device_only = store.only_on_device(&path, &body, model_is_local);
    Ok(CorpusAiRead {
        revision: crate::fsutil::revision(body.as_bytes()),
        editor: with_editor.then(|| super::ai_journal::editor_text(&body).to_string()),
        body,
        on_device_only,
    })
}
