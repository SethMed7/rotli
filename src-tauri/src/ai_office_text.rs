//! Bounded, local-name-aware OOXML text extraction for the secure AI ledger.
//! Spreadsheet and Word package text is read from the bytes on disk, never
//! from a frontend summary. Unreadable packages fail closed.

use std::io::Read;

use quick_xml::escape::unescape;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// The largest XML package part the check will inflate.
const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const WORD_FOOTNOTES: &str = "word/footnotes.xml";
pub(crate) const WORD_ENDNOTES: &str = "word/endnotes.xml";
pub(crate) const WORD_COMMENTS: &str = "word/comments.xml";

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

/// Enumerate XML package parts for the ledger's Office text passes. The same
/// bounded entry reader above inflates each matching part; a malformed package
/// refuses the secure local read rather than recording arbitrary zip bytes.
fn zip_xml_names(bytes: &[u8], prefix: &str) -> Result<Vec<String>, String> {
    let bad = || "not a readable Office package".to_string();
    let floor = bytes.len().saturating_sub(65_557);
    let eocd = (floor..bytes.len().saturating_sub(21))
        .rev()
        .find(|&at| u32_at(bytes, at) == Some(0x0605_4b50))
        .ok_or_else(bad)?;
    let count = u16_at(bytes, eocd + 10).ok_or_else(bad)? as usize;
    let mut at = u32_at(bytes, eocd + 16).ok_or_else(bad)? as usize;
    let mut names = Vec::new();
    for _ in 0..count {
        if u32_at(bytes, at) != Some(0x0201_4b50) {
            return Err(bad());
        }
        let name_len = u16_at(bytes, at + 28).ok_or_else(bad)? as usize;
        let extra_len = u16_at(bytes, at + 30).ok_or_else(bad)? as usize;
        let comment_len = u16_at(bytes, at + 32).ok_or_else(bad)? as usize;
        let name = bytes.get(at + 46..at + 46 + name_len).ok_or_else(bad)?;
        let name = std::str::from_utf8(name).map_err(|_| bad())?;
        if name.starts_with(prefix) && (name.ends_with(".xml") || name.ends_with(".rels")) {
            names.push(name.to_string());
        }
        at = at
            .checked_add(46 + name_len + extra_len + comment_len)
            .ok_or_else(bad)?;
    }
    if names.is_empty() || names.len() > 256 {
        return Err(bad());
    }
    Ok(names)
}

/// Cell and shared-string text from a spreadsheet package. Numbers/formula
/// cached values are included too; the ledger only retains hashes of phrases.
pub(crate) fn xlsx_text(bytes: &[u8]) -> Result<String, String> {
    let mut text = String::new();
    for name in zip_xml_names(bytes, "")? {
        let kind = if name == "xl/sharedStrings.xml" {
            Some(b"sst".as_slice())
        } else if worksheet_part(&name) {
            Some(b"worksheet".as_slice())
        } else if spreadsheet_comments_part(&name) {
            Some(b"comments".as_slice())
        } else if name == "xl/workbook.xml" {
            Some(b"workbook".as_slice())
        } else {
            None
        };
        if name == "[Content_Types].xml" || spreadsheet_metadata_part(&name) {
            continue;
        }
        let xml = zip_entry(bytes, &name).map_err(|_| "not a readable spreadsheet".to_string())?;
        if xml.len() > MAX_XML_BYTES as usize {
            return Err("the spreadsheet's text is too large to check".into());
        }
        if let Some(root) = kind {
            spreadsheet_part_text(&xml, root, &mut text)?;
        } else {
            generic_part_text(&xml, &mut text, "not a readable spreadsheet")?;
        }
    }
    if text.trim().is_empty() {
        return Err("not a readable spreadsheet".into());
    }
    Ok(text)
}

fn worksheet_part(name: &str) -> bool {
    name.strip_prefix("xl/worksheets/").is_some_and(|tail| {
        !tail.contains('/') && tail.ends_with(".xml")
    })
}

fn spreadsheet_comments_part(name: &str) -> bool {
    let Some(("xl", tail)) = name.split_once('/') else {
        return false;
    };
    let tail = tail.strip_prefix("comments/").unwrap_or(tail);
    let number = tail
        .strip_prefix("comments")
        .or_else(|| tail.strip_prefix("comment"));
    number
        .and_then(|value| value.strip_suffix(".xml"))
        .is_some_and(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
}

fn spreadsheet_metadata_part(name: &str) -> bool {
    matches!(
        name,
        "xl/commentsExtended.xml" | "xl/commentsIds.xml" | "xl/commentsExtensible.xml"
    )
}

/// OOXML permits arbitrary namespace prefixes; Strict OOXML also uses a
/// different namespace URI. Only the local element name carries this text
/// policy. Parse XML rather than matching literal `<t>` or `<x:t>` strings.
fn spreadsheet_part_text(xml: &[u8], root: &[u8], text: &mut String) -> Result<(), String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut depth = 0usize;
    let mut seen_root = false;
    let mut in_item = false;
    let mut item_text = String::new();
    let shared = root == b"sst";
    let header_footer: [&[u8]; 6] = [
        b"oddHeader", b"oddFooter", b"evenHeader", b"evenFooter", b"firstHeader", b"firstFooter",
    ];
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) => {
                let local = start.local_name();
                let local = local.as_ref();
                if depth == 0 {
                    if seen_root || local != root {
                        return Err(bad());
                    }
                    seen_root = true;
                }
                if (shared && local == b"si") || (root == b"worksheet" && local == b"is") {
                    in_item = true;
                    item_text.clear();
                }
                if root == b"workbook" && local == b"sheet" {
                    sheet_name(&start, text, &bad)?;
                }
                let field = (in_item && local == b"t")
                    || (root == b"worksheet"
                        && (local == b"v" || local == b"f" || header_footer.contains(&local)))
                    || (root == b"comments" && local == b"t")
                    || (root == b"workbook" && local == b"definedName");
                if field {
                    let value = read_element_text(&mut reader, start.name().as_ref(), &bad)?;
                    if in_item && local == b"t" {
                        item_text.push_str(&value);
                    } else {
                        text.push_str(&value);
                        text.push(' ');
                    }
                } else {
                    depth += 1;
                }
            }
            Event::Empty(start) => {
                if root == b"workbook" && start.local_name().as_ref() == b"sheet" {
                    sheet_name(&start, text, &bad)?;
                }
            }
            Event::End(end) => {
                let local = end.local_name();
                if in_item
                    && ((shared && local.as_ref() == b"si")
                        || (root == b"worksheet" && local.as_ref() == b"is"))
                {
                    text.push_str(&item_text);
                    text.push(' ');
                    in_item = false;
                    item_text.clear();
                }
                depth = depth.checked_sub(1).ok_or_else(bad)?;
            }
            Event::Eof => break,
            _ => {}
        }
        if text.len() + item_text.len() > MAX_XML_BYTES as usize {
            return Err("the spreadsheet's text is too large to check".into());
        }
    }
    if !seen_root || depth != 0 || in_item {
        return Err(bad());
    }
    Ok(())
}

fn sheet_name(
    start: &BytesStart<'_>,
    text: &mut String,
    bad: &impl Fn() -> String,
) -> Result<(), String> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| bad())?;
        if attribute.key.local_name().as_ref() == b"name" {
            let raw = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| bad())?;
            text.push_str(&unescape(raw).map_err(|_| bad())?);
            text.push(' ');
        }
    }
    Ok(())
}

/// Unknown XML parts are still security-relevant. Include their text and
/// attribute values (for example pivot shared items) and refuse malformed XML.
fn generic_part_text(xml: &[u8], text: &mut String, error: &str) -> Result<(), String> {
    let bad = || error.to_string();
    let mut reader = Reader::from_reader(xml);
    let mut stack: Vec<Vec<u8>> = Vec::new();
    let mut seen_root = false;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) => {
                if stack.is_empty() && seen_root {
                    return Err(bad());
                }
                seen_root = true;
                append_attributes(&start, text, &bad)?;
                stack.push(start.name().as_ref().to_vec());
            }
            Event::Empty(start) => {
                if stack.is_empty() && seen_root {
                    return Err(bad());
                }
                seen_root = true;
                append_attributes(&start, text, &bad)?;
            }
            Event::Text(part) => {
                let decoded = part.decode().map_err(|_| bad())?;
                if stack.is_empty() && !decoded.trim().is_empty() {
                    return Err(bad());
                }
                text.push_str(&unescape(&decoded).map_err(|_| bad())?);
                text.push(' ');
            }
            Event::CData(part) => {
                let decoded = part.decode().map_err(|_| bad())?;
                if stack.is_empty() && !decoded.trim().is_empty() {
                    return Err(bad());
                }
                text.push_str(&decoded);
                text.push(' ');
            }
            Event::GeneralRef(part) => {
                if stack.is_empty() {
                    return Err(bad());
                }
                let reference = format!("&{};", part.decode().map_err(|_| bad())?);
                text.push_str(&unescape(&reference).map_err(|_| bad())?);
            }
            Event::End(end) => {
                if stack.pop().as_deref() != Some(end.name().as_ref()) {
                    return Err(bad());
                }
            }
            Event::Eof => break,
            _ => {}
        }
        if text.len() > MAX_XML_BYTES as usize {
            return Err(error.to_string());
        }
    }
    if !seen_root || !stack.is_empty() {
        return Err(bad());
    }
    Ok(())
}

fn append_attributes(
    start: &BytesStart<'_>,
    text: &mut String,
    bad: &impl Fn() -> String,
) -> Result<(), String> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| bad())?;
        if attribute.key.as_ref().starts_with(b"xmlns") {
            continue;
        }
        let raw = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| bad())?;
        text.push_str(&unescape(raw).map_err(|_| bad())?);
        text.push(' ');
    }
    Ok(())
}

fn read_element_text(
    reader: &mut Reader<&[u8]>,
    end: &[u8],
    bad: &impl Fn() -> String,
) -> Result<String, String> {
    let mut value = String::new();
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Text(part) => {
                let decoded = part.decode().map_err(|_| bad())?;
                value.push_str(&unescape(&decoded).map_err(|_| bad())?);
            }
            Event::GeneralRef(part) => {
                let reference = format!("&{};", part.decode().map_err(|_| bad())?);
                value.push_str(&unescape(&reference).map_err(|_| bad())?);
            }
            Event::CData(part) => value.push_str(&part.decode().map_err(|_| bad())?),
            Event::End(close) if close.name().as_ref() == end => return Ok(value),
            Event::Eof | Event::Start(_) => return Err(bad()),
            _ => {}
        }
        if value.len() > MAX_XML_BYTES as usize {
            return Err(bad());
        }
    }
}

/// Text from the main and secondary Word parts, paragraph by paragraph: what
/// the secret check reads (never the frontend's word for it).
pub(crate) fn docx_text(bytes: &[u8]) -> Result<String, String> {
    let bad = || "not a readable Word document".to_string();
    let names = zip_xml_names(bytes, "").map_err(|_| bad())?;
    if !names.iter().any(|name| name == "word/document.xml") {
        return Err(bad());
    }
    let mut text = String::new();
    for name in names {
        if name == "[Content_Types].xml" || name == "word/commentsExtended.xml" {
            continue;
        }
        let root = if name == "word/document.xml" {
            Some(b"document".as_slice())
        } else if numbered_word_part(&name, "header") {
            Some(b"hdr".as_slice())
        } else if numbered_word_part(&name, "footer") {
            Some(b"ftr".as_slice())
        } else if name == WORD_FOOTNOTES {
            Some(b"footnotes".as_slice())
        } else if name == WORD_ENDNOTES {
            Some(b"endnotes".as_slice())
        } else if name == WORD_COMMENTS {
            Some(b"comments".as_slice())
        } else {
            None
        };
        let xml = zip_entry(bytes, &name).map_err(|_| bad())?;
        if xml.len() > MAX_XML_BYTES as usize {
            return Err("the document's text is too large to check".into());
        }
        let Some(root) = root else {
            generic_part_text(&xml, &mut text, "not a readable Word document")?;
            continue;
        };
        let mut reader = Reader::from_reader(xml.as_slice());
        let mut depth = 0usize;
        let mut seen_root = false;
        let mut attributes = String::new();
        loop {
            match reader.read_event().map_err(|_| bad())? {
                Event::Start(start) => {
                    let local = start.local_name();
                    if depth == 0 {
                        if seen_root || local.as_ref() != root {
                            return Err(bad());
                        }
                        seen_root = true;
                    }
                    // The document codec exposes drawing metadata (notably
                    // wp:docPr descr/name) as image text to the local model.
                    // Record all attributes so another visible Word field
                    // cannot bypass the overlap ledger.
                    // Keep metadata separate until body text is complete: a
                    // Word paragraph may split one phrase across styled runs.
                    append_attributes(&start, &mut attributes, &bad)?;
                    if matches!(local.as_ref(), b"t" | b"delText" | b"instrText") {
                        text.push_str(&read_element_text(&mut reader, start.name().as_ref(), &bad)?);
                    } else {
                        depth += 1;
                    }
                }
                Event::Empty(start) => append_attributes(&start, &mut attributes, &bad)?,
                Event::End(end) => {
                    if end.local_name().as_ref() == b"p" {
                        text.push('\n');
                    }
                    depth = depth.checked_sub(1).ok_or_else(bad)?;
                }
                Event::Eof => break,
                _ => {}
            }
            if text.len() + attributes.len() > MAX_XML_BYTES as usize {
                return Err("the document's text is too large to check".into());
            }
        }
        if !seen_root || depth != 0 {
            return Err(bad());
        }
        text.push('\n');
        text.push_str(&attributes);
    }
    if text.trim().is_empty() {
        return Err(bad());
    }
    // a link's address lives in the relationships part, not the body
    if let Ok(rels) = zip_entry(bytes, "word/_rels/document.xml.rels") {
        let rels = String::from_utf8_lossy(&rels);
        for target in rels.split("Target=\"").skip(1) {
            text.push_str(target.split('"').next().unwrap_or(""));
            text.push('\n');
        }
    }
    Ok(text)
}

fn numbered_word_part(name: &str, stem: &str) -> bool {
    name.strip_prefix("word/")
        .and_then(|tail| tail.strip_prefix(stem))
        .and_then(|tail| tail.strip_suffix(".xml"))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
}
