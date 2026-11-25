//! `protected_path`, the one rule an agent lane asks of a path (Codex
//! re-checks of pull request 302, 2026-11-20): every spelling of a protected
//! place is protected, and the guard below keeps agent code from comparing
//! paths any other way.

use super::*;
use crate::corpus::CorpusStore;
use std::fs;
use tempfile::TempDir;

fn vault(keywords: &[&str]) -> (TempDir, CorpusStore) {
    let temp = TempDir::new().unwrap();
    let root = temp.path();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_protected_path\"}\n").unwrap();
    fs::create_dir_all(root.join(".rotli")).unwrap();
    let list = keywords.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(",");
    fs::write(root.join(".rotli/settings.json"), format!("{{\"librarianRules\":{{\"secureKeywords\":[{list}]}}}}\n")).unwrap();
    for dir in ["wiki/_secure/Deep", "wiki/Projects", "wiki/Areas"] {
        fs::create_dir_all(root.join(dir)).unwrap();
    }
    let mut store = CorpusStore::open(root.to_path_buf()).unwrap();
    store.set_agent_lane();
    (temp, store)
}

/// Every way to spell `name`: its case flipped per letter, upper, lower, the
/// long s for each `s`, and decomposed.
fn spellings(name: &str) -> Vec<String> {
    let mut out = vec![name.to_string(), name.to_uppercase(), name.to_lowercase()];
    let chars: Vec<char> = name.chars().collect();
    for i in 0..chars.len() {
        let flipped: String = chars
            .iter()
            .enumerate()
            .map(|(j, c)| if (j % 2 == 0) == (i % 2 == 0) { c.to_uppercase().next().unwrap() } else { *c })
            .collect();
        out.push(flipped);
        if chars[i] == 's' {
            let long: String = chars.iter().enumerate().map(|(j, c)| if j == i { 'ſ' } else { *c }).collect();
            out.push(long);
        }
    }
    out.push(name.nfd().collect());
    out
}

/// Every way to write the separators of `parts` joined: `/`, `\`, doubled,
/// with `./` segments, with a leading `/`.
fn joinings(parts: &[&str]) -> Vec<String> {
    vec![
        parts.join("/"),
        parts.join("\\"),
        parts.join("//"),
        parts.join("/./"),
        format!("/{}", parts.join("/")),
        format!("./{}/", parts.join("/")),
    ]
}

#[test]
fn folding_matches_the_way_the_disk_compares_names() {
    assert_eq!(fold("_ſecure"), fold("_SECURE"));
    assert_eq!(fold("Straße"), fold("STRASSE"));
    assert_eq!(fold("ẞ"), "ss");
    assert_eq!(fold("ﬃ"), "ffi");
    assert_eq!(fold("ΚΑΛΟΣ"), fold("καλος"));
    assert_eq!(fold("Cafe\u{301}"), fold("CAFÉ"));
    assert_ne!(fold("secured"), fold("_secure"));
}

#[test]
fn components_refuse_climbing_and_read_backslashes_as_separators() {
    assert_eq!(components("wiki\\_secure//x/./y"), Some(vec!["wiki".into(), "_secure".into(), "x".into(), "y".into()]));
    assert_eq!(components("wiki/../x"), None);
    assert_eq!(components("..\\x"), None);
    assert!(is_clean("wiki/Projects"));
    assert!(!is_clean("wiki//Projects") && !is_clean("wiki/./x") && !is_clean("wiki\\x") && !is_clean("/wiki"));
}

#[test]
fn every_spelling_of_a_secure_home_is_protected() {
    let (_temp, store) = vault(&[]);
    for home in [vec!["wiki", "_secure"], vec!["Secure notes"]] {
        for leaf in spellings(home[home.len() - 1]) {
            let mut parts: Vec<&str> = home[..home.len() - 1].to_vec();
            parts.push(&leaf);
            parts.extend(["Sub", "note.md"]);
            for path in joinings(&parts) {
                assert!(store.protected_path(&path), "{path:?}");
            }
            parts.truncate(home.len());
            assert!(store.protected_path(&parts.join("/")), "the home itself: {parts:?}");
        }
    }
}

#[test]
fn every_spelling_of_a_keyword_in_any_component_is_protected() {
    let (_temp, store) = vault(&["Straße", "Juniper", "Café", "Cafe"]);
    // a decomposed name holds the bare word as written, as the leaf check read it
    assert!(store.protected_path("wiki/Cafe\u{301}/x.md"));
    for keyword in ["STRASSE", "Juniper", "CAFÉ"] {
        for name in spellings(keyword) {
            for parts in [vec!["wiki", &name], vec!["wiki", "Projects", &name, "Ordinary", "n.md"], vec!["wiki", &format!("Matter {name}"), "x.csv"]] {
                for path in joinings(&parts) {
                    assert!(store.protected_path(&path), "{path:?}");
                }
            }
        }
    }
    for open in ["wiki/Projects/open.md", "wiki/Strassenbahn/x.md", "wiki/Junipers/x.md", "wiki/secured/x.md", "Storage", "Board", ""] {
        assert!(!store.protected_path(open), "{open:?}");
    }
}

#[cfg(unix)]
#[test]
fn climbing_or_unresolvable_paths_fail_closed() {
    let (temp, store) = vault(&[]);
    let root = temp.path();
    for path in ["wiki/../outside", "wiki/Projects/../../etc", "..", "wiki\\..\\x"] {
        assert!(store.protected_path(path), "{path:?}");
    }
    std::os::unix::fs::symlink(root.join("wiki/_secure"), root.join("wiki/Link")).unwrap();
    std::os::unix::fs::symlink(root.join("wiki/missing"), root.join("wiki/Dangling")).unwrap();
    let outside = TempDir::new().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("wiki/Away")).unwrap();
    for path in ["wiki/Link", "wiki/Link/Deep", "wiki/Link/Deep/new/shelf", "wiki/Dangling/x", "wiki/Away/x"] {
        assert!(store.protected_path(path), "{path:?}");
    }
    // a case-insensitive disk opens `LINK` as `Link`
    if cfg!(target_os = "macos") {
        assert!(store.protected_path("wiki/LINK/Deep"));
    }
    // a shelf that names no folder on disk yet is judged by its name alone
    assert!(!store.protected_path("wiki/New/Shelf"));
}

/// The rule replaced the leaf-name and secure-home checks at the board read,
/// the document bridge, and attachments: whatever they protected, it still
/// protects (generated names, both rules asked on the same paths).
#[test]
fn the_rule_protects_everything_the_checks_it_replaced_protected() {
    let (temp, _) = vault(&["Straße", "Cafe", "bank"]);
    let store = CorpusStore::open(temp.path().to_path_buf()).unwrap();
    let names = ["Cafe\u{301}", "CAFE", "café", "Straße", "STRASSE", "bank-login", "Bank details", "plain", "_secure", "_SECURE", "Secure notes"];
    let mut checked = 0;
    for a in names {
        for b in names {
            for path in [format!("wiki/{a}/{b}.md"), format!("{a}/{b}"), format!("wiki/{a}/x/{b}.csv"), format!("{a}.md")] {
                if store.file_is_protected(&path) {
                    checked += 1;
                    assert!(store.protected_path(&path), "{path:?}");
                }
            }
        }
    }
    assert!(checked > 50, "the old check protected {checked} generated paths");
}

#[test]
fn unreadable_keyword_settings_protect_every_path() {
    let (temp, store) = vault(&[]);
    fs::write(temp.path().join(".rotli/settings.json"), "not json").unwrap();
    assert!(store.protected_path("wiki/Projects/open.md"));
}

/// The mechanical guard for the class (AGENTS.md: a reviewer finding of a
/// class lands a guard): agent-lane code never compares a path against a
/// secure home or a keyword itself; it asks `protected_path`. The store's AI
/// gates that agent lanes rely on ask it too.
#[test]
fn agent_lanes_compare_paths_only_through_protected_path() {
    fn production(text: &str) -> &str {
        let cut = ["\n#[cfg(test)]\nmod tests", "\n#[cfg(test)]\n#[path"]
            .iter()
            .filter_map(|marker| text.find(marker))
            .min()
            .unwrap_or(text.len());
        &text[..cut]
    }
    // every agent-lane source file, found on disk so a new one is covered
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut agent_files: Vec<(String, String)> = fs::read_dir(&src)
        .unwrap()
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| (name.starts_with("workspace") || name.starts_with("agent_bridge")) && name.ends_with(".rs") && !name.ends_with("_tests.rs"))
        .map(|name| (name.clone(), fs::read_to_string(src.join(&name)).unwrap()))
        .collect();
    agent_files.sort();
    assert!(agent_files.iter().any(|(name, _)| name == "workspace.rs") && agent_files.len() >= 8, "{:?}", agent_files.iter().map(|f| &f.0).collect::<Vec<_>>());
    let scanned: usize = agent_files.iter().map(|(_, text)| production(text).lines().count()).sum();
    assert!(scanned > 3000, "the guard read only {scanned} production lines");
    let forbidden = ["in_secure_home", "secure_by_name(", "file_is_protected(", "SECURE_NOTES_FOLDER", "\"wiki/_secure", "\"Secure notes", "/_secure", "_secure/", "\"_secure"];
    // the AI row builders serve the app's own lanes too (an on-device reader's
    // file_is_protected is theirs), but never compare a path to a secure home
    // themselves (Opus re-check of #304, mutation 6)
    for (number, line) in include_str!("corpus_ai_rows.rs").lines().enumerate().filter(|(_, line)| !line.trim_start().starts_with("//")) {
        for token in ["in_secure_home", "secure_by_name(", "SECURE_NOTES_FOLDER", "\"wiki/_secure", "\"Secure notes", "/_secure", "_secure/", "\"_secure"] {
            assert!(!line.contains(token), "corpus_ai_rows.rs:{}: compares a path without protected_path: {line}", number + 1);
        }
    }
    for (name, text) in &agent_files {
        for (number, line) in production(text).lines().enumerate() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            for token in forbidden {
                assert!(!line.contains(token), "{name}:{}: compares a path without protected_path: {line}", number + 1);
            }
        }
    }
    let rules = include_str!("corpus_rules.rs");
    let body = |text: &'static str, start: &str| {
        let from = text.find(start).unwrap_or_else(|| panic!("{start} is gone; update this guard"));
        &text[from..from + text[from..].find("\n    }\n").unwrap()]
    };
    let rule = include_str!("corpus_protected_path.rs");
    let bridge = include_str!("agent_bridge.rs");
    // each agent-lane gate, and the call that makes it one: deleting the
    // call fails here even when no forbidden spelling is added (Opus review
    // of pull request 304: removing it from read_board_for_remote kept this
    // guard green)
    let gates: [(&'static str, &str, &str); 14] = [
        (rules, "fn file_is_protected(", "protected_path("),
        (rules, "fn agent_listable(", "protected_path("),
        (rules, "fn agent_listable_folder(", "agent_listable("),
        (rule, "fn agent_row(", "agent_folder("),
        (rule, "fn agent_doc(", "agent_folder("),
        (rule, "fn agent_folder(", "protected_path("),
        (include_str!("corpus_ai_rows.rs"), "fn parse_approved(", "agent_row("),
        (include_str!("corpus_ai_gate.rs"), "fn read_doc_for_ai(", "agent_doc("),
        (include_str!("workspace.rs"), "fn open_target(", "set_agent_lane()"),
        (include_str!("workspace.rs"), "fn read_board_for_remote(", "protected_path("),
        (include_str!("workspace_file_visibility.rs"), "fn file_visible_to_remote(", "file_visible("),
        (include_str!("workspace_file_visibility.rs"), "fn file_visible(", "protected_path("),
        (bridge, "fn document_records_gate(", "protected_path("),
        (bridge, "fn document_contents_gate(", "content_visible("),
    ];
    for (text, start, call) in gates {
        assert!(body(text, start).contains(call), "{start} no longer calls {call}");
    }
    assert!(body(rule, "fn agent_row(").contains("agent_origin(") && body(rule, "fn agent_doc(").contains("agent_origin("));
    // an attachment target passes the admit gate's own visibility test
    assert!(body(include_str!("workspace_attachments.rs"), "fn describe_attachment(").contains("reference_visible_to_remote("));
    // the agent-lane functions in corpus*.rs never compare a path themselves
    let corpus_lanes = [
        (rules, "fn agent_listable("),
        (rules, "fn agent_listable_folder("),
        (include_str!("corpus.rs"), "fn move_for_remote_agent("),
        (include_str!("corpus.rs"), "fn create_for_remote_agent("),
        (rule, "fn agent_row("),
        (rule, "fn agent_doc("),
        (rule, "fn agent_folder("),
        (rule, "fn agent_origin("),
    ];
    for (text, start) in corpus_lanes {
        for line in body(text, start).lines().filter(|line| !line.trim_start().starts_with("//")) {
            for token in forbidden {
                assert!(!line.contains(token), "{start} compares a path without protected_path: {line}");
            }
        }
    }
}

/// Every field of a row, a read note, or a folder an agent lane returns,
/// classified. A path is cleaned by `agent_row` / `agent_doc` (or, for a
/// folder, judged by `agent_listable_folder`); anything else is the note's
/// own text, a label, or a fact. A new field fails here until it is
/// classified, and, if it is a path, cleaned (Opus review of pull request
/// 304: `origin` was a path nobody cleaned).
const FIELDS: [(&str, &[&str], &[&str]); 3] = [
    ("NoteMeta", &["id", "folder_id", "disk_folder_id", "origin"], &["title", "snippet", "body_empty", "aliases", "created_at", "updated_at", "pinned", "kind", "secure"]),
    ("NoteDoc", &["id", "folder_id", "disk_folder_id", "origin"], &["body", "revision", "created_at", "updated_at", "pinned", "secure", "locked"]),
    ("FolderMeta", &["id", "parent_id"], &["name"]),
];

#[test]
fn every_field_an_agent_sees_is_classified() {
    let corpus = include_str!("corpus.rs");
    for (name, paths, others) in FIELDS {
        let start = corpus.find(&format!("pub struct {name} {{")).unwrap_or_else(|| panic!("{name} is gone; update this guard"));
        let body = &corpus[start..start + corpus[start..].find("\n}").unwrap()];
        let mut fields: Vec<&str> = body
            .lines()
            // every field, whatever its visibility (`pub(crate) origin` was missed)
            .filter_map(|line| {
                let line = line.trim();
                let line = line.strip_prefix("pub(crate) ").or_else(|| line.strip_prefix("pub(super) ")).or_else(|| line.strip_prefix("pub ")).unwrap_or(line);
                let (field, _) = line.split_once(':')?;
                field.chars().all(|c| c.is_ascii_lowercase() || c == '_').then_some(field).filter(|field| !field.is_empty())
            })
            .collect();
        fields.sort();
        let mut known: Vec<&str> = paths.iter().chain(others.iter()).copied().collect();
        known.sort();
        assert_eq!(fields, known, "{name}: classify each new field here, and clean it in agent_row/agent_doc if it names a path");
    }
}

fn meta(id: &str, folder: &str, disk: &str, origin: Option<&str>) -> NoteMeta {
    NoteMeta {
        id: id.into(),
        title: "Plan".into(),
        snippet: String::new(),
        body_empty: false,
        aliases: Vec::new(),
        folder_id: folder.into(),
        disk_folder_id: disk.into(),
        created_at: 0,
        updated_at: 0,
        pinned: false,
        origin: origin.map(Into::into),
        kind: crate::corpus::NoteKind::Note,
        secure: false,
    }
}

#[test]
fn no_path_field_an_agent_sees_names_a_protected_place() {
    let (_temp, store) = vault(&["Juniper"]);
    for place in ["wiki/_secure/x", "wiki/Projects/Juniper", "wiki/../up", "wiki//double", "wiki\\x"] {
        let rows = [
            meta(place, "wiki/Projects", "wiki/Projects", None),
            meta("01ID", place, "wiki/Projects", None),
            meta("01ID", "wiki/Projects", place, None),
            meta("01ID", "wiki/Projects", "wiki/Projects", Some(place)),
        ];
        for row in rows {
            if let Some(shown) = store.agent_row(row.clone()) {
                // the folder a note lives in comes from the walk: unprotected
                // is enough; every other path must also be clean
                assert!(!store.protected_path(&shown.disk_folder_id), "{place}: {row:?}");
                for path in [Some(shown.id.clone()), Some(shown.folder_id.clone()), shown.origin.clone()].into_iter().flatten() {
                    assert!(path == "01ID" || (is_clean(&path) && !store.protected_path(&path)), "{place}: {row:?} showed {path:?}");
                }
            }
        }
    }
}

#[test]
fn no_path_field_of_a_read_note_names_a_protected_place() {
    let (_temp, store) = vault(&["Juniper"]);
    let doc = |id: &str, folder: &str, disk: &str, origin: Option<&str>| NoteDoc {
        id: id.into(),
        folder_id: folder.into(),
        disk_folder_id: disk.into(),
        body: String::new(),
        revision: String::new(),
        created_at: 0,
        updated_at: 0,
        pinned: false,
        origin: origin.map(Into::into),
        secure: false,
        locked: false,
    };
    for place in ["wiki/_secure/x", "wiki/Projects/Juniper", "wiki/../up", "wiki//double"] {
        let docs = [
            doc(place, "wiki/Projects", "wiki/Projects", None),
            doc("01ID", place, "wiki/Projects", None),
            doc("01ID", "wiki/Projects", place, None),
            doc("01ID", "wiki/Projects", "wiki/Projects", Some(place)),
        ];
        for read in docs {
            if let Ok(shown) = store.agent_doc(read) {
                assert!(!store.protected_path(&shown.disk_folder_id), "{place}");
                for path in [Some(shown.id), Some(shown.folder_id), shown.origin].into_iter().flatten() {
                    assert!(path == "01ID" || (is_clean(&path) && !store.protected_path(&path)), "{place} showed {path:?}");
                }
            }
        }
    }
}

#[test]
fn a_folder_row_is_judged_with_its_parents() {
    let (_temp, mut store) = vault(&["Juniper"]);
    for (id, parent) in [("wiki/_secure/x", "wiki/_secure"), ("wiki/Projects/Juniper/Ordinary", "wiki/Projects/Juniper")] {
        assert!(store.protected_path(parent) && !store.agent_listable_folder(id), "{id}");
    }
    assert!(store.agent_listable_folder("wiki/Projects"));
}

/// Final review threads on pull request 304, hold 1: any `word:` prefix,
/// once or more, in front of a protected path still names it.
#[test]
fn a_protected_path_behind_any_prefix_is_protected() {
    let (_temp, store) = vault(&["Juniper"]);
    for text in ["evil:wiki/_secure/Leak", "x:y:wiki/_secure/PrivateId", "a:b:c:wiki/Projects/Juniper", "\"evil:wiki/_secure/Leak\"", "[[x:wiki/_secure/Leak|alias]]"] {
        assert!(store.names_protected_path(text), "{text}");
        assert!(!store.agent_id_shown(text), "{text}");
    }
    for text in ["https://example.com/a/b", "default:wiki/Projects/open", "a:b:wiki/Projects"] {
        assert!(!store.names_protected_path(text), "{text}");
    }
}

/// Hold 2: a secure home anywhere in a path, in any spelling: a trashed or
/// archived copy is still the secure home's.
#[test]
fn a_secure_home_anywhere_in_the_path_is_protected() {
    let (_temp, store) = vault(&[]);
    for path in ["trash/wiki/_secure/Diary.md", "archive/wiki/_secure/a.md", "Trash/wiki/_secure", "Archive/wiki/_SECURE/x", "trash/wiki/_\u{17f}ecure/x", "wiki/Projects/Secure notes/x"] {
        assert!(store.protected_path(path), "{path}");
    }
    for path in ["trash/wiki/Projects/x.md", "wiki/secure/x", "wiki/_securely/x"] {
        assert!(!store.protected_path(path), "{path}");
    }
}

/// The person's own lifecycle moves never ask the agent rule: a secure note
/// trashed by path is restored and read as before; only an agent's store
/// treats the copy as protected.
#[test]
fn the_persons_restore_from_trash_is_unaffected() {
    let (temp, _) = vault(&[]);
    fs::write(temp.path().join("memex.json"), "{\"id\":\"mx_protected_path\",\"contract\":\"3.4\",\"apps\":{}}\n").unwrap();
    fs::create_dir_all(temp.path().join("trash/wiki/_secure")).unwrap();
    fs::write(temp.path().join("trash/wiki/_secure/kept.md"), "---\nid: 01PATHKEPT00000000000000000\n---\n# Kept\n\nbody\n").unwrap();
    let mut person = CorpusStore::open(temp.path().to_path_buf()).unwrap();
    person.list().unwrap();
    assert!(person.read("01PATHKEPT00000000000000000").unwrap().body.contains("body"));
    let restored = person.move_note("01PATHKEPT00000000000000000", "wiki/_secure").unwrap();
    assert_eq!(restored.disk_folder_id, "wiki/_secure");
    let mut agent = CorpusStore::open(temp.path().to_path_buf()).unwrap();
    agent.set_agent_lane();
    assert!(agent.protected_path("trash/wiki/_secure/kept.md"));
}
