// Parity for the link a new image gets, how a wikilink's name is compared,
// and what counts as secret-shaped (split from parity_tests.rs at its size
// ceiling).

use super::entry;

/// What counts as secret-shaped agrees on both sides, decimals included.
#[test]
fn looks_secure_fixtures_agree() {
    for case in entry("looksSecure").as_array().expect("looksSecure is an array") {
        let text = case["text"].as_str().expect("text is a string");
        let secret = case["secret"].as_bool().expect("secret is a bool");
        assert_eq!(crate::secret::looks_secure(text), secret, "{text}");
    }
}

/// The link a new image gets (and the link converter writes) agrees on both sides.
#[test]
fn note_image_link_fixtures_agree() {
    for case in entry("noteImageLink").as_array().expect("noteImageLink is an array") {
        let wire = case["wire"].as_str().expect("wire is a string");
        let folder = case["folder"].as_str().expect("folder is a string");
        let link = case["link"].as_str().expect("link is a string");
        assert_eq!(crate::corpus::link_convert::note_image_link(wire, folder), link, "{wire} from {folder}");
    }
}

/// Navigation's name comparison: the editor (wikilink.ts `linkKey`) and Rust
/// (corpus_links.rs `link_key`, used by note selectors) trim and fold a link
/// the same way, U+FEFF included.
#[test]
fn wikilink_navigation_fixtures_agree() {
    for case in entry("wikilinkNavigation")["keys"].as_array().unwrap() {
        let label = case["label"].as_str().unwrap();
        assert_eq!(crate::corpus::links::link_key(label), case["key"].as_str().unwrap(), "link_key({label:?})");
    }
}

/// Who may read a secure note on device: the web vault's reader and Rust's
/// decide the same way, failing closed both ways (Codex review of 7f542f5b).
#[test]
fn local_ai_allowed_cases_match_fixture() {
    for case in entry("localAiAllowedCases").as_array().unwrap() {
        let fields: Vec<String> = case["fields"].as_array().unwrap().iter().map(|f| f.as_str().unwrap().to_string()).collect();
        let says = match crate::frontmatter_keys::local_ai_allowed(&fields) {
            Some(true) => "grant",
            Some(false) => "deny",
            None => "unset",
        };
        assert_eq!(says, case["says"].as_str().unwrap(), "{case}");
    }
}
