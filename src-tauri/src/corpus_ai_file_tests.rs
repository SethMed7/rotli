// AI file read gates and extracted-text egress ledger coverage.

use super::*;
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
fn unreadable_secure_office_packages_refuse_local_ai_reads() {
    let tmp = TempDir::new().unwrap();
    let store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    fs::create_dir_all(store.root().join("Secure notes")).unwrap();
    for ext in ["docx", "xlsx"] {
        let rel = format!("Secure notes/damaged.{ext}");
        fs::write(store.root().join(&rel), b"not an office package").unwrap();
        assert!(store.read_file_bytes_for_ai(&rel, true).is_err(), "{rel}");
    }
}
