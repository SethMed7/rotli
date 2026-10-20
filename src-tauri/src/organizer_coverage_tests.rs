// Coverage is committed only after a write window's fallible writes succeed.

use super::*;
use std::fs;
use tempfile::TempDir;

fn brain() -> (TempDir, PathBuf, CorpusState, OrganizerHandle) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
    fs::create_dir_all(root.join("wiki/Projects")).unwrap();
    fs::write(root.join("memex.json"), "{\"id\":\"mx_test123\",\"contract\":\"3.4\"}").unwrap();
    let store = corpus::CorpusStore::open(root).unwrap();
    let root = store.root().to_path_buf();
    let mut reg = corpus::CorpusRegistry::new("default".to_string());
    reg.insert("default".to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(reg));
    let settings = "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}";
    state.route("default", |s| s.dot_write("settings", settings)).unwrap();
    (dir, root, state, OrganizerHandle::new())
}

fn place(state: &CorpusState, body: &str) -> String {
    state
        .route("default", |s| {
            let meta = s.create("wiki/_inbox", body)?;
            let rel = s.resolve_note_rel(&meta.id)?;
            s.set_ai_field(&rel, "area", "Projects")?;
            let meta = s.file_note(&rel)?;
            s.resolve_note_rel(&meta.id)
        })
        .unwrap()
}

fn lock(root: &Path, rel: &str) {
    let text = fs::read_to_string(root.join(rel)).unwrap();
    let (fm, body) = corpus::parse_document(&text);
    let mut fm = fm.unwrap_or_default();
    fm.foreign.push("locked: true".to_string());
    fs::write(root.join(rel), corpus::compose_document(&fm, body)).unwrap();
}

#[test]
fn a_refused_enrich_write_records_no_coverage() {
    let (_dir, root, state, handle) = brain();
    let a = place(&state, "# Harbor lease\n\nrenewal terms for the dock");
    let b = place(&state, "# Quokka\n\nsmall marsupial facts");
    handle.enqueue(&root, &[root.join(&a), root.join(&b)]);
    let transport = |p: &str| {
        if p.contains("Harbor lease") {
            // locked while A's model call is in flight: the body hash still
            // matches, so only the Filer gate refuses the field write
            lock(&root, &a);
        }
        Ok("{\"summary\":\"one line\",\"tags\":[\"land\"],\"links\":[]}".to_string())
    };
    let report = run_cycle(&state, "default", &root, &handle.0, &|| true, &transport).unwrap();
    assert_eq!(report.errors, 1, "the locked note's refused write counts as one error");
    assert!(report.applied >= 1, "B still enriched, so the shared state was persisted");

    let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
    let a_snap = snapshot_note(&root, &a).unwrap();
    assert!(!enrich_covered(&a_snap, &st), "a refused write must not mark A enrich-covered");
    assert!(!st.notes.contains_key(&state_key(&a_snap)), "no pass recorded for A at all");
    let b_snap = snapshot_note(&root, &b).unwrap();
    assert!(enrich_covered(&b_snap, &st), "B's successful pass is recorded");
}
