// Parity for the permission line rules: locked, secure, ai_edit, created_by
// and local_ai_allowed read the same way on both sides, in every spelling the
// rules name (src-tauri/src/frontmatter_lines.rs, src/lib/frontmatterLines.ts).
// These rows are representative; the seeded differential harness
// (permission_differential_tests.rs) carries the bulk.

use super::entry;

/// A note's permissions as four characters, the harness's verdict: body edit
/// (a/p/r/l), on-device (t/u/f), locked (1/0), secure (1/0).
pub(crate) fn permission_verdict(fields: &[String]) -> String {
    use crate::ai_edit_policy::{body_edit, BodyEdit};
    let body = match body_edit(fields) {
        BodyEdit::Allowed => 'a',
        BodyEdit::PersonWritten => 'p',
        BodyEdit::Revoked => 'r',
        BodyEdit::Locked => 'l',
    };
    let local = match crate::frontmatter_keys::local_ai_allowed(fields) {
        Some(true) => 't',
        Some(false) => 'f',
        None => 'u',
    };
    let flag = |on: bool| if on { '1' } else { '0' };
    let locked = fields.iter().any(|line| crate::corpus::locked_field(line) == Some(true));
    let secure = fields.iter().any(|line| crate::corpus::secure_field(line) == Some(true));
    [body, local, flag(locked), flag(secure)].iter().collect()
}

#[test]
fn permission_line_cases_match_fixture() {
    for case in entry("permissionLineCases").as_array().unwrap() {
        let fields: Vec<String> = case["fields"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect();
        assert_eq!(permission_verdict(&fields), case["verdict"].as_str().unwrap(), "{fields:?}");
    }
}
