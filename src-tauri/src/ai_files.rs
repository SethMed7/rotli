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
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::corpus::{compose_root_id, split_root_id, CorpusState};

const GRANTS: &str = ".rotli/file-grants.json";
/// The largest `word/document.xml` the check will inflate.
const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;

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
    created_by: String,
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

fn record_ai_created(root: &Path, rel: &str) -> Result<(), String> {
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
                created_by: "ai".into(),
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
        .is_some_and(|grant| grant.created_by == "ai" && grant.ai_edit)
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// One entry of a zip package, stored or deflated (a .docx is a zip).
fn zip_entry(bytes: &[u8], wanted: &str) -> Result<Vec<u8>, String> {
    let bad = || "not a readable Word document".to_string();
    // the end-of-central-directory record sits in the last 64 KiB + 22 bytes
    let floor = bytes.len().saturating_sub(65_557);
    let eocd = (floor..bytes.len().saturating_sub(21))
        .rev()
        .find(|&at| u32_at(bytes, at) == Some(0x0605_4b50))
        .ok_or_else(bad)?;
    let count = u16_at(bytes, eocd + 10).ok_or_else(bad)? as usize;
    let mut at = u32_at(bytes, eocd + 16).ok_or_else(bad)? as usize;
    for _ in 0..count {
        if u32_at(bytes, at) != Some(0x0201_4b50) {
            return Err(bad());
        }
        let method = u16_at(bytes, at + 10).ok_or_else(bad)?;
        let size = u32_at(bytes, at + 20).ok_or_else(bad)? as usize;
        let name_len = u16_at(bytes, at + 28).ok_or_else(bad)? as usize;
        let extra_len = u16_at(bytes, at + 30).ok_or_else(bad)? as usize;
        let comment_len = u16_at(bytes, at + 32).ok_or_else(bad)? as usize;
        let local = u32_at(bytes, at + 42).ok_or_else(bad)? as usize;
        let name = bytes.get(at + 46..at + 46 + name_len).ok_or_else(bad)?;
        if name == wanted.as_bytes() {
            if u32_at(bytes, local) != Some(0x0403_4b50) {
                return Err(bad());
            }
            let skip = u16_at(bytes, local + 26).ok_or_else(bad)? as usize
                + u16_at(bytes, local + 28).ok_or_else(bad)? as usize;
            let data = bytes
                .get(local + 30 + skip..local + 30 + skip + size)
                .ok_or_else(bad)?;
            return match method {
                0 => Ok(data.to_vec()),
                8 => {
                    let mut out = Vec::new();
                    flate2::read::DeflateDecoder::new(data)
                        .take(MAX_XML_BYTES + 1)
                        .read_to_end(&mut out)
                        .map_err(|_| bad())?;
                    if out.len() as u64 > MAX_XML_BYTES {
                        return Err("the document's text is too large to check".into());
                    }
                    Ok(out)
                }
                _ => Err(bad()),
            };
        }
        at += 46 + name_len + extra_len + comment_len;
    }
    Err(bad())
}

/// The visible text of a .docx, paragraph by paragraph: what the secret
/// check reads (never the frontend's word for it).
pub(crate) fn docx_text(bytes: &[u8]) -> Result<String, String> {
    let xml = String::from_utf8(zip_entry(bytes, "word/document.xml")?)
        .map_err(|_| "not a readable Word document".to_string())?;
    let mut text = String::new();
    for paragraph in xml.split("</w:p>") {
        let mut rest = paragraph;
        while let Some(start) = rest.find("<w:t") {
            rest = &rest[start + 4..];
            // `<w:t>` or `<w:t xml:space=…>`, never `<w:tbl…>` / `<w:tc…>`
            if !(rest.starts_with('>') || rest.starts_with(' ')) {
                continue;
            }
            let Some(open_end) = rest.find('>') else { break };
            rest = &rest[open_end + 1..];
            let Some(close) = rest.find("</w:t>") else { break };
            text.push_str(&rest[..close]);
            rest = &rest[close..];
        }
        text.push('\n');
    }
    // a link's address lives in the relationships part, not the body
    if let Ok(rels) = zip_entry(bytes, "word/_rels/document.xml.rels") {
        let rels = String::from_utf8_lossy(&rels);
        for target in rels.split("Target=\"").skip(1) {
            text.push_str(target.split('"').next().unwrap_or(""));
            text.push('\n');
        }
    }
    Ok(text
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&"))
}

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

/// The AI creates a Word document in the managed lane and records that it did.
#[tauri::command]
pub fn corpus_create_managed_file_ai(
    state: tauri::State<'_, CorpusState>,
    name: String,
    base64: String,
    root_id: Option<String>,
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
        record_ai_created(store.root(), &rel)?;
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
mod tests {
    use super::*;
    use std::io::Write;

    /// A one-entry zip, deflated or stored (the CRC isn't checked here).
    fn zip_of(name: &str, data: &[u8], deflate: bool) -> Vec<u8> {
        zip_with(&[(name, data)], deflate)
    }

    fn zip_with(entries: &[(&str, &[u8])], deflate: bool) -> Vec<u8> {
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

    const XML: &str = r#"<w:document><w:body><w:p><w:r><w:t>Launch &amp; land</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space="preserve">Owner </w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;

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
        record_ai_created(root, "storage/rotli/plan.docx").unwrap();
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
