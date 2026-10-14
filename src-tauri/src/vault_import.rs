//! Bringing an existing vault in as a COPY (docs/design/
//! vault-copy-and-obsidian-compatibility.md, slice 3; owner, 2026-10-13: "we
//! will never be the cause of someone losing notes"). The person's vault is
//! only ever read. Rotli plans the copy, copies it with progress and a Cancel,
//! verifies the copy against the plan (every path, every size, the content of
//! every Markdown file), records where it came from in the copy's
//! `.rotli/import.json`, and only then opens the copy. A copy that doesn't
//! verify is left exactly as it is, and so is the original.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::corpus;
use crate::vault_roles::Marked;

/// Set by Cancel; read between files. Never takes the vault lane, so it can
/// always stop the copy holding it.
#[derive(Default)]
pub(crate) struct VaultCopyCancel(AtomicBool);

const CANCELLED: &str = "The copy was cancelled. Nothing was changed in your vault.";

/// What the copy will write: every file (path from the source root, bytes)
/// and every linked item it won't follow.
#[derive(Debug, Default)]
pub(crate) struct CopyPlan {
    files: Vec<(PathBuf, u64)>,
    bytes: u64,
    skipped_links: Vec<String>,
}

/// The copy's skip rules: Rotli's own state, history and dependency folders,
/// and symlinks (never followed; listed by name). Everything else a person
/// would miss comes along: `.obsidian/`, `.trash/`, canvases, boards, Office
/// files.
fn skip(name: &str, kind: &fs::FileType) -> bool {
    name == ".rotli" || (kind.is_dir() && corpus::is_skipped_dir(name))
}

pub(crate) fn plan(source: &Path) -> Result<CopyPlan, String> {
    let mut plan = CopyPlan::default();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        let dir = source.join(&rel);
        let mut entries: Vec<_> = fs::read_dir(&dir)
            .map_err(|e| format!("read {}: {e}", dir.display()))?
            .filter_map(Result::ok)
            .collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if skip(&name, &kind) {
                continue;
            }
            let child = rel.join(&name);
            if kind.is_symlink() {
                plan.skipped_links.push(child.to_string_lossy().into_owned());
            } else if kind.is_dir() {
                stack.push(child);
            } else if kind.is_file() {
                let len = entry.metadata().map_err(|e| e.to_string())?.len();
                plan.bytes += len;
                plan.files.push((child, len));
            }
        }
    }
    Ok(plan)
}

/// A separate, empty folder: never the source, inside it, or around it.
pub(crate) fn check_destination(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination || destination.starts_with(source) || source.starts_with(destination) {
        return Err("Choose a separate destination outside the source vault.".into());
    }
    let has_entries = fs::read_dir(destination)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_str() != Some(".DS_Store"));
    if has_entries {
        return Err("Copy into an empty folder.".into());
    }
    Ok(())
}

/// `<name> (Rotli)` beside the person's vaults, then ` 2`, ` 3`… — a folder
/// Rotli creates, so Cancel may remove it whole.
pub(crate) fn default_destination(parent: &Path, source: &Path) -> PathBuf {
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("Notes");
    let first = parent.join(format!("{name} (Rotli)"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| parent.join(format!("{name} (Rotli) {n}")))
        .find(|candidate| !candidate.exists())
        .expect("an unused name")
}

/// Copy the planned files. `progress(files, bytes)` is called as it goes;
/// a set `cancel` stops between files with `CANCELLED`.
pub(crate) fn copy(
    source: &Path,
    destination: &Path,
    plan: &CopyPlan,
    cancel: &AtomicBool,
    mut progress: impl FnMut(usize, u64),
) -> Result<(), String> {
    let mut bytes = 0u64;
    for (index, (rel, len)) in plan.files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        let target = destination.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        fs::copy(source.join(rel), &target).map_err(|e| format!("copy {}: {e}", rel.display()))?;
        bytes += len;
        progress(index + 1, bytes);
    }
    Ok(())
}

/// Undo a copy that didn't finish: a folder Rotli created goes whole; a folder
/// the person picked keeps itself and anything that was in it (only a
/// `.DS_Store` could have been), losing only what the copy wrote.
pub(crate) fn clean_up(destination: &Path, created_by_rotli: bool) {
    if created_by_rotli {
        let _ = fs::remove_dir_all(destination);
        return;
    }
    if let Ok(entries) = fs::read_dir(destination) {
        for entry in entries.filter_map(Result::ok) {
            if entry.file_name().to_str() == Some(".DS_Store") {
                continue;
            }
            let path = entry.path();
            let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        }
    }
}

/// Compare the copy with the plan: the same paths, the same sizes, and the
/// same content for every Markdown file. Returns what differs.
pub(crate) fn verify(source: &Path, destination: &Path, plan: &CopyPlan) -> Vec<String> {
    let mut problems = Vec::new();
    let copied = match self::plan(destination) {
        Ok(copied) => copied,
        Err(error) => return vec![error],
    };
    let ignorable = |rel: &Path| rel == Path::new(".DS_Store");
    let expected: std::collections::BTreeMap<_, _> = plan.files.iter().cloned().collect();
    let found: std::collections::BTreeMap<_, _> =
        copied.files.into_iter().filter(|(rel, _)| !ignorable(rel) || expected.contains_key(rel)).collect();
    for (rel, len) in &expected {
        match found.get(rel) {
            None => problems.push(format!("missing: {}", rel.display())),
            Some(got) if got != len => problems.push(format!("different size: {}", rel.display())),
            Some(_) if rel.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) => {
                let same = match (fs::read(source.join(rel)), fs::read(destination.join(rel))) {
                    (Ok(a), Ok(b)) => crate::fsutil::revision(&a) == crate::fsutil::revision(&b),
                    _ => false,
                };
                if !same {
                    problems.push(format!("different content: {}", rel.display()));
                }
            }
            Some(_) => {}
        }
    }
    for rel in found.keys().filter(|rel| !expected.contains_key(*rel)) {
        problems.push(format!("unexpected: {}", rel.display()));
    }
    problems
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportRecord {
    pub source: String,
    pub copied_at: String,
    pub files: usize,
    pub bytes: u64,
    pub markdown: usize,
    /// Linked items (symlinks) that were not followed, by path.
    pub skipped: Vec<String>,
}

/// Write `.rotli/import.json` in the copy: where it came from, when, and what
/// was left out — the copy can always say where it came from.
pub(crate) fn record(source: &Path, destination: &Path, plan: &CopyPlan) -> Result<ImportRecord, String> {
    let record = ImportRecord {
        source: source.display().to_string(),
        copied_at: time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        files: plan.files.len(),
        bytes: plan.bytes,
        markdown: plan
            .files
            .iter()
            .filter(|(rel, _)| rel.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")))
            .count(),
        skipped: plan.skipped_links.clone(),
    };
    let dir = destination.join(".rotli");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let body = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
    crate::fsutil::atomic_write(&dir.join("import.json"), &body, ".rotli-import-")?;
    Ok(record)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CopyProgress {
    files: usize,
    total_files: usize,
    bytes: u64,
    total_bytes: u64,
}

/// The summary the dialog shows once the copy is open.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyReport {
    destination: String,
    files: usize,
    bytes: u64,
    skipped: Vec<String>,
    /// What the copy became: an imported vault, the Rotli vault it already
    /// was, or (a foreign `memex.json`) a protected folder opened in place.
    marked: Marked,
}

/// "Work on a copy": copy `source` (a folder picked in Rotli's picker) into
/// `destination` (picked too) or, by default, a new `<name> (Rotli)` folder
/// beside the person's vaults; verify; record; then open the copy.
#[tauri::command]
pub(crate) async fn corpus_copy_vault(
    app: AppHandle,
    source: String,
    destination: Option<String>,
) -> Result<CopyReport, String> {
    tauri::async_runtime::spawn_blocking(move || copy_vault_blocking(&app, &source, destination.as_deref()))
        .await
        .map_err(|e| format!("vault copy worker failed ({e})"))?
}

/// Cancel a copy in progress. Only sets the flag the copy reads between files.
#[tauri::command]
pub(crate) fn corpus_copy_vault_cancel(app: AppHandle) {
    app.state::<VaultCopyCancel>().0.store(true, Ordering::SeqCst);
}

fn copy_vault_blocking(app: &AppHandle, source: &str, destination: Option<&str>) -> Result<CopyReport, String> {
    let _lane = crate::vault_lane();
    let authorizations = app.state::<crate::memex::FolderAuthorizations>();
    let source = authorizations.require(Path::new(source))?;
    crate::reject_privileged_root(app, &source)?;
    let (destination, created_by_rotli) = match destination {
        Some(picked) => (authorizations.require(Path::new(picked))?, false),
        None => {
            let parent = crate::vault_location::picker_start(app);
            let target = default_destination(&parent, &source);
            fs::create_dir_all(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
            (fs::canonicalize(&target).map_err(|e| e.to_string())?, true)
        }
    };
    let result = (|| {
        crate::reject_privileged_root(app, &destination)?;
        check_destination(&source, &destination)?;
        let plan = plan(&source)?;
        let cancel = &app.state::<VaultCopyCancel>().0;
        cancel.store(false, Ordering::SeqCst);
        let total = (plan.files.len(), plan.bytes);
        let mut last = Instant::now() - Duration::from_secs(1);
        copy(&source, &destination, &plan, cancel, |files, bytes| {
            if files == total.0 || last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                let progress = CopyProgress { files, total_files: total.0, bytes, total_bytes: total.1 };
                let _ = app.emit_to("main", "rotli:vault-copy-progress", progress);
            }
        })?;
        Ok(plan)
    })();
    let plan = match result {
        Ok(plan) => plan,
        Err(error) => {
            clean_up(&destination, created_by_rotli);
            return Err(error);
        }
    };
    // a copy that doesn't match is left exactly as it is, and so is the source
    let problems = verify(&source, &destination, &plan);
    if !problems.is_empty() {
        let shown: Vec<_> = problems.iter().take(8).cloned().collect();
        return Err(format!(
            "The copy in {} doesn’t match your vault, so Rotli didn’t open it. Both folders are as they were. {}",
            destination.display(),
            shown.join("; ")
        ));
    }
    let record = record(&source, &destination, &plan)?;
    crate::flush_webviews_before_shutdown(app)?;
    let previous = corpus::is_configured(app).then(|| corpus::resolve_corpus(app));
    let marked = make_vault(&destination, previous.as_deref())?;
    let memex = crate::memex::detect_folder(&destination).kind == "memex";
    crate::activate_vault_path_live(app, destination.clone(), !memex)?;
    Ok(CopyReport {
        destination: destination.display().to_string(),
        files: record.files,
        bytes: record.bytes,
        skipped: record.skipped,
        marked,
    })
}

/// Turn a verified copy into the vault it opens as (slice 4): mark it
/// imported, carry the person's settings over as with any switch, then turn
/// its Librarian on at Suggest — the person made this copy for the Librarian,
/// and the switch is decided per vault, never inherited. A copied Rotli vault
/// stays one, and
/// a foreign `memex.json` is never overwritten — that copy opens protected.
pub(crate) fn make_vault(destination: &Path, previous: Option<&Path>) -> Result<Marked, String> {
    let marked = crate::vault_roles::mark_imported(destination)?;
    if let Some(previous) = previous {
        corpus::carry_settings(previous, destination)?;
    }
    if marked == Marked::Imported {
        crate::vault_roles::seed_librarian(destination)?;
    }
    Ok(marked)
}

#[cfg(test)]
#[path = "vault_import_tests.rs"]
mod tests;
