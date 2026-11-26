// Parity for a brought-in vault's marker: the role map every import writes,
// and what says "connected in place"; and the identity that may open an
// existing vault at all (split from parity_tests.rs at its size ceiling).

use super::entry;

#[test]
fn imported_folder_roles_match_fixture() {
    let expected = serde_json::to_value(crate::vault_roles::FolderRoles::imported()).unwrap();
    assert_eq!(entry("importedFolderRoles"), expected);
}

/// Only a Rotli imported marker whose `inPlace` is exactly `true` says so.
#[test]
fn imported_marker_in_place_matches_fixture() {
    for case in entry("importedMarkerInPlace").as_array().unwrap() {
        let expected = case["inPlace"].as_bool().unwrap();
        assert_eq!(crate::vault_roles::marker_in_place(&case["marker"]), expected, "{case}");
    }
}

/// The one identity that owns every vault. Only Rust refuses an existing
/// vault, so its sentence has no TS twin.
#[test]
fn app_identity_matches_fixture() {
    let identity = entry("appIdentity");
    assert_eq!(crate::app_identity::STANDALONE_IDENTIFIER, identity["standaloneIdentifier"].as_str().unwrap());
}
