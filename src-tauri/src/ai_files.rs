//! Word documents the AI may edit (docs/design/univer-ai-integration.md;
//! the owner's 2026-09-29 rule for notes, applied to files): Rotli's AI edits
//! a .docx only when Rotli's AI created it. Files carry no frontmatter, so the
//! record lives beside the vault's settings, in `.rotli/file-grants.json`,
//! written ONLY by the AI creation command here. A document a person made, or
//! any file without a record (a renamed one included), stays closed to the AI.
//! Every AI write also passes its own secret check on the document's text,
//! read here from the package itself, and the ordinary revision gate with a
//! one-time `.bak`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::corpus::{compose_root_id, split_root_id, CorpusState};

const GRANTS: &str = ".rotli/file-grants.json";

#[derive(Default, Serialize, Deserialize)]
struct Grants {
    #[serde(default)]
    v: u32,
    #[serde(default)]
    files: BTreeMap<String, Grant>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grant {
    /// "ai" (Rotli's chat) or "agent" (an outside agent through the bridge).
    created_by: String,
    /// The outside agent's name (MCP `clientInfo.name`); chat records none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    agent: Option<String>,
    ai_edit: bool,
}

fn grants_path(root: &Path) -> PathBuf {
    root.join(GRANTS)
}

/// The vault's records; a missing or unreadable file grants nothing.
fn read_grants(root: &Path) -> Grants {
    std::fs::read_to_string(grants_path(root))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn record_ai_created(root: &Path, rel: &str, agent: Option<&str>) -> Result<(), String> {
    let path = grants_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::fsutil::with_file_lock(&path, || {
        let mut grants = read_grants(root);
        grants.v = 1;
        grants.files.insert(
            rel.to_string(),
            Grant {
                created_by: if agent.is_some() { "agent" } else { "ai" }.into(),
                agent: agent.map(str::to_string),
                ai_edit: true,
            },
        );
        let text = serde_json::to_string_pretty(&grants).map_err(|e| e.to_string())?;
        crate::fsutil::atomic_write(&path, &text, ".rotli-file-grants-")
    })
}

pub(crate) fn ai_may_edit(root: &Path, rel: &str) -> bool {
    read_grants(root)
        .files
        .get(rel)
        // any AI's document is open to every AI, as with notes (`created_by`)
        .is_some_and(|grant| matches!(grant.created_by.as_str(), "ai" | "agent") && grant.ai_edit)
}

pub(crate) use crate::ai_office_text::{docx_text, xlsx_text};

fn refuse_secret(bytes: &[u8]) -> Result<(), String> {
    if crate::secret::blocked_for_remote(&docx_text(bytes)?) {
        return Err("blocked: the document would hold secret-shaped text; Rotli's AI won't write it into a file".into());
    }
    Ok(())
}

fn decode(base64: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad file payload: {e}"))
}

fn is_docx(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("docx"))
}

/// The AI creates a Word document in the managed lane and records that it did
/// (and which outside agent, when one asked through the bridge).
#[tauri::command]
pub fn corpus_create_managed_file_ai(
    state: tauri::State<'_, CorpusState>,
    name: String,
    base64: String,
    root_id: Option<String>,
    agent: Option<String>,
) -> Result<String, String> {
    if !is_docx(&name) {
        return Err("Rotli's AI creates Word documents (.docx) here".into());
    }
    let bytes = decode(&base64)?;
    refuse_secret(&bytes)?;
    let root_id = match root_id {
        Some(id) => id,
        None => state.default_root_id()?,
    };
    let rel = state.route(&root_id, |store| {
        let rel = store.create_managed_file(&name, &bytes)?;
        record_ai_created(store.root(), &rel, agent.as_deref())?;
        Ok(rel)
    })?;
    Ok(compose_root_id(&root_id, &rel))
}

/// The AI saves its edit to a Word document it created: provenance, the
/// secret check, then the revision gate with a one-time backup.
#[tauri::command]
pub fn corpus_write_file_ai(
    state: tauri::State<'_, CorpusState>,
    id: String,
    base64: String,
    expected_revision: String,
) -> Result<String, String> {
    let bytes = decode(&base64)?;
    let (root, rel) = split_root_id(&id);
    if !is_docx(&rel) {
        return Err("Rotli's AI edits Word documents (.docx) only".into());
    }
    state.route(&root, |store| {
        if !ai_may_edit(store.root(), &rel) {
            return Err("this Word document is yours: Rotli's AI edits only documents it created. Edit it yourself, or ask for a new document".into());
        }
        refuse_secret(&bytes)?;
        store.write_file_bytes_if_revision(&rel, &bytes, true, &expected_revision)
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::ai_office_text::{WORD_COMMENTS, WORD_ENDNOTES, WORD_FOOTNOTES};
    use std::io::Write;

    /// A one-entry zip, deflated or stored (the CRC isn't checked here).
    fn zip_of(name: &str, data: &[u8], deflate: bool) -> Vec<u8> {
        zip_with(&[(name, data)], deflate)
    }

    pub(crate) fn zip_with(entries: &[(&str, &[u8])], deflate: bool) -> Vec<u8> {
        let method: u16 = if deflate { 8 } else { 0 };
        let mut zip = Vec::new();
        let mut directory = Vec::new();
        for (name, data) in entries {
            let body = if deflate {
                let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                encoder.write_all(data).unwrap();
                encoder.finish().unwrap()
            } else {
                data.to_vec()
            };
            let offset = zip.len() as u32;
            zip.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            zip.extend_from_slice(&[20, 0, 0, 0]);
            zip.extend_from_slice(&method.to_le_bytes());
            zip.extend_from_slice(&[0; 8]);
            zip.extend_from_slice(&(body.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(data.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(&body);
            directory.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            directory.extend_from_slice(&[20, 0, 20, 0, 0, 0]);
            directory.extend_from_slice(&method.to_le_bytes());
            directory.extend_from_slice(&[0; 8]);
            directory.extend_from_slice(&(body.len() as u32).to_le_bytes());
            directory.extend_from_slice(&(data.len() as u32).to_le_bytes());
            directory.extend_from_slice(&(name.len() as u16).to_le_bytes());
            directory.extend_from_slice(&[0; 12]);
            directory.extend_from_slice(&offset.to_le_bytes());
            directory.extend_from_slice(name.as_bytes());
        }
        let central = zip.len();
        zip.extend_from_slice(&directory);
        let count = (entries.len() as u16).to_le_bytes();
        zip.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        zip.extend_from_slice(&[0, 0, 0, 0]);
        zip.extend_from_slice(&count);
        zip.extend_from_slice(&count);
        zip.extend_from_slice(&(directory.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(central as u32).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip
    }

    pub(crate) const XML: &str = r#"<w:document><w:body><w:p><w:r><w:t>Launch &amp; land</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">Owner </w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

    #[test]
    fn xlsx_text_joins_rich_text_runs_before_remembering_phrases() {
        let shared = b"<sst><si><r><t>The opal bridge</t></r><r><t> crossing opens before autumn twilight.</t></r></si></sst>";
        let sheet =
            b"<worksheet><sheetData><row><c t=\"s\"><v>0</v></c></row></sheetData></worksheet>";
        let bytes = zip_with(
            &[
                ("xl/sharedStrings.xml", shared),
                ("xl/worksheets/sheet1.xml", sheet),
            ],
            true,
        );
        assert!(xlsx_text(&bytes)
            .unwrap()
            .contains("The opal bridge crossing opens before autumn twilight."));
    }

    #[test]
    fn numeric_only_workbook_text_is_readable() {
        let sheet = b"<worksheet><sheetData><row><c><v>123456789</v></c></row></sheetData></worksheet>";
        let bytes = zip_of("xl/worksheets/sheet1.xml", sheet, true);
        assert!(xlsx_text(&bytes).unwrap().contains("123456789"));
    }

    #[test]
    fn exceljs_saved_strict_roundtrip_is_readable_by_rust() {
        let saved = include_bytes!("../fixtures/strict-roundtrip-saved.xlsx");
        assert!(xlsx_text(saved).unwrap().contains("After"));
    }

    #[test]
    fn workbook_comments_headers_footers_and_defined_names_enter_the_ledger_text() {
        let sheet = b"<worksheet><headerFooter><oddHeader>The amber orchard header waits beyond autumn twilight.</oddHeader><oddFooter>The cobalt harbor footer waits beyond winter twilight.</oddFooter></headerFooter><sheetData><row><c><v>7</v></c></row></sheetData></worksheet>";
        let comments = b"<comments><commentList><comment><text><t>The violet orchard comment waits beyond spring twilight.</t></text></comment></commentList></comments>";
        let book = b"<workbook><definedNames><definedName name=\"Private\">The silver harbor name waits beyond summer twilight.</definedName></definedNames></workbook>";
        let bytes = zip_with(
            &[
                ("xl/worksheets/sheet1.xml", sheet),
                ("xl/comments/comment1.xml", comments),
                ("xl/workbook.xml", book),
            ],
            true,
        );
        let text = xlsx_text(&bytes).unwrap();
        for phrase in [
            "amber orchard header",
            "cobalt harbor footer",
            "violet orchard comment",
            "silver harbor name",
        ] {
            assert!(text.contains(phrase), "missing {phrase}: {text}");
        }
    }

    #[test]
    fn docx_reads_prefixed_strict_cdata_and_secondary_parts() {
        let main = b"<x:document xmlns:x=\"http://purl.oclc.org/ooxml/wordprocessingml/main\"><x:body><x:p><x:r><x:t><![CDATA[The amber bridge crossing opens before autumn twilight.]]></x:t></x:r></x:p></x:body></x:document>";
        let parts: [(&str, &[u8]); 5] = [
            ("word/header1.xml", b"<x:hdr><x:p><x:t>The violet harbor header arrives before winter twilight.</x:t></x:p></x:hdr>"),
            ("word/footer1.xml", b"<x:ftr><x:p><x:t>The copper orchard footer arrives before winter twilight.</x:t></x:p></x:ftr>"),
            (WORD_FOOTNOTES, b"<x:footnotes><x:footnote><x:p><x:t>The silver garden footnote arrives before winter twilight.</x:t></x:p></x:footnote></x:footnotes>"),
            (WORD_ENDNOTES, b"<x:endnotes><x:endnote><x:p><x:t>The teal lighthouse endnote arrives before winter twilight.</x:t></x:p></x:endnote></x:endnotes>"),
            (WORD_COMMENTS, b"<x:comments><x:comment><x:p><x:t>The crimson harbor comment arrives before winter twilight.</x:t></x:p></x:comment></x:comments>"),
        ];
        let mut entries = vec![("word/document.xml", main.as_slice())];
        entries.extend(parts);
        let text = docx_text(&zip_with(&entries, true)).unwrap();
        for phrase in [
            "amber bridge crossing",
            "violet harbor header",
            "copper orchard footer",
            "silver garden footnote",
            "teal lighthouse endnote",
            "crimson harbor comment",
        ] {
            assert!(text.contains(phrase), "missing {phrase}: {text}");
        }
    }

    #[test]
    fn docx_main_part_without_readable_text_is_refused() {
        let bytes = zip_of(
            "word/document.xml",
            b"<w:document><w:body><w:p/></w:body></w:document>",
            true,
        );
        assert!(docx_text(&bytes).is_err());
    }

    #[test]
    fn a_documents_text_is_read_from_the_package_itself_deflated_or_stored() {
        for deflate in [true, false] {
            let text = docx_text(&zip_of("word/document.xml", XML.as_bytes(), deflate)).unwrap();
            assert!(text.contains("Launch & land"), "{text}");
            assert!(text.contains("Owner "), "{text}");
        }
        assert!(docx_text(b"not a zip").is_err());
        assert!(docx_text(&zip_of("word/other.xml", XML.as_bytes(), true)).is_err());
    }

    #[test]
    fn only_documents_the_ai_created_are_open_to_it() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        assert!(!ai_may_edit(root, "storage/rotli/plan.docx"));
        record_ai_created(root, "storage/rotli/plan.docx", None).unwrap();
        record_ai_created(root, "storage/rotli/agent.docx", Some("Claude Code")).unwrap();
        assert!(ai_may_edit(root, "storage/rotli/agent.docx"));
        let grants = std::fs::read_to_string(grants_path(root)).unwrap();
        assert!(grants.contains("\"createdBy\": \"agent\"") && grants.contains("\"agent\": \"Claude Code\""));
        assert!(ai_may_edit(root, "storage/rotli/plan.docx"));
        assert!(!ai_may_edit(root, "storage/rotli/mine.docx"));
        // an unreadable record grants nothing
        std::fs::write(grants_path(root), "{ broken").unwrap();
        assert!(!ai_may_edit(root, "storage/rotli/plan.docx"));
    }

    #[test]
    fn secret_shaped_text_is_never_written_into_a_document() {
        let secret = XML.replace("Launch &amp; land", "key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert!(refuse_secret(&zip_of("word/document.xml", secret.as_bytes(), true)).is_err());
        assert!(refuse_secret(&zip_of("word/document.xml", XML.as_bytes(), true)).is_ok());
    }

    #[test]
    fn a_secret_in_a_link_address_is_refused_too() {
        let rels = |target: &str| {
            format!(r#"<Relationships><Relationship Id="rIdRotliLink1" Type="…/hyperlink" Target="{target}" TargetMode="External"/></Relationships>"#)
        };
        let secret = rels("https://example.com/?k=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        let entries = |rels: &str| {
            zip_with(
                &[("word/document.xml", XML.as_bytes()), ("word/_rels/document.xml.rels", rels.as_bytes())],
                true,
            )
        };
        assert!(refuse_secret(&entries(&secret)).is_err());
        assert!(refuse_secret(&entries(&rels("https://rotli.co"))).is_ok());
    }
}
