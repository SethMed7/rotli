// Parity for note tags (src-tauri/src/note_tags.rs, src/lib/noteTags.ts): the
// allowlist that keeps a tag from writing frontmatter, and the `tags:` line
// editor that keeps every other line, and every tag already there, as written.

use super::{entry, string_list};
use crate::note_tags::{apply_change, normalize_tag, TAGS_PER_CHANGE_MAX, TAGS_PER_NOTE_MAX, TAG_MAX_CHARS};

#[test]
fn note_tag_cases_match_fixture() {
    for case in entry("noteTagCases").as_array().expect("cases") {
        let input = case["input"].as_str().unwrap();
        assert_eq!(normalize_tag(input).ok().as_deref(), case["tag"].as_str(), "{case}");
    }
}

#[test]
fn note_tag_edit_cases_match_fixture() {
    for case in entry("noteTagEditCases").as_array().expect("cases") {
        let fields = string_list(&case["fields"]);
        let got = apply_change(&fields, &string_list(&case["add"]), &string_list(&case["remove"]));
        match &case["result"] {
            serde_json::Value::Null => assert!(got.is_err(), "{case} → {got:?}"),
            serde_json::Value::String(s) if s == "unchanged" => assert_eq!(got, Ok(None), "{case}"),
            lines => assert_eq!(got, Ok(Some(string_list(lines))), "{case}"),
        }
    }
}

#[test]
fn note_tag_limits_match_fixture() {
    let limits = entry("noteTagLimits");
    assert_eq!(limits["tagMaxChars"], TAG_MAX_CHARS);
    assert_eq!(limits["tagsPerChangeMax"], TAGS_PER_CHANGE_MAX);
    assert_eq!(limits["tagsPerNoteMax"], TAGS_PER_NOTE_MAX);
}
