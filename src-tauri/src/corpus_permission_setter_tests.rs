//! Codex review round 5 of PR #295: now that a permission key denies in any
//! spelling, the person's own setting clears every spelling of its key before
//! it writes Rotli's line. Checked on the file as written, in a Rotli vault and
//! in a folder opened in place.

use super::tests::bare;
use super::*;
use tempfile::TempDir;

/// An Obsidian-shaped folder connected in place, opened as Rotli opens it.
fn opened_in_place(dir: &TempDir) -> CorpusStore {
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Notes")).unwrap();
    fs::create_dir_all(root.join(".obsidian")).unwrap();
    crate::vault_roles::mark_in_place(&root).unwrap();
    let mut store = CorpusStore::open(fs::canonicalize(root).unwrap()).unwrap();
    store.os_trash = false;
    assert!(store.adopted);
    store
}

/// A note with the frontmatter given, written by hand, found by the walk.
fn note(store: &mut CorpusStore, frontmatter: &str) -> String {
    fs::create_dir_all(store.abs("Notes")).unwrap();
    fs::write(store.abs("Notes/plan.md"), format!("---\n{frontmatter}---\n# Plan\n\nWords.\n")).unwrap();
    store.suppress.bump();
    store.list().unwrap();
    "Notes/plan.md".to_string()
}

/// The frontmatter lines on disk that name `key`, in any spelling.
fn naming(store: &CorpusStore, rel: &str, key: &str) -> (Vec<String>, Vec<String>) {
    let text = fs::read_to_string(store.abs(rel)).unwrap();
    let foreign = parse_document(&text).0.unwrap_or_default().foreign;
    let named = foreign.iter().filter(|line| crate::frontmatter_keys::names_key(line, key)).cloned().collect();
    (named, foreign)
}

fn both_kinds() -> Vec<(TempDir, CorpusStore)> {
    let (dir, store) = bare();
    let place = TempDir::new().unwrap();
    let in_place = opened_in_place(&place);
    vec![(dir, store), (place, in_place)]
}

#[test]
fn turning_let_ai_edit_on_clears_every_spelling_of_ai_edit() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\ntags: [plan]\n  ai_edit: false\n\"ai\\u005fedit\": false\n");
        store.set_ai_edit(&rel, true).unwrap();
        let (named, foreign) = naming(&store, &rel, "ai_edit");
        assert_eq!(named, ["ai_edit: true"], "adopted={}: {foreign:?}", store.adopted);
        assert_eq!(crate::ai_edit_policy::body_edit(&foreign), crate::ai_edit_policy::BodyEdit::Allowed, "adopted={}", store.adopted);
        assert!(fs::read_to_string(store.abs(&rel)).unwrap().contains("Words."));
    }
}

#[test]
fn allowing_on_device_ai_clears_every_spelling_of_local_ai_allowed() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\nsecure: true\n  local_ai_allowed: false\n\"local\\u005fai_allowed\": false\n");
        store.set_local_ai_access(&rel, true).unwrap();
        let (named, foreign) = naming(&store, &rel, "local_ai_allowed");
        assert_eq!(named, ["local_ai_allowed: true"], "adopted={}: {foreign:?}", store.adopted);
        assert_eq!(crate::frontmatter_keys::local_ai_allowed(&foreign), Some(true), "adopted={}", store.adopted);
    }
}


/// Claude 2's review of PR #295: in a folder opened in place, a key the
/// person spelled their own way (`locked : false`, `"locked": false`) was
/// kept beside the line Rotli wrote, so the note carried the key twice.
#[test]
fn locking_in_place_replaces_a_lock_line_spelled_another_way() {
    let place = TempDir::new().unwrap();
    let mut store = opened_in_place(&place);
    for spelled in ["locked : false", "\"locked\": false", "'locked': false"] {
        let rel = note(&mut store, &format!("id: obs-plan\ntags: [plan]\n{spelled}\n"));
        store.set_locked(&rel, true).unwrap();
        let foreign = parse_document(&fs::read_to_string(store.abs(&rel)).unwrap()).0.unwrap_or_default().foreign;
        let locks: Vec<&String> = foreign.iter().filter(|line| crate::frontmatter_keys::names_key(line, "locked")).collect();
        assert_eq!(locks, ["locked: true"], "{spelled:?}: {foreign:?}");
        assert_eq!(foreign, ["tags: [plan]", "locked: true"], "{spelled:?}: the line keeps its place");
    }
}

/// A key the line reader doesn't name (a space inside, as Obsidian's
/// `date created`) is still edited and removed in place, once.
#[test]
fn a_key_with_a_space_is_edited_and_removed_in_place() {
    let note = "---\ndate created: 2020-01-01\ntags: [plan]\n---\n# Plan\n";
    let before = parse_document(note).0.unwrap_or_default();
    let edited = Frontmatter { foreign: vec!["date created: 2021-02-02".into(), "tags: [plan]".into()], ..before.clone() };
    assert_eq!(compose_in_place(note, &edited), "---\ndate created: 2021-02-02\ntags: [plan]\n---\n# Plan\n");
    let removed = Frontmatter { foreign: vec!["tags: [plan]".into()], ..before };
    assert_eq!(compose_in_place(note, &removed), "---\ntags: [plan]\n---\n# Plan\n");
}

fn disk(store: &CorpusStore, rel: &str) -> String {
    fs::read_to_string(store.abs(rel)).unwrap()
}

/// Codex review of PR #303, blocker 1: the generic metadata setter took the
/// quoted key `"ai_edit"` (and `"secure"`) past its reserved-key check, and
/// the in-place writer then wrote Rotli's own `ai_edit: true`, or replaced
/// `secure: true`, so the note became AI-editable or passed the remote gate.
#[test]
fn the_generic_setter_never_grants_or_unsecures() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\nsecure: true\ncreated_by: agent\nai_edit: false\n");
        let before = disk(&store, &rel);
        for (key, value) in [("\"ai_edit\"", "true"), ("'ai_edit'", "true"), ("\"secure\"", "false"), ("\"ai\\u005fedit\"", "true"), ("topic", "x\nai_edit: true"), ("a: b", "c")] {
            assert!(store.set_field(&rel, key, value).is_err(), "adopted={} {key:?}", store.adopted);
            assert_eq!(disk(&store, &rel), before, "adopted={} {key:?}", store.adopted);
        }
        assert!(store.read_for_ai(&rel, false).is_err(), "a remote model is still refused");
        // a typed spelling is kept as typed
        store.set_field(&rel, "\"topic\"", "plans").unwrap();
        assert!(disk(&store, &rel).contains("\n\"topic\": plans\n"), "adopted={}: {}", store.adopted, disk(&store, &rel));
    }
    // the in-place writer copies an action's line verbatim: a typed grant stays typed
    let original = "---\ncreated_by: person\n---\nWords.\n";
    let mut next = parse_document(original).0.unwrap_or_default();
    next.foreign.push("\"ai_edit\": true".into());
    let out = compose_in_place(original, &next);
    assert_eq!(out, "---\ncreated_by: person\n\"ai_edit\": true\n---\nWords.\n");
    let foreign = parse_document(&out).0.unwrap_or_default().foreign;
    assert_ne!(crate::ai_edit_policy::body_edit(&foreign), crate::ai_edit_policy::BodyEdit::Allowed);
}

/// Codex review of PR #303, blocker 2: on a note with `"locked": true` and
/// `ai_edit: true`, Lock succeeded while AI editing stayed enabled: the lock
/// reader ignored the quoted spelling and the writer saw an equal value.
#[test]
fn a_quoted_lock_locks_and_the_lock_actions_replace_it() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\n\"locked\": true\ncreated_by: agent\nai_edit: true\n");
        assert!(crate::corpus::has_locked_frontmatter(&disk(&store, &rel)), "the reader counts a quoted lock");
        store.set_locked(&rel, true).unwrap();
        let (locks, foreign) = naming(&store, &rel, "locked");
        assert_eq!(locks, ["locked: true"], "adopted={}: {foreign:?}", store.adopted);
        assert_eq!(crate::ai_edit_policy::body_edit(&foreign), crate::ai_edit_policy::BodyEdit::Locked);
        store.set_locked(&rel, false).unwrap();
        let (locks, foreign) = naming(&store, &rel, "locked");
        assert!(locks.is_empty(), "adopted={}: {foreign:?}", store.adopted);
        assert!(!crate::corpus::has_locked_frontmatter(&disk(&store, &rel)));
    }
}

/// Codex review of PR #303, item 4: setting `ai_edit` deleted an indented
/// `ai_edit: false` from inside a person's `example: |` text, and left the
/// `: false` line of a `? ai_edit` behind. A setter now removes whole spans,
/// never block text, and refuses when its result wouldn't say what it promised.
#[test]
fn setters_keep_block_text_and_remove_whole_spans() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\ncreated_by: agent\nexample: |\n  ai_edit: false\n");
        let before = disk(&store, &rel);
        assert!(store.set_ai_edit(&rel, true).is_err(), "adopted={}", store.adopted);
        assert_eq!(disk(&store, &rel), before, "the person's text stays");

        let rel = note(&mut store, "id: 01PLANNOTE\n? ai_edit\n: false\ntags: [plan]\n");
        store.set_ai_edit(&rel, true).unwrap();
        let (named, foreign) = naming(&store, &rel, "ai_edit");
        assert_eq!(named, ["ai_edit: true"], "adopted={}: {foreign:?}", store.adopted);
        assert!(!foreign.iter().any(|line| line.starts_with(':')), "adopted={}: {foreign:?}", store.adopted);
        assert!(foreign.contains(&"tags: [plan]".to_string()));
    }
}

/// Codex review of PR #303, item 8: `date created :` (a space before the
/// colon) was repeated, not replaced, in a folder opened in place.
#[test]
fn a_key_spelled_with_a_space_before_its_colon_is_replaced_in_place() {
    let place = TempDir::new().unwrap();
    let mut store = opened_in_place(&place);
    let rel = note(&mut store, "id: obs-plan\ndate created : 2020-01-01\n");
    store.set_field(&rel, "date created", "2021-02-02").unwrap();
    assert_eq!(parse_document(&disk(&store, &rel)).0.unwrap_or_default().foreign, ["date created: 2021-02-02"]);
    let out = super::in_place::with_top_level_line("---\ndate created : 2020\n---\nWords.\n", "date created", Some("2021"));
    assert_eq!(out, "---\ndate created: 2021\n---\nWords.\n");
}

/// Codex review of PR #303, second round: a write never changes how a
/// setting it doesn't own reads. Each case below erased a denial before.
#[test]
fn a_write_never_changes_a_setting_it_does_not_own() {
    for (_dir, mut store) in both_kinds() {
        for (frontmatter, write) in [
            ("created_by: agent\nexample: |\n  ai_edit: false\n", "field"),
            ("ai_edit: false\n  locked: true\n", "ai_edit"),
            ("created_by: agent\nsecure: true\n{s: 1, \"local\\u005fai_allowed\": false}\n", "flow"),
        ] {
            let rel = note(&mut store, &format!("id: 01PLANNOTE\n{frontmatter}"));
            let before = disk(&store, &rel);
            let wrote = match write {
                "field" => store.set_field(&rel, "example", "x"),
                "ai_edit" => store.set_ai_edit(&rel, true),
                _ => store.set_field(&rel, "{s", "x}"),
            };
            assert!(wrote.is_err(), "adopted={} {frontmatter:?}", store.adopted);
            assert_eq!(disk(&store, &rel), before, "adopted={} {frontmatter:?}", store.adopted);
        }
    }
    // the filer's field write too
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("brain");
    super::tests::seed_memex(&root);
    fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
    let text = "---\nid: 01JFILERSPANULID0000000000\ncreated_by: agent\ntags:\n  ai_edit: false\n---\n# Plan\n";
    fs::write(root.join("wiki/_inbox/plan.md"), text).unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    store.os_trash = false;
    store.list().unwrap();
    assert!(store.set_ai_field("01JFILERSPANULID0000000000", "tags", "[a]").is_err());
    assert_eq!(fs::read_to_string(root.join("wiki/_inbox/plan.md")).unwrap(), text);
}

/// Turning secure off clears a quoted `"secure": true` too, in a folder
/// opened in place (the reader counts that spelling, so the writer must).
#[test]
fn turning_secure_off_clears_a_quoted_secure_line_in_place() {
    let place = TempDir::new().unwrap();
    let mut store = opened_in_place(&place);
    let rel = note(&mut store, "id: obs-plan\n\"secure\": true\ntags: [plan]\n");
    store.set_secure(&rel, false).unwrap();
    let foreign = parse_document(&disk(&store, &rel)).0.unwrap_or_default().foreign;
    assert_eq!(foreign, ["tags: [plan]"]);
}
