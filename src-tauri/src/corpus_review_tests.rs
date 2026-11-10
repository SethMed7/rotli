//! Regression tests for the 2026-11-09 review findings that reached shipped
//! features: AI lanes shown unjudged bytes (#1), hard-linked notes (#4), and
//! an agent move after a lock (#5).

use super::tests::bare;
use tempfile::TempDir;
use super::*;

/// Finding #1's fixture: a public note, and the secure version of it the walk
/// cached, which holds a canary that must never reach an AI lane.
pub(crate) const HARBOR_TITLE: &str = "Harbor plan";
pub(crate) const HARBOR_BODY: &str = "harbor opens at nine";
pub(crate) const CANARY: &str = "canary-7Q4";

/// Finding #4's fixture: a Markdown file outside the vault that a hard link
/// inside it must never expose.
pub(crate) const OUTSIDE_NOTE: &str = "# Ledger\n\nwords from beyond the vault\n";
pub(crate) const OUTSIDE_WORDS: &str = "beyond the vault";

/// The second review's fixture for #1: one note in a Memex vault, in two
/// versions. The secure one, which the walk caches first, carries a private
/// value in EVERY field derived from the note's content (title, body, shelf
/// and so its folder, tags, aliases, origin, and its dates), so a lane that
/// copies any field from the cache shows it.
pub(crate) const PRIVATE: &str = "PRIVATE-CANARY-7Q4";
/// 1999-09-09T00:00:00Z, the secure version's dates, in milliseconds.
pub(crate) const PRIVATE_STAMP: &str = "936835200000";
pub(crate) const ALT_ID: &str = "01JREVIEWALTERNATE0000000A";

pub(crate) struct Alternating {
    pub(crate) abs: std::path::PathBuf,
    pub(crate) public: String,
}

pub(crate) fn alternating_memex(root: &Path) -> Alternating {
    fs::write(root.join("memex.json"), "{\"id\":\"mx_review\",\"contract\":\"3.4\",\"apps\":{}}").unwrap();
    for dir in ["self", "wiki/Projects", "history", "chats", "archive", "trash"] {
        fs::create_dir_all(root.join(dir)).unwrap();
    }
    let abs = root.join("wiki/Projects/harbor-plan.md");
    let public = format!(
        "---\nid: {ALT_ID}\nshelf: Projects\ntags: [harbor]\naliases: []\ncreated: 2026-01-02T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\n---\n\n# {HARBOR_TITLE}\n\n{HARBOR_BODY}\n"
    );
    let secure = format!(
        "---\nid: {ALT_ID}\nsecure: true\nshelf: {PRIVATE}\ntags: [{PRIVATE}]\naliases: [{PRIVATE}]\norigin: {PRIVATE}\ncreated: 1999-09-09T00:00:00Z\nupdated: 1999-09-09T00:00:00Z\n---\n\n# Harbor {PRIVATE} plan\n\nharbor code {PRIVATE} opens at nine\n"
    );
    fs::write(&abs, secure).unwrap();
    Alternating { abs, public }
}

/// The whole serialized answer, not field by field.
pub(crate) fn assert_nothing_private(answer: &str) {
    assert!(!answer.contains(PRIVATE) && !answer.contains(PRIVATE_STAMP), "{answer}");
}

pub(crate) fn with_canary(public: &str) -> String {
    public
        .replacen("---\n", "---\nsecure: true\n", 1)
        .replace(&format!("# {HARBOR_TITLE}"), &format!("# Harbor {CANARY} plan"))
        .replace(HARBOR_BODY, &format!("harbor code {CANARY} opens at nine"))
}

/// Review 2026-11-09 #5: an agent's move checked secure and locked
/// before waiting for the note's lock. Another writer holding the lock
/// could lock the note meanwhile, and the move went ahead on release. The
/// policy is checked again inside the lock, right before the move.
#[test]
fn a_note_locked_while_an_agent_move_waits_is_not_moved() {
    let (_dir, mut store) = bare();
    store.create_folder("Projects", None).unwrap();
    let n = store.create("Inbox", "# Ferry timetable\n\nboats at noon\n").unwrap();
    let rel = store.resolve_note_rel(&n.id).unwrap();
    let abs = store.abs(&rel);
    let (held, wait_for_hold) = std::sync::mpsc::channel();
    let writer = {
        let abs = abs.clone();
        std::thread::spawn(move || {
            crate::fsutil::with_file_lock(&abs, || {
                held.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(300));
                let text = fs::read_to_string(&abs).unwrap();
                fs::write(&abs, text.replacen("---\n", "---\nlocked: true\n", 1)).unwrap();
                Ok(())
            })
            .unwrap();
        })
    };
    wait_for_hold.recv().unwrap();
    let moved = store.move_for_remote_agent(&n.id, "Projects");
    writer.join().unwrap();
    let error = moved.expect_err("a note locked before the move ran is not moved");
    assert!(error.contains("locked"), "{error}");
    assert!(abs.is_file(), "the note stays where it was");
}

/// Review 2026-11-09 #4: a hard link in the vault to a Markdown file
/// outside it passes every path check, so reading the note's indexed id
/// returned the outside file. A note is read only from a regular file with
/// one name; a hard-linked one is never read, listed, or searched.
#[cfg(unix)]
#[test]
fn a_hard_link_to_a_file_outside_the_vault_is_never_read() {
    let (dir, mut store) = bare();
    let outside = dir.path().join("outside.md");
    fs::write(&outside, OUTSIDE_NOTE).unwrap();

    // a note whose file is swapped for a hard link to the outside file
    let n = store.create("Inbox", "# Plain\n\nan ordinary note\n").unwrap();
    let rel = store.resolve_note_rel(&n.id).unwrap();
    let abs = store.abs(&rel);
    fs::remove_file(&abs).unwrap();
    fs::hard_link(&outside, &abs).unwrap();
    store.suppress.bump();
    // with the words the open note's notice recognises (src/lib/hardLinks.ts)
    let refused = store.read(&n.id).unwrap_err();
    assert!(refused.contains("has a hard link"), "the editor's read refuses it: {refused}");
    assert!(store.read_for_ai(&n.id, false).is_err(), "the AI read gate refuses it");
    assert!(store.read_doc_for_ai(&n.id, true).is_err(), "the agent read refuses it");

    // a fresh hard link is never walked: not listed, not searched
    fs::hard_link(&outside, store.abs("Inbox/linked.md")).unwrap();
    store.suppress.bump();
    let list = store.list().unwrap();
    assert!(!list.notes.iter().any(|m| m.title == "Ledger"), "{:?}", list.notes);
    assert!(store.search("beyond", 10, false).unwrap().is_empty());
    // the open note and the fresh link are both named, for the notice and
    // the line under search results
    let named: Vec<&str> = list.skipped.iter().map(|f| f.path.as_str()).collect();
    assert!(named.contains(&rel.as_str()) && named.contains(&"Inbox/linked.md"), "{named:?}");
    assert_eq!(fs::read_to_string(&outside).unwrap(), OUTSIDE_NOTE);
}

/// Review 2026-11-09 #1: an AI lane gated one read of a note and showed
/// another. The walk cached a secure version holding a canary; the note
/// then went public, the gate approved the public bytes, and the hit still
/// carried the cached title and snippet. A hit, and a listing row, now show
/// only the bytes the gate judged.
#[test]
fn ai_lanes_show_only_the_bytes_the_gate_judged() {
    let (_dir, mut store) = bare();
    let n = store.create("Inbox", &format!("# {HARBOR_TITLE}\n\n{HARBOR_BODY}\n")).unwrap();
    let rel = store.resolve_note_rel(&n.id).unwrap();
    let abs = store.abs(&rel);
    let public = fs::read_to_string(&abs).unwrap();
    let secure = with_canary(&public);
    fs::write(&abs, &secure).unwrap();
    let hits = store.search("harbor", 10, false).unwrap(); // the walk caches the secure version
    assert!(hits[0].snippet.contains(CANARY), "the person's own search sees their note");
    fs::write(&abs, &public).unwrap(); // public again, with no walk in between

    let shown: Vec<SearchHit> =
        hits.into_iter().filter_map(|hit| store.search_row_for_ai("harbor", &hit.id, false)).collect();
    assert_eq!(shown.len(), 1, "the public note is still found");
    assert!(!format!("{shown:?}").contains(CANARY), "{shown:?}");
    assert_eq!(shown[0].title, HARBOR_TITLE);

    // a hit the public bytes no longer match is dropped, not shown from the cache
    fs::write(&abs, &secure).unwrap();
    store.suppress.bump(); // the watcher saw the change
    let canary = store.search("canary", 10, false).unwrap();
    fs::write(&abs, &public).unwrap();
    assert!(canary.into_iter().filter_map(|hit| store.search_row_for_ai("canary", &hit.id, false)).next().is_none());

    let meta = store.list().unwrap().notes.into_iter().find(|m| m.id == n.id).unwrap();
    assert!(meta.title.contains(CANARY), "the cached listing row is the secure version");
    let row = store.note_row_for_ai(&meta.id, false).expect("the public note is listed");
    assert!(!format!("{row:?}").contains(CANARY), "{row:?}");
}

/// Review pass on #1 through the app's own commands: the in-app chat's
/// search and note list for a model (`corpus_search_ai`, `corpus_notes_ai`)
/// run these functions over the app's corpus state.
#[test]
fn the_apps_ai_search_and_list_show_only_judged_bytes() {
    let (_dir, mut store) = bare();
    let n = store.create("Inbox", &format!("# {HARBOR_TITLE}\n\n{HARBOR_BODY}\n")).unwrap();
    let rel = store.resolve_note_rel(&n.id).unwrap();
    let abs = store.abs(&rel);
    let public = fs::read_to_string(&abs).unwrap();
    fs::write(&abs, with_canary(&public)).unwrap();
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
    registry.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(registry));
    let warmed = corpus_search_inner(&state, "harbor", None, None).unwrap(); // the person's search walks the secure version
    assert!(format!("{warmed:?}").contains(CANARY));
    fs::write(&abs, &public).unwrap();

    let hits = search_ai_inner(&state, "harbor", None, None, false).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(!format!("{hits:?}").contains(CANARY), "{hits:?}");
    let notes = notes_ai_inner(&state, false).unwrap();
    assert!(notes.iter().any(|m| m.title == HARBOR_TITLE));
    assert!(!format!("{notes:?}").contains(CANARY), "{notes:?}");
}

/// Review pass on #4: every read of a file's bytes under the vault refuses a
/// hard link, not only note reads: the editor's file reads (sheets, Word
/// documents, CSV), the AI file lane, and board reads.
#[cfg(unix)]
#[test]
fn no_file_read_crosses_the_vault_through_a_hard_link() {
    let (dir, mut store) = bare();
    let outside = dir.path().join("outside.csv");
    fs::write(&outside, "account,balance\n").unwrap();
    fs::create_dir_all(store.abs("Storage")).unwrap();
    fs::hard_link(&outside, store.abs("Storage/linked.csv")).unwrap();
    fs::hard_link(&outside, store.abs("Inbox/linked.excalidraw")).unwrap();
    assert!(store.read_user_file_bytes("Storage/linked.csv").is_err(), "the editor's file read");
    assert!(store.read_file_bytes_for_ai("Storage/linked.csv", true).is_err(), "the AI file lane");
    assert!(store.read_board("Inbox/linked.excalidraw").is_err(), "a board read");
    fs::write(store.abs("Storage/plain.csv"), "a,b\n").unwrap();
    assert_eq!(store.read_user_file_bytes("Storage/plain.csv").unwrap(), b"a,b\n");
}

/// Second review #1 through the app's own commands: every field of the chat's
/// search and note list (folder, aliases, dates, everything) comes from the
/// approved snapshot, never the cached secure version.
#[test]
fn the_apps_ai_rows_carry_no_field_from_the_cached_version() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    fs::create_dir_all(&root).unwrap();
    let alt = alternating_memex(&root);
    let mut store = CorpusStore::open(root).unwrap();
    store.os_trash = false;
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
    registry.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(registry));
    let warmed = serde_json::to_string(&corpus_list_inner(&state, false).unwrap()).unwrap();
    assert!(warmed.contains(PRIVATE), "the person's own listing walks the secure version");
    let _ = corpus_search_inner(&state, "harbor", None, None).unwrap();
    fs::write(&alt.abs, &alt.public).unwrap();

    let hits = search_ai_inner(&state, "harbor", None, None, false).unwrap();
    assert_eq!(hits.len(), 1);
    assert_nothing_private(&serde_json::to_string(&hits).unwrap());
    let notes = notes_ai_inner(&state, false).unwrap();
    assert!(notes.iter().any(|m| m.title == HARBOR_TITLE && m.folder_id == "Projects"));
    assert_nothing_private(&serde_json::to_string(&notes).unwrap());
}

/// The guard for the class behind second-review #1 (a field copied from a
/// cached row into what a model sees): the AI row builders take no cached
/// row, and neither they nor the lanes that hand AI rows out build one with
/// struct-update syntax (`..hit`) from another row.
///
/// A syntax tripwire, not the proof (third review): it reads source text, so
/// a copy written field by field would pass it. The behaviour is proven by
/// the fixtures above that put a private value in every content-derived field
/// of the cached version and assert none reaches any AI answer
/// (`the_apps_ai_rows_carry_no_field_from_the_cached_version`).
#[test]
fn no_cached_row_reaches_an_ai_row() {
    fn code(text: &str) -> Vec<&str> {
        text.lines().filter(|line| !line.trim_start().starts_with("//")).collect()
    }
    fn spreads(line: &str) -> bool {
        line.match_indices("..").any(|(at, _)| line[at + 2..].starts_with(|c: char| c.is_alphabetic() || c == '_'))
    }
    fn body<'a>(text: &'a str, start: &str, end: &str) -> &'a str {
        let from = text.find(start).unwrap_or_else(|| panic!("{start} is gone; update this guard"));
        let to = from + text[from..].find(end).unwrap_or_else(|| panic!("no end after {start}"));
        &text[from..to]
    }
    for line in code(include_str!("corpus_ai_rows.rs")) {
        let signature = line.contains("fn ");
        assert!(
            !(signature && (line.contains(": NoteMeta") || line.contains(": SearchHit"))),
            "an AI row builder takes a cached row: {line}"
        );
        assert!(!spreads(line), "an AI row copies fields with struct-update syntax: {line}");
    }
    let corpus = include_str!("corpus.rs");
    let workspace = include_str!("workspace.rs");
    for lane in [
        body(corpus, "fn search_ai_inner(", "\n}\n"),
        body(corpus, "fn notes_ai_inner(", "\n}\n"),
        body(workspace, "    fn list_remote(", "\n    }\n"),
        body(workspace, "    fn search_remote(", "\n    }\n"),
        body(workspace, "    fn query_remote(", "\n    }\n"),
    ] {
        for line in code(lane) {
            assert!(!spreads(line), "an AI lane copies a row's fields: {line}");
        }
    }
}

/// Second review #3: the walk lists no board, file, or note that is a hard
/// link, and the path handed to the webview's asset protocol refuses one.
#[cfg(unix)]
#[test]
fn hard_linked_files_are_neither_listed_nor_handed_to_the_webview() {
    let (_dir, mut store) = bare();
    let _board = crate::fsutil::hard_link_outside(&store.abs("Inbox/linked.excalidraw"), b"{}");
    let _image = crate::fsutil::hard_link_outside(&store.abs("Storage/linked.png"), b"\x89PNG");
    store.suppress.bump();
    let list = store.list().unwrap();
    assert!(list.notes.iter().all(|row| !row.id.contains("linked.")), "{list:?}");
    // third review #5: left out, and said so, with the reason
    let mut skipped: Vec<(&str, SkipReason)> = list.skipped.iter().map(|f| (f.path.as_str(), f.reason)).collect();
    skipped.sort_by_key(|(path, _)| *path);
    assert_eq!(skipped, vec![("Inbox/linked.excalidraw", SkipReason::HardLink), ("Storage/linked.png", SkipReason::HardLink)]);
    assert!(store.webview_path("Storage/linked.png").is_err());
    fs::write(store.abs("Storage/own.png"), b"\x89PNG").unwrap();
    assert!(store.webview_path("Storage/own.png").is_ok());
}

/// Hold `abs`'s note lock on another thread, set `flag: true` in it while
/// `act` waits for that lock, then release.
fn with_policy_changed_while_waiting<T>(
    store: &mut CorpusStore,
    abs: &Path,
    flag: &str,
    act: impl FnOnce(&mut CorpusStore) -> Result<T, String>,
) -> Result<T, String> {
    let (held, wait_for_hold) = std::sync::mpsc::channel();
    let writer = {
        let abs = abs.to_path_buf();
        let line = format!("---\n{flag}: true\n");
        std::thread::spawn(move || {
            crate::fsutil::with_file_lock(&abs, || {
                held.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(300));
                let text = fs::read_to_string(&abs).unwrap();
                fs::write(&abs, text.replacen("---\n", &line, 1)).unwrap();
                Ok(())
            })
            .unwrap();
        })
    };
    wait_for_hold.recv().unwrap();
    let result = act(store);
    writer.join().unwrap();
    result
}

/// Second review #5: the in-app filer and the filer's field writes checked
/// policy before waiting for the note's lock, so a note locked or made
/// secure by a writer holding that lock was moved or written on release.
#[test]
fn the_filer_and_its_field_writes_recheck_policy_inside_the_lock() {
    for flag in ["locked", "secure"] {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        super::tests::seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        fs::create_dir_all(root.join("wiki/Projects")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;

        let ferry = store.create("wiki/_inbox", "# Ferry\n\nboats at noon\n").unwrap();
        let rel = store.path_of(&ferry.id).unwrap();
        let abs = store.abs(&rel);
        let moved = with_policy_changed_while_waiting(&mut store, &abs, flag, |s| s.filer_move(&rel, "wiki/Projects"));
        assert!(moved.is_err(), "{flag}: the filer moved a note that became {flag} while it waited");
        assert!(abs.is_file());

        let tide = store.create("wiki/_inbox", "# Tide\n\nlow at six\n").unwrap();
        let rel = store.path_of(&tide.id).unwrap();
        let abs = store.abs(&rel);
        let written =
            with_policy_changed_while_waiting(&mut store, &abs, flag, |s| s.set_ai_field(&rel, "summary", "one line"));
        assert!(written.is_err(), "{flag}: the filer wrote a field into a note that became {flag}");
        assert!(!fs::read_to_string(&abs).unwrap().contains("one line"));
    }
}

/// The guard for the class behind second-review #5 (a note lock taken
/// without its policy checked inside it): `lock_note` is the only way a
/// corpus module locks a note, and it requires an `Authority`, which has no
/// default. A plain file lock is allowed only for Rotli's own sidecars below.
#[test]
fn every_note_lock_names_its_authority() {
    const SIDECAR_LOCKS: [&str; 11] = [
        "journal_append",
        "journal_prune",
        "main_write",
        "main_write_if_revision",
        "main_update",
        "views_write_if_revision",
        "views_update",
        "gitignore_add",
        "gitignore_remove",
        "ensure_main_committable",
        "ai_journal_append",
    ];
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut seen = std::collections::BTreeSet::new();
    for entry in fs::read_dir(&dir).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("corpus") || !name.ends_with(".rs") || name.ends_with("_tests.rs") {
            continue;
        }
        let source = fs::read_to_string(entry.path()).unwrap();
        let production = source.split("#[cfg(test)]\nmod tests").next().unwrap();
        let lines: Vec<&str> = production.lines().collect();
        for (at, line) in lines.iter().enumerate() {
            let enclosing = || {
                lines[..at]
                    .iter()
                    .rev()
                    .find_map(|l| l.split("fn ").nth(1).filter(|_| l.trim_start().starts_with(['p', 'f'])))
                    .map(|rest| rest.split(['(', '<']).next().unwrap_or_default().to_string())
                    .unwrap_or_default()
            };
            if line.contains("with_file_lock(") {
                let function = enclosing();
                seen.insert(function.clone());
                assert!(
                    SIDECAR_LOCKS.contains(&function.as_str()),
                    "{name}:{} {function} locks a file without lock_note's authority check",
                    at + 1
                );
            }
            if line.contains("fsutil::lock_file(") {
                assert_eq!(enclosing(), "lock_note", "{name}:{} takes a raw file lock", at + 1);
            }
        }
    }
    assert_eq!(seen.len(), SIDECAR_LOCKS.len(), "the scan found {seen:?}; update this guard");
}

/// Deferred finding #2's qualifier (docs/design/librarian-mcp-and-t3-chat.md):
/// an index or log page the route wrote in a development build stays an
/// ordinary note in any build. The gate turns the route off; it doesn't clean
/// or hide the pages, so they are listed, searched, and readable by AI lanes
/// like any other public note, including any line about a note made secure
/// since.
#[test]
fn a_page_the_route_wrote_stays_an_ordinary_searchable_note() {
    let (_dir, mut store) = bare();
    let page = store
        .create_librarian_page("Inbox", "# Librarian index\n\n- [[Harbor plan]]: when the harbor opens\n", "index")
        .unwrap();
    let listed = store.list().unwrap().notes;
    assert!(listed.iter().any(|m| m.id == page.id), "listed");
    let hits = store.search("harbor opens", 10, false).unwrap();
    assert!(hits.iter().any(|h| h.id == page.id), "searchable");
    assert!(store.note_row_for_ai(&page.id, false).is_some(), "readable by AI lanes as a public note");
}

/// Third review #4: the chat's AI listing keeps a board and a file in their
/// own lanes (its rebuild that week built every row as a note), for a remote
/// and an on-device model; a board's row comes from its path, not its scene.
#[test]
fn the_ai_listing_keeps_boards_and_files_in_their_lanes() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Harbor plan\n\nharbor opens at nine\n").unwrap();
    fs::write(store.abs("Inbox/Harbor sketch.excalidraw"), "{\"type\":\"excalidraw\",\"elements\":[]}").unwrap();
    fs::create_dir_all(store.abs("Storage")).unwrap();
    fs::write(store.abs("Storage/harbor.csv"), "berth,time\n1,nine\n").unwrap();
    store.suppress.bump();
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
    registry.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(registry));
    let mine = corpus_list_inner(&state, false).unwrap().notes;
    for local in [false, true] {
        let rows = notes_ai_inner(&state, local).unwrap();
        let row = |id: &str| rows.iter().find(|r| r.id == id).unwrap_or_else(|| panic!("{id} missing: {rows:?}"));
        assert_eq!(row(&note.id).kind, NoteKind::Note);
        assert_eq!(row("Inbox/Harbor sketch.excalidraw").kind, NoteKind::Board);
        assert_eq!(row("Inbox/Harbor sketch.excalidraw").title, "Harbor sketch");
        assert_eq!(row("Storage/harbor.csv").kind, NoteKind::File);
        // each row is what the person's own listing shows for it
        for shown in &rows {
            let own = mine.iter().find(|m| m.id == shown.id).unwrap();
            assert_eq!((&own.title, own.kind, &own.folder_id), (&shown.title, shown.kind, &shown.folder_id));
        }
    }
}

/// Third review, Part 3: the Librarian's People list reads only the People
/// notes, each through the gate for the model; its areas are the vault's
/// directories, never a shelf synthesized from a (secure) note.
#[test]
fn the_librarian_listing_reads_only_people_notes_through_the_gate() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    fs::create_dir_all(&root).unwrap();
    alternating_memex(&root); // a secure note in Projects whose shelf is PRIVATE
    fs::create_dir_all(root.join("wiki/People/Work")).unwrap();
    fs::write(root.join("wiki/People/Work/ana.md"), "# Ana\n\nworks on the harbor\n").unwrap();
    fs::write(root.join("wiki/People/bob.md"), "---\nsecure: true\n---\n\n# Bob\n\nprivate\n").unwrap();
    let mut store = CorpusStore::open(root).unwrap();
    store.os_trash = false;
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
    registry.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(registry));
    let remote = ai_rows::librarian_ai_inner(&state, false).unwrap();
    let people: Vec<&str> = remote.people.iter().map(|row| row.title.as_str()).collect();
    assert_eq!(people, vec!["Ana"]);
    let local = ai_rows::librarian_ai_inner(&state, true).unwrap();
    let mut people: Vec<&str> = local.people.iter().map(|row| row.title.as_str()).collect();
    people.sort_unstable();
    assert_eq!(people, vec!["Ana", "Bob"], "an on-device model may read a secure note");
    let json = serde_json::to_string(&remote).unwrap();
    assert!(remote.folders.iter().any(|folder| folder.id.ends_with("People/Work")), "{json}");
    assert_nothing_private(&json);
}

/// Third review, Part 3 (search after an edit, as the CHANGELOG states it): a
/// save made in Rotli is seen by the very next AI search; a change made
/// outside Rotli is seen once the file watcher fires (after 300 ms of quiet,
/// `corpus_watch::DEBOUNCE`; here, the bump it makes), and until then no
/// search answers with words the note no longer has.
#[test]
fn an_ai_search_sees_an_in_app_save_at_once_and_an_outside_edit_after_the_watcher() {
    let (_dir, mut store) = bare();
    let n = store.create("Inbox", "# Ferry timetable\n\nboats at noon\n").unwrap();
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
    let rel = store.resolve_note_rel(&n.id).unwrap();
    let abs = store.abs(&rel);
    registry.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(registry));
    assert_eq!(search_ai_inner(&state, "noon", None, None, false).unwrap().len(), 1);

    state.route(DEFAULT_ROOT_ID, |s| s.write(&n.id, "# Ferry timetable\n\nboats at dusk\n")).unwrap();
    assert_eq!(search_ai_inner(&state, "dusk", None, None, false).unwrap().len(), 1, "an in-app save, at once");
    assert!(search_ai_inner(&state, "noon", None, None, false).unwrap().is_empty());

    let text = fs::read_to_string(&abs).unwrap().replace("dusk", "midnight");
    fs::write(&abs, text).unwrap();
    // before the watcher fires: the old words are no longer answered for
    assert!(search_ai_inner(&state, "dusk", None, None, false).unwrap().is_empty());
    state.route(DEFAULT_ROOT_ID, |s| { s.suppress.bump(); Ok(()) }).unwrap();
    assert_eq!(search_ai_inner(&state, "midnight", None, None, false).unwrap().len(), 1, "after the watcher");
}
