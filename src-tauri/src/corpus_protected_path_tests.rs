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
    let (_temp, store) = vault(&["Straße", "Juniper", "Café"]);
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
    for path in ["wiki/Link", "wiki/Link/Deep", "wiki/Link/Deep/new/shelf", "wiki/LINK/Deep", "wiki/Dangling/x", "wiki/Away/x"] {
        assert!(store.protected_path(path), "{path:?}");
    }
    // a shelf that names no folder on disk yet is judged by its name alone
    assert!(!store.protected_path("wiki/New/Shelf"));
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
    let forbidden = ["in_secure_home", "secure_by_name(", "file_is_protected(", "SECURE_NOTES_FOLDER", "\"wiki/_secure", "\"Secure notes"];
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
    assert!(body(rules, "fn file_is_protected(").contains("protected_path("), "judge_for_ai and file_for_ai ask it through here");
    assert!(body(rules, "fn agent_listable(").contains("protected_path("));
    assert!(body(include_str!("corpus_ai_rows.rs"), "fn parse_approved(").contains("agent_row("));
    assert!(body(include_str!("corpus.rs"), "fn read_doc_for_ai(").contains("agent_doc("));
    assert!(body(include_str!("workspace.rs"), "fn open_target(").contains("set_agent_lane()"));
}
