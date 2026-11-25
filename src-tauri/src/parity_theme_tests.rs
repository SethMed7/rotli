// Parity for personal theme files: the id rule and the size cap (split from
// parity_tests.rs at its size ceiling).

use super::{entry, string_list};

#[test]
fn theme_file_rules_match_fixture() {
    let rules = entry("themeFileRules");
    assert_eq!(rules["maxBytes"].as_u64(), Some(crate::theme_files::MAX_THEME_FILE_BYTES as u64));
    for id in string_list(&rules["validIds"]) {
        assert!(crate::theme_files::valid_theme_id(&id), "{id} should be a theme id");
    }
    for id in string_list(&rules["invalidIds"]) {
        assert!(!crate::theme_files::valid_theme_id(&id), "{id} should not be a theme id");
    }
}
