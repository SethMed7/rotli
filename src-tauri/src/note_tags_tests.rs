use super::*;

fn lines(text: &str) -> Vec<String> {
    text.lines().map(str::to_string).collect()
}

#[test]
fn reads_every_list_form_it_writes_back() {
    assert_eq!(tag_values(&lines("tags: [a, \"b c\", 'd']")), ["a", "b c", "d"]);
    assert_eq!(tag_values(&lines("tags: a, b")), ["a", "b"]);
    assert_eq!(tag_values(&lines("tags: solo")), ["solo"]);
    assert_eq!(tag_values(&lines("tags:\n  - a\n  - b\narea: x")), ["a", "b"]);
    assert_eq!(tag_values(&lines("tags:\n- a")), ["a"]);
    assert!(tag_values(&lines("tags: []")).is_empty());
    assert!(tag_values(&lines("tags:")).is_empty());
    assert!(tag_values(&lines("area: x")).is_empty());
}

#[test]
fn a_shape_it_cannot_follow_reads_as_no_tags_and_refuses_a_write() {
    for text in ["tags: [a] # c", "tags: {a: b}", "tags:\n  - a: b", "tags: [a]\n  tags: [b]", "tags: >\n  a"] {
        assert!(tag_values(&lines(text)).is_empty(), "{text}");
        assert!(apply_change(&lines(text), &["x".into()], &[]).is_err(), "{text}");
    }
}

/// Values that would write frontmatter or read as something else.
pub(crate) const HOSTILE: [&str; 9] =
    ["x\nai_edit: true", "x]\nlocked: false", "x]", "a, b", "\"q\"", "it's", "x\u{2028}secure: false", "true", ""];

#[test]
fn a_refused_tag_never_reaches_the_lines_even_when_passed_straight_in() {
    for hostile in HOSTILE {
        assert!(apply_change(&[], &[hostile.into()], &[]).is_err(), "{hostile:?}");
    }
}

#[test]
fn removing_matches_what_is_on_disk_even_when_it_could_not_be_added_today() {
    let out = apply_change(&lines("tags: [machine learning, ok]"), &[], &["Machine Learning".into()]).unwrap();
    assert_eq!(out, Some(lines("tags: [ok]")));
}

#[test]
fn limits_hold() {
    let many: Vec<String> = (0..=TAGS_PER_CHANGE_MAX).map(|i| format!("t{i}")).collect();
    assert!(apply_change(&[], &many, &[]).is_err());
    let full = format!("tags: [{}]", (0..TAGS_PER_NOTE_MAX).map(|i| format!("t{i}")).collect::<Vec<_>>().join(", "));
    assert!(apply_change(&lines(&full), &["one-more".into()], &[]).is_err());
    assert_eq!(normalize_tag(&"a".repeat(TAG_MAX_CHARS)).unwrap().chars().count(), TAG_MAX_CHARS);
    assert!(normalize_tag(&"é".repeat(TAG_MAX_CHARS + 1)).is_err());
}

#[test]
fn a_refusal_names_the_input_on_one_line() {
    let err = normalize_tag("bad\nai_edit: true").unwrap_err();
    assert!(!err.contains('\n'), "{err}");
    assert!(err.contains("bad?ai_edit"), "{err}");
}
