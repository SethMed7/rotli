//! Tests of frontmatter_keys.rs (split out at its size ceiling).

use super::*;

#[test]
fn every_spelling_names_its_key_and_only_rusts_is_canonical() {
    let key = |line: &str| frontmatter_key(line).map(|k| (k.name, k.canonical));
    assert_eq!(key("created_by: librarian"), Some(("created_by".into(), true)));
    assert_eq!(key("created_by:"), Some(("created_by".into(), true)));
    for spelling in ["  created_by: x", "\tcreated_by: x", "\"created_by\": x", "'created_by': x", "- created_by: x", "? created_by", "created_by : x"] {
        assert_eq!(key(spelling), Some(("created_by".into(), false)), "{spelling:?}");
    }
    for not_a_key in ["- plain item", "# created_by: comment", "continued prose", ""] {
        assert_eq!(key(not_a_key), None, "{not_a_key:?}");
    }
    assert_eq!(canonical_field("created_by: librarian"), Some(("created_by", "librarian")));
    assert_eq!(canonical_field("  created_by: librarian"), None);
    assert_eq!(canonical_field("\"created_by\": librarian"), None);
}

/// Codex review of 7f542f5b: a denial typed in any spelling still denies,
/// in both directions of every key only Rust writes; only Rust's spelling
/// grants. (Canonical-only reading turned an indented `false` into a
/// grant under the default.)
#[test]
fn a_denial_in_any_spelling_holds_and_only_rusts_spelling_grants() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    for spelling in ["  {k}: false", "\"{k}\": false", "- {k}: false", "{k} : no"] {
        let line = |k: &str| spelling.replace("{k}", k);
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true".to_string(), line("local_ai_allowed")]), Some(false), "{spelling}");
        assert_eq!(body_edit(&["created_by: agent".to_string(), line("ai_edit")]), BodyEdit::Revoked, "{spelling}");
    }
    // frontmatter that won't parse denies only the keys a line could
    // spell: the creator here, not AI editing (review of PR #303, item 3)
    assert_eq!(body_edit(&["created_by: agent", "  created_by: someone"]), BodyEdit::PersonWritten);
    assert_eq!(body_edit(&["  created_by: agent"]), BodyEdit::PersonWritten, "a typed creator grants nothing");
    assert_eq!(body_edit(&["  ai_edit: true"]), BodyEdit::PersonWritten, "a typed grant grants nothing");
    assert_eq!(local_ai_allowed(&["  local_ai_allowed: true"]), None, "a typed grant follows the vault");
    assert_eq!(local_ai_allowed(&["local_ai_allowed: true"]), Some(true));
    assert_eq!(body_edit(&["ai_edit: true"]), BodyEdit::Allowed);
    // a control character or U+FEFF, which two YAML parsers could read
    // differently, decides nothing: it denies on both sides
    assert_eq!(body_edit(&["ai_edit: \u{85}true"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["ai_edit: \u{feff}true"]), BodyEdit::Revoked);
}

/// The organizer writes values unquoted (`summary: <one line>`,
/// `links: [[A]], [[B]]`), so frontmatter that won't parse is read once
/// more with the values of plain non-permission keys blanked, and the note
/// keeps its permissions (the round-5 WIP denied all three on such a note,
/// so a filed AI note stopped being editable).
#[test]
fn a_filed_note_with_an_unquoted_colon_keeps_its_permissions() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    let filed = ["summary: Plan: phase two", "links: [[Alpha]], [[Beta]]"];
    let with = |head: &[&str]| head.iter().chain(filed.iter()).map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(body_edit(&with(&["created_by: librarian"])), BodyEdit::Allowed);
    assert_eq!(body_edit(&with(&["created_by: agent", "ai_edit: true"])), BodyEdit::Allowed);
    assert_eq!(body_edit(&with(&[])), BodyEdit::PersonWritten, "not revoked: a consented insert still lands");
    assert_eq!(local_ai_allowed(&with(&["secure: true", "local_ai_allowed: true"])), Some(true));
    assert_eq!(local_ai_allowed(&with(&["secure: true"])), None, "follows the vault");
    // a repeated ordinary key, a stray control character in a plain value, an unclosed list
    for extra in ["tags: [a]\ntags: [b]", "summary: pasted\u{85}text", "x: [unclosed"] {
        let fields: Vec<&str> = ["created_by: agent"].into_iter().chain(extra.split('\n')).collect();
        assert_eq!(body_edit(&fields), BodyEdit::Allowed, "{extra:?}");
    }
}

/// Codex review of PR #303, item 3: a denial only a YAML reader sees (an
/// escaped key in a flow map) holds whatever else the frontmatter holds:
/// an alias elsewhere, a plain value that won't parse. Frontmatter that
/// can't be read even with plain values blanked is refused, which denies.
#[test]
fn a_denial_only_yaml_sees_holds_beside_an_alias_or_a_bad_value() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    let flow = "{\"local\\u005fai_allowed\": false, note: x}";
    for extra in ["a: &k one", "b: *k", "summary: a: b"] {
        let fields = ["secure: true".to_string(), "local_ai_allowed: true".to_string(), flow.replace("{", "{s: 1, ").to_string(), extra.to_string()];
        assert_eq!(local_ai_allowed(&fields), Some(false), "{extra:?}");
    }
    assert_eq!(local_ai_allowed(&["local_ai_allowed: true", "flow: {\"local\\u005fai_allowed\": false}", "a: &k one", "b: *k"]), Some(true), "nested, not a root key");
    assert_eq!(local_ai_allowed(&["local_ai_allowed: true", "a: &k local_ai_allowed", "*k : false"]), Some(false), "an alias as a root key");
    assert_eq!(body_edit(&["created_by: agent", "ai_edit: true", "ai_edit: true"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "!!str ai_edit: false"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "\"ai\\u005fedit\": false"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["{created_by: agent, ai_edit: false}"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["created_by: agent", "\tnested: tab"]), BodyEdit::Allowed, "an unreadable line that spells no key decides nothing");
    assert_eq!(local_ai_allowed(&["local_ai_allowed: \u{feff}true", "summary: a: b"]), Some(false));
}

/// Codex review of PR #303, item 5: identity and repeats are the same on
/// both sides; keys `1.0` and `1.00` are two keys, not a repeat.
#[test]
fn unrelated_keys_never_change_the_verdict() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    assert_eq!(body_edit(&["created_by: agent", "1.0: a", "1.00: b", "summary: The ai_edit setting"]), BodyEdit::Allowed);
    assert_eq!(body_edit(&["created_by: agent", "1: a", "1: b"]), BodyEdit::Allowed, "a repeat of another key decides nothing");
}

/// The reader takes any file's frontmatter, so it never builds a YAML tree
/// and bounds the work first: over 64 KiB, `[`/`{` nested past 64, or YAML
/// nesting past 64 levels is refused, which denies. Nested aliases cost
/// nothing, since no alias is expanded.
#[test]
fn hostile_frontmatter_is_never_built_into_a_tree() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    let mut laughs = vec!["a: &a [x, x, x, x, x, x, x, x, x]".to_string()];
    for (at, name) in "bcdefghijk".chars().enumerate() {
        let prev = "abcdefghijk".chars().nth(at).unwrap();
        laughs.push(format!("{name}: &{name} [{}]", vec![format!("*{prev}"); 9].join(", ")));
    }
    let deep = format!("x: {}{}", "[".repeat(30_000), "]".repeat(30_000));
    let wide = format!("summary: {}", "x".repeat(70_000));
    let long_key = format!("\"{}\": false", "\\u0061".repeat(20_000));
    // refused: a key is denied only where another line could spell it
    // (the escaped key could spell any of them)
    for (hostile, verdict) in [(laughs.join("\n"), BodyEdit::Allowed), (deep, BodyEdit::Allowed), (wide, BodyEdit::Allowed), (long_key, BodyEdit::Locked)] {
        let started = std::time::Instant::now();
        let mut fields: Vec<String> = hostile.split('\n').map(str::to_string).collect();
        fields.push("created_by: agent".into());
        assert_eq!(body_edit(&fields), verdict);
        assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
    }
    // 64 levels of YAML nesting are read; at 65 the frontmatter is refused,
    // and then a key is denied only where another line could spell it
    let nested = |lists: usize, extra: &str| ["local_ai_allowed: true".to_string(), format!("x: {{y: {}{}}}", "[".repeat(lists), "]".repeat(lists)), extra.to_string()];
    assert_eq!(decoded_value(&nested(62, ""), "local_ai_allowed"), Decoded::Value(Some("true".into())));
    assert_eq!(decoded_value(&nested(63, ""), "local_ai_allowed"), Decoded::Refused);
    assert_eq!(local_ai_allowed(&nested(63, "")), Some(true));
    assert_eq!(local_ai_allowed(&nested(63, "z: \"local\\u005fai_allowed\"")), Some(false));
}

/// Review of PR #303 at 828f994d, found by the differential harness: the
/// readers agree on tabs, stray lines, `...`, carriage returns, quoted or
/// YAML-only locks and merge keys, and bound list markers before parsing.
#[test]
fn what_the_differential_harness_found() {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    // item 1: a tab after the colon never grants
    assert_eq!(body_edit(&["ai_edit:\ttrue"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["created_by:\tagent"]), BodyEdit::PersonWritten, "a typed creator grants nothing");
    assert_eq!(local_ai_allowed(&["secure: true", "local_ai_allowed:\ttrue"]), Some(false));
    assert_eq!(body_edit(&["date created:\t2024-01-01"]), BodyEdit::PersonWritten);
    assert_eq!(body_edit(&["created_by: agent", "date created:\t2024-01-01"]), BodyEdit::Allowed);
    assert_eq!(body_edit(&["created_by:  agent"]), BodyEdit::PersonWritten);
    // item 3: one malformed ordinary line changes no permission
    for odd in ["date created: Meeting: x", "c", "- item", "\t- a", "{a: 1,", "%YAML 1.2", "  y: z"] {
        assert_eq!(body_edit(&["created_by: agent", odd]), BodyEdit::Allowed, "{odd:?}");
        assert_eq!(body_edit(&[odd]), BodyEdit::PersonWritten, "{odd:?}");
        assert_eq!(local_ai_allowed(&["secure: true", odd]), None, "{odd:?}");
    }
    assert_eq!(body_edit(&["created_by: agent", "\"a\\qb\": c"]), BodyEdit::Allowed, "blanked: a plain key now");
    assert_eq!(body_edit(&["created_by: agent", "c", "{\"ai\\u005fedit\": false"]), BodyEdit::Locked, "an escape could spell any key, `locked` too");
    // item 6
    assert_eq!(local_ai_allowed(&["...", "secure: true", "local_ai_allowed: true"]), Some(true), "nothing else spells the key");
    assert_eq!(local_ai_allowed(&["...", "local_ai_allowed: true", "x: *nope"]), Some(false), "an alias could");
    assert_eq!(body_edit(&["ai_edit: true\r\r\r"]), BodyEdit::Allowed);
    assert_eq!(body_edit(&["\tnested: tab"]), BodyEdit::PersonWritten);
    // item 8
    for lock in ["locked: \"true\"", "locked: True", "{locked: true}", "!!str locked: true"] {
        assert_eq!(body_edit(&[lock, "created_by: agent"]), BodyEdit::Locked, "{lock:?}");
    }
    assert_eq!(body_edit(&["created_by: agent", "<<: {ai_edit: false}"]), BodyEdit::Revoked);
    assert_eq!(body_edit(&["created_by: agent", "base: &x {ai_edit: false}", "<<: *x"]), BodyEdit::Locked, "an alias could carry any key");
    // item 7
    let started = std::time::Instant::now();
    let markers = format!("  {}a", "- ".repeat(30_000));
    assert_eq!(body_edit(&["created_by: agent", "x:", markers.as_str()]), BodyEdit::Allowed);
    assert!(started.elapsed() < std::time::Duration::from_millis(500), "{:?}", started.elapsed());
}

/// The person's setters clear every spelling of the key they set, so a
/// typed denial never outlives the person's own grant.
#[test]
fn setters_see_every_spelling_of_their_key() {
    assert_eq!(crate::ai_edit_policy::ai_edit_field("  ai_edit: false"), Some(false));
    assert_eq!(crate::corpus::local_ai_allowed_field("\"local_ai_allowed\": false"), Some(false));
}

/// Third independent review of PR #295: a stricter merger read a quoted
/// value as a mapping and deleted a person's whole summary. The merger is
/// dev's again; a value that merely contains a key's name is kept byte for
/// byte, and so is a block scalar's indented text.
#[test]
fn the_metadata_editor_never_drops_a_value_that_mentions_a_key() {
    let original = "---\nid: 01J\n---\n\n# Diary\n\nprose\n";
    for line in [
        "summary: \"Discuss {created_by: librarian} next week\"",
        "notes: [created: soon, owner: me]",
        "plan: |\n  created_by: nobody, this is prose\n  ai_edit: also prose",
    ] {
        let merged = merge_raw_frontmatter(original, &format!("id: 01J\n{line}\n")).unwrap();
        assert!(merged.contains(line), "{line:?} was altered:\n{merged}");
    }
}

/// The guard for the writer class (Codex re-check of PR #303): every
/// production function that composes a note's frontmatter runs
/// `guard_write` (or a wrapper of it) before writing, so no writer can
/// leave a note more permissive than the action owns. A new writer fails
/// this test until it does, or is named below with its reason.
#[test]
fn every_frontmatter_writer_runs_the_guard() {
    const COMPOSERS: [&str; 8] = ["compose_for(", "compose_document(", "compose_in_place(", "with_top_level_line(", "with_key_lines(", "with_secure_line_only(", "with_view_tag(", "merge_raw_frontmatter("];
    const GUARDS: [&str; 5] = ["guard_write(", "keeps(", "keeps_other_verdicts(", "leaves_managed(", "keeps_its_metadata("];
    let exempt: std::collections::HashMap<&str, &str> = [
        ("compose_for", "picks the composer for a write; each caller guards the result"),
        ("create_marked", "creates a new note: there is no earlier frontmatter to loosen"),
        ("compose_in_place", "a pure composer: returns text; its callers write and guard it"),
        ("with_secure_line_only", "a pure composer: returns text; its callers write and guard it"),
        ("with_top_level_line", "a pure composer: returns text; its callers write and guard it"),
        ("with_view_tag", "a pure composer: returns text; its callers write and guard it"),
    ]
    .into_iter()
    .collect();
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    let mut unguarded = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let production = text.split(concat!("#[cfg(test)]\n", "mod tests")).next().unwrap_or_default();
        // each function's text, from its `fn` line to the next one
        let mut function: Option<(String, String)> = None;
        let mut check = |function: Option<(String, String)>| {
            let Some((fn_name, body)) = function else { return };
            let composes = COMPOSERS.iter().any(|call| body.contains(call) && !call.starts_with(&format!("{fn_name}(")));
            if !composes || exempt.contains_key(fn_name.as_str()) {
                return;
            }
            if !GUARDS.iter().any(|guard| body.contains(guard)) {
                unguarded.push(format!("{name}: {fn_name}"));
                return;
            }
            // every path (review of PR #303): each write writes a value a
            // guard checked as its result...
            let guarded = |value: &str| {
                GUARDS.iter().any(|guard| {
                    body.match_indices(guard).any(|(at, _)| {
                        let args = &body[at + guard.len()..];
                        args.split_once(',').is_some_and(|(_, rest)| {
                            let rest = rest.trim_start().trim_start_matches('&');
                            rest.starts_with(value) && !rest[value.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_')
                        })
                    })
                })
            };
            let mut writes = false;
            for (at, _) in body.match_indices("atomic_write(") {
                writes = true;
                let args = &body[at + "atomic_write(".len()..];
                let value: String = args.split_once(',').map(|(_, rest)| rest.trim_start().trim_start_matches('&')).unwrap_or_default().chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
                let not_a_note = [("views_write_unlocked", "raw", "rolls the views manifest back; not a note")];
                if value.is_empty() || !guarded(&value) && !not_a_note.iter().any(|(f, v, _)| *f == fn_name && *v == value) {
                    unguarded.push(format!("{name}: {fn_name} writes `{value}` unguarded"));
                }
            }
            // ...and one that writes nothing never hands back a composer's
            // result before a guard has seen it
            if !writes {
                for line in body.lines() {
                    let direct = line.trim_start().starts_with("Some(") || line.trim_start().starts_with("return ");
                    if direct && COMPOSERS.iter().any(|call| line.contains(call)) {
                        unguarded.push(format!("{name}: {fn_name} returns a composer's result unguarded"));
                    }
                }
            }
        };
        for line in production.lines() {
            let trimmed = line.trim_start();
            let declares = ["fn ", "pub fn ", "pub(crate) fn ", "pub(super) fn ", "async fn ", "pub(crate) async fn "].iter().find(|p| trimmed.starts_with(*p));
            if let Some(prefix) = declares {
                check(function.take());
                let rest = &trimmed[prefix.len()..];
                let fn_name = rest.split(|c: char| !(c.is_alphanumeric() || c == '_')).next().unwrap_or_default().to_string();
                function = Some((fn_name, String::new()));
            } else if let Some((_, body)) = function.as_mut() {
                body.push_str(line);
                body.push('\n');
            }
        }
        check(function.take());
    }
    unguarded.sort();
    assert!(unguarded.is_empty(), "frontmatter writers without guard_write: {unguarded:?}");
}

/// The guard for the class: a production reader of a key only Rust writes
/// goes through this module (`owned_key` for policy, `frontmatter_field`
/// for a setter, `top_level_field` for an in-place writer). A new file that names one of these keys
/// fails this test until it does too (the key lists in corpus.rs read
/// nothing, but corpus.rs reads `local_ai_allowed` through it as well).
#[test]
fn the_keys_rust_owns_are_read_only_through_the_shared_parser() {
    const KEYS: [&str; 3] = ["\"created_by\"", "\"ai_edit\"", "\"local_ai_allowed\""];
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    let mut readers = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") || name.starts_with("frontmatter_") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        // everything above the file's test module (a `#[cfg(test)]` item higher up is still production)
        let production = text.split(concat!("#[cfg(test)]\n", "mod tests")).next().unwrap_or_default();
        if KEYS.iter().any(|key| production.contains(key)) {
            assert!(production.contains("frontmatter_keys::"), "{name} reads a key only Rust writes without frontmatter_keys");
            readers.push(name);
        }
    }
    readers.sort();
    assert_eq!(readers, ["ai_edit_policy.rs", "corpus.rs", "corpus_ai_edit.rs", "corpus_in_place.rs"], "a new reader of a key only Rust writes: check it, then add it here");
}
