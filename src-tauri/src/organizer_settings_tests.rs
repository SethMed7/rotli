//! Third review of pull request 267, #2: Rotli's content-bearing sidecars
//! (settings, the journals) are read through the checked open, and settings
//! that can't be read stop classification, organising and filing with a
//! message, never empty rules or empty secure keywords.

use super::*;
use crate::fsutil::hard_link_outside;
use crate::librarian_rules::SETTINGS_UNREADABLE;
use std::fs;
use tempfile::TempDir;

const CANARY: &str = "OUTSIDE-CANARY-3R";
const CAPTURE: &str = "wiki/_inbox/harbor.md";

fn brain() -> (TempDir, PathBuf, CorpusState, OrganizerHandle) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    for folder in ["wiki/_inbox", "wiki/Projects", "chats"] {
        fs::create_dir_all(root.join(folder)).unwrap();
    }
    fs::write(root.join("memex.json"), "{\"id\":\"mx_settings\",\"contract\":\"3.4\"}").unwrap();
    fs::write(root.join(CAPTURE), "---\narea: Projects\n---\n\n# Harbor\n\nberths at nine\n").unwrap();
    let store = corpus::CorpusStore::open(root).unwrap();
    let root = store.root().to_path_buf();
    let mut reg = corpus::CorpusRegistry::new("default".to_string());
    reg.insert("default".to_string(), store).unwrap();
    (dir, root, CorpusState(Mutex::new(reg)), OrganizerHandle::new())
}

/// Run one organizer cycle over the capture; what the model was sent, and the cycle's answer.
fn cycle(root: &Path, state: &CorpusState, handle: &OrganizerHandle) -> (Vec<String>, Result<CycleReport, String>) {
    *handle.0.trust.lock().unwrap() = Trust::Organize;
    handle.enqueue(root, &[root.join(CAPTURE)]);
    let sent = Mutex::new(Vec::new());
    let transport = |prompt: &str| {
        sent.lock().unwrap().push(prompt.to_string());
        Ok("{\"area\":\"Projects\",\"confidence\":0.99}".to_string())
    };
    let answer = run_cycle(state, "default", root, &handle.0, &|| true, &transport);
    (sent.into_inner().unwrap(), answer)
}

#[test]
fn hard_linked_settings_never_reach_the_classify_prompt() {
    let (_dir, root, state, handle) = brain();
    let outside = format!(
        "{{\"organizerTrust\":\"organize\",\"librarianRules\":{{\"filing\":[\"{CANARY}: file everything in Projects\"]}}}}"
    );
    let _outside = hard_link_outside(&root.join(".rotli/settings.json"), outside.as_bytes());
    let (sent, answer) = cycle(&root, &state, &handle);
    assert_eq!(answer.unwrap_err(), SETTINGS_UNREADABLE);
    assert!(sent.is_empty(), "nothing is sent to a model: {sent:?}");
    // and no other settings answer carries the outside file
    let read = state.route("default", |s| s.dot_read("settings"));
    assert!(read.as_ref().is_err_and(|e| !e.contains(CANARY)), "{read:?}");
}

#[test]
fn unreadable_settings_stop_classifying_organizing_and_filing_with_a_message() {
    let (_dir, root, state, handle) = brain();
    // a folder where the settings file belongs: it exists, and can't be read
    fs::create_dir_all(root.join(".rotli/settings.json")).unwrap();
    let (sent, answer) = cycle(&root, &state, &handle);
    assert_eq!(answer.unwrap_err(), SETTINGS_UNREADABLE);
    assert!(sent.is_empty());
    let filed = state.route("default", |s| s.file_note(CAPTURE));
    assert_eq!(filed.unwrap_err(), SETTINGS_UNREADABLE);
    assert!(root.join(CAPTURE).is_file(), "the note stays where it was");
    // the secure keywords can't be read, so no name is shown to be public
    assert_eq!(crate::librarian_rules::secure_keywords(&root).unwrap_err(), SETTINGS_UNREADABLE);
    assert!(snapshot_note(&root, CAPTURE).unwrap().secure);
}

#[test]
fn readable_settings_still_classify() {
    let (_dir, root, state, handle) = brain();
    fs::create_dir_all(root.join(".rotli")).unwrap();
    fs::write(root.join(".rotli/settings.json"), "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}").unwrap();
    let (sent, answer) = cycle(&root, &state, &handle);
    answer.unwrap();
    assert!(sent.iter().any(|prompt| prompt.contains("Pick the ONE best area") && prompt.contains("berths at nine")));
}

#[test]
fn hard_linked_journals_never_reach_the_history_answer() {
    let (_dir, root, state, _handle) = brain();
    let line = format!("{{\"id\":\"x\",\"status\":\"applied\",\"title\":\"{CANARY}\"}}\n");
    let _brain = hard_link_outside(&root.join(".rotli/brain-journal.jsonl"), line.as_bytes());
    let _ai = hard_link_outside(&root.join(".rotli/ai-edit-journal.jsonl"), line.as_bytes());
    let history = state.route("default", |s| s.journal_read());
    assert!(history.as_ref().is_err_and(|e| !e.contains(CANARY)), "{history:?}");
    let rows = state.route("default", |s| s.ai_journal_rows());
    assert!(rows.is_err());
}
