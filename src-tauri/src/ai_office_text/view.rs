//! The model-visible Office view added to the secure overlap ledger.

use std::collections::{BTreeMap, HashMap};

use quick_xml::events::Event;
use quick_xml::Reader;

use super::{
    attribute_value, read_element_text, zip_entry, RELATIONSHIP,
    RELATIONSHIP_TARGET,
};

#[derive(Default)]
struct AiCell {
    address: String,
    kind: String,
    style: Option<usize>,
    value: String,
    formula: String,
}

fn shared_strings(xml: &[u8]) -> Result<Vec<String>, String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut items = Vec::new();
    let mut item: Option<String> = None;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) if start.local_name().as_ref() == b"si" => {
                item = Some(String::new());
            }
            Event::Start(start) if start.local_name().as_ref() == b"t" => {
                let value = read_element_text(&mut reader, start.name().as_ref(), &bad)?;
                if let Some(item) = &mut item {
                    item.push_str(&value);
                }
            }
            Event::End(end) if end.local_name().as_ref() == b"si" => {
                items.push(item.take().ok_or_else(bad)?);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(items)
}

fn workbook_sheets(bytes: &[u8]) -> Result<Vec<(String, String)>, String> {
    let bad = || "not a readable spreadsheet".to_string();
    let Ok(workbook) = zip_entry(bytes, "xl/workbook.xml") else {
        return Ok(Vec::new());
    };
    let mut relationships = HashMap::new();
    if let Ok(rels) = zip_entry(bytes, "xl/_rels/workbook.xml.rels") {
        let mut reader = Reader::from_reader(rels.as_slice());
        loop {
            match reader.read_event().map_err(|_| bad())? {
                Event::Start(start) | Event::Empty(start)
                    if start.local_name().as_ref() == RELATIONSHIP =>
                {
                    if let (Some(id), Some(target)) = (
                        attribute_value(&start, b"Id", &bad)?,
                        attribute_value(&start, RELATIONSHIP_TARGET, &bad)?,
                    ) {
                        relationships.insert(id, target);
                    }
                }
                Event::Eof => break,
                _ => {}
            }
        }
    }
    let mut reader = Reader::from_reader(workbook.as_slice());
    let mut sheets = Vec::new();
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) | Event::Empty(start)
                if start.local_name().as_ref() == b"sheet" =>
            {
                let name = attribute_value(&start, b"name", &bad)?.unwrap_or_default();
                let id = attribute_value(&start, b"id", &bad)?.unwrap_or_default();
                let default = format!("worksheets/sheet{}.xml", sheets.len() + 1);
                let target = relationships.get(&id).unwrap_or(&default);
                let path = if target.starts_with("/xl/") {
                    target.trim_start_matches('/').to_string()
                } else {
                    format!("xl/{}", target.trim_start_matches('/'))
                };
                if !path.starts_with("xl/worksheets/") || path.contains("..") {
                    return Err(bad());
                }
                sheets.push((name, path));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(sheets)
}

fn cell_coordinates(address: &str) -> Option<(usize, usize)> {
    let mut column = 0usize;
    let mut split = 0usize;
    for ch in address.chars() {
        if !ch.is_ascii_alphabetic() {
            break;
        }
        column = column
            .checked_mul(26)?
            .checked_add((ch.to_ascii_uppercase() as u8 - b'A' + 1) as usize)?;
        split += 1;
    }
    let row = address.get(split..)?.parse::<usize>().ok()?;
    if row == 0 || column == 0 {
        return None;
    }
    Some((row, column))
}

fn worksheet_cells(xml: &[u8]) -> Result<BTreeMap<usize, BTreeMap<usize, AiCell>>, String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut rows: BTreeMap<usize, BTreeMap<usize, AiCell>> = BTreeMap::new();
    let mut cell: Option<AiCell> = None;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) if start.local_name().as_ref() == b"c" => {
                cell = Some(AiCell {
                    address: attribute_value(&start, b"r", &bad)?.unwrap_or_default(),
                    kind: attribute_value(&start, b"t", &bad)?.unwrap_or_default(),
                    style: attribute_value(&start, b"s", &bad)?
                        .and_then(|value| value.parse().ok()),
                    ..AiCell::default()
                });
            }
            Event::Start(start)
                if cell.is_some() && matches!(start.local_name().as_ref(), b"v" | b"f" | b"t") =>
            {
                let local = start.local_name();
                let value = read_element_text(&mut reader, start.name().as_ref(), &bad)?;
                if let Some(cell) = &mut cell {
                    match local.as_ref() {
                        b"v" => cell.value = value,
                        b"f" => cell.formula = value,
                        b"t" => cell.value.push_str(&value),
                        _ => {}
                    }
                }
            }
            Event::End(end) if end.local_name().as_ref() == b"c" => {
                if let Some(cell) = cell.take() {
                    if let Some((row, col)) = cell_coordinates(&cell.address) {
                        rows.entry(row).or_default().insert(col, cell);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(rows)
}

fn model_cell_text(
    cell: &AiCell,
    shared: &[String],
    formats: &[Option<String>],
    date1904: bool,
) -> String {
    let value = match cell.kind.as_str() {
        "s" => cell
            .value
            .parse::<usize>()
            .ok()
            .and_then(|i| shared.get(i))
            .map(|s| serde_json::to_string(s).unwrap_or_default())
            .unwrap_or_default(),
        "inlineStr" | "str" => serde_json::to_string(&cell.value).unwrap_or_default(),
        "b" => {
            if cell.value == "1" {
                "true".into()
            } else {
                "false".into()
            }
        }
        _ => cell
            .style
            .and_then(|i| formats.get(i))
            .and_then(Option::as_deref)
            .and_then(|pattern| rendered_date(&cell.value, pattern, date1904))
            .unwrap_or_else(|| cell.value.clone()),
    };
    if cell.formula.is_empty() {
        value
    } else if value.is_empty() {
        format!("={}", cell.formula)
    } else {
        format!("={} → {value}", cell.formula)
    }
}

pub(super) fn workbook_model_view(
    bytes: &[u8],
    formats: &[Option<String>],
    date1904: bool,
) -> Result<String, String> {
    let shared = if let Ok(xml) = zip_entry(bytes, "xl/sharedStrings.xml") {
        shared_strings(&xml)?
    } else {
        Vec::new()
    };
    let mut views = Vec::new();
    let mut budget = 4000usize;
    for (name, path) in workbook_sheets(bytes)? {
        if budget == 0 {
            break;
        }
        let xml = zip_entry(bytes, &path).map_err(|_| "not a readable spreadsheet".to_string())?;
        let rows = worksheet_cells(&xml)?;
        let mut lines = Vec::new();
        let (mut last_row, mut last_col) = (0, 0);
        for (row, cells) in rows {
            let parts: Vec<_> = cells
                .into_iter()
                .filter_map(|(col, cell)| {
                    let value = model_cell_text(&cell, &shared, formats, date1904);
                    (!value.is_empty()).then_some((col, format!("{} {value}", cell.address)))
                })
                .collect();
            if parts.is_empty() {
                continue;
            }
            last_row = row;
            last_col = last_col.max(parts.iter().map(|(col, _)| *col).max().unwrap_or(0));
            if budget == 0 {
                continue;
            }
            let shown = parts.len().min(budget);
            lines.push(
                parts
                    .iter()
                    .take(shown)
                    .map(|(_, text)| text.as_str())
                    .collect::<Vec<_>>()
                    .join(" | "),
            );
            budget -= shown;
        }
        let size = if last_row == 0 {
            "empty".to_string()
        } else {
            format!("{last_row} rows × {last_col} columns used")
        };
        views.push(format!(
            "## Sheet \"{name}\" ({size})\n{}",
            lines.join("\n")
        ));
    }
    Ok(views.join("\n\n"))
}

fn date_pattern(pattern: &str) -> bool {
    let mut bare = String::new();
    let mut chars = pattern.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                for next in chars.by_ref() {
                    if next == '"' {
                        break;
                    }
                }
            }
            '[' => {
                for next in chars.by_ref() {
                    if next == ']' {
                        break;
                    }
                }
            }
            '\\' => {
                chars.next();
            }
            _ => bare.push(ch),
        }
    }
    bare.chars()
        .any(|ch| matches!(ch.to_ascii_lowercase(), 'd' | 'y' | 'h'))
}

pub(super) fn workbook_date_formats(xml: &[u8]) -> Result<Vec<Option<String>>, String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    let mut custom = HashMap::new();
    let mut formats = Vec::new();
    let mut in_xfs = false;
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) | Event::Empty(start) => {
                let local = start.local_name();
                match local.as_ref() {
                    b"cellXfs" => in_xfs = true,
                    b"numFmt" => {
                        if let (Some(id), Some(pattern)) = (
                            attribute_value(&start, b"numFmtId", &bad)?,
                            attribute_value(&start, b"formatCode", &bad)?,
                        ) {
                            custom.insert(id, pattern);
                        }
                    }
                    b"xf" if in_xfs => {
                        let id = attribute_value(&start, b"numFmtId", &bad)?.unwrap_or_default();
                        let pattern = custom
                            .get(&id)
                            .cloned()
                            .or_else(|| built_in_date_pattern(&id).map(str::to_string));
                        formats.push(pattern.filter(|pattern| date_pattern(pattern)));
                    }
                    _ => {}
                }
            }
            Event::End(end) if end.local_name().as_ref() == b"cellXfs" => in_xfs = false,
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(formats)
}

fn built_in_date_pattern(id: &str) -> Option<&'static str> {
    match id.parse::<u16>().ok()? {
        14..=17 | 27..=36 | 50..=58 => Some("yyyy-mm-dd"),
        18..=22 | 45..=47 => Some("yyyy-mm-dd h:mm"),
        _ => None,
    }
}

pub(super) fn workbook_uses_1904_dates(xml: &[u8]) -> Result<bool, String> {
    let bad = || "not a readable spreadsheet".to_string();
    let mut reader = Reader::from_reader(xml);
    loop {
        match reader.read_event().map_err(|_| bad())? {
            Event::Start(start) | Event::Empty(start)
                if start.local_name().as_ref() == b"workbookPr" =>
            {
                return Ok(matches!(
                    attribute_value(&start, b"date1904", &bad)?.as_deref(),
                    Some("1" | "true")
                ));
            }
            Event::Eof => return Ok(false),
            _ => {}
        }
    }
}

pub(super) fn rendered_date(value: &str, pattern: &str, date1904: bool) -> Option<String> {
    let serial: f64 = value.parse().ok()?;
    if !serial.is_finite() {
        return None;
    }
    let epoch_ms = if date1904 {
        -2_082_844_800_000_i64
    } else {
        -2_209_161_600_000_i64
    };
    let millis = epoch_ms.checked_add((serial * 86_400_000.0) as i64)?;
    let date = time::OffsetDateTime::from_unix_timestamp(millis.div_euclid(1000)).ok()?;
    let day = format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        date.month() as u8,
        date.day()
    );
    let mut chars = pattern.chars();
    let mut with_time = false;
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                for next in chars.by_ref() {
                    if next == '"' {
                        break;
                    }
                }
            }
            '[' => {
                for next in chars.by_ref() {
                    if next == ']' {
                        break;
                    }
                }
            }
            _ if matches!(ch.to_ascii_lowercase(), 'h' | 's') => with_time = true,
            _ => {}
        }
    }
    if with_time {
        Some(format!("{day} {:02}:{:02}", date.hour(), date.minute()))
    } else {
        Some(day)
    }
}
