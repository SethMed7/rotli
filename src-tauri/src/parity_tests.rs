//! TS↔Rust parity assertions — hand-written, never generated. The contract is
//! scripts/fixtures/parity.json; src/lib/parity.test.ts asserts the same
//! entries against the real TS modules, and scripts/check-parity.mjs keeps
//! every fixture entry referenced by BOTH suites. A one-sided constant edit
//! fails here (or in bun test) before it ships.

use serde_json::Value;

fn entry(name: &str) -> Value {
    let fixture: Value = serde_json::from_str(include_str!("../../scripts/fixtures/parity.json"))
        .expect("parity.json parses");
    let value = fixture["entries"][name]["value"].clone();
    assert!(!value.is_null(), "parity.json entry \"{name}\" is missing");
    value
}

fn string_list(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("fixture value is an array")
        .iter()
        .map(|item| item.as_str().expect("fixture item is a string").to_string())
        .collect()
}

#[test]
fn sheet_edit_max_bytes_matches_fixture() {
    assert_eq!(
        entry("sheetEditMaxBytes").as_u64(),
        Some(crate::corpus::SHEET_EDIT_MAX_BYTES as u64)
    );
}

#[test]
fn chat_image_asset_exts_match_fixture() {
    assert_eq!(
        string_list(&entry("chatImageAssetExts")),
        crate::corpus::CHAT_IMAGE_ASSET_EXTS
    );
}

#[test]
fn board_limits_match_fixture() {
    let limits = entry("boardLimits");
    assert_eq!(
        limits["maxBytes"].as_u64(),
        Some(crate::board::BOARD_MAX_BYTES as u64)
    );
    assert_eq!(
        limits["maxElements"].as_u64(),
        Some(crate::board::BOARD_MAX_ELEMENTS as u64)
    );
    assert_eq!(
        limits["maxActions"].as_u64(),
        Some(crate::board::BOARD_MAX_ACTIONS as u64)
    );
    assert_eq!(
        limits["maxStringChars"].as_u64(),
        Some(crate::board::BOARD_MAX_STRING_CHARS as u64)
    );
    assert_eq!(
        limits["maxCoordinate"].as_f64(),
        Some(crate::board::BOARD_MAX_COORDINATE)
    );
    assert_eq!(
        limits["maxFiles"].as_u64(),
        Some(crate::board::BOARD_MAX_FILES as u64)
    );
    assert_eq!(
        limits["maxDepth"].as_u64(),
        Some(crate::board::BOARD_MAX_DEPTH as u64)
    );
    assert_eq!(
        limits["maxNodes"].as_u64(),
        Some(crate::board::BOARD_MAX_NODES as u64)
    );
}

#[test]
fn document_convertible_exts_match_fixture() {
    assert_eq!(
        string_list(&entry("documentConvertibleExts")),
        crate::corpus::DOCUMENT_CONVERTIBLE_EXTS
    );
}

#[test]
fn memex_perms_match_fixture() {
    // the enum's serde wire strings ARE the contract — a variant rename fails here
    let wire: Vec<String> = [
        crate::memex::MemexPerms::ChatsInbox,
        crate::memex::MemexPerms::ReadOnly,
    ]
    .iter()
    .map(|p| {
        serde_json::to_value(p)
            .unwrap()
            .as_str()
            .unwrap()
            .to_string()
    })
    .collect();
    assert_eq!(string_list(&entry("memexPerms")), wire);
}

#[test]
fn frontmatter_view_matches_fixture() {
    // the IPC payload-shape half of Batch 5.3: these serde wire keys ARE the
    // contract the TS side's blind `invoke::<FrontmatterView>` cast trusts
    let sample = crate::corpus::FrontmatterView {
        id: String::new(),
        created: String::new(),
        updated: String::new(),
        locked: false,
        secure: false,
        local_ai_allowed: false,
        pinned: false,
        fields: Vec::new(),
    };
    let json = serde_json::to_value(&sample).expect("FrontmatterView serializes");
    let mut keys: Vec<String> = json.as_object().expect("object").keys().cloned().collect();
    keys.sort();
    let mut expected = string_list(&entry("frontmatterView"));
    expected.sort();
    assert_eq!(keys, expected);
}

#[test]
fn keychain_service_matches_fixture() {
    assert_eq!(
        entry("keychainService").as_str(),
        Some(crate::keychain::SERVICE)
    );
}

#[test]
fn keychain_allowed_accounts_match_fixture() {
    assert_eq!(
        string_list(&entry("keychainAllowedAccounts")),
        crate::keychain::WEBVIEW_ALLOWED
    );
}

#[test]
fn cli_bin_candidates_match_fixture() {
    let fixture = entry("cliBinCandidates");
    let map = fixture.as_object().expect("cliBinCandidates is an object");
    assert_eq!(
        map.len(),
        crate::provider::CLIS.len(),
        "fixture and CLIS list different providers"
    );
    for spec in crate::provider::CLIS {
        assert_eq!(
            string_list(&map[spec.id]),
            spec.bins,
            "candidate list drifted for {}",
            spec.id
        );
    }
}

#[test]
fn endpoint_locality_fixtures_agree() {
    for case in entry("endpointLocality")
        .as_array()
        .expect("endpointLocality is an array")
    {
        let url = case["url"].as_str().expect("url is a string");
        let expected = case["local"].as_bool().expect("local is a bool");
        assert_eq!(
            crate::chat::endpoint_is_local(url),
            expected,
            "endpoint_is_local({url:?})"
        );
    }
}

/// The verbatim-phrase egress rule, asserted against the SAME fixture the TS
/// mirror uses. Rust's side is stateful (a process-local ledger of secure
/// prose) where TS's takes the source as an argument, so this teaches the
/// ledger the fixture's source note and then asks the same questions.
#[test]
fn secure_overlap() {
    let value = entry("secureOverlap");
    let source = value["source"]
        .as_str()
        .expect("fixture source is a string");
    crate::secret::remember_secure_text(source);
    for outbound in string_list(&value["matches"]) {
        assert!(
            crate::secret::echoes_secure_text(&outbound),
            "fixture says this overlaps the source note: {outbound}"
        );
    }
    for outbound in string_list(&value["clean"]) {
        assert!(
            !crate::secret::echoes_secure_text(&outbound),
            "fixture says this does NOT overlap: {outbound}"
        );
    }
}
