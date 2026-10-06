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
fn document_edit_limits_match_fixture() {
    assert_eq!(
        entry("documentEditMaxActions").as_u64(),
        Some(crate::workspace_documents::MAX_ACTIONS as u64)
    );
    assert_eq!(
        entry("documentEditMaxText").as_u64(),
        Some(crate::workspace_documents::MAX_TEXT as u64)
    );
}

#[test]
fn document_edit_max_bytes_matches_fixture() {
    assert_eq!(
        entry("documentEditMaxBytes").as_u64(),
        Some(crate::agent_bridge::DOCX_MAX_BYTES)
    );
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
fn secure_notes_folder_matches_fixture() {
    assert_eq!(
        entry("secureNotesFolder").as_str(),
        Some(crate::corpus::SECURE_NOTES_FOLDER)
    );
}

#[test]
fn strip_markers_match_fixture() {
    assert_eq!(
        string_list(&entry("stripMarkers")),
        crate::corpus::STRIP_MARKERS.to_vec()
    );
}

#[test]
fn native_image_picker_exts_match_fixture() {
    assert_eq!(
        string_list(&entry("nativeImagePickerExts")),
        crate::corpus::NATIVE_IMAGE_PICKER_EXTS
    );
}

#[test]
fn video_exts_match_fixture() {
    assert_eq!(string_list(&entry("videoExts")), crate::corpus::VIDEO_EXTS);
}

#[test]
fn view_folder_forbidden_chars_match_fixture() {
    let chars: Vec<String> = crate::corpus::VIEW_FOLDER_FORBIDDEN_CHARS
        .iter()
        .map(char::to_string)
        .collect();
    assert_eq!(string_list(&entry("viewFolderForbiddenChars")), chars);
}

#[test]
fn templates_brain_folder_matches_fixture() {
    assert_eq!(
        entry("templatesBrainFolder").as_str(),
        Some(crate::organizer::TEMPLATES_BRAIN_FOLDER)
    );
}

#[test]
fn chat_image_asset_max_bytes_matches_fixture() {
    assert_eq!(
        entry("chatImageAssetMaxBytes").as_u64(),
        Some(crate::corpus::CHAT_IMAGE_ASSET_MAX_BYTES as u64)
    );
}

#[test]
fn empty_board_scene_matches_fixture() {
    assert_eq!(
        entry("emptyBoardScene").as_str(),
        Some(crate::corpus::EMPTY_EXCALIDRAW)
    );
}

#[test]
fn board_lane_matches_fixture() {
    assert_eq!(entry("boardLane").as_str(), Some(crate::corpus::BOARD_LANE));
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
        ai_body_edit: "allowed",
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

#[test]
fn ai_keys_match_fixture() {
    assert_eq!(string_list(&entry("aiKeys")), crate::corpus::AI_KEYS.to_vec());
}

#[test]
fn people_area_matches_fixture() {
    assert_eq!(
        entry("peopleArea").as_str(),
        Some(crate::librarian_rules::PEOPLE_AREA)
    );
}

#[test]
fn default_people_groups_match_fixture() {
    assert_eq!(
        string_list(&entry("defaultPeopleGroups")),
        crate::librarian_rules::DEFAULT_PEOPLE_GROUPS
    );
}

#[test]
fn secure_by_name_cases_match_fixture() {
    for case in entry("secureByNameCases").as_array().expect("cases") {
        let keywords = string_list(&case["keywords"]);
        assert_eq!(
            crate::librarian_rules::secure_by_name(
                case["title"].as_str().unwrap(),
                case["rel"].as_str().unwrap(),
                &keywords
            ),
            case["secure"].as_bool().unwrap(),
            "{case}"
        );
    }
}

#[test]
fn ai_creators_match_fixture() {
    assert_eq!(
        string_list(&entry("aiCreators")),
        crate::ai_edit_policy::AI_CREATORS
    );
}

#[test]
fn ai_body_edit_cases_match_fixture() {
    for case in entry("aiBodyEditCases").as_array().expect("cases") {
        let fields = string_list(&case["fields"]);
        assert_eq!(
            crate::ai_edit_policy::body_edit(&fields).as_str(),
            case["verdict"].as_str().unwrap(),
            "{case}"
        );
    }
}

#[test]
fn consented_insert_cases_match_fixture() {
    for case in entry("consentedInsertCases").as_array().expect("cases") {
        let fields = string_list(&case["fields"]);
        assert_eq!(
            crate::ai_edit_policy::consented_insert_refusal(&fields).is_some(),
            case["refused"].as_bool().unwrap(),
            "{case}"
        );
    }
}

/// A note's date stamps read and write alike in the Mac app and Rotli Web
/// (docs/architecture/memex-data-contract.md, "Metadata ownership").
/// `localMidnight` is each side's own zone, so here it is the no-file reading:
/// a local midnight within UTC−12..UTC+14 of the fixture day's UTC midnight.
#[test]
fn note_date_stamps_match_fixture() {
    const HOUR_MS: i64 = 3_600_000;
    const FIXTURE_DAY_UTC_MIDNIGHT: i64 = 1_790_899_200_000; // 2026-10-02T00:00:00Z
    let value = entry("noteDateStamps");
    for case in value["reads"].as_array().expect("reads") {
        let stamp = case["stamp"].as_str().expect("stamp");
        let file = case["fileMs"].as_i64();
        let read = crate::note_dates::stamp_to_ms(stamp, file);
        match case["expect"].as_str().expect("expect") {
            "file" => assert_eq!(read, file, "{case}"),
            "asWritten" => assert_eq!(read, case["ms"].as_i64(), "{case}"),
            "none" => assert_eq!(read, None, "{case}"),
            "localMidnight" => {
                let midnight = crate::note_dates::stamp_to_ms(stamp, None).expect("a day");
                assert_eq!(read, Some(midnight), "{case}");
                let earliest = FIXTURE_DAY_UTC_MIDNIGHT - 14 * HOUR_MS;
                let latest = FIXTURE_DAY_UTC_MIDNIGHT + 12 * HOUR_MS;
                assert!((earliest..=latest).contains(&midnight), "{case}");
            }
            other => panic!("unknown expectation {other}"),
        }
    }
    for case in value["days"].as_array().expect("days") {
        let minutes = case["offsetMinutes"].as_i64().expect("offsetMinutes");
        let now_secs = case["nowMs"].as_i64().expect("nowMs") / 1000;
        assert_eq!(
            crate::note_dates::day_stamp(now_secs, move |_| minutes * 60),
            case["day"].as_str().expect("day"),
            "{case}"
        );
    }
}
