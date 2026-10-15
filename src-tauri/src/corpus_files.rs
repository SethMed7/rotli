//! Files that aren't notes (split from corpus.rs, 2026-10-06): a JSON Canvas
//! born beside notes, and how a file moves to Archive/Trash and back home.
//! Notes and boards keep their own lifecycle; a file's keeps its folder path
//! beneath the sink so restoring it needs no `.rotli/` state.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reaches
//! the store's private helpers.

use std::fs;
use std::path::Path;

use super::*;

/// A JSON Canvas file (`.canvas`, Obsidian's format) — a file, but one that
/// lives beside notes and moves to Archive/Trash like one (owner decisions
/// 2026-10-06).
pub(crate) fn is_canvas_path(rel: &str) -> bool {
    crate::feature_policy::canvas_enabled() && has_canvas_extension(rel)
}

fn has_canvas_extension(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    // a dotfile named ".canvas" has no extension, as Path reads it
    name.rsplit_once('.')
        .is_some_and(|(stem, ext)| !stem.is_empty() && ext.eq_ignore_ascii_case("canvas"))
}

/// A `.canvas` in a build whose canvases aren't live (the owner, 2026-10-15:
/// a public build listed one as an ordinary file and opened it as raw JSON).
/// The walk leaves it out, so it is in no listing, never seeded into Main,
/// and never opened; the file itself stays on disk untouched.
pub(crate) fn is_withheld_canvas(rel: &str) -> bool {
    withheld_canvas_for(crate::feature_policy::canvas_enabled(), rel)
}

fn withheld_canvas_for(canvases_enabled: bool, rel: &str) -> bool {
    !canvases_enabled && has_canvas_extension(rel)
}

/// What a new canvas file holds: an empty JSON Canvas, written the way
/// Obsidian writes one (src/jsonCanvas/model.ts serializeCanvas).
pub(crate) const EMPTY_CANVAS: &str = "{\n\t\"nodes\":[],\n\t\"edges\":[]\n}";

impl CorpusStore {
    /// A dropped `.excalidraw` file becomes a board (owner, 2026-10-13: "users
    /// should be able to just drop in excalidraw boards and they work"): its
    /// scene is checked like any board save, then COPIED into the board home —
    /// the board lane in a vault, `Board/` in a plain folder — named after the
    /// file. The source on disk is never touched. Returns the board's meta.
    pub fn import_board(&mut self, src: &Path) -> Result<NoteMeta, String> {
        super::raw::refuse_in_raw(self, "add files to")?;
        let is_board = src
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("excalidraw"));
        if !is_board {
            return Err("not an Excalidraw board".into());
        }
        let size = fs::metadata(src).map_err(|e| format!("read the board: {e}"))?.len();
        if size > crate::board::BOARD_MAX_BYTES as u64 {
            return Err("this board is larger than Rotli opens".into());
        }
        let body = fs::read_to_string(src).map_err(|e| format!("read the board: {e}"))?;
        let name = src
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|stem| !stem.trim().is_empty())
            .unwrap_or("Board");
        let home = self.layout.board_lane();
        self.create_named_board(&home, name, Some(&body))
    }

    /// Why a surfaced storage asset cannot enter Rotli's in-memex Archive/Trash
    /// (None = it can). Markdown and boards keep their own lifecycle.
    pub(super) fn storage_file_lifecycle_block(&self, rel: &str) -> Option<&'static str> {
        if self.mutation_allowed().is_err() {
            return Some("read-only vault");
        }
        // a folder opened in place keeps its files where they are: an image there
        // may be shared by many of the person's notes (owner rule 2026-10-13)
        if self.adopted {
            return Some("a folder opened in place keeps its files where they are");
        }
        if !self.guard_rel(rel).is_ok_and(|path| path.is_file()) {
            return Some("not a file");
        }
        let in_storage = rel.starts_with(&format!("{}/", self.layout.storage_dir()));
        let ext = Path::new(rel)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        let own_lifecycle = matches!(ext.as_deref(), Some("md" | "markdown" | "excalidraw"));
        // a canvas lives beside notes, so it moves from wherever it is
        let movable = in_storage || is_canvas_path(rel);
        (!movable || own_lifecycle).then_some("outside Rotli storage")
    }

    /// Move an existing storage asset into Archive/Trash while preserving its
    /// original relative path below that sink. The breadcrumb is therefore
    /// durable user-visible structure, not `.rotli/` state.
    pub fn move_file_to_sink(&mut self, rel: &str, sink: &str) -> Result<String, String> {
        super::raw::refuse_in_raw(self, "move or delete")?;
        validate_rel(rel)?;
        // the menu's labels, resolved to this vault's own sink (an imported
        // vault's Archive/ and Trash/ are the person's folders)
        let sink = match sink {
            "Archive" => self.layout.archive_id(),
            "Trash" => self.layout.trash_id(),
            other => return Err(format!("not a file lifecycle destination: {other}")),
        };
        if let Some(reason) = self.storage_file_lifecycle_block(rel) {
            return Err(format!("this file can't move ({reason}): {rel}"));
        }
        let abs = self.abs(rel);
        let name = Path::new(rel)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("file has no name: {rel}"))?;
        let disk_sink = lifecycle_disk_folder(self.layout, sink);
        let original_folder = folder_of(rel);
        let sink_folder = if original_folder.is_empty() {
            disk_sink
        } else {
            format!("{disk_sink}/{original_folder}")
        };
        validate_rel(&sink_folder)?;
        self.guard_rel(&sink_folder)?;
        fs::create_dir_all(self.abs(&sink_folder))
            .map_err(|e| format!("create {sink_folder}: {e}"))?;
        let target_rel = self.free_name(&sink_folder, &name, None);
        let target_abs = self.abs(&target_rel);
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        fs::rename(&abs, &target_abs).map_err(|e| format!("move {rel} to {sink}: {e}"))?;
        Ok(target_rel)
    }

    /// Restore a file from Archive/Trash to the storage path nested beneath the
    /// sink. Collisions are renamed safely; no restore overwrites another file.
    pub fn restore_file(&mut self, rel: &str) -> Result<String, String> {
        super::raw::refuse_in_raw(self, "move or delete")?;
        validate_rel(rel)?;
        self.mutation_allowed()?;
        self.guard_rel(rel)?;
        // either layout's sink spelling (Archive/ or a memex's archive/), or an
        // imported vault's own sinks
        let original_rel = [self.layout.archive_id(), self.layout.trash_id()]
            .iter()
            .flat_map(|sink| [Layout::LegacyRotli, Layout::Memex].map(|layout| lifecycle_disk_folder(layout, sink)))
            .find_map(|disk| rel.strip_prefix(disk.as_str())?.strip_prefix('/'))
            .ok_or_else(|| format!("file is not in Archive or Trash: {rel}"))?;
        let in_storage = original_rel.starts_with(&format!("{}/", self.layout.storage_dir()));
        // a BOARD restores by this lane too (2026-08-04): it is path-addressed
        // with no frontmatter origin, so the sink-relative path is its only way
        // home — and in LegacyRotli boards live in `Board/`, outside storage.
        let is_board = original_rel.ends_with(".excalidraw");
        if (!in_storage && !is_board && !is_canvas_path(original_rel)) || !self.abs(rel).is_file() {
            return Err(format!("file has no restorable storage origin: {rel}"));
        }
        let name = Path::new(original_rel)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("file has no name: {rel}"))?;
        let original_folder = folder_of(original_rel);
        self.guard_rel(&original_folder)?;
        fs::create_dir_all(self.abs(&original_folder))
            .map_err(|e| format!("create {original_folder}: {e}"))?;
        let target_rel = self.free_name(&original_folder, &name, None);
        let source_abs = self.abs(rel);
        let target_abs = self.abs(&target_rel);
        self.suppress.mark(&source_abs);
        self.suppress.mark(&target_abs);
        fs::rename(&source_abs, &target_abs).map_err(|e| format!("restore {rel}: {e}"))?;
        Ok(target_rel)
    }

    /// Create an empty JSON Canvas named `name` in `folder` — beside notes
    /// (owner decision 2026-10-06). A folder that isn't a writable note folder
    /// (a memex's hidden root Inbox, Storage, a reference lane) lands it where
    /// a new note would: the capture folder.
    pub fn create_canvas(&mut self, folder: &str, name: &str) -> Result<String, String> {
        super::raw::refuse_in_raw(self, "add files to")?;
        crate::feature_policy::require_canvas()?;
        self.mutation_allowed()?;
        // a typed "/" never makes a folder: it reads as "-" (Rotli Web's rule)
        let stem = name.trim().replace(['/', '\\'], "-");
        let stem = stem.trim();
        if stem.is_empty() {
            return Err("a canvas needs a name".into());
        }
        let file = format!("{stem}.canvas");
        validate_component(&file)?;
        let folder = canvas_home(self.layout == Layout::Memex, folder);
        self.new_file_bytes(folder, &file, EMPTY_CANVAS.as_bytes())
    }
}

/// Where a new canvas is written — the one rule the web twin shares
/// (folderCanvases.canvasHome; parity entry `canvasHome`): in a memex, under
/// wiki/ or else the capture folder; in a plain vault, the folder it was made
/// in, the root included — where a note made there lands.
pub(crate) fn canvas_home(memex: bool, folder: &str) -> &str {
    if memex && !(folder == "wiki" || folder.starts_with("wiki/")) {
        "wiki/_inbox"
    } else {
        folder
    }
}

/// Create an empty JSON Canvas beside notes; returns its root-qualified id.
#[tauri::command]
pub fn corpus_create_canvas(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    name: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&folder_id);
    let new_rel = state.route(&root, |s| s.create_canvas(&rel, &name))?;
    Ok(compose_root_id(&root, &new_rel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn only_a_build_without_canvases_withholds_a_canvas() {
        // stable: a .canvas is withheld, whatever its case; nothing else is
        assert!(withheld_canvas_for(false, "Plan.canvas"));
        assert!(withheld_canvas_for(false, "wiki/projects/Q3.CANVAS"));
        assert!(!withheld_canvas_for(false, "notes/canvas.md"));
        assert!(!withheld_canvas_for(false, "photo.png"));
        assert!(!withheld_canvas_for(false, "canvas"));
        // dev: nothing is withheld
        assert!(!withheld_canvas_for(true, "Plan.canvas"));
    }

    #[test]
    fn a_canvas_is_listed_and_seeded_into_main_only_when_canvases_are_live() {
        let (dir, mut store) = super::super::tests::bare();
        let root = dir.path().join("corpus");
        let canvas = "{\"nodes\":[],\"edges\":[]}";
        fs::write(root.join("Ideas.md"), "# Ideas\n").unwrap();
        fs::write(root.join("Plan.canvas"), canvas).unwrap();
        fs::write(root.join("photo.png"), b"png").unwrap();
        let _ = fs::remove_file(root.join(".rotli/main.json"));

        let ids: Vec<String> = store.list().unwrap().notes.into_iter().map(|note| note.id).collect();
        store.seed_main_from_disk_if_missing().unwrap();
        let main = fs::read_to_string(root.join(".rotli/main.json")).unwrap();

        let live = crate::feature_policy::canvas_enabled();
        assert_eq!(ids.iter().any(|id| id == "Plan.canvas"), live, "listed: {ids:?}");
        assert_eq!(main.contains("Plan.canvas"), live, "main: {main}");
        // other files list either way, and the canvas stays on disk as written
        assert!(ids.iter().any(|id| id == "photo.png"), "{ids:?}");
        assert!(main.contains("photo.png"), "{main}");
        assert_eq!(fs::read_to_string(root.join("Plan.canvas")).unwrap(), canvas);
    }

    #[test]
    fn a_dropped_excalidraw_file_becomes_an_editable_board_and_the_source_stays() {
        let dir = TempDir::new().unwrap();
        let outside = dir.path().join("Downloads");
        fs::create_dir_all(&outside).unwrap();
        // an excalidraw.com export: version, source, appState, files
        let scene = r##"{"type":"excalidraw","version":2,"source":"https://excalidraw.com","elements":[{"id":"a","type":"rectangle","x":10.5,"y":-3.25,"width":80,"height":40}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}"##;
        let src = outside.join("Team Map.excalidraw");
        fs::write(&src, scene).unwrap();

        let mut plain = CorpusStore::open(dir.path().join("notes")).unwrap();
        let board = plain.import_board(&src).unwrap();
        assert_eq!(board.kind, NoteKind::Board);
        assert!(board.id.starts_with("Board/"), "{}", board.id);
        assert_eq!(plain.read_board(&board.id).unwrap().body, scene);
        // it saves like any board
        plain.write_board(&board.id, scene).unwrap();
        // the dropped original is untouched, and a second drop doesn't overwrite
        assert_eq!(fs::read_to_string(&src).unwrap(), scene);
        let again = plain.import_board(&src).unwrap();
        assert_ne!(again.id, board.id);
    }

    #[test]
    fn a_dropped_board_lands_in_the_vault_board_lane_and_bad_files_are_refused() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("vault");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::write(root.join("memex.json"), "{\"id\":\"mx_dropboard1\",\"contract\":\"3.4\"}").unwrap();
        let mut vault = CorpusStore::open(root).unwrap();
        assert!(vault.is_memex());
        let src = dir.path().join("plan.excalidraw");
        fs::write(&src, EMPTY_EXCALIDRAW).unwrap();
        let board = vault.import_board(&src).unwrap();
        assert!(board.id.starts_with(&format!("{BOARD_LANE}/")), "{}", board.id);

        let not_a_board = dir.path().join("notes.txt");
        fs::write(&not_a_board, "hello").unwrap();
        assert!(vault.import_board(&not_a_board).is_err());
        let broken = dir.path().join("broken.excalidraw");
        fs::write(&broken, "{\"type\":\"something-else\"}").unwrap();
        assert!(vault.import_board(&broken).is_err(), "a scene that isn't a board is refused");
    }

    #[test]
    fn a_canvas_is_born_beside_notes_named_like_a_board_and_moves_like_a_note() {
        if !crate::feature_policy::canvas_enabled() {
            // the public binary refuses, and a .canvas is an ordinary file
            let (_dir, mut store) = super::super::tests::bare();
            assert!(store.create_canvas("", "Plan").is_err());
            assert!(!is_canvas_path("Plan.canvas"));
            return;
        }
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        super::super::tests::seed_memex(&root);
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        // in a note folder it lands right there, as an empty JSON Canvas
        let plan = store.create_canvas("wiki/projects", "Q3 plan").unwrap();
        assert_eq!(plan, "wiki/projects/Q3 plan.canvas");
        assert_eq!(fs::read_to_string(root.join(&plan)).unwrap(), EMPTY_CANVAS);
        // a second with the same name never overwrites the first
        assert_eq!(
            store.create_canvas("wiki/projects", "Q3 plan").unwrap(),
            "wiki/projects/Q3 plan-2.canvas"
        );
        // a folder that isn't a writable note folder lands it where a new note would
        assert_eq!(
            store.create_canvas("Inbox", "Loose").unwrap(),
            "wiki/_inbox/Loose.canvas"
        );
        assert!(store.create_canvas("wiki", "  ").is_err());
        // a typed "/" reads as "-", on the Mac as on the web
        assert_eq!(store.create_canvas("wiki", "Q3/plan").unwrap(), "wiki/Q3-plan.canvas");
        // only wiki/ holds a canvas in a memex; a chat folder doesn't
        assert_eq!(store.create_canvas("chats", "Stray").unwrap(), "wiki/_inbox/Stray.canvas");

        // listed as a file titled without its extension
        let listed = store.list().unwrap();
        let row = listed.notes.iter().find(|note| note.id == plan).unwrap();
        assert_eq!((row.title.as_str(), &row.kind), ("Q3 plan", &NoteKind::File));
        assert!(store.file_stat(&plan).unwrap().lifecycle_mutable);

        // Archive and Trash keep its folder path, and it comes back home
        let trashed = store.move_file_to_sink(&plan, "Trash").unwrap();
        assert_eq!(trashed, "trash/wiki/projects/Q3 plan.canvas");
        assert_eq!(store.restore_file(&trashed).unwrap(), plan);
        let archived = store.move_file_to_sink(&plan, "Archive").unwrap();
        assert_eq!(store.restore_file(&archived).unwrap(), plan);
        assert!(root.join(&plan).is_file());
    }

    #[test]
    fn storage_files_move_to_memex_sinks_and_restore_only_when_mutable() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        super::super::tests::seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let doc = store.create_managed_file("draft.docx", b"docx").unwrap();
        let stat = store.file_stat(&doc).unwrap();
        assert!(
            stat.writable,
            "DOCX files open in Rotli's local document editor"
        );
        assert!(
            stat.lifecycle_mutable,
            "managed files still need a lifecycle action"
        );
        let trashed = store.move_file_to_sink(&doc, "Trash").unwrap();
        assert!(!root.join(&doc).exists());
        assert_eq!(trashed, "trash/storage/rotli/draft.docx");
        assert!(root.join(&trashed).is_file());
        let listed = store.list().unwrap();
        assert!(
            listed.notes.iter().any(|note| {
                note.id == trashed
                    && note.folder_id == "Trash/storage/rotli"
                    && note.kind == NoteKind::File
            }),
            "trashed file was not surfaced: {:?}",
            listed.notes
        );
        assert_eq!(store.restore_file(&trashed).unwrap(), doc);
        assert!(root.join(&doc).is_file());

        let archived = store.move_file_to_sink(&doc, "Archive").unwrap();
        assert_eq!(archived, "archive/storage/rotli/draft.docx");
        assert_eq!(store.restore_file(&archived).unwrap(), doc);

        // the FILE lifecycle stays a storage-lane affair even though wiki/ is a
        // writable NOTE lane (2026-08-03): a binary parked in wiki/ is outside
        // Rotli storage, so the sink move still refuses it.
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(root.join("wiki/projects/reference.pdf"), b"keep").unwrap();
        assert!(store
            .move_file_to_sink("wiki/projects/reference.pdf", "Trash")
            .is_err());
        assert!(root.join("wiki/projects/reference.pdf").is_file());
        assert!(store.move_file_to_sink(&doc, "Somewhere").is_err());
    }

    #[test]
    fn file_stat_names_why_a_file_cannot_enter_archive_or_trash() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        super::super::tests::seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        let doc = store.create_managed_file("reasons.docx", b"docx").unwrap();
        assert_eq!(store.file_stat(&doc).unwrap().lifecycle_reason, None);
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(root.join("wiki/projects/reference.pdf"), b"keep").unwrap();
        let outside = store.file_stat("wiki/projects/reference.pdf").unwrap();
        assert!(!outside.lifecycle_mutable);
        assert_eq!(outside.lifecycle_reason.as_deref(), Some("outside Rotli storage"));
        store.set_perms_read_only(true);
        let locked = store.file_stat(&doc).unwrap();
        assert!(!locked.lifecycle_mutable);
        assert_eq!(locked.lifecycle_reason.as_deref(), Some("read-only vault"));
    }
}

/// Import a dropped `.excalidraw` file as a board in `root_id` (the native
/// drag event grants this exact source path once, as for any dropped file).
#[tauri::command]
pub fn corpus_import_board(
    state: tauri::State<'_, CorpusState>,
    authorizations: tauri::State<'_, ImportAuthorizations>,
    root_id: String,
    path: String,
) -> Result<NoteMeta, String> {
    let src = authorizations.consume(Path::new(&path))?;
    let meta = state.route(&root_id, |s| s.import_board(&src))?;
    Ok(NoteMeta { id: compose_root_id(&root_id, &meta.id), ..meta })
}
