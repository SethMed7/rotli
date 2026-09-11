//! The Welcome folder: the root welcome note plus nine Markdown lessons that
//! live in the vault as ordinary notes. Vault creation and Settings → Open
//! welcome folder both seed them through `seed_welcome`, which reuses intact
//! lessons by exact title and never overwrites a user's edits. The frontend
//! files the returned ids under a `Welcome` root folder in Main; nothing here
//! touches views. `src/assets/welcome.json` is the one catalog for the welcome
//! note body (entry 0, written by the memex scaffold) and the lessons.

use serde::Serialize;

use crate::corpus::{CorpusState, CorpusStore, DEFAULT_ROOT_ID};
use crate::memex::WELCOME_PRESET_FILE;

const DIR: &str = "wiki/Welcome";
/// Physical folder for lessons in a plain (non-memex) notes folder.
const FOLDER: &str = "Welcome";

#[derive(serde::Deserialize)]
struct Entry {
    filename: String,
    body: String,
}

static CATALOG: std::sync::LazyLock<Vec<Entry>> = std::sync::LazyLock::new(|| {
    let entries: Vec<Entry> = serde_json::from_str(include_str!("../../src/assets/welcome.json"))
        .expect("bundled welcome catalog must be valid");
    assert_eq!(
        entries.first().map(|e| e.filename.as_str()),
        Some(WELCOME_PRESET_FILE),
        "welcome catalog must start with the root welcome note"
    );
    entries
});

/// The root welcome note's Markdown, written by `scaffold_memex`.
pub fn welcome_body() -> &'static str {
    CATALOG[0].body.as_str()
}

fn lessons() -> &'static [Entry] {
    &CATALOG[1..]
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeSeed {
    /// True when at least one lesson file was written by this call.
    pub created: bool,
    /// Stable note ids in catalog order: the root welcome note first (when it
    /// still exists), then every lesson. Main files them under one folder.
    pub note_ids: Vec<String>,
}

/** Install the lessons into the active vault as ordinary notes and return the
 * ids to file in Main. Idempotent: an intact lesson is matched by exact title
 * inside the lesson folder and reused, so user edits are never overwritten and
 * a deleted lesson comes back on the next call. The root welcome note is never
 * recreated; a vault whose owner removed it simply seeds the lessons. */
pub fn seed_welcome(store: &mut CorpusStore) -> Result<WelcomeSeed, String> {
    let folder = if store.is_memex() { DIR } else { FOLDER };
    let mut listed = store.list()?;
    let mut created = false;
    let mut note_ids = Vec::with_capacity(CATALOG.len());
    let welcome_title = crate::corpus::title_of(welcome_body());
    if let Some(welcome) = listed
        .notes
        .iter()
        .find(|note| note.title == welcome_title && note.disk_folder_id.is_empty())
    {
        note_ids.push(welcome.id.clone());
    }
    for lesson in lessons() {
        let filename = lesson.filename.as_str();
        let body = lesson.body.as_str();
        let title = crate::corpus::title_of(body);
        let find = |list: &crate::corpus::CorpusList| {
            list.notes
                .iter()
                .find(|note| note.disk_folder_id == folder && note.title == title)
                .map(|note| note.id.clone())
        };
        let id = match find(&listed) {
            Some(id) => id,
            None => {
                // Plain Markdown files. Generic note creation adds Inbox shelf
                // metadata, which means Captures.
                store.new_file_bytes(folder, filename, body.as_bytes())?;
                created = true;
                listed = store.list()?;
                find(&listed).ok_or("seeded welcome lesson was not indexed")?
            }
        };
        note_ids.push(id);
    }
    Ok(WelcomeSeed { created, note_ids })
}

#[tauri::command]
pub fn corpus_seed_welcome(state: tauri::State<'_, CorpusState>) -> Result<WelcomeSeed, String> {
    state.route(DEFAULT_ROOT_ID, seed_welcome)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::memex::scaffold_memex;

    #[test]
    fn the_catalog_is_the_welcome_note_plus_nine_lessons_with_the_promoted_grammar() {
        assert_eq!(lessons().len(), 9);
        assert!(welcome_body().starts_with("# Welcome to Rotli\n"));
        assert!(welcome_body().contains("## Guided lessons"));
        let controls = &lessons()[2].body;
        assert!(controls.contains("- [#x] Medium"));
        assert!(controls.contains("- [##?] What belongs in the first release?"));
        assert!(controls.contains("- [True:green|x False:red] Ready to share"));
        assert!(controls.contains("- [:blue|:green] A color-only switch"));
        let tables = &lessons()[3].body;
        assert!(tables.starts_with("# Tables and code\n"));
        assert!(tables.contains("`[#]`"));
        for lesson in lessons() {
            assert!(!lesson.body.contains("Playground"), "{}", lesson.filename);
        }
    }

    #[test]
    fn seeding_files_the_welcome_note_first_then_stable_lesson_ids_and_restores_a_trashed_lesson() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        scaffold_memex(&root).unwrap();
        let mut store = CorpusStore::open(root).unwrap();

        let first = seed_welcome(&mut store).unwrap();
        assert!(first.created);
        assert_eq!(first.note_ids.len(), CATALOG.len());
        assert_eq!(
            first.note_ids.iter().collect::<std::collections::HashSet<_>>().len(),
            CATALOG.len()
        );
        let listed = store.list().unwrap();
        let welcome = listed.notes.iter().find(|n| n.id == first.note_ids[0]).unwrap();
        assert_eq!(welcome.title, "Welcome to Rotli");
        assert!(welcome.disk_folder_id.is_empty());
        assert_eq!(
            listed.notes.iter().filter(|n| n.disk_folder_id == DIR).count(),
            lessons().len()
        );
        assert!(listed
            .notes
            .iter()
            .filter(|note| note.disk_folder_id == DIR)
            .all(|note| note.folder_id == DIR));
        // seeding never writes a named view; Main files the ids on the frontend
        let views = store.views_read().unwrap();
        assert!(views.trim().is_empty() || views.trim() == "{}");

        let again = seed_welcome(&mut store).unwrap();
        assert!(!again.created);
        assert_eq!(again.note_ids, first.note_ids);
        assert_eq!(store.list().unwrap().notes.len(), listed.notes.len());

        // a lesson the user moved to Trash comes back as a fresh file; the
        // others keep their ids so Main's references stay valid
        let removed = store.root().join(DIR).join(&lessons()[2].filename);
        store.delete(&first.note_ids[3]).unwrap();
        assert!(!removed.exists());
        let restored = seed_welcome(&mut store).unwrap();
        assert!(restored.created);
        assert!(removed.exists());
        assert_eq!(restored.note_ids.len(), CATALOG.len());
        for (index, id) in first.note_ids.iter().enumerate() {
            if index == 3 {
                assert_ne!(&restored.note_ids[index], id);
            } else {
                assert_eq!(&restored.note_ids[index], id);
            }
        }
    }

    #[test]
    fn seeding_reuses_an_edited_lesson_by_title_and_survives_a_removed_welcome_note() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        scaffold_memex(&root).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        let edited = format!("{}\nMy tutorial edits.\n", lessons()[0].body);
        let rel = store
            .new_file_bytes(DIR, &lessons()[0].filename, edited.as_bytes())
            .unwrap();
        let welcome_id = store.wire_id_of(WELCOME_PRESET_FILE).unwrap();
        store.delete(&welcome_id).unwrap();
        let result = seed_welcome(&mut store).unwrap();
        assert!(result.created);
        assert_eq!(result.note_ids.len(), lessons().len());
        assert!(fs::read_to_string(store.root().join(rel))
            .unwrap()
            .contains("My tutorial edits."));
        assert_eq!(
            store
                .list()
                .unwrap()
                .notes
                .iter()
                .filter(|note| note.disk_folder_id == DIR)
                .count(),
            lessons().len()
        );
    }
}
