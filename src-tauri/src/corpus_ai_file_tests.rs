// AI file read gates and extracted-text egress ledger coverage.

use super::*;
use std::process::Command;
use tempfile::TempDir;

#[test]
fn ai_file_gate_refuses_secure_home_and_honors_local_knob() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/plan.csv";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    fs::write(store.root().join(rel), "task,status\nDraft,ready").unwrap();
    assert!(store.file_for_ai(rel, false).is_err());
    assert!(store.file_for_ai(rel, true).is_ok());
    store
        .dot_write("settings", "{\"secureLocalAi\":false}")
        .unwrap();
    assert!(store.file_for_ai(rel, true).is_err());
    let ordinary = "Storage/summary.csv";
    fs::create_dir_all(store.root().join("Storage")).unwrap();
    fs::write(store.root().join(ordinary), "task,status\nDraft,ready").unwrap();
    assert!(store.file_for_ai(ordinary, false).is_ok());
    let named = "Storage/bank-plan.csv";
    fs::write(store.root().join(named), "task,status\nDraft,ready").unwrap();
    store
        .dot_write(
            "settings",
            "{\"secureLocalAi\":false,\"librarianRules\":{\"secureKeywords\":[\"bank\"]}}",
        )
        .unwrap();
    assert!(store.file_for_ai(named, false).is_err());
    assert!(store.file_for_ai(named, true).is_err());
}

#[test]
fn ai_note_read_gate_refuses_plain_text_in_secure_homes() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    for rel in ["wiki/_secure/plan.csv", "Secure notes/plan.txt"] {
        fs::create_dir_all(store.root().join(Path::new(rel).parent().unwrap())).unwrap();
        fs::write(store.root().join(rel), "task,status\nDraft,ready").unwrap();
        assert!(store.read_for_ai(rel, false).is_err(), "remote read: {rel}");
        assert!(store.read_for_ai(rel, true).is_ok(), "local read: {rel}");
    }
    store
        .dot_write("settings", "{\"secureLocalAi\":false}")
        .unwrap();
    assert!(store.read_for_ai("Secure notes/plan.txt", true).is_err());
}

#[test]
fn corpus_read_ai_route_uses_the_shared_gate_for_plain_text_files() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    for rel in ["wiki/_secure/plan.csv", "Secure notes/plan.txt"] {
        fs::create_dir_all(store.root().join(Path::new(rel).parent().unwrap())).unwrap();
        fs::write(store.root().join(rel), "task,status\nDraft,ready").unwrap();
        assert!(
            read_ai_versioned(&mut store, rel, false, false).is_err(),
            "{rel}"
        );
        assert_eq!(
            read_ai_versioned(&mut store, rel, true, false)
                .unwrap()
                .body,
            "task,status\nDraft,ready"
        );
    }
}

#[test]
fn allowed_local_secure_file_text_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/plan.txt";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The amber orchard schedule moves to the thirteenth of November.";
    fs::write(store.root().join(rel), prose).unwrap();
    let bytes = store.read_file_bytes_for_ai(rel, true).unwrap();
    assert_eq!(bytes, prose.as_bytes());
    assert!(crate::secret::blocked_for_remote(prose));
}

#[test]
fn allowed_local_secure_docx_text_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/plan.docx";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The violet harbor timetable changes before winter arrives.";
    let xml = format!(
        "<w:document><w:body><w:p><w:r><w:t>{prose}</w:t></w:r></w:p></w:body></w:document>"
    );
    let bytes = crate::ai_files::tests::zip_with(&[("word/document.xml", xml.as_bytes())], true);
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(prose));
}

#[test]
fn secure_docx_image_alt_text_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let alt = "The saffron observatory appointment moves before next winter.";
    let name = "The lilac lighthouse picture belongs to the private archive.";
    let drawing = "The cobalt drawing caption stays inside the local vault.";
    let document = format!(
        "<w:document><w:body><w:p><w:r><w:t>Public plan</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:docPr id=\"1\" name=\"{name}\" descr=\"{alt}\"/><a:graphic><a:t>{drawing}</a:t></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>"
    );
    let bytes = crate::ai_files::tests::zip_with(&[("word/document.xml", document.as_bytes())], true);
    let rel = "Secure notes/image.docx";
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    for phrase in [alt, name, drawing] {
        assert!(crate::secret::blocked_for_remote(phrase), "missing {phrase}");
    }
}

#[test]
fn secure_docx_run_attributes_do_not_split_model_visible_prose() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The hidden silver orchard meeting moves before winter.";
    let document = b"<w:document><w:body><w:p><w:r w:rsidR=\"001\"><w:t xml:space=\"preserve\">The hidden silver orchard </w:t></w:r><w:r w:rsidR=\"002\"><w:t>meeting moves before winter.</w:t></w:r></w:p></w:body></w:document>";
    let bytes = crate::ai_files::tests::zip_with(&[("word/document.xml", document)], true);
    let rel = "Secure notes/split-runs.docx";
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(prose));
}

#[test]
fn secure_docx_tabs_breaks_and_carriage_returns_preserve_visible_phrases() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let xml = b"<w:document><w:body><w:p><w:r><w:t>The silver</w:t><w:tab/><w:t>orchard meeting</w:t><w:br/><w:t>moves before</w:t><w:cr/><w:t>winter arrives.</w:t></w:r></w:p></w:body></w:document>";
    let rel = "Secure notes/whitespace.docx";
    fs::write(
        store.root().join(rel),
        crate::ai_files::tests::zip_with(&[("word/document.xml", xml)], true),
    )
    .unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(
        "The silver orchard meeting moves before winter arrives."
    ));
}

#[test]
fn non_visible_word_metadata_cannot_evict_prose_from_one_read() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The violet lighthouse schedule changes before the autumn tide arrives.";
    let mut xml = format!("<w:document><w:body><w:p><w:r><w:t>{prose}</w:t></w:r></w:p>");
    for id in 0..52_000 {
        xml.push_str(&format!("<w:p w:rsidR=\"{id:08}abcdefgh\"/>"));
    }
    xml.push_str("</w:body></w:document>");
    let bytes = crate::ai_files::tests::zip_with(&[("word/document.xml", xml.as_bytes())], true);
    let rel = "Secure notes/metadata.docx";
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(prose));
    assert!(
        crate::ai_files::docx_text(&fs::read(store.root().join(rel)).unwrap())
            .unwrap()
            .len()
            < 500
    );
}

#[test]
fn secure_workbook_hyperlink_relationship_reads_and_enters_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let label = "The amber garden itinerary changes before the final snowfall.";
    let target = "https://example.com/private/indigo-harbor-meeting-next-thursday";
    let sheet = format!("<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>{label}</t></is></c></row></sheetData><hyperlinks><hyperlink ref=\"A1\" r:id=\"rId1\"/></hyperlinks></worksheet>");
    let rels = format!("<Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"{target}\" TargetMode=\"External\"/></Relationships>");
    let bytes = crate::ai_files::tests::zip_with(&[
        ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ("xl/worksheets/_rels/sheet1.xml.rels", rels.as_bytes()),
    ], true);
    let rel = "Secure notes/hyperlink.xlsx";
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(label));
    assert!(crate::secret::blocked_for_remote(target));
}

#[test]
fn generated_office_packages_remain_readable_for_secure_local_ai() {
    let tmp = TempDir::new().unwrap();
    let output = Command::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/office-ledger-packages.ts"
        ))
        .arg(tmp.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Office fixture generator failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    for name in [
        "hyperlink.xlsx",
        "hyperlink-comment.xlsx",
        "hyperlink-comment-image.xlsx",
        "image-hyperlink-header.docx",
    ] {
        let rel = format!("Secure notes/{name}");
        fs::copy(tmp.path().join(name), store.root().join(&rel)).unwrap();
        store
            .read_file_bytes_for_ai(&rel, true)
            .unwrap_or_else(|error| panic!("{name} refused: {error}"));
    }
    for phrase in [
        "The amber garden itinerary changes before the final snowfall.",
        "https://example.com/private/indigo-harbor-meeting-next-thursday",
        "The violet orchard comment stays inside the local workbook.",
        "The saffron observatory appointment moves before next winter.",
        "The silver lighthouse guide waits beyond the autumn tide.",
        "https://example.com/private/silver-lighthouse-guide-autumn-tide",
        "The indigo harbor header remains inside the private document.",
    ] {
        assert!(crate::secret::blocked_for_remote(phrase), "missing {phrase}");
    }
}

#[test]
fn allowed_local_secure_xlsx_text_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/plan.xlsx";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The silver garden delivery happens before morning returns.";
    let sheet = format!("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>{prose}</t></is></c></row></sheetData></worksheet>");
    let bytes =
        crate::ai_files::tests::zip_with(&[("xl/worksheets/sheet1.xml", sheet.as_bytes())], true);
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(prose));
}

#[test]
fn secure_workbook_date_displays_enter_remote_overlap_ledger() {
    for (date1904, serial) in [(false, 45306), (true, 43844)] {
        let tmp = TempDir::new().unwrap();
        let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        fs::create_dir_all(store.root().join("Secure notes")).unwrap();
        let workbook = format!(
            "<workbook><workbookPr date1904=\"{}\"/><sheets><sheet name=\"Private Plans\" sheetId=\"1\"/></sheets></workbook>",
            if date1904 { 1 } else { 0 }
        );
        let styles = b"<styleSheet><numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"yyyy-mm-dd\"/></numFmts><cellXfs count=\"2\"><xf numFmtId=\"0\"/><xf numFmtId=\"164\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>";
        let sheet = format!("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"1\"><v>{serial}</v></c><c r=\"B1\" t=\"inlineStr\"><is><t>winter planning review approved</t></is></c></row></sheetData></worksheet>");
        let bytes = crate::ai_files::tests::zip_with(
            &[
                ("xl/workbook.xml", workbook.as_bytes()),
                ("xl/styles.xml", styles),
                ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
            ],
            true,
        );
        let rel = "Secure notes/dates.xlsx";
        fs::write(store.root().join(rel), bytes).unwrap();
        store.read_file_bytes_for_ai(rel, true).unwrap();
        assert!(
            crate::secret::blocked_for_remote("2024-01-15 winter planning review approved"),
            "date1904={date1904}"
        );
    }
}

#[test]
fn numeric_only_secure_workbook_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/numbers.xlsx";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let sheet = b"<worksheet><sheetData><row><c><v>1234567</v></c><c><v>2345678</v></c><c><v>3456789</v></c><c><v>4567890</v></c><c><v>5678901</v></c></row></sheetData></worksheet>";
    let bytes = crate::ai_files::tests::zip_with(&[("xl/worksheets/sheet1.xml", sheet)], true);
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(
        "1234567 2345678 3456789 4567890 5678901"
    ));
}

#[test]
fn secure_office_comments_enter_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let sheet = b"<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>";
    let sheet_secret = "The bronze meadow comment settles after the midsummer lantern parade.";
    let comments = format!(
        "<comments><commentList><comment><text><t>{sheet_secret}</t></text></comment></commentList></comments>"
    );
    let workbook = crate::ai_files::tests::zip_with(
        &[
            ("xl/worksheets/sheet1.xml", sheet),
            ("xl/comments/comment1.xml", comments.as_bytes()),
        ],
        true,
    );
    fs::write(store.root().join("Secure notes/comments.xlsx"), workbook).unwrap();
    store
        .read_file_bytes_for_ai("Secure notes/comments.xlsx", true)
        .unwrap();
    assert!(crate::secret::blocked_for_remote(sheet_secret));

    let word_secret = "The indigo meadow comment settles after the winter lantern parade.";
    let document = b"<w:document><w:body><w:p><w:t>Public plan</w:t></w:p></w:body></w:document>";
    let word_comments = format!(
        "<w:comments><w:comment><w:p><w:t>{word_secret}</w:t></w:p></w:comment></w:comments>"
    );
    let word = crate::ai_files::tests::zip_with(
        &[
            ("word/document.xml", document),
            ("word/comments.xml", word_comments.as_bytes()),
        ],
        true,
    );
    fs::write(store.root().join("Secure notes/comments.docx"), word).unwrap();
    store
        .read_file_bytes_for_ai("Secure notes/comments.docx", true)
        .unwrap();
    assert!(crate::secret::blocked_for_remote(word_secret));
}

#[test]
fn prefixed_strict_workbook_text_enters_remote_overlap_ledger() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/strict.xlsx";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let prose = "The copper lighthouse meeting begins after the first snowfall.";
    let shared = format!(
        "<x:sst xmlns:x=\"http://purl.oclc.org/ooxml/spreadsheetml/main\"><x:si><x:t>{prose}</x:t></x:si></x:sst>"
    );
    let sheet = "<x:worksheet xmlns:x=\"http://purl.oclc.org/ooxml/spreadsheetml/main\"><x:sheetData><x:row><x:c t=\"s\"><x:v>0</x:v></x:c></x:row></x:sheetData></x:worksheet>";
    let bytes = crate::ai_files::tests::zip_with(
        &[
            ("xl/sharedStrings.xml", shared.as_bytes()),
            ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
        ],
        true,
    );
    fs::write(store.root().join(rel), bytes).unwrap();
    store.read_file_bytes_for_ai(rel, true).unwrap();
    assert!(crate::secret::blocked_for_remote(prose));
}

#[test]
fn secure_workbook_formula_enters_remote_overlap_ledger() {
    let formula_secret = "The violet formula records a private winter meeting.";
    let sheet = format!("<worksheet><sheetData><row><c><f>N(&quot;{formula_secret}&quot;)</f><v>0</v></c></row></sheetData></worksheet>");
    remember_secure_workbook(&[("xl/worksheets/sheet1.xml", sheet.as_bytes())], "formula.xlsx");
    assert!(crate::secret::blocked_for_remote(formula_secret));
}

#[test]
fn secure_workbook_tab_name_enters_remote_overlap_ledger() {
    let tab_secret = "The amber tab records a private summer meeting.";
    let sheet = b"<worksheet><sheetData><row><c><v>0</v></c></row></sheetData></worksheet>";
    let book = format!("<workbook><sheets><sheet name=\"{tab_secret}\" sheetId=\"1\"/></sheets></workbook>");
    remember_secure_workbook(&[("xl/worksheets/sheet1.xml", sheet), ("xl/workbook.xml", book.as_bytes())], "tabs.xlsx");
    assert!(crate::secret::blocked_for_remote(tab_secret));
}

fn remember_secure_workbook(parts: &[(&str, &[u8])], name: &str) {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let rel = format!("Secure notes/{name}");
    fs::write(store.root().join(&rel), crate::ai_files::tests::zip_with(parts, true)).unwrap();
    store.read_file_bytes_for_ai(&rel, true).unwrap();
}

#[test]
fn secure_workbook_with_extended_comment_metadata_reads() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let comment = "The lavender numbered comment remains in the secure ledger.";
    let comment_xml = format!("<comments><commentList><comment><text><t>{comment}</t></text></comment></commentList></comments>");
    let sheet = b"<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>";
    let bytes = crate::ai_files::tests::zip_with(&[
        ("xl/worksheets/sheet1.xml", sheet),
        ("xl/comments1.xml", comment_xml.as_bytes()),
        ("xl/commentsExtended.xml", b"<commentsExtended/>"),
    ], true);
    fs::write(store.root().join("Secure notes/metadata.xlsx"), bytes).unwrap();
    assert!(store.read_file_bytes_for_ai("Secure notes/metadata.xlsx", true).is_ok());
    assert!(crate::secret::blocked_for_remote(comment));
}

#[test]
fn secure_workbook_records_other_text_parts() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let threaded = "The threaded coral message stays inside the local ledger.";
    let drawing = "The drawing cobalt label stays inside the local ledger.";
    let pivot = "The pivot silver item stays inside the local ledger.";
    let chart = "The chart green heading stays inside the local ledger.";
    let chartsheet = "The chartsheet amber caption stays inside the local ledger.";
    let custom = "The custom blue payload stays inside the local ledger.";
    let sheet = b"<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>";
    let thread_xml = format!("<ThreadedComments><threadedComment><text>{threaded}</text></threadedComment></ThreadedComments>");
    let drawing_xml = format!("<xdr:wsDr><a:t>{drawing}</a:t></xdr:wsDr>");
    let pivot_xml = format!("<pivotCacheDefinition><cacheFields><cacheField><sharedItems><s v=\"{pivot}\"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>");
    let chart_xml = format!("<c:chartSpace><c:title><a:t>{chart}</a:t></c:title></c:chartSpace>");
    let chartsheet_xml = format!("<chartsheet><a:t>{chartsheet}</a:t></chartsheet>");
    let custom_xml = format!("<custom><text>{custom}</text></custom>");
    let bytes = crate::ai_files::tests::zip_with(&[
        ("xl/worksheets/sheet1.xml", sheet),
        ("xl/threadedComments/threadedComment1.xml", thread_xml.as_bytes()),
        ("xl/drawings/drawing1.xml", drawing_xml.as_bytes()),
        ("xl/pivotCache/pivotCacheDefinition1.xml", pivot_xml.as_bytes()),
        ("xl/charts/chart1.xml", chart_xml.as_bytes()),
        ("xl/chartsheets/sheet1.xml", chartsheet_xml.as_bytes()),
        ("customXml/item1.xml", custom_xml.as_bytes()),
    ], true);
    fs::write(store.root().join("Secure notes/parts.xlsx"), bytes).unwrap();
    store.read_file_bytes_for_ai("Secure notes/parts.xlsx", true).unwrap();
    for secret in [threaded, drawing, pivot, chart, chartsheet, custom] {
        assert!(crate::secret::blocked_for_remote(secret), "{secret}");
    }
}

#[test]
fn malformed_unknown_office_xml_refuses_secure_local_read() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let sheet = b"<worksheet><sheetData><row><c><v>1</v></c></row></sheetData></worksheet>";
    let bytes = crate::ai_files::tests::zip_with(&[
        ("xl/worksheets/sheet1.xml", sheet),
        ("customXml/item1.xml", b"<custom><text>unclosed"),
    ], true);
    fs::write(store.root().join("Secure notes/unknown.xlsx"), bytes).unwrap();
    assert!(store.read_file_bytes_for_ai("Secure notes/unknown.xlsx", true).is_err());
    let bytes = crate::ai_files::tests::zip_with(&[
        ("xl/worksheets/sheet1.xml", sheet),
        ("customXml/item1.xml", b"<first/><second/>"),
    ], true);
    fs::write(store.root().join("Secure notes/two-roots.xlsx"), bytes).unwrap();
    assert!(store.read_file_bytes_for_ai("Secure notes/two-roots.xlsx", true).is_err());
}

#[test]
fn secure_word_records_deleted_field_and_secondary_part_text() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let deleted = "The deleted crimson paragraph remains private forever.";
    let field = "The field indigo instruction remains private forever.";
    let drawing = "The diagram copper label remains private forever.";
    let diagram = "The Word diagram teal label remains private forever.";
    let glossary = "The glossary jade entry remains private forever.";
    let document = format!("<w:document><w:body><w:p><w:t>Public</w:t><w:delText>{deleted}</w:delText><w:instrText>{field}</w:instrText></w:p></w:body></w:document>");
    let drawing_xml = format!("<wsp:wordprocessingShape><a:t>{drawing}</a:t></wsp:wordprocessingShape>");
    let diagram_xml = format!("<dgm:dataModel><a:t>{diagram}</a:t></dgm:dataModel>");
    let glossary_xml = format!("<w:glossaryDocument><w:docPart><w:t>{glossary}</w:t></w:docPart></w:glossaryDocument>");
    let bytes = crate::ai_files::tests::zip_with(&[
        ("word/document.xml", document.as_bytes()),
        ("word/commentsExtended.xml", b"<w:commentsEx/>"),
        ("word/drawings/drawing1.xml", drawing_xml.as_bytes()),
        ("word/diagrams/data1.xml", diagram_xml.as_bytes()),
        ("word/glossary/document.xml", glossary_xml.as_bytes()),
    ], true);
    fs::write(store.root().join("Secure notes/parts.docx"), bytes).unwrap();
    store.read_file_bytes_for_ai("Secure notes/parts.docx", true).unwrap();
    for secret in [deleted, field, drawing, diagram, glossary] {
        assert!(crate::secret::blocked_for_remote(secret), "{secret}");
    }
}

#[test]
fn a_workbook_with_undecodable_sheet_text_refuses_a_secure_local_read() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    let rel = "Secure notes/undecodable.xlsx";
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    let sheet = b"<x:worksheet xmlns:x=\"http://purl.oclc.org/ooxml/spreadsheetml/main\"><x:sheetData><x:row><x:c><x:unreadable>private prose</x:unreadable></x:c></x:row></x:sheetData></x:worksheet>";
    let bytes = crate::ai_files::tests::zip_with(&[("xl/worksheets/sheet1.xml", sheet)], true);
    fs::write(store.root().join(rel), bytes).unwrap();
    assert!(store.read_file_bytes_for_ai(rel, true).is_err());
}

#[test]
fn every_office_package_extension_uses_extracted_text_for_secure_reads() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    for ext in ["xlsx", "xlsm", "xltx", "xltm"] {
        let rel = format!("Secure notes/workbook.{ext}");
        let prose = format!("Amber {ext} travels past velvet {ext} toward indigo {ext} skies.");
        let sheet = format!(
            "<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>{prose}</t></is></c></row></sheetData></worksheet>"
        );
        let bytes = crate::ai_files::tests::zip_with(
            &[("xl/worksheets/sheet1.xml", sheet.as_bytes())],
            true,
        );
        fs::write(store.root().join(&rel), bytes).unwrap();
        store.read_file_bytes_for_ai(&rel, true).unwrap();
        assert!(crate::secret::blocked_for_remote(&prose), "{rel}");
    }
    for ext in ["docx", "docm", "dotx", "dotm"] {
        let rel = format!("Secure notes/document.{ext}");
        let prose = format!("Crimson {ext} waits beside cobalt {ext} beneath silver {ext} clouds.");
        let xml = format!(
            "<w:document><w:body><w:p><w:t>{prose}</w:t></w:p></w:body></w:document>"
        );
        let bytes = crate::ai_files::tests::zip_with(&[("word/document.xml", xml.as_bytes())], true);
        fs::write(store.root().join(&rel), bytes).unwrap();
        store.read_file_bytes_for_ai(&rel, true).unwrap();
        assert!(crate::secret::blocked_for_remote(&prose), "{rel}");
    }
}

#[test]
fn unreadable_secure_office_packages_refuse_local_ai_reads() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    for ext in ["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm"] {
        let rel = format!("Secure notes/damaged.{ext}");
        fs::write(store.root().join(&rel), b"not an office package").unwrap();
        assert!(store.read_file_bytes_for_ai(&rel, true).is_err(), "{rel}");
    }
}
