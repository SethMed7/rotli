// Parity for the link a new image gets and for what counts as secret-shaped
// (split from parity_tests.rs at its size ceiling).

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
