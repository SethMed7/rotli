//! Bounded, local-name-aware OOXML text extraction for the secure AI ledger.
//! Spreadsheet and Word package text is read from the bytes on disk, never
//! from a frontend summary. Unreadable packages fail closed.

use std::io::Read;

use quick_xml::escape::unescape;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

mod view;
mod word_view;

#[cfg(test)]
pub(crate) use word_view::word_style_label;

use view::{
    rendered_date, workbook_date_formats, workbook_model_view,
    workbook_uses_1904_dates,
};
use word_view::{append_word_model_view, word_list_kinds};

/// The largest XML package part the check will inflate.
const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const WORD_FOOTNOTES: &str = "word/footnotes.xml";
pub(crate) const WORD_ENDNOTES: &str = "word/endnotes.xml";
pub(crate) const WORD_COMMENTS: &str = "word/comments.xml";
const DOC_PR: &[u8] = b"docPr";
const ALT_DESCRIPTION: &[u8] = b"descr";
const RELATIONSHIP: &[u8] = b"Relationship";
const RELATIONSHIP_TARGET: &[u8] = b"Target";

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
    let date_formats = if let Ok(styles) = zip_entry(bytes, "xl/styles.xml") {
        workbook_date_formats(&styles)?
    } else {
        Vec::new()
    };
    let date1904 = if let Ok(workbook) = zip_entry(bytes, "xl/workbook.xml") {
        workbook_uses_1904_dates(&workbook)?
    } else {
        false
    };
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
            spreadsheet_part_text(&xml, root, &mut text, &date_formats, date1904)?;
        } else {
            generic_part_text(&xml, &mut text, "not a readable spreadsheet")?;
        }
    }
    if text.trim().is_empty() {
        return Err("not a readable spreadsheet".into());
    }
    // The model sees addressed cells and tab framing, not the raw shared-
    // string indices. Include that view so phrases across cells and sheets
    // are covered too; the pass above still records hidden secondary text.
    text.push('\n');
    text.push_str(&workbook_model_view(bytes, &date_formats, date1904)?);
    if text.len() > MAX_XML_BYTES as usize {
        return Err("the spreadsheet's text is too large to check".into());
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
fn spreadsheet_part_text(
    xml: &[u8],
    root: &[u8],
    text: &mut String,
    date_formats: &[Option<String>],
    date1904: bool,
) -> Result<(), String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut depth = 0usize;
    let mut seen_root = false;
    let mut in_item = false;
    let mut item_text = String::new();
    let shared = root == b"sst";
    let mut cell_style = None;
    let mut cell_boolean = false;
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
                if root == b"worksheet" && local == b"c" {
                    cell_style = attribute_value(&start, b"s", &bad)?
                        .and_then(|value| value.parse::<usize>().ok());
                    cell_boolean = attribute_value(&start, b"t", &bad)?.as_deref() == Some("b");
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
                        if root == b"worksheet" && local == b"v" {
                            if cell_boolean {
                                text.push_str(if value == "1" { "true " } else { "false " });
                            }
                            if let Some(pattern) = cell_style
                                .and_then(|index| date_formats.get(index))
                                .and_then(Option::as_deref)
                            {
                                if let Some(date) = rendered_date(&value, pattern, date1904) {
                                    text.push_str(&date);
                                    text.push(' ');
                                }
                            }
                        }
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
                if root == b"worksheet" && local.as_ref() == b"c" {
                    cell_style = None;
                    cell_boolean = false;
                }
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

fn attribute_value(
    start: &BytesStart<'_>,
    wanted: &[u8],
    bad: &impl Fn() -> String,
) -> Result<Option<String>, String> {
    let mut value = None;
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| bad())?;
        let raw = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| bad())?;
        let decoded = unescape(raw).map_err(|_| bad())?;
        if attribute.key.local_name().as_ref() == wanted {
            value = Some(decoded.into_owned());
        }
    }
    Ok(value)
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

/// Unknown XML parts are still security-relevant. Include text nodes and the
/// few attributes the model can see, while validating every attribute.
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
                append_visible_attributes(&start, text, &bad)?;
                stack.push(start.name().as_ref().to_vec());
            }
            Event::Empty(start) => {
                if stack.is_empty() && seen_root {
                    return Err(bad());
                }
                seen_root = true;
                append_visible_attributes(&start, text, &bad)?;
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

fn append_visible_attributes(
    start: &BytesStart<'_>,
    text: &mut String,
    bad: &impl Fn() -> String,
) -> Result<(), String> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| bad())?;
        let raw = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| bad())?;
        let decoded = unescape(raw).map_err(|_| bad())?;
        let element = start.local_name();
        let key = attribute.key.local_name();
        let visible = (element.as_ref() == DOC_PR
            && (key.as_ref() == ALT_DESCRIPTION || key.as_ref() == b"name"))
            || (element.as_ref() == RELATIONSHIP && key.as_ref() == RELATIONSHIP_TARGET);
        if visible {
            text.push_str(&decoded);
            text.push(' ');
        }
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
    let mut model_view = String::new();
    let lists = if names.iter().any(|name| name == "word/numbering.xml") {
        word_list_kinds(&zip_entry(bytes, "word/numbering.xml").map_err(|_| bad())?)?
    } else {
        std::collections::HashMap::new()
    };
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
        if name == "word/document.xml" {
            append_word_model_view(&xml, &lists, &mut model_view)?;
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
                    // Image alt text and its name fallback are model-visible.
                    // Keep them separate so styled runs retain their phrases.
                    append_visible_attributes(&start, &mut attributes, &bad)?;
                    if matches!(local.as_ref(), b"t" | b"delText" | b"instrText") {
                        text.push_str(&read_element_text(
                            &mut reader,
                            start.name().as_ref(),
                            &bad,
                        )?);
                    } else {
                        if matches!(local.as_ref(), b"tab" | b"br" | b"cr") {
                            text.push(' ');
                        }
                        depth += 1;
                    }
                }
                Event::Empty(start) => {
                    append_visible_attributes(&start, &mut attributes, &bad)?;
                    if matches!(start.local_name().as_ref(), b"tab" | b"br" | b"cr") {
                        text.push(' ');
                    }
                }
                Event::End(end) => {
                    if end.local_name().as_ref() == b"p" {
                        text.push('\n');
                    }
                    depth = depth.checked_sub(1).ok_or_else(bad)?;
                }
                Event::Eof => break,
                _ => {}
            }
            if text.len() + attributes.len() + model_view.len() > MAX_XML_BYTES as usize {
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
    text.push('\n');
    text.push_str(&model_view);
    if text.len() > MAX_XML_BYTES as usize {
        return Err("the document's text is too large to check".into());
    }
    Ok(text)
}

fn numbered_word_part(name: &str, stem: &str) -> bool {
    name.strip_prefix("word/")
        .and_then(|tail| tail.strip_prefix(stem))
        .and_then(|tail| tail.strip_suffix(".xml"))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
}
