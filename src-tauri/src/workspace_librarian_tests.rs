//! The Librarian route's guards: off by default, secure notes never shown,
//! proposals instead of rewrites (and no tool that approves them), its own two
//! pages the only ones it rewrites, and the person's apply running through the
//! same write seams.

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::{handle_mcp_request_for_root, handle_mcp_with, RootTarget, Workspace, CONNECTOR_ROOT, DEFAULT_ROOT_ID, MAIN_ROOT};
use super::*;
use crate::ai_edit_policy::Creator;

/// The route's behaviour exists only in development builds.
pub(super) fn public_build() -> bool {
    !crate::feature_policy::agents_enabled()
}

#[test]
fn a_public_build_ignores_the_vault_switch() {
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    assert_eq!(enabled(temp.path()), !public_build(), "the switch does nothing in a public build");
}

pub(super) fn turn_on(temp: &TempDir) {
    fs::create_dir_all(temp.path().join(".rotli")).unwrap();
    fs::write(temp.path().join(".rotli/settings.json"), r#"{"theme":"grove","librarianMcp":true}"#).unwrap();
    record_consent(temp.path(), true).unwrap();
}

pub(super) fn target(id: &str, temp: &TempDir, is_default: bool) -> RootTarget {
    RootTarget { id: id.into(), label: id.into(), path: temp.path().to_path_buf(), read_only: false, is_default }
}

/// One call to a Librarian server bound to `bound` (as `serve` binds it at start).
pub(super) fn call_bound(bound: Option<Bound>, method: &str, params: Value) -> Value {
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    BOUND.with(|value| *value.borrow_mut() = bound);
    let response = handle_mcp_with(&request, &SERVER).unwrap();
    BOUND.with(|value| *value.borrow_mut() = None);
    response["result"].clone()
}

pub(super) fn request(temp: &TempDir, method: &str, params: Value) -> Value {
    let target = target(DEFAULT_ROOT_ID, temp, true);
    let identity = crate::containment::folder_identity(&target.path);
    call_bound(Some(Bound { target, identity }), method, params)
}

pub(super) fn mcp(temp: &TempDir, name: &str, arguments: Value) -> Value {
    request(temp, "tools/call", json!({ "name": name, "arguments": arguments }))
}

/// The refusal a failed call carries, all its text parts joined.
pub(super) fn refusal(result: &Value) -> String {
    assert!(result.get("isError").and_then(Value::as_bool).unwrap_or(false), "expected a refusal: {result}");
    let parts = result.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
    parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" ")
}

pub(super) fn ok(result: Value) -> Value {
    assert_eq!(result["isError"], false, "{result}");
    result["structuredContent"].clone()
}

pub(super) fn body_of(ws: &mut Workspace, id: &str) -> String {
    let local = ws.local_id(id).unwrap();
    ws.read_note(&local).unwrap().note.body
}

#[test]
fn the_route_is_off_until_the_vault_turns_it_on() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    let _ = test_workspace(&temp);
    assert!(!enabled(temp.path()));
    for (name, args) in [
        (SEARCH, json!({"query":"x"})),
        (CAPTURE, json!({"title":"T","body":"b"})),
        (REVIEW, json!({})),
    ] {
        let refused = refusal(&mcp(&temp, name, args));
        assert!(refused.contains("The Librarian is off"), "{name}");
        // the refusal names the switch that exists today, not a Settings page that doesn't
        assert!(refused.contains(r#""librarianMcp": true"#) && !refused.contains("Settings →"), "{refused}");
    }
    // the skills are static help text, readable before the switch is on
    let guide = ok(mcp(&temp, GUIDE, json!({})));
    assert_eq!(guide.pointer("/skill").and_then(Value::as_str), Some(FIRST_SKILL));
    assert!(guide["markdown"].as_str().unwrap().contains("Hard rules"));

    fs::create_dir_all(temp.path().join(".rotli")).unwrap();
    for off in [r#"{"librarianMcp":false}"#, r#"{"librarianMcp":"true"}"#, "not json"] {
        fs::write(temp.path().join(".rotli/settings.json"), off).unwrap();
        assert!(!enabled(temp.path()), "{off}");
    }
    fs::write(temp.path().join(".rotli/settings.json"), r#"{"librarianMcp":true}"#).unwrap();
    assert!(!enabled(temp.path()), "the setting alone is not the person's consent for this folder");
    turn_on(&temp);
    assert!(enabled(temp.path()));
}

#[test]
fn the_tool_set_is_small_and_has_no_way_to_approve() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    let listed: Vec<String> = (SERVER.tools)().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(listed, [GUIDE, SEARCH, READ, CAPTURE, FILE, LINK, INDEX, LOG, INDEX_READ, REVIEW]);
    assert!(!listed.iter().any(|name| name.contains("apply") || name.contains("approve")));
    let init = request(&temp, "initialize", json!({}));
    assert_eq!(init.pointer("/serverInfo/name").and_then(Value::as_str), Some(SERVER.name));
    turn_on(&temp);
    assert!(refusal(&mcp(&temp, "librarian_apply", json!({"id":"x"}))).contains("unknown tool"));
    assert!(refusal(&mcp(&temp, "rotli_update_note", json!({}))).contains("unknown tool"));
}

#[test]
fn capture_files_a_raw_source_in_intake_and_logs_it() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let note = ok(mcp(&temp, CAPTURE, json!({"title":"Pricing call","body":"Ana said the tiers are fine.","source":"conversation"})));
    let mut ws = test_workspace(&temp);
    let body = body_of(&mut ws, note["id"].as_str().unwrap());
    assert!(body.contains("Ana said the tiers are fine.") && body.ends_with("Source: conversation\n"), "{body}");
    let pages = ok(mcp(&temp, INDEX_READ, json!({})));
    assert_eq!(pages["log"][0]["text"], "Captured a new source");
    assert_eq!(pages["log"][0]["notes"][0]["title"], "Pricing call", "the title is the live note's: {pages}");

    let fm = mcp(&temp, CAPTURE, json!({"title":"Sneaky","body":"---\nsecure: false\n---\nx"}));
    assert!(refusal(&fm).contains("frontmatter"), "{fm}");
    let secret = mcp(&temp, CAPTURE, json!({"title":"Keys","body":"card 4242 4242 4242 4242"}));
    assert_eq!(secret["isError"], true, "{secret}");
}

#[test]
fn secure_notes_are_never_read_searched_or_proposed() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let secure = ws.store.create_as("Secure notes", "# Bank login\n\nmarigold", true, Some(Creator::Agent)).unwrap();
    assert!(refusal(&mcp(&temp, READ, json!({"id": secure.id}))).contains("secure"));
    let hits = ok(mcp(&temp, SEARCH, json!({"query":"marigold"})));
    assert_eq!(hits["items"].as_array().unwrap().len(), 0, "{hits}");
    assert_eq!(mcp(&temp, FILE, json!({"id": secure.id, "folder":"projects","reason":"x"}))["isError"], true);
    assert!(pending(temp.path()).is_empty());
}

#[test]
fn filing_is_a_proposal_the_person_applies() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Launch plan", "steps", MAIN_ROOT).unwrap();
    let rel = ws.store.resolve_note_rel(&note.id).unwrap();

    let first = ok(mcp(&temp, FILE, json!({"id": note.id, "folder":"projects/payments","reason":"Part of the Payments project."})));
    let again = ok(mcp(&temp, FILE, json!({"id": note.id, "folder":"projects/payments/","reason":"Same thing."})));
    assert_eq!(first["id"], again["id"], "a repeated proposal is the pending one");
    assert_eq!(ws.store.resolve_note_rel(&note.id).unwrap(), rel, "nothing moved on proposing");
    let review = ok(mcp(&temp, REVIEW, json!({})));
    assert_eq!(review["items"].as_array().unwrap().len(), 1);
    assert_eq!(review["items"][0]["noteTitle"], "Launch plan");

    for escape in ["../escape", ".rotli", "a//b"] {
        let why = refusal(&mcp(&temp, FILE, json!({"id": note.id, "folder": escape, "reason":"x"})));
        assert!(why.contains("plain vault-relative"), "{escape}: {why}");
    }

    let id = first["id"].as_str().unwrap();
    let applied = decide(&mut ws, id, true).unwrap();
    assert_eq!(applied["status"], "applied");
    assert!(ws.store.resolve_note_rel(&note.id).unwrap().starts_with("projects/payments/"));
    assert!(pending(temp.path()).is_empty());
    assert!(decide(&mut ws, id, true).unwrap_err().contains("no pending proposal"));
}

#[test]
fn a_link_on_a_persons_note_waits_for_their_grant() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    ws.create_note("Ana Ruiz", "design lead", MAIN_ROOT).unwrap();
    let mine = ws.store.create("Inbox", "# Meeting\n\nwords the person wrote").unwrap();
    let agents = ws.create_note("Summary", "made by an agent", MAIN_ROOT).unwrap();

    assert!(refusal(&mcp(&temp, LINK, json!({"id": mine.id, "target":"Nobody","reason":"x"}))).contains("not found"));
    assert!(refusal(&mcp(&temp, LINK, json!({"id": mine.id, "target":"[[Ana Ruiz]]","reason":"x"}))).contains("without [[ ]]"));

    let on_person = propose(&mut ws, "link", &mine.id, "Ana Ruiz", "Ana ran this meeting.").unwrap();
    let refused = decide(&mut ws, &on_person.id, true).unwrap_err();
    assert!(refused.contains("written by the person"), "{refused}");
    assert_eq!(pending(temp.path()).len(), 1, "a refused apply stays pending");
    assert_eq!(body_of(&mut ws, &mine.id), "# Meeting\n\nwords the person wrote");

    let first = propose(&mut ws, "link", &agents.id, "Ana Ruiz", "About Ana.").unwrap();
    decide(&mut ws, &first.id, true).unwrap();
    let second = propose(&mut ws, "link", &agents.id, "Meeting", "Came from it.").unwrap();
    decide(&mut ws, &second.id, true).unwrap();
    assert!(body_of(&mut ws, &agents.id).ends_with("made by an agent\n\nRelated: [[Ana Ruiz]], [[Meeting]]\n"));

    let dismissed = decide(&mut ws, &on_person.id, false).unwrap();
    assert_eq!(dismissed["status"], "dismissed");
    assert!(pending(temp.path()).is_empty());
}

/// Found by a real Claude Code session (2026-11-08): MCP's `structuredContent`
/// must be a JSON object, and Claude Code rejects a list result as malformed,
/// so search and review failed for every compliant client. A list travels
/// wrapped in `items`; the text part still carries the whole value.
#[test]
fn every_result_is_an_mcp_object_even_when_the_answer_is_a_list() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    ws.create_note("Harbor launch", "March", MAIN_ROOT).unwrap();
    for (name, args) in [(SEARCH, json!({"query":"Harbor"})), (REVIEW, json!({}))] {
        let result = mcp(&temp, name, args);
        let structured = &result["structuredContent"];
        assert!(structured.is_object(), "{name}: {result}");
        assert!(structured["items"].is_array(), "{name}: {result}");
    }
    // the full workspace server shares the handler, so its list tools were broken too
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "rotli_search", "arguments": { "query": "Harbor" } } });
    let response = handle_mcp_request_for_root(&request, temp.path().to_path_buf(), false).unwrap();
    assert!(response["result"]["structuredContent"]["items"].is_array(), "{response}");
}

#[test]
fn related_lines_grow_without_touching_prose() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    assert_eq!(with_related("# T\n\nbody", "[[A]]"), "# T\n\nbody\n\nRelated: [[A]]\n");
    assert_eq!(with_related("# T\n\nbody\n\nRelated: [[A]]\n", "[[B]]"), "# T\n\nbody\n\nRelated: [[A]], [[B]]\n");
}

/// The person makes a note secure after the agent has seen it.
pub(super) fn make_secure(ws: &mut Workspace, id: &str) {
    let rel = ws.store.resolve_note_rel(id).unwrap();
    let path = ws.store.root().join(rel);
    let text = fs::read_to_string(&path).unwrap();
    fs::write(&path, text.replacen("---\n", "---\nsecure: true\n", 1)).unwrap();
}

/// Audit 2026-11-08 (finding 1): a planted `.rotli/librarian` link, or a link
/// at the proposals file, must not carry an agent's write out of the vault.
#[cfg(unix)]
#[test]
fn proposals_never_follow_a_symlink_out_of_the_vault() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Launch plan", "steps", MAIN_ROOT).unwrap();
    let file = |temp: &TempDir| mcp(temp, FILE, json!({"id": note.id, "folder":"projects","reason":"Part of projects."}));

    symlink(outside.path(), temp.path().join(".rotli/librarian")).unwrap();
    assert!(refusal(&file(&temp)).contains("symlink"));
    assert!(fs::read_dir(outside.path()).unwrap().next().is_none(), "nothing written outside the vault");

    fs::remove_file(temp.path().join(".rotli/librarian")).unwrap();
    fs::create_dir_all(temp.path().join(".rotli/librarian")).unwrap();
    let victim = outside.path().join("victim.txt");
    fs::write(&victim, "keep me\n").unwrap();
    symlink(&victim, temp.path().join(PROPOSALS)).unwrap();
    assert!(refusal(&file(&temp)).contains("symlink"));
    assert_eq!(fs::read_to_string(&victim).unwrap(), "keep me\n");
}

/// Audit 2026-11-08 (finding 2): the route serves the one vault it was started
/// for, never whatever the app's default is at the moment of a call.
#[test]
fn the_route_serves_the_one_vault_it_was_started_for() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let (a, b, stranger) = (TempDir::new().unwrap(), TempDir::new().unwrap(), TempDir::new().unwrap());
    for vault in [&a, &b] {
        turn_on(vault);
        let _ = test_workspace(vault);
    }
    let targets = || vec![target(DEFAULT_ROOT_ID, &a, true), target("b", &b, false)];
    let real_b = fs::canonicalize(b.path()).unwrap();
    let path = |t: &TempDir| t.path().to_str().unwrap().to_string();

    let bound = bind_vault(Some(&path(&b)), a.path(), targets()).unwrap();
    assert_eq!((bound.target.path.as_path(), bound.target.id.as_str()), (real_b.as_path(), "b"));
    assert_eq!(bind_vault(None, b.path(), targets()).unwrap().target.path, real_b, "the cwd binds");
    #[cfg(unix)]
    {
        let link = stranger.path().join("b-link");
        std::os::unix::fs::symlink(b.path(), &link).unwrap();
        assert_eq!(bind_vault(Some(link.to_str().unwrap()), a.path(), targets()).unwrap().target.path, real_b);
    }
    assert!(bind_vault(None, stranger.path(), targets()).unwrap_err().contains("--vault"));
    assert!(bind_vault(Some(&path(&stranger)), a.path(), targets()).unwrap_err().contains("not a vault registered"));
    fs::write(b.path().join(".rotli/settings.json"), r#"{"librarianMcp":false}"#).unwrap();
    assert!(bind_vault(Some(&path(&b)), a.path(), targets()).unwrap_err().contains("The Librarian is off"));
    turn_on(&b);

    // bound to B, a capture lands in B even while A is the app's default
    let capture = json!({"name": CAPTURE, "arguments": {"title":"Only in B","body":"x"}});
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = Some((a.path().to_path_buf(), false)));
    let result = call_bound(Some(bound), "tools/call", capture.clone());
    let unbound = call_bound(None, "tools/call", capture);
    CONNECTOR_ROOT.with(|value| *value.borrow_mut() = None);
    assert!(ok(result)["id"].as_str().unwrap().starts_with("b:"));
    assert!(test_workspace(&b).resolve_note_selector("Only in B").is_ok());
    assert!(test_workspace(&a).resolve_note_selector("Only in B").is_err());
    assert!(refusal(&unbound).contains("not bound"), "an unbound server refuses instead of guessing");
}

/// Audit 2026-11-08 (finding 5): a proposal's title and reason stop showing
/// once its note, or the page it links to, turns secure.
#[test]
fn review_drops_proposals_whose_notes_turned_secure() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let ana = ws.create_note("Ana Ruiz", "design lead", MAIN_ROOT).unwrap();
    let harbor = ws.create_note("Harbor plan", "steps", MAIN_ROOT).unwrap();
    let dock = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    propose(&mut ws, "file", &harbor.id, "projects", "Harbor belongs to projects.").unwrap();
    propose(&mut ws, "link", &dock.id, "Ana Ruiz", "Ana leads the dock work.").unwrap();
    assert_eq!(ok(mcp(&temp, REVIEW, json!({})))["items"].as_array().unwrap().len(), 2);

    make_secure(&mut ws, &harbor.id);
    make_secure(&mut ws, &ana.id);
    let review = mcp(&temp, REVIEW, json!({}));
    assert_eq!(ok(review.clone())["items"].as_array().unwrap().len(), 0, "{review}");
    assert!(!review.to_string().contains("Harbor") && !review.to_string().contains("Ana"), "{review}");
    assert_eq!(pending(temp.path()).len(), 2, "the person still sees both");
}

/// Audit 2026-11-08 (finding 7): two captures that pick the same file name at
/// once both survive; neither replaces the other.
#[test]
fn concurrent_captures_never_overwrite_each_other() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    const WRITERS: usize = 8;
    for round in 0..4 {
        let temp = TempDir::new().unwrap();
        turn_on(&temp);
        let intake = test_workspace(&temp).store.layout().intake_dir().to_string();
        let gate = Arc::new(Barrier::new(WRITERS));
        let writers: Vec<_> = (0..WRITERS)
            .map(|i| {
                let (gate, root, intake) = (gate.clone(), target(DEFAULT_ROOT_ID, &temp, true), intake.clone());
                std::thread::spawn(move || {
                    let mut ws = Workspace::open_target(root).unwrap();
                    gate.wait();
                    ws.store.create_for_remote_agent(&intake, &format!("# Same title\n\nwriter {i}")).unwrap().id
                })
            })
            .collect();
        let ids: Vec<String> = writers.into_iter().map(|w| w.join().unwrap()).collect();
        let mut ws = test_workspace(&temp);
        for (i, id) in ids.iter().enumerate() {
            assert!(body_of(&mut ws, id).contains(&format!("writer {i}")), "round {round}: writer {i} was overwritten");
        }
    }
}

/// Audit 2026-11-08 (finding 4): a read returns exactly the bytes the secure
/// gate judged, with the revision of those bytes, even while the file flips.
#[test]
fn a_read_returns_exactly_the_bytes_the_gate_checked() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Flip", "plain words", MAIN_ROOT).unwrap();
    let rel = ws.store.resolve_note_rel(&note.id).unwrap();
    let path = ws.store.root().join(rel);
    let plain = fs::read_to_string(&path).unwrap();
    let secure = plain.replacen("---\n", "---\nsecure: true\n", 1).replace("plain words", "marigold");
    let plain_revision = crate::fsutil::revision(plain.as_bytes());
    let stop = Arc::new(AtomicBool::new(false));
    let flipper = {
        let (stop, path) = (stop.clone(), path.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                crate::fsutil::atomic_write(&path, &secure, ".flip-").unwrap();
                crate::fsutil::atomic_write(&path, &plain, ".flip-").unwrap();
            }
        })
    };
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut served = 0;
    let mut wrong = None;
    while Instant::now() < deadline && wrong.is_none() {
        if let Ok(read) = ws.read_note(&note.id) {
            served += 1;
            if read.note.body.contains("marigold") || read.revision != plain_revision {
                wrong = Some(format!("body {:?}, revision {}", read.note.body, read.revision));
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    flipper.join().unwrap();
    assert_eq!(wrong, None, "a read served bytes the gate never judged");
    assert!(served > 0);
}

/// Audit round 2 (finding 3): a hard link at the proposals file passes every
/// path check and O_NOFOLLOW, so appends changed a file outside the vault and
/// reads returned its rows. A proposals file that is not one plain file of its
/// own is refused both ways.
#[cfg(unix)]
#[test]
fn proposals_refuse_a_hard_linked_file() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Launch plan", "steps", MAIN_ROOT).unwrap();
    let planted = r#"{"id":"p0","ts":0,"kind":"file","note":"x","noteTitle":"Planted","folder":"a","reason":"r","status":"pending"}"#;
    let victim = outside.path().join("victim.jsonl");
    fs::write(&victim, format!("{planted}\n")).unwrap();
    fs::create_dir_all(temp.path().join(".rotli/librarian")).unwrap();
    fs::hard_link(&victim, temp.path().join(PROPOSALS)).unwrap();

    let why = refusal(&mcp(&temp, FILE, json!({"id": note.id, "folder":"projects","reason":"Part of projects."})));
    assert!(why.contains("proposals"), "{why}");
    assert_eq!(fs::read_to_string(&victim).unwrap(), format!("{planted}\n"), "the outside file is untouched");
    assert!(all_proposals(temp.path()).is_empty(), "the outside file's rows are never read");
    assert!(!ok(mcp(&temp, REVIEW, json!({}))).to_string().contains("Planted"));
}

/// Audit round 2 (finding 6): every step to the proposals file is opened
/// without following a link, so a `.rotli` swapped for a link is refused too.
#[cfg(unix)]
#[test]
fn proposals_refuse_a_linked_rotli_folder() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Launch plan", "steps", MAIN_ROOT).unwrap();
    turn_on(&temp);
    let real = temp.path().join(".rotli-real");
    fs::rename(temp.path().join(".rotli"), &real).unwrap();
    std::os::unix::fs::symlink(&real, temp.path().join(".rotli")).unwrap();
    fs::create_dir_all(real.join("librarian")).unwrap();
    std::os::unix::fs::symlink(outside.path(), real.join("x")).unwrap();
    let proposal = Proposal {
        id: "p1".into(),
        ts: 0,
        kind: "file".into(),
        note: note.id.clone(),
        note_title: "Launch plan".into(),
        folder: Some("projects".into()),
        target: None,
        target_id: None,
        revision: None,
        reason: "r".into(),
        status: "pending".into(),
    };
    assert!(append_proposal(temp.path(), &proposal).is_err());
    assert!(!real.join("librarian/proposals.jsonl").exists());
}

/// Audit round 2 (finding 6): the server checks, on every call, that the
/// vault folder is still the one it bound at start, not a folder put in its
/// place since.
#[cfg(unix)]
#[test]
fn a_vault_folder_replaced_after_binding_is_refused() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let parent = TempDir::new().unwrap();
    let path = parent.path().join("vault");
    let make = |path: &std::path::Path| {
        fs::create_dir_all(path.join(".rotli")).unwrap();
        fs::write(path.join(".rotli/settings.json"), r#"{"librarianMcp":true}"#).unwrap();
        record_consent(path, true).unwrap();
        let root = RootTarget { id: DEFAULT_ROOT_ID.into(), label: "v".into(), path: fs::canonicalize(path).unwrap(), read_only: false, is_default: true };
        Workspace::open_target(root.clone()).unwrap();
        root
    };
    let root = make(&path);
    let bound = bind_vault(Some(path.to_str().unwrap()), parent.path(), vec![root]).unwrap();
    let capture = json!({"name": CAPTURE, "arguments": {"title":"Kept","body":"x"}});
    ok(call_bound(Some(bound.clone()), "tools/call", capture.clone()));

    fs::rename(&path, parent.path().join("moved")).unwrap();
    make(&path);
    let why = refusal(&call_bound(Some(bound), "tools/call", capture));
    assert!(why.contains("replaced"), "{why}");
}

/// Audit round 2 (finding 5): a link proposal is checked against the exact
/// page it was made for. Once that page turns secure, another public note
/// carrying its title as an alias must not stand in for it, and an older row
/// with only the title is shown only when that title still names one page.
#[test]
fn review_checks_the_exact_page_a_link_was_proposed_for() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let ana = ws.create_note("Ana Ruiz", "design lead", MAIN_ROOT).unwrap();
    let dock = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    propose(&mut ws, "link", &dock.id, "Ana Ruiz", "Ana leads the dock work.").unwrap();
    let legacy = r#"{"id":"old1","ts":0,"kind":"link","note":"NOTE","noteTitle":"Dock notes","target":"Ana Ruiz","reason":"Older Ana row.","status":"pending"}"#
        .replace("NOTE", &dock.id);
    let mut file = fs::OpenOptions::new().append(true).open(temp.path().join(PROPOSALS)).unwrap();
    std::io::Write::write_all(&mut file, format!("{legacy}\n").as_bytes()).unwrap();
    assert_eq!(ok(mcp(&temp, REVIEW, json!({})))["items"].as_array().unwrap().len(), 2);

    make_secure(&mut ws, &ana.id);
    super::review_tests::alias_ana_on_a_stand_in(&mut ws);
    assert!(ws.resolve_note_selector("Ana Ruiz").is_ok(), "the alias alone would resolve");
    let review = mcp(&temp, REVIEW, json!({}));
    assert_eq!(ok(review.clone())["items"].as_array().unwrap().len(), 0, "{review}");
    assert!(!review.to_string().contains("Ana"), "{review}");
}
