//! Librarian rules (2026-09-28): how the person wants the Library kept, in plain
//! settings rather than code. One `librarianRules` object in the vault's
//! `.rotli/settings.json`, owned by the frontend (src/lib/librarianRules.ts
//! parses the same shape); Rust only READS it. Anything missing or malformed
//! falls back to the defaults, never an error.
//!
//! - `secureKeywords`: words that make a note secure when they appear in its
//!   title or file name. Matched here, deterministically, on the NAME only —
//!   never the body, and never by a model — and the note goes to the one
//!   protected folder like any other secure note (the owner's call).
//! - `people`: how the People area is split — `groups` (sub-folders such as
//!   People/Friends, created on first filing) or `simple` (one People folder).
//! - `filing`: plain sentences the Librarian follows when it files.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde_json::Value;

/// The People area's folder name (byte-identical to PEOPLE_AREA in
/// src/lib/librarianActions.ts; pinned by scripts/fixtures/parity.json).
pub(crate) const PEOPLE_AREA: &str = "People";
/// The People groups a vault starts with (parity-pinned like PEOPLE_AREA).
pub(crate) const DEFAULT_PEOPLE_GROUPS: &[&str] = &["Family", "Friends", "Work", "Acquaintances"];

const MAX_KEYWORDS: usize = 50;
const MAX_GROUPS: usize = 20;
const MAX_FILING: usize = 20;
const MAX_WORD: usize = 40;
const MAX_SENTENCE: usize = 200;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LibrarianRules {
    pub(crate) secure_keywords: Vec<String>,
    /// Empty = the simple mode: one People folder, no groups.
    pub(crate) people_groups: Vec<String>,
    pub(crate) filing: Vec<String>,
}

impl Default for LibrarianRules {
    fn default() -> Self {
        LibrarianRules {
            secure_keywords: Vec::new(),
            people_groups: DEFAULT_PEOPLE_GROUPS
                .iter()
                .map(|g| g.to_string())
                .collect(),
            filing: Vec::new(),
        }
    }
}

/// A People group becomes a folder, so it is a single plain name: no path
/// separators, no leading `_` or `.` (those are Rotli's own lanes), no `..`.
pub(crate) fn valid_group(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.chars().count() <= MAX_WORD
        && !name.contains(['/', '\\', ':'])
        && !name.contains("..")
        && !name.starts_with(['_', '.'])
}

fn strings(v: Option<&Value>, max_items: usize, max_len: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in v.and_then(Value::as_array).into_iter().flatten() {
        let Some(text) = item.as_str().map(str::trim) else {
            continue;
        };
        if text.is_empty() || text.chars().count() > max_len {
            continue;
        }
        if out.iter().any(|seen| seen.eq_ignore_ascii_case(text)) {
            continue;
        }
        out.push(text.to_string());
        if out.len() == max_items {
            break;
        }
    }
    out
}

/// The rules out of the whole settings.json text.
pub(crate) fn parse_rules(settings_json: &str) -> LibrarianRules {
    let v: Value = serde_json::from_str(settings_json).unwrap_or(Value::Null);
    let Some(rules) = v.get("librarianRules").filter(|r| r.is_object()) else {
        return LibrarianRules::default();
    };
    let people = rules.get("people");
    let simple = people.and_then(|p| p.get("mode")).and_then(Value::as_str) == Some("simple");
    let people_groups = if simple {
        Vec::new()
    } else {
        match people.and_then(|p| p.get("groups")) {
            Some(groups) => strings(Some(groups), MAX_GROUPS, MAX_WORD)
                .into_iter()
                .filter(|g| valid_group(g))
                .collect(),
            None => LibrarianRules::default().people_groups,
        }
    };
    LibrarianRules {
        secure_keywords: strings(rules.get("secureKeywords"), MAX_KEYWORDS, MAX_WORD),
        people_groups,
        filing: strings(rules.get("filing"), MAX_FILING, MAX_SENTENCE),
    }
}

/// A missing field has the documented empty default. Malformed security
/// settings cannot establish that a name is safe for a remote recipient.
pub(crate) fn classifiable_secure_keywords(settings_json: &str) -> Result<Vec<String>, String> {
    let bad = || "cannot classify secure keywords in settings".to_string();
    let value: Value = serde_json::from_str(settings_json).map_err(|_| bad())?;
    if !value.is_object() {
        return Err(bad());
    }
    if value.get("librarianRules").is_some_and(|rules| !rules.is_object()) {
        return Err(bad());
    }
    if let Some(keywords) = value
        .get("librarianRules")
        .and_then(|rules| rules.get("secureKeywords"))
    {
        let Some(keywords) = keywords.as_array() else {
            return Err(bad());
        };
        if keywords.len() > MAX_KEYWORDS
            || keywords.iter().any(|word| {
                !word.as_str().is_some_and(|word| {
                    let word = word.trim();
                    !word.is_empty() && word.chars().count() <= MAX_WORD
                })
            })
        {
            return Err(bad());
        }
    }
    Ok(parse_rules(settings_json).secure_keywords)
}

/// The vault's secure keywords, read from `<root>/.rotli/settings.json` and
/// cached against the file's modification time: the organizer snapshots many
/// notes per cycle, and the settings file changes rarely.
pub(crate) fn secure_keywords(root: &Path) -> Vec<String> {
    type Cached = Option<(PathBuf, SystemTime, Vec<String>)>;
    static CACHE: Mutex<Cached> = Mutex::new(None);
    let path = root.join(crate::corpus::DOT_DIR).join("settings.json");
    let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else {
        return Vec::new(); // no settings file ⇒ no keywords
    };
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((at, when, keywords)) = cache.as_ref() {
        if *at == path && *when == modified {
            return keywords.clone();
        }
    }
    // raw read: Rotli's own vault sidecar; its bytes never reach a model or the person's view (failing closed here would drop secure keywords)
    let keywords = std::fs::read_to_string(&path)
        .map(|text| parse_rules(&text).secure_keywords)
        .unwrap_or_default();
    *cache = Some((path, modified, keywords.clone()));
    keywords
}

/// The ways a name is cut into lowercased words. A note is secure when ANY of
/// them finds the keyword, because this is a deny list: a new way of reading a
/// name may only ever add protection. Each is defined the same way in
/// src/lib/librarianRules.ts, from Unicode properties both languages share
/// (Alphabetic, Number, Mark):
/// - `Plain`: letters and digits, everything else a break (the first matcher).
/// - `MarksBreak`: the same, with combining marks as breaks too, so `banḱ`
///   (k + U+0301) still holds the word "bank" (the first TS matcher).
/// - `Folded`: NFKC first, marks kept inside words, so a decomposed `é`
///   (e + U+0301) is the `é` a person types, and compatibility forms
///   (fullwidth `ｂａｎｋ`, ligatures) fold to plain letters. Folding alone
///   lost names the others catch (`bank™` folds to "banktm").
#[derive(Clone, Copy)]
enum Words {
    Plain,
    MarksBreak,
    Folded,
}

const EVERY_WAY: [Words; 3] = [Words::Plain, Words::MarksBreak, Words::Folded];

fn words(text: &str, way: Words) -> Vec<String> {
    use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
    let cut = |text: &str, joins: &dyn Fn(char) -> bool| -> Vec<String> {
        text.split(|c: char| !joins(c))
            .filter(|w| !w.is_empty())
            .map(str::to_lowercase)
            .collect()
    };
    match way {
        Words::Plain => cut(text, &|c| c.is_alphanumeric()),
        Words::MarksBreak => cut(text, &|c| c.is_alphanumeric() && !is_combining_mark(c)),
        Words::Folded => cut(&text.nfkc().collect::<String>(), &|c| {
            c.is_alphanumeric() || is_combining_mark(c)
        })
        .into_iter()
        .map(|w| w.nfkc().collect())
        .collect(),
    }
}

/// The short id suffix an older Rotli added to a colliding file name
/// (`bank-login-3f9k2a.md`): a dash and the last six characters of the note's
/// ULID, lowercased (corpus.rs `legacy_filename_stem`). Only that exact ASCII
/// shape, with a digit in it, is dropped; anything else stays a word.
fn without_id_suffix(stem: &str) -> &str {
    const ULID_TAIL: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";
    match stem.rsplit_once('-') {
        Some((head, tail))
            if !head.is_empty()
                && tail.len() == 6
                && tail.bytes().all(|b| ULID_TAIL.contains(&b))
                && tail.bytes().any(|b| b.is_ascii_digit()) =>
        {
            head
        }
        _ => stem,
    }
}

/// The words of a note's file name, without its folder, `.md`, and an id suffix.
fn file_words(rel: &str, way: Words) -> Vec<String> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let stem = name.strip_suffix(".md").unwrap_or(name);
    let head = words(without_id_suffix(stem), way);
    if head.is_empty() {
        words(stem, way)
    } else {
        head
    }
}

/// Does a keyword appear in the title or the file name, as whole words, in
/// any case? "bank" matches "Bank login" and `bank-login.md`, never
/// "Riverbank"; a keyword of several words must appear in order.
pub(crate) fn secure_by_name(title: &str, rel: &str, keywords: &[String]) -> bool {
    if keywords.is_empty() {
        return false;
    }
    EVERY_WAY.into_iter().any(|way| {
        let names = [words(title, way), file_words(rel, way)];
        keywords.iter().any(|keyword| {
            let k = words(keyword, way);
            !k.is_empty()
                && names
                    .iter()
                    .any(|name| name.windows(k.len()).any(|at| at == k.as_slice()))
        })
    })
}

/// The areas Classify may pick: the Library's top-level areas and, when the
/// rules split People into groups, each `People/<group>` in place of People
/// itself (a group's folder is created when its first note is filed).
pub(crate) fn with_people_groups(
    mut vocab: Vec<(String, String)>,
    rules: &LibrarianRules,
) -> Vec<(String, String)> {
    // the rules alone govern People's folders, whatever is on disk
    vocab.retain(|(name, _)| {
        !name
            .split_once('/')
            .is_some_and(|(top, _)| top.eq_ignore_ascii_case(PEOPLE_AREA))
    });
    if !rules.people_groups.is_empty() {
        vocab.retain(|(name, _)| !name.eq_ignore_ascii_case(PEOPLE_AREA));
        for group in &rules.people_groups {
            vocab.push((
                format!("{PEOPLE_AREA}/{group}"),
                format!("notes about a person, in the {group} group"),
            ));
        }
    }
    vocab
}

/// The person's filing sentences, as lines for a filing prompt ("" for none).
pub(crate) fn filing_prompt(filing: &[String]) -> String {
    if filing.is_empty() {
        return String::new();
    }
    let mut p = String::from("\nThe person's own filing rules (follow them when they apply):\n");
    for rule in filing {
        p.push_str(&format!("- {rule}\n"));
    }
    p
}

/// An area the Librarian may file into beyond the Library's top-level
/// folders: `People/<group>` for a group the rules name. Returns the
/// canonical spelling, or None for anything else with a `/`.
pub(crate) fn people_group_area(area: &str, rules: &LibrarianRules) -> Option<String> {
    let (root, group) = area.split_once('/')?;
    if !root.eq_ignore_ascii_case(PEOPLE_AREA) || group.contains('/') {
        return None;
    }
    rules
        .people_groups
        .iter()
        .find(|g| g.eq_ignore_ascii_case(group.trim()))
        .map(|g| format!("{PEOPLE_AREA}/{g}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kw(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn missing_or_malformed_rules_are_the_defaults() {
        for text in ["", "not json", "{}", r#"{"librarianRules": 3}"#] {
            assert_eq!(parse_rules(text), LibrarianRules::default());
        }
        assert_eq!(
            LibrarianRules::default().people_groups,
            vec!["Family", "Friends", "Work", "Acquaintances"]
        );
    }

    #[test]
    fn rules_are_trimmed_deduplicated_capped_and_safe() {
        let rules = parse_rules(
            r#"{"librarianRules":{
              "secureKeywords":[" Bank ","bank","",7,"x"],
              "people":{"mode":"groups","groups":["Family","../etc","_hidden","Book club","a/b","family"]},
              "filing":["Recipes go to Cooking","  "]
            }}"#,
        );
        assert_eq!(rules.secure_keywords, kw(&["Bank", "x"]));
        assert_eq!(rules.people_groups, kw(&["Family", "Book club"]));
        assert_eq!(rules.filing, kw(&["Recipes go to Cooking"]));
        let simple =
            parse_rules(r#"{"librarianRules":{"people":{"mode":"simple","groups":["Family"]}}}"#);
        assert!(simple.people_groups.is_empty());
    }

    #[test]
    fn keywords_match_whole_words_of_the_name_only() {
        let keys = kw(&["bank", "tax return"]);
        assert!(secure_by_name(
            "Bank login",
            "wiki/_inbox/bank-login.md",
            &keys
        ));
        assert!(secure_by_name(
            "Notes",
            "wiki/_inbox/my-bank-3f9k2a.md",
            &keys
        ));
        assert!(secure_by_name("2025 Tax Return", "wiki/x.md", &keys));
        assert!(!secure_by_name(
            "Riverbank walk",
            "wiki/_inbox/riverbank-walk.md",
            &keys
        ));
        assert!(!secure_by_name("Return the tax forms", "wiki/x.md", &keys));
        assert!(!secure_by_name("Bank login", "wiki/x.md", &[]));
        // the folder never counts, only the note's own name
        assert!(!secure_by_name(
            "Groceries",
            "wiki/bank/groceries.md",
            &keys
        ));
    }

    #[test]
    fn filing_offers_people_groups_and_carries_the_rules() {
        let vocab = || {
            vec![
                ("People".to_string(), String::new()),
                ("Projects".to_string(), String::new()),
            ]
        };
        let rules = parse_rules(
            r#"{"librarianRules":{"filing":["Recipes go to Cooking"],"people":{"groups":["Family","Friends"]}}}"#,
        );
        let names = |v: Vec<(String, String)>| v.into_iter().map(|(n, _)| n).collect::<Vec<_>>();
        assert_eq!(
            names(with_people_groups(vocab(), &rules)),
            ["Projects", "People/Family", "People/Friends"]
        );
        let simple = parse_rules(r#"{"librarianRules":{"people":{"mode":"simple"}}}"#);
        assert_eq!(
            names(with_people_groups(vocab(), &simple)),
            ["People", "Projects"]
        );
        assert_eq!(
            filing_prompt(&rules.filing),
            "\nThe person's own filing rules (follow them when they apply):\n- Recipes go to Cooking\n"
        );
        assert_eq!(filing_prompt(&[]), "");
    }

    #[test]
    fn only_configured_people_groups_may_be_filed_into() {
        let rules = LibrarianRules::default();
        assert_eq!(
            people_group_area("people/friends", &rules).as_deref(),
            Some("People/Friends")
        );
        assert_eq!(people_group_area("People/Strangers", &rules), None);
        assert_eq!(people_group_area("Projects/Friends", &rules), None);
        assert_eq!(people_group_area("People/Friends/Old", &rules), None);
        assert_eq!(people_group_area("People", &rules), None);
        let simple = parse_rules(r#"{"librarianRules":{"people":{"mode":"simple"}}}"#);
        assert_eq!(people_group_area("People/Friends", &simple), None);
    }
}
