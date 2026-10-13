use base64::Engine;

pub(super) fn assert_fixture(cases: &serde_json::Value) {
    for sample in cases.as_array().expect("Office cases") {
        let file = sample["file"].as_str().unwrap();
        let encoded = match file {
            "secure-office-word.b64" => {
                include_str!("../../../scripts/fixtures/secure-office-word.b64")
            }
            "secure-office-word-metadata.b64" => {
                include_str!("../../../scripts/fixtures/secure-office-word-metadata.b64")
            }
            "secure-office-workbook1900.b64" => {
                include_str!("../../../scripts/fixtures/secure-office-workbook1900.b64")
            }
            "secure-office-workbook1904.b64" => {
                include_str!("../../../scripts/fixtures/secure-office-workbook1904.b64")
            }
            _ => panic!("unexpected Office fixture {file}"),
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .unwrap();
        let extracted = match sample["kind"].as_str().unwrap() {
            "docx" => crate::ai_office_text::docx_text(&bytes),
            "xlsx" => crate::ai_office_text::xlsx_text(&bytes),
            _ => panic!("unexpected Office kind"),
        }
        .unwrap();
        let expected = super::string_list(&sample["tokens"]);
        let actual = crate::secret::prose_tokens(&extracted);
        for phrase in expected.windows(5) {
            assert!(
                actual.windows(5).any(|window| window == phrase),
                "{file} missing: {}",
                phrase.join(" ")
            );
        }
        if let Some(max) = sample["maxRustTokens"].as_u64() {
            assert!(
                actual.len() <= max as usize,
                "{file} recorded {} tokens",
                actual.len()
            );
        }
    }
}
