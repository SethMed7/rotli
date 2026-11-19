//! A file's protection mark (a chat's `secureContext: true`), by the one
//! grammar TypeScript shares (src/lib/frontmatterBlock.ts `protectionMark`),
//! written out in scripts/fixtures/protection-marks.json and run by both
//! sides' tests. Where the grammar can't be sure, it says marked (seventh
//! review of pull request 267: the two sides disagreed, so a protected chat
//! written one way reopened unmarked on the other).

/// Does `contents` carry `key` as a protection mark?
pub(crate) fn marked(contents: &str, key: &str) -> bool {
    let text = contents.strip_prefix('\u{feff}').unwrap_or(contents);
    let mut lines = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l));
    let fence = loop {
        match lines.next() {
            None => return false,
            Some(line) if line.trim().is_empty() => continue,
            Some(line) => break line,
        }
    };
    if fence.trim_end() != "---" {
        return false;
    }
    let mut found = false;
    for line in lines {
        if line.trim_end() == "---" {
            return found;
        }
        found |= marks(line, key);
    }
    // a block that never closes can't show the mark absent
    true
}

/// Does this one line set `key` as a mark (rules 4 and 5)? Also what the
/// egress marker scan reads, line by line (secret.rs).
pub(crate) fn marks(line: &str, key: &str) -> bool {
    let Some((name, value)) = line.split_once(':') else {
        return false;
    };
    if name.trim() != key {
        return false;
    }
    let value = value.trim();
    let value = ['"', '\'']
        .iter()
        .find_map(|q| value.strip_prefix(*q).and_then(|v| v.strip_suffix(*q)))
        .unwrap_or(value);
    !matches!(value.to_ascii_lowercase().as_str(), "false" | "no" | "off")
}

/// Every case of scripts/fixtures/protection-marks.json: name, contents, marked.
#[cfg(test)]
pub(crate) fn fixture_cases() -> Vec<(String, String, bool)> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../scripts/fixtures/protection-marks.json")).unwrap();
    fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let text = |key: &str| case[key].as_str().unwrap().to_string();
            (
                text("name"),
                text("contents"),
                case["marked"].as_bool().unwrap(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{fixture_cases, marked};

    #[test]
    fn every_case_of_the_shared_grammar() {
        for (name, contents, expected) in fixture_cases() {
            assert_eq!(marked(&contents, "secureContext"), expected, "{name}");
        }
    }

    /// The walk's rule (which gates an unprotected PDF copy, search and the
    /// Helper's ledger) reads the mark by the grammar (eighth review).
    #[test]
    fn the_walk_reads_every_case_the_same_way() {
        for (name, contents, expected) in fixture_cases() {
            let (fm, raw) = crate::corpus::parse_document(&contents);
            let walked = crate::corpus::walked_secure(&fm.unwrap_or_default(), raw, &contents);
            assert_eq!(walked, expected, "{name}");
        }
    }

    /// The egress backstop scans outbound text line by line: wherever the
    /// grammar marks a text through a line naming the key, the scan refuses
    /// it too (a block that never closes and names no key is the grammar's
    /// own caution, which a line scan of a reply can't apply).
    #[test]
    fn the_egress_scan_misses_no_marked_line() {
        for (name, contents, expected) in fixture_cases() {
            let names_key = contents.lines().any(|line| super::marks(line.trim(), "secureContext"));
            if expected && names_key {
                assert!(crate::secret::marked_protected(&contents), "{name}");
            }
        }
    }
}
