//! The frontmatter differential harness, Rust side (review of PR #303): the
//! same seeded cases scripts/frontmatter-differential.ts builds, read by the
//! Rust permission readers, must give the TypeScript verdicts recorded in
//! scripts/fixtures/frontmatter-differential.json, every one. Point
//! `ROTLI_FRONTMATTER_DIFFERENTIAL` at a bigger run's file to check it.

use crate::ai_edit_policy::{body_edit, BodyEdit};

/// mulberry32 (frontmatter-differential.ts `generator`).
fn next(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let a = *state;
    let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    t ^ (t >> 14)
}

/// Four characters: body edit, on-device (t/f/u), locked (1/0), secure (1/0).
pub(crate) fn verdict(fields: &[String]) -> String {
    let body = match body_edit(fields) {
        BodyEdit::Allowed => 'a',
        BodyEdit::Locked => 'l',
        BodyEdit::PersonWritten => 'p',
        BodyEdit::Revoked => 'r',
    };
    let local = match crate::frontmatter_keys::local_ai_allowed(fields) {
        None => 'u',
        Some(true) => 't',
        Some(false) => 'f',
    };
    let flag = |on: bool| if on { '1' } else { '0' };
    [body, local, flag(crate::frontmatter_keys::locked(fields)), flag(crate::frontmatter_keys::secure(fields))].iter().collect()
}

#[test]
fn rust_and_typescript_read_every_differential_case_alike() {
    let text = match std::env::var("ROTLI_FRONTMATTER_DIFFERENTIAL") {
        Ok(path) => std::fs::read_to_string(path).unwrap(),
        Err(_) => include_str!("../../scripts/fixtures/frontmatter-differential.json").to_string(),
    };
    let fixture: serde_json::Value = serde_json::from_str(&text).unwrap();
    let pool: Vec<&str> = fixture["pool"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    let (count, max_lines) = (fixture["count"].as_u64().unwrap(), fixture["maxLines"].as_u64().unwrap() as u32);
    let expected: Vec<char> = fixture["verdicts"].as_str().unwrap().chars().collect();
    assert_eq!(expected.len() as u64, count * 4, "the fixture's verdicts are stale: bun scripts/frontmatter-differential.ts --write");
    let mut state = fixture["seed"].as_u64().unwrap() as u32;
    let mut differ = Vec::new();
    for case in 0..count as usize {
        let lines = 1 + next(&mut state) % max_lines;
        let mut fields = Vec::new();
        for _ in 0..lines {
            let entry = pool[(next(&mut state) as usize) % pool.len()];
            fields.extend(entry.split('\n').map(str::to_string));
        }
        let want: String = expected[case * 4..case * 4 + 4].iter().collect();
        let got = verdict(&fields);
        if got != want {
            differ.push(serde_json::to_string(&fields).unwrap());
        }
    }
    let distinct: std::collections::BTreeSet<&String> = differ.iter().collect();
    if let Ok(report) = std::env::var("ROTLI_FRONTMATTER_DIFFERENTIAL_REPORT") {
        std::fs::write(report, serde_json::to_string(&distinct).unwrap()).unwrap();
    }
    assert!(differ.is_empty(), "{} cases ({} distinct) read differently:\n{}", differ.len(), distinct.len(), distinct.iter().take(40).map(|s| s.as_str()).collect::<Vec<_>>().join("\n"));
}
