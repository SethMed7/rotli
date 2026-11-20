//! `rotli notes list` gated every row of the vault, reading each file's whole
//! bytes, before keeping the newest hundred: a vault with a large `storage/`
//! took minutes (2026-11-20). The listing now gates in proportion to its
//! answer, and the answer is unchanged.

use super::listing::ROWS_GATED;
use super::tests::test_workspace;
use super::*;
use std::time::{Duration, SystemTime};
use tempfile::TempDir;

const SECRET: &str = "key: sk-ant-api03-EXAMPLE0EXAMPLE0EXAM";

fn put(root: &Path, rel: &str, text: &str, age_days: u64) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, text).unwrap();
    let when = SystemTime::now() - Duration::from_secs(age_days * 86_400 + 60);
    fs::File::options().write(true).open(&path).unwrap().set_modified(when).unwrap();
}

fn note(id: &str, extra: &str, title: &str, body: &str) -> String {
    format!("---\nid: {id}\n{extra}---\n# {title}\n\n{body}\n")
}

/// A memex vault: recent wiki notes, older shelved and pinned notes, a
/// secret-shaped note and file, and a `storage/` of `storage_files` files
/// older than every note.
fn memex(temp: &TempDir, storage_files: usize) -> Workspace {
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_listing_fixture\"}\n").unwrap();
    for i in 0..6 {
        put(root, &format!("wiki/Projects/recent-{i}.md"), &note(&format!("01LIST{i:020}"), "", &format!("Recent {i}"), "plain"), i);
    }
    put(root, "wiki/Projects/shelved.md", &note("01LISTSHELVED00000000000000", "shelf: [wiki/Shelves/Payments]\n", "Shelved", "plain"), 30);
    put(root, "wiki/Areas/pinned.md", &note("01LISTPINNED000000000000000", "pinned: true\n", "Pinned", "plain"), 40);
    put(root, "wiki/Areas/token.md", &note("01LISTTOKEN0000000000000000", "", "Token", SECRET), 2);
    // walked as a file, read as Markdown (an id with no extension)
    put(root, "wiki/Projects/README", "# Readme\n\nplain\n", 45);
    // the newest storage file is secret-shaped: the next one still brings
    // the Storage folder when every storage row is past the limit
    put(root, "storage/inbox/secret.txt", SECRET, 50);
    put(root, "storage/inbox/near.csv", "task,status\nDraft,ready\n", 51);
    for i in 0..storage_files {
        put(root, &format!("storage/batch-{}/asset-{i}.csv", i % 4), "a,b\n1,2\n", 60 + i as u64);
    }
    test_workspace(temp)
}

/// The listing as it was: every row gated, then the folders of all of them,
/// then the limit.
fn listed_by_gating_every_row(ws: &mut Workspace, limit: usize) -> CorpusList {
    let mut kept = Vec::new();
    for meta in ws.store.list().unwrap().notes {
        let shown = match meta.kind {
            NoteKind::Note => ws.store.note_row_for_ai(&meta.id, false),
            _ if ws.remote_meta_visible(&meta) => ws.store.row_for_ai(&meta.id, false).map(|marked| marked.row),
            _ => None,
        };
        kept.extend(shown);
    }
    let folders: Vec<FolderMeta> =
        ws.store.folders_for_ai(&kept).unwrap().into_iter().filter(|folder| ws.store.agent_listable_folder(&folder.id)).collect();
    kept.truncate(limit.min(500));
    CorpusList {
        notes: kept.into_iter().map(|meta| ws.prefix_meta(meta)).collect(),
        folders: folders.into_iter().map(|folder| ws.prefix_folder(folder)).collect(),
        skipped: Vec::new(),
    }
}

fn json(list: &CorpusList) -> Value {
    serde_json::to_value(list).unwrap()
}

#[test]
fn listing_gates_rows_in_proportion_to_its_limit_not_to_the_vault() {
    let temp = TempDir::new().unwrap();
    let mut ws = memex(&temp, 200);
    ws.store.list().unwrap();
    ROWS_GATED.with(|count| count.set(0));
    let listed = ws.list_remote(3).unwrap();
    let gated = ROWS_GATED.with(|count| count.get());
    assert_eq!(listed.notes.len(), 3);
    // every note (nine), and the storage files up to the first visible one;
    // never the 200 older assets
    assert!(gated <= 12, "gated {gated} rows for a listing of 3");
}

#[test]
fn listing_returns_what_gating_every_row_returned() {
    let temp = TempDir::new().unwrap();
    let mut ws = memex(&temp, 40);
    for limit in [0, 1, 3, 8, 12, 600] {
        let expected = listed_by_gating_every_row(&mut ws, limit);
        let listed = ws.list_remote(limit).unwrap();
        assert_eq!(json(&listed), json(&expected), "limit {limit}");
    }
    let small = ws.list_remote(1).unwrap();
    let folder_ids: Vec<&str> = small.folders.iter().map(|folder| folder.id.as_str()).collect();
    // a shelf only a row past the limit names stays listed
    assert!(folder_ids.contains(&"wiki/Shelves/Payments"), "{folder_ids:?}");
    assert!(folder_ids.contains(&"wiki/Shelves"), "{folder_ids:?}");
    let all = ws.list_remote(600).unwrap();
    assert!(all.notes.first().is_some_and(|meta| meta.title == "Pinned"), "{:?}", all.notes.first());
    assert!(all.notes.iter().any(|meta| meta.title == "near.csv"));
    assert!(!all.notes.iter().any(|meta| meta.title == "Token" || meta.title == "secret.txt"));
    // Codex review of pull request 302, #1: a shelf is read from frontmatter,
    // so a note past the limit that moved shelf since the walk still brings
    // its new folder, as gating every row did
    let moved = note("01LIST00000000000000000005", "shelf: [wiki/New/Shelf]\n", "Recent 5", "plain");
    put(temp.path(), "wiki/Projects/recent-5.md", &moved, 5);
    // Codex re-check, #2: an extensionless file is walked as a file but read
    // as Markdown, so its shelf comes from its frontmatter too
    put(temp.path(), "wiki/Projects/README", "---\nshelf: [wiki/Readme/Shelf]\n---\n# Readme\n\nplain\n", 45);
    for limit in [0, 1, 3, 600] {
        let expected = listed_by_gating_every_row(&mut ws, limit);
        let listed = ws.list_remote(limit).unwrap();
        assert_eq!(json(&listed), json(&expected), "after the edit, limit {limit}");
        let ids: Vec<&str> = listed.folders.iter().map(|folder| folder.id.as_str()).collect();
        assert!(ids.contains(&"wiki/New/Shelf") && ids.contains(&"wiki/New"), "limit {limit}: {ids:?}");
        assert!(ids.contains(&"wiki/Readme/Shelf"), "limit {limit}: {ids:?}");
    }
}

/// Codex review of pull request 302, #2 (older than the pull request): a
/// directory inside a secure home was listed to agents by name, even with
/// no rows asked for, while every note in it stayed hidden.
#[test]
fn no_folder_inside_a_secure_home_is_listed_to_agents() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_listing_fixture\"}\n").unwrap();
    put(root, "wiki/Projects/open.md", &note("01LISTOPEN00000000000000000", "", "Open", "plain"), 1);
    put(root, "wiki/_secure/PrivateFolder/kept.md", &note("01LISTKEPT00000000000000000", "", "Kept", "plain"), 2);
    // Codex re-check, #1: a `:` in the name read as a vault prefix, and a
    // public note whose id is the folder's path redirected the check to itself
    put(root, "wiki/_secure/PrivateProject:/kept.md", &note("01LISTCOLON0000000000000000", "", "Kept", "plain"), 3);
    put(root, "wiki/_secure/PrivateProject/kept.md", &note("01LISTALIAS0000000000000000", "", "Kept", "plain"), 3);
    put(root, "wiki/Projects/decoy.md", &note("wiki/_secure/PrivateProject", "", "Decoy", "plain"), 4);
    let mut ws = test_workspace(&temp);
    for limit in [0, 100] {
        let listed = ws.list_remote(limit).unwrap();
        let ids: Vec<&str> = listed.folders.iter().map(|folder| folder.id.as_str()).collect();
        assert!(ids.contains(&"wiki/Projects"), "{ids:?}");
        assert!(!ids.iter().any(|id| id.contains("_secure") || id.contains("Private")), "limit {limit}: {ids:?}");
        assert!(!listed.notes.iter().any(|meta| meta.title == "Kept"));
    }
}

/// Codex re-check, #4: a folder is frontmatter-free, so its name gets the
/// protection a file's name gets: the vault's secure keywords. Nothing under
/// it is read to decide.
#[test]
fn a_folder_named_with_a_secure_keyword_is_not_listed_to_agents() {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_listing_fixture\"}\n").unwrap();
    put(root, ".rotli/settings.json", "{\"librarianRules\":{\"secureKeywords\":[\"Juniper\"]}}\n", 1);
    put(root, "wiki/Projects/open.md", &note("01LISTOPEN00000000000000000", "", "Open", "plain"), 1);
    put(root, "wiki/Matter Juniper/brief.md", &note("01LISTBRIEF0000000000000000", "", "Brief", SECRET), 2);
    let mut ws = test_workspace(&temp);
    let listed = ws.list_remote(0).unwrap();
    let ids: Vec<&str> = listed.folders.iter().map(|folder| folder.id.as_str()).collect();
    assert!(ids.contains(&"wiki/Projects"), "{ids:?}");
    assert!(!ids.iter().any(|id| id.contains("Juniper")), "{ids:?}");
}

/// Codex re-check, #3 (older than pull request 302): metrics counted the
/// shelf of a note no agent may read as a physical folder.
#[test]
fn metrics_count_no_folder_from_a_refused_note() {
    let vault = |refused: bool| {
        let temp = TempDir::new().unwrap();
        let root = temp.path();
        fs::write(root.join("memex.json"), "{\"id\":\"mx_listing_fixture\"}\n").unwrap();
        put(root, "wiki/Projects/open.md", &note("01LISTOPEN00000000000000000", "", "Open", "plain"), 1);
        if refused {
            let token = note("01LISTTOKEN0000000000000000", "shelf: [wiki/Unshared/Private]\n", "Token", SECRET);
            put(root, "wiki/Projects/token.md", &token, 2);
        }
        let mut ws = test_workspace(&temp);
        let metrics = ws.metrics().unwrap();
        (metrics.physical_folders, metrics.visible_notes)
    };
    assert_eq!(vault(true), vault(false));
}
