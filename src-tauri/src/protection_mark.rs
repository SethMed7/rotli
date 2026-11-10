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
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim() != key {
            continue;
        }
        let value = value.trim();
        let value = ['"', '\'']
            .iter()
            .find_map(|q| value.strip_prefix(*q).and_then(|v| v.strip_suffix(*q)))
            .unwrap_or(value);
        if !matches!(value.to_ascii_lowercase().as_str(), "false" | "no" | "off") {
            found = true;
        }
    }
    // a block that never closes can't show the mark absent
    true
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
}
