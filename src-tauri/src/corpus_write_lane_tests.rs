//! The editor's write lane (sixth review of pull request 267): the contract
//! the TypeScript test fake must match, the protection a read reports, and the
//! headless harness that drives the real TypeScript save queue against this
//! store (src/editor/realWriteLane.lane.ts).

use std::collections::HashMap;
use std::io::{BufRead, Write};

use serde_json::{json, Value};

use super::tests::bare;
use super::*;

#[test]
fn stale_editor_write_must_not_overwrite_an_external_edit() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CorpusStore::open(dir.path().to_path_buf()).unwrap();
    let note = store.create("Inbox", "# Original\n\nfirst").unwrap();
    let opened = store.read(&note.id).unwrap();
    let rel = store.path_of(&note.id).unwrap();

    fs::write(
        store.root().join(&rel),
        "---\nid: 01EXTERNAL\n---\n\n# External\n\nnewer",
    )
    .unwrap();

    let result = store.write_if_revision_with_body_base(
        &note.id,
        &format!("{}\n\nlocal", opened.body),
        &opened.revision,
        Some(&opened.body),
    );
    assert!(
        result.is_err(),
        "a stale editor save must report a conflict"
    );
    let current = fs::read_to_string(store.root().join(&rel)).unwrap();
    assert!(current.contains("# External\n\nnewer"));
}

#[test]
fn stale_complete_revision_merges_when_only_rotli_metadata_changed() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = CorpusStore::open(dir.path().to_path_buf()).unwrap();
    let note = store.create("Inbox", "# Original\n\nfirst").unwrap();
    let opened = store.read(&note.id).unwrap();

    // A pin is representative of the Librarian's metadata/location work:
    // complete-file bytes and revision move, editor prose does not.
    store.set_pinned(&note.id, true).unwrap();
    let after_metadata = store.read(&note.id).unwrap();
    assert_ne!(after_metadata.revision, opened.revision);
    assert_eq!(after_metadata.body, opened.body);

    let result = store
        .write_if_revision_with_body_base(
            &note.id,
            "# Original\n\nlocal edit",
            &opened.revision,
            Some(&opened.body),
        )
        .unwrap();

    assert_eq!(
        store.read(&note.id).unwrap().body,
        "# Original\n\nlocal edit"
    );
    assert!(
        result.meta.pinned,
        "the newer metadata must survive the body save"
    );
}

/// One step of scripts/fixtures/write-lane-contract.json against the store.
fn run_step(
    store: &mut CorpusStore,
    ids: &mut HashMap<String, String>,
    revs: &mut HashMap<String, String>,
    step: &Value,
    scenario: &str,
) {
    let text = |key: &str| step[key].as_str().unwrap_or_default().to_string();
    let note = text("note");
    let at = format!("{scenario}: {step}");
    match step["op"].as_str().unwrap() {
        "create" => {
            let made = store.create_with(
                step["folder"].as_str().unwrap_or("Inbox"),
                &text("body"),
                step["secure"].as_bool().unwrap_or(false),
                step["locked"].as_bool().unwrap_or(false),
                None,
                step["event"].as_str(),
            );
            let expected = step["expect"].as_str().unwrap_or("ok");
            assert_eq!(if made.is_ok() { "ok" } else { "error" }, expected, "{at}: {made:?}");
            let Ok(made) = made else { return };
            if let Some(label) = step["as"].as_str() {
                revs.insert(label.into(), made.revision.clone());
            }
            if let Some(other) = step["sameAs"].as_str() {
                assert_eq!(made.meta.id, ids[other], "{at}");
            }
            ids.insert(note, made.meta.id);
        }
        "read" => {
            let read = store.read(&ids[&note]);
            if step["missing"].as_bool() == Some(true) {
                assert!(read.is_err(), "{at}");
                return;
            }
            let doc = read.unwrap();
            if let Some(body) = step["body"].as_str() {
                assert_eq!(doc.body, body, "{at}");
            }
            if let Some(label) = step["revisionIs"].as_str() {
                assert_eq!(doc.revision, revs[label], "{at}");
            }
            if let Some(label) = step["revisionNot"].as_str() {
                assert_ne!(doc.revision, revs[label], "{at}");
            }
            if let Some(pinned) = step["pinned"].as_bool() {
                assert_eq!(doc.pinned, pinned, "{at}");
            }
            if let Some(secure) = step["secure"].as_bool() {
                assert_eq!(doc.secure, secure, "{at}");
            }
            if let Some(locked) = step["locked"].as_bool() {
                assert_eq!(doc.locked, locked, "{at}");
            }
            if let Some(folder) = step["inFolder"].as_str() {
                assert_eq!(doc.folder_id, folder, "{at}");
            }
            if let Some(label) = step["as"].as_str() {
                revs.insert(label.into(), doc.revision);
            }
        }
        "write" => {
            let result = store.write_if_revision_with_body_base(
                &ids[&note],
                &text("body"),
                &revs[&text("revision")],
                Some(&text("base")),
            );
            match (step["expect"].as_str().unwrap(), result) {
                ("ok", Ok(landed)) => {
                    if let Some(label) = step["as"].as_str() {
                        revs.insert(label.into(), landed.revision);
                    }
                }
                ("conflict", Err(error)) => {
                    assert!(error.starts_with("revision conflict"), "{at}: {error}")
                }
                ("missing", Err(error)) => {
                    assert!(error.starts_with("note not found"), "{at}: {error}")
                }
                (expected, other) => panic!("{at}: expected {expected}, got {other:?}"),
            }
        }
        "external" => {
            store.write(&ids[&note], &text("body")).unwrap();
        }
        "pin" => store.set_pinned(&ids[&note], true).unwrap(),
        "lock" => store.set_locked(&ids[&note], true).unwrap(),
        "move" => {
            store.move_note(&ids[&note], &text("folder")).unwrap();
        }
        "purge" => {
            store.delete(&ids[&note]).unwrap();
            store.purge(&ids[&note]).unwrap();
        }
        other => panic!("unknown step {other}"),
    }
}

#[test]
fn the_write_lane_keeps_the_contract_the_test_fake_follows() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../scripts/fixtures/write-lane-contract.json"
    ))
    .unwrap();
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let (_dir, mut store) = bare();
        let (mut ids, mut revs) = (HashMap::new(), HashMap::new());
        let name = scenario["name"].as_str().unwrap();
        for step in scenario["steps"].as_array().unwrap() {
            run_step(&mut store, &mut ids, &mut revs, step, name);
        }
    }
}

/// F7: native conflict recovery made an unprotected copy of a secure note,
/// because a read carried neither flag.
#[test]
fn a_read_carries_the_effective_protection_the_ipc_sends() {
    let (_dir, mut store) = bare();
    let marked = store
        .create_as("Inbox", "# Ledger\n\nprivate", true, None)
        .unwrap();
    let in_home = store
        .create(SECURE_NOTES_FOLDER, "# Filed\n\nwords")
        .unwrap();
    let detected = store
        .create("Inbox", "# Keys\n\nkey: sk-ant-api03-EXAMPLE0EXAMPLE0EXAM")
        .unwrap();
    let plain = store.create("Inbox", "# Plain\n\nwords").unwrap();
    for id in [&marked.id, &in_home.id, &detected.id] {
        assert!(store.read(id).unwrap().secure, "{id}");
    }
    let doc = store.read(&plain.id).unwrap();
    assert!(!doc.secure && !doc.locked);
    let wire = serde_json::to_value(&doc).unwrap();
    assert_eq!(wire["secure"], json!(false));
    assert_eq!(wire["locked"], json!(false));
}

/// A native note read counts a chat's taint mark by the grammar TypeScript
/// shares (seventh review of pull request 267: `doc_from_text` left it out).
#[test]
fn a_native_read_counts_a_chats_taint_mark_by_the_shared_grammar() {
    let (dir, store) = bare();
    let abs = dir.path().join("Inbox/chat.md");
    for (name, contents, marked) in crate::protection_mark::fixture_cases() {
        let doc = store.doc_from_text("chat", "Inbox/chat.md", &abs, &contents);
        assert_eq!(doc.secure, marked, "{name}");
    }
}

/// What the harness answers for one IPC command: the same store methods the
/// Tauri commands call (corpus_read, corpus_write, corpus_create, corpus_list,
/// corpus_move, corpus_delete, corpus_purge, corpus_set_secure), plus test-only steps:
/// `external` (another app writes the note), `pin`, `notes` (every note's id,
/// body and protection) and `rel` (the note's path).
fn harness_answer(store: &mut CorpusStore, cmd: &str, args: &Value) -> Result<Value, String> {
    let arg = |key: &str| args[key].as_str().unwrap_or_default().to_string();
    let to = |value: Result<Value, serde_json::Error>| value.map_err(|e| e.to_string());
    match cmd {
        "corpus_read" => to(serde_json::to_value(store.read(&arg("id"))?)),
        "corpus_write" => {
            let base = args["expectedBody"].as_str().map(str::to_string);
            to(serde_json::to_value(
                store.write_if_revision_with_body_base(
                    &arg("id"),
                    &arg("body"),
                    &arg("expectedRevision"),
                    base.as_deref(),
                )?,
            ))
        }
        "corpus_create" => {
            let event = args["recoveryEvent"].as_str().map(str::to_string);
            to(serde_json::to_value(store.create_with(
                &arg("folderId"),
                &arg("body"),
                args["secure"].as_bool().unwrap_or(false),
                args["locked"].as_bool().unwrap_or(false),
                None,
                event.as_deref(),
            )?))
        }
        "corpus_list" => to(serde_json::to_value(store.list()?)),
        "corpus_move" => to(serde_json::to_value(
            store.move_note(&arg("id"), &arg("targetFolder"))?,
        )),
        "corpus_delete" => store.delete(&arg("id")).map(|()| Value::Null),
        "corpus_purge" => store.purge(&arg("id")).map(|()| Value::Null),
        "corpus_set_secure" => store
            .set_secure(&arg("id"), args["secure"].as_bool().unwrap_or(true))
            .map(|()| Value::Null),
        "external" => to(serde_json::to_value(store.write(&arg("id"), &arg("body"))?)),
        "pin" => store.set_pinned(&arg("id"), true).map(|()| Value::Null),
        "notes" => {
            let ids: Vec<String> = store
                .list()?
                .notes
                .into_iter()
                .filter(|n| n.kind == NoteKind::Note)
                .map(|n| n.id)
                .collect();
            let mut out = Vec::new();
            for id in ids {
                let doc = store.read(&id)?;
                out.push(json!({ "id": id, "body": doc.body, "secure": doc.secure, "locked": doc.locked, "folderId": doc.folder_id }));
            }
            Ok(Value::Array(out))
        }
        other => Err(format!("the write-lane harness doesn't answer {other}")),
    }
}

/// The headless real-lane harness: JSON lines on stdin, `{"seq","cmd","args"}`,
/// each answered on stdout as `{"seq","ok","value"|"error"}`, against a fresh
/// temporary vault. Run by src/editor/realWriteLane.lane.ts, never alone.
#[test]
#[ignore = "driven by src/editor/realWriteLane.lane.ts over stdin"]
fn write_lane_harness() {
    let (_dir, mut store) = bare();
    let stdout = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = serde_json::from_str(&line).unwrap();
        // Real slowness inside Rust, around the store call: the harness answers
        // one request at a time, as the app's registry mutex serialises store
        // operations (corpus.rs), so a slow call holds everything behind it.
        // Test-only: this module is compiled only under cfg(test).
        if let Some(ms) = request["delayMs"].as_u64() {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
        let answer = match harness_answer(
            &mut store,
            request["cmd"].as_str().unwrap_or_default(),
            &request["args"],
        ) {
            Ok(value) => json!({ "seq": request["seq"], "ok": true, "value": value }),
            Err(error) => json!({ "seq": request["seq"], "ok": false, "error": error }),
        };
        let mut out = stdout.lock();
        writeln!(out, "@lane {answer}").unwrap();
        out.flush().unwrap();
    }
}
