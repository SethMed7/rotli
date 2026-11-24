//! The tag lanes' guarantees: the person's own change always lands (locked and
//! secure notes included), an AI's is held to the body write's gates, no tag
//! write changes a note's protection, and a remote tag list never names or
//! counts a tag that lives only on a secure note.

use std::fs;

use super::super::tests::bare;
use super::*;
use crate::corpus::CorpusStore;
use tempfile::TempDir;

const ID: &str = "01JTAGNOTE0000000000000000";

fn note(text: &str) -> (TempDir, CorpusStore, std::path::PathBuf) {
    let (dir, mut store) = bare();
    let path = store.root().join("tagged.md");
    fs::write(&path, text).unwrap();
    store.list().unwrap();
    (dir, store, path)
}

fn doc(fields: &str) -> String {
    format!("---\nid: {ID}\ncreated: 2026-11-24\nupdated: 2026-11-24\npinned: false\n{fields}---\n\n# Tagged\n\nbody words\n")
}

fn add(tags: &[&str]) -> TagChange {
    TagChange { add: tags.iter().map(|t| t.to_string()).collect(), remove: Vec::new() }
}

fn remove(tags: &[&str]) -> TagChange {
    TagChange { add: Vec::new(), remove: tags.iter().map(|t| t.to_string()).collect() }
}

fn rev(path: &std::path::Path) -> String {
    crate::fsutil::revision(&fs::read(path).unwrap())
}

const AGENT: AiTagger = AiTagger::Agent;
const REMOTE_CHAT: AiTagger = AiTagger::Chat { local: false, consented: false };

#[test]
fn the_person_tags_a_locked_and_secure_note_without_touching_anything_else() {
    let text = doc("locked: true\nsecure: true\nmood: calm # kept\ntags: [\"a: b\", old]\n");
    let (_dir, mut store, path) = note(&text);
    let out = store.change_tags_as_person(ID, &add(&["#Launch", "old"]), None).unwrap();
    assert_eq!(out.tags, ["a: b", "old", "Launch"]);
    let saved = fs::read_to_string(&path).unwrap();
    assert_eq!(saved, text.replace("tags: [\"a: b\", old]", "tags: [\"a: b\", old, Launch]"));
    assert_eq!(out.revision, rev(&path));

    let out = store.change_tags_as_person(ID, &remove(&["OLD"]), Some(&out.revision)).unwrap();
    assert_eq!(out.tags, ["a: b", "Launch"]);
}

#[test]
fn the_person_lane_honours_a_revision_and_refuses_bad_tags_untouched() {
    let text = doc("tags: [a]\n");
    let (_dir, mut store, path) = note(&text);
    let err = store.change_tags_as_person(ID, &add(&["b"]), Some("fnv1a64:0")).unwrap_err();
    assert!(err.contains("revision"), "{err}");
    for hostile in crate::note_tags::tests::HOSTILE {
        assert!(store.change_tags_as_person(ID, &add(&[hostile]), None).is_err(), "{hostile:?}");
    }
    assert!(store.change_tags_as_person(ID, &TagChange::default(), None).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn tags_named_like_permission_keys_change_no_protection_in_any_form() {
    for fields in ["", "tags: [a]\n", "tags:\n  - a\n", "locked: true\ntags:\n- a\n", "ai_edit: false\ntags: a\n"] {
        let text = doc(fields);
        let (_dir, mut store, path) = note(&text);
        let before = crate::note_protection::protection(&text);
        for key in ["locked", "secure", "ai_edit", "created_by", "local_ai_allowed", "secureContext"] {
            store.change_tags_as_person(ID, &add(&[key]), None).unwrap();
            assert_eq!(crate::note_protection::protection(&fs::read_to_string(&path).unwrap()), before, "{fields:?} + {key}");
        }
        store
            .change_tags_as_person(ID, &remove(&["locked", "secure", "ai_edit", "created_by", "local_ai_allowed", "secureContext"]), None)
            .unwrap();
        assert_eq!(crate::note_protection::protection(&fs::read_to_string(&path).unwrap()), before, "{fields:?}");
    }
}

#[test]
fn a_tags_field_it_cannot_follow_is_never_rewritten() {
    let text = doc("tags: [a] # mine\n");
    let (_dir, mut store, path) = note(&text);
    let err = store.change_tags_as_person(ID, &add(&["b"]), None).unwrap_err();
    assert!(err.contains("Show file metadata"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn an_ai_needs_the_grant_and_never_tags_a_locked_note() {
    // a person's note with no grant: refused, for chat and agents alike
    let text = doc("tags: [a]\n");
    let (_dir, mut store, path) = note(&text);
    let revision = rev(&path);
    for tagger in [AGENT, REMOTE_CHAT] {
        let err = store.change_tags_for_ai(ID, &add(&["b"]), tagger, &revision).unwrap_err();
        assert!(err.contains("written by the person"), "{err}");
    }
    // "Allow once" covers a person's note…
    let consented = AiTagger::Chat { local: false, consented: true };
    let out = store.change_tags_for_ai(ID, &add(&["b"]), consented, &revision).unwrap();
    assert_eq!(out.tags, ["a", "b"]);

    // …never a lock, nor a deliberate no
    for fields in ["locked: true\nai_edit: true\n", "ai_edit: false\n"] {
        let text = doc(fields);
        let (_dir, mut store, path) = note(&text);
        let revision = rev(&path);
        for tagger in [AGENT, REMOTE_CHAT, consented, AiTagger::Chat { local: true, consented: true }] {
            assert!(store.change_tags_for_ai(ID, &add(&["b"]), tagger, &revision).is_err(), "{fields:?}");
        }
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }
}

#[test]
fn an_ai_tags_a_granted_note_under_the_revision_guard() {
    let text = doc("ai_edit: true\ntags:\n  - a\n");
    let (_dir, mut store, path) = note(&text);
    assert!(store.change_tags_for_ai(ID, &add(&["b"]), AGENT, "").is_err(), "a revision is required");
    let stale = store.change_tags_for_ai(ID, &add(&["b"]), AGENT, "fnv1a64:0").unwrap_err();
    assert!(stale.contains("revision"), "{stale}");
    let out = store.change_tags_for_ai(ID, &add(&["b"]), AGENT, &rev(&path)).unwrap();
    assert_eq!(out.tags, ["a", "b"]);
    assert!(fs::read_to_string(&path).unwrap().contains("tags:\n  - a\n  - b\n"));
    let out = store.change_tags_for_ai(ID, &remove(&["a"]), AGENT, &out.revision).unwrap();
    assert_eq!(out.tags, ["b"]);
}

#[test]
fn a_remote_ai_never_tags_a_secure_note_and_never_learns_its_revision() {
    let text = doc("ai_edit: true\nsecure: true\n");
    let (_dir, mut store, path) = note(&text);
    for tagger in [AGENT, REMOTE_CHAT] {
        let err = store.change_tags_for_ai(ID, &add(&["b"]), tagger, "fnv1a64:0").unwrap_err();
        assert!(!err.contains("revision"), "the gate answers before the revision: {err}");
    }
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_secret_shaped_tag_is_refused_for_a_remote_ai() {
    let text = doc("ai_edit: true\n");
    let (_dir, mut store, path) = note(&text);
    let secret = "sk-ant-api03-EXAMPLE0EXAMPLE0EXAM";
    assert!(store.change_tags_for_ai(ID, &add(&[secret]), AGENT, &rev(&path)).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_remote_tag_list_never_names_or_counts_a_tag_only_a_secure_note_carries() {
    let (_dir, mut store) = bare();
    let root = store.root().to_path_buf();
    fs::write(root.join("open.md"), "---\nid: 01JTAGOPEN0000000000000000\ntags: [shared, Public]\n---\n\n# Open\n").unwrap();
    fs::write(root.join("also.md"), "---\nid: 01JTAGALSO0000000000000000\ntags: [public]\n---\n\n# Also\n").unwrap();
    fs::write(root.join("more.md"), "---\nid: 01JTAGMORE0000000000000000\ntags:\n  - public\n---\n\n# More\n").unwrap();
    fs::write(
        root.join("vault.md"),
        "---\nid: 01JTAGSECR0000000000000000\nsecure: true\ntags: [shared, hidden-merger]\n---\n\n# Vault\n",
    )
    .unwrap();
    let remote = store.tag_counts(true).unwrap();
    let names: Vec<(&str, usize)> = remote.iter().map(|c| (c.tag.as_str(), c.count)).collect();
    assert_eq!(names, [("public", 3), ("shared", 1)]);
    assert!(remote.iter().all(|c| !c.ids.contains(&"01JTAGSECR0000000000000000".to_string())));

    let mine = store.tag_counts(false).unwrap();
    let names: Vec<(&str, usize)> = mine.iter().map(|c| (c.tag.as_str(), c.count)).collect();
    assert_eq!(names, [("public", 3), ("shared", 2), ("hidden-merger", 1)]);
}
