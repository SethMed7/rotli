//! Word block framing as shown to the local model.

use std::collections::HashMap;

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{attribute_value, read_element_text, ALT_DESCRIPTION, DOC_PR};

const PARAGRAPH_STYLE: &[u8] = b"pStyle";
const NUMBERING_PROPERTIES: &[u8] = b"numPr";
const HEADING_1_LABEL: &str = "Heading 1";
const HEADING_2_LABEL: &str = "Heading 2";
const HEADING_3_LABEL: &str = "Heading 3";

pub(crate) fn word_style_label(style_id: &str) -> Option<&'static str> {
    let key: String = style_id
        .to_lowercase()
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '_' && *ch != '-')
        .collect();
    match key.as_str() {
        "title" => Some("Title"),
        "subtitle" => Some("Subtitle"),
        "heading1" => Some(HEADING_1_LABEL),
        "heading2" => Some(HEADING_2_LABEL),
        "heading3" => Some(HEADING_3_LABEL),
        _ => None,
    }
}

/// numId → bullet/number, from the same numbering fields the Word editor uses.
pub(super) fn word_list_kinds(xml: &[u8]) -> Result<HashMap<String, &'static str>, String> {
    let bad = || "not a readable Word document".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut abstract_kinds = HashMap::new();
    let mut concrete = Vec::new();
    let mut abstract_id = None;
    let mut num_id = None;
    let mut level_zero = false;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) => match start.local_name().as_ref() {
                b"abstractNum" => {
                    abstract_id = attribute_value(&start, b"abstractNumId", &bad)?;
                    if let Some(id) = &abstract_id {
                        abstract_kinds.insert(id.clone(), "bullet");
                    }
                }
                b"num" => num_id = attribute_value(&start, b"numId", &bad)?,
                b"lvl" if abstract_id.is_some() => {
                    level_zero = attribute_value(&start, b"ilvl", &bad)?.as_deref() == Some("0");
                }
                b"numFmt" if level_zero => {
                    let kind =
                        if attribute_value(&start, b"val", &bad)?.as_deref() == Some("bullet") {
                            "bullet"
                        } else {
                            "number"
                        };
                    abstract_kinds.insert(abstract_id.clone().unwrap_or_default(), kind);
                }
                b"abstractNumId" if num_id.is_some() => {
                    if let Some(abstract_id) = attribute_value(&start, b"val", &bad)? {
                        concrete.push((num_id.clone().unwrap_or_default(), abstract_id));
                    }
                }
                _ => {}
            },
            Event::Empty(start) => match start.local_name().as_ref() {
                b"numFmt" if level_zero => {
                    let kind =
                        if attribute_value(&start, b"val", &bad)?.as_deref() == Some("bullet") {
                            "bullet"
                        } else {
                            "number"
                        };
                    abstract_kinds.insert(abstract_id.clone().unwrap_or_default(), kind);
                }
                b"abstractNumId" if num_id.is_some() => {
                    if let Some(abstract_id) = attribute_value(&start, b"val", &bad)? {
                        concrete.push((num_id.clone().unwrap_or_default(), abstract_id));
                    }
                }
                _ => {}
            },
            Event::End(end) => match end.local_name().as_ref() {
                b"abstractNum" => abstract_id = None,
                b"lvl" => level_zero = false,
                b"num" => num_id = None,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(concrete
        .into_iter()
        .filter_map(|(id, abstract_id)| abstract_kinds.get(&abstract_id).map(|kind| (id, *kind)))
        .collect())
}

#[derive(Default)]
struct WordParagraph {
    body: String,
    image: Option<String>,
    style: Option<String>,
    list: bool,
    num_id: Option<String>,
}

#[derive(Default)]
struct WordTable {
    rows: Vec<Vec<String>>,
    cell_paragraphs: Vec<String>,
}

fn append_word_paragraph(
    out: &mut String,
    index: &mut usize,
    paragraph: WordParagraph,
    lists: &HashMap<String, &'static str>,
) {
    *index += 1;
    if let Some(image) = paragraph.image.filter(|_| paragraph.body.trim().is_empty()) {
        out.push_str(&format!("[{}] image: {}\n", index, image));
        return;
    }
    let label = paragraph
        .style
        .as_deref()
        .and_then(word_style_label)
        .or_else(|| {
            paragraph.list.then(|| {
                let kind = paragraph
                    .num_id
                    .as_deref()
                    .and_then(|id| lists.get(id).copied())
                    .unwrap_or(if paragraph.num_id.as_deref() == Some("2") {
                        "number"
                    } else {
                        "bullet"
                    });
                if kind == "number" {
                    "number item"
                } else {
                    "bullet item"
                }
            })
        })
        .unwrap_or("paragraph");
    out.push_str(&format!("[{}] {}: {}\n", index, label, paragraph.body));
}

fn append_word_table(out: &mut String, index: &mut usize, table: WordTable) {
    *index += 1;
    let width = table.rows.iter().map(Vec::len).max().unwrap_or(0);
    out.push_str(&format!(
        "[{}] table ({} rows × {} columns):\n",
        index,
        table.rows.len(),
        width
    ));
    for (row, cells) in table.rows.iter().enumerate() {
        for (col, body) in cells.iter().enumerate() {
            out.push_str(&format!("  r{}c{}: {}\n", row + 1, col + 1, body));
        }
    }
}

/// Model framing can join a visible phrase to a block label or the next
/// block. Record the local view in document order as well as raw secondary
/// parts, which include comments, fields, and tracked deletions.
pub(super) fn append_word_model_view(
    xml: &[u8],
    lists: &HashMap<String, &'static str>,
    out: &mut String,
) -> Result<(), String> {
    let bad = || "not a readable Word document".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut path: Vec<Vec<u8>> = Vec::new();
    let mut paragraph: Option<WordParagraph> = None;
    let mut table: Option<WordTable> = None;
    let mut table_depth = None;
    let mut index = 0;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) => {
                let local = start.local_name();
                let parent = path.last().map(Vec::as_slice);
                match local.as_ref() {
                    b"tbl" if parent == Some(b"body".as_slice()) => {
                        table = Some(WordTable::default());
                        table_depth = Some(path.len() + 1);
                    }
                    b"tr"
                        if parent == Some(b"tbl".as_slice()) && table_depth == Some(path.len()) =>
                    {
                        if let Some(table) = &mut table {
                            table.rows.push(Vec::new());
                        }
                    }
                    b"tc"
                        if parent == Some(b"tr".as_slice())
                            && table_depth == path.len().checked_sub(1) =>
                    {
                        if let Some(table) = &mut table {
                            table.cell_paragraphs.clear();
                        }
                    }
                    b"p" if parent == Some(b"body".as_slice())
                        || (parent == Some(b"tc".as_slice())
                            && table_depth == path.len().checked_sub(2)) =>
                    {
                        paragraph = Some(WordParagraph::default());
                    }
                    tag if tag == PARAGRAPH_STYLE && paragraph.is_some() => {
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.style = attribute_value(&start, b"val", &bad)?;
                        }
                    }
                    tag if tag == NUMBERING_PROPERTIES && paragraph.is_some() => {
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.list = true;
                        }
                    }
                    b"numId" if paragraph.is_some() => {
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.num_id = attribute_value(&start, b"val", &bad)?;
                        }
                    }
                    b"t" if paragraph.is_some() => {
                        let value = read_element_text(&mut reader, start.name().as_ref(), &bad)?;
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.body.push_str(&value);
                        }
                        continue;
                    }
                    b"tab" | b"br" | b"cr" => {
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.body.push(' ');
                        }
                    }
                    DOC_PR => {
                        if let Some(paragraph) = &mut paragraph {
                            paragraph.image = attribute_value(&start, ALT_DESCRIPTION, &bad)?
                                .filter(|value| !value.is_empty())
                                .or(attribute_value(&start, b"name", &bad)?);
                        }
                    }
                    _ => {}
                }
                path.push(local.as_ref().to_vec());
            }
            Event::Empty(start) => match start.local_name().as_ref() {
                b"tab" | b"br" | b"cr" => {
                    if let Some(paragraph) = &mut paragraph {
                        paragraph.body.push(' ');
                    }
                }
                tag if tag == PARAGRAPH_STYLE && paragraph.is_some() => {
                    if let Some(paragraph) = &mut paragraph {
                        paragraph.style = attribute_value(&start, b"val", &bad)?;
                    }
                }
                b"numId" if paragraph.is_some() => {
                    if let Some(paragraph) = &mut paragraph {
                        paragraph.num_id = attribute_value(&start, b"val", &bad)?;
                    }
                }
                tag if tag == NUMBERING_PROPERTIES && paragraph.is_some() => {
                    if let Some(paragraph) = &mut paragraph {
                        paragraph.list = true;
                    }
                }
                DOC_PR => {
                    if let Some(paragraph) = &mut paragraph {
                        paragraph.image = attribute_value(&start, ALT_DESCRIPTION, &bad)?
                            .filter(|value| !value.is_empty())
                            .or(attribute_value(&start, b"name", &bad)?);
                    }
                }
                _ => {}
            },
            Event::End(end) => {
                match end.local_name().as_ref() {
                    b"p" if paragraph.is_some() => {
                        if let Some(paragraph) = paragraph.take() {
                            if let Some(table) = &mut table {
                                table.cell_paragraphs.push(paragraph.body);
                            } else {
                                append_word_paragraph(out, &mut index, paragraph, lists);
                            }
                        }
                    }
                    b"tc" if table_depth == path.len().checked_sub(2) => {
                        if let Some(table) = &mut table {
                            if let Some(row) = table.rows.last_mut() {
                                row.push(table.cell_paragraphs.join(" "));
                            }
                        }
                    }
                    b"tbl" if table_depth == Some(path.len()) => {
                        if let Some(table) = table.take() {
                            append_word_table(out, &mut index, table);
                        }
                        table_depth = None;
                    }
                    _ => {}
                }
                if path.pop().as_deref() != Some(end.local_name().as_ref()) {
                    return Err(bad());
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !path.is_empty() {
        return Err(bad());
    }
    Ok(())
}
