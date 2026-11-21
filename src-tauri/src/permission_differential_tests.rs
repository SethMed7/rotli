//! The permission differential harness, Rust side: the same seeded cases
//! scripts/permission-differential.ts builds, read by the Rust permission
//! readers, must give the TypeScript verdicts recorded in
//! scripts/fixtures/permission-differential.json, every one. Point
//! `ROTLI_PERMISSION_DIFFERENTIAL` at a larger run's file (`--large --out`)
//! to check that instead.

use serde_json::Value;

use crate::parity_tests::permission::permission_verdict;

/// mulberry32 (permission-differential.ts `generator`).
fn next(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x6d2b_79f5);
    let a = *state;
    let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
    t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
    t ^ (t >> 14)
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect()
}

/// A set's cases, built as permission-differential.ts `cases` builds them.
fn cases(set: &Value) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    match set["kind"].as_str().unwrap() {
        "pool" => {
            let pool = strings(&set["pool"]);
            let max_lines = set["maxLines"].as_u64().unwrap() as u32;
            let mut state = set["seed"].as_u64().unwrap() as u32;
            for _ in 0..set["count"].as_u64().unwrap() {
                let lines = 1 + next(&mut state) % max_lines;
                let mut fields = Vec::new();
                for _ in 0..lines {
                    let entry = &pool[next(&mut state) as usize % pool.len()];
                    fields.extend(entry.split('\n').map(str::to_string));
                }
                out.push(fields);
            }
        }
        "product" => {
            let tails = strings(&set["tails"]);
            let stride = set["stride"].as_u64().unwrap() as usize;
            let mut index = 0usize;
            let mut keep = |fields: Vec<String>| {
                if index % stride == 0 {
                    out.push(fields);
                }
                index += 1;
            };
            for head in set["heads"].as_array().unwrap().iter().map(strings) {
                for a in &tails {
                    keep([head.clone(), vec![a.clone()]].concat());
                }
                for a in &tails {
                    for b in &tails {
                        keep([head.clone(), vec![a.clone(), b.clone()]].concat());
                    }
                }
            }
        }
        "spelling" => {
            for spec in set["keys"].as_array().unwrap() {
                let key = spec["key"].as_str().unwrap();
                let escaped = format!("\\u{:04x}{}", key.chars().next().unwrap() as u32, &key[1..]);
                for template in set["templates"].as_array().unwrap() {
                    let template = template[1].as_str().unwrap();
                    for value in strings(&set["values"][spec["values"].as_str().unwrap()]) {
                        for context in spec["contexts"].as_array().unwrap().iter().map(strings) {
                            let line = template.replace("$K", key).replace("$E", &escaped).replace("$U", &key.to_uppercase()).replace("$V", &value);
                            out.push([context, line.split('\n').map(str::to_string).collect()].concat());
                        }
                    }
                }
            }
        }
        kind => panic!("unknown case set kind {kind}"),
    }
    out
}

#[test]
fn permission_differential_rust_reads_every_case_as_typescript_does() {
    let text = match std::env::var("ROTLI_PERMISSION_DIFFERENTIAL") {
        Ok(path) => std::fs::read_to_string(path).unwrap(),
        Err(_) => include_str!("../../scripts/fixtures/permission-differential.json").to_string(),
    };
    let fixture: Value = serde_json::from_str(&text).unwrap();
    let mut differ = Vec::new();
    let mut total = 0usize;
    for set in fixture["sets"].as_array().unwrap() {
        let name = set["name"].as_str().unwrap();
        let expected: Vec<char> = fixture["verdicts"][name].as_str().unwrap().chars().collect();
        let all = cases(set);
        assert_eq!(expected.len(), all.len() * 4, "{name}: the fixture's verdicts are stale: bun scripts/permission-differential.ts --write");
        total += all.len();
        for (i, fields) in all.iter().enumerate() {
            let want: String = expected[i * 4..i * 4 + 4].iter().collect();
            let got = permission_verdict(fields);
            if got != want {
                differ.push(format!("{name} {fields:?}: TS {want}, Rust {got}"));
            }
        }
    }
    if let Ok(report) = std::env::var("ROTLI_PERMISSION_DIFFERENTIAL_REPORT") {
        std::fs::write(report, differ.join("\n")).unwrap();
    }
    assert!(total > 0);
    assert!(differ.is_empty(), "{} of {total} cases read differently:\n{}", differ.len(), differ.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
}
