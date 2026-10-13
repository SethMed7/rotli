//! The vault's `.gitignore` lines that keep a secure note (and the projections
//! Rotli shares) out of git — split from corpus.rs at its size ceiling.
//! Declared as a CHILD of `corpus`, so it reuses the store's own gates.

use std::fs;

use super::*;

impl CorpusStore {
    /// Append a path to the corpus `.gitignore` (idempotent) — a secure note must
    /// never be pushed when the corpus is a git repo. The write error PROPAGATES: a
    /// note marked secure whose `.gitignore` write failed would silently stay
    /// committable, so set_secure must learn about it (the maintainer, 2026-06-30 — audit).
    pub(super) fn gitignore_add(&self, rel: &str) -> Result<(), String> {
        // a raw mount never writes into the person's folder (corpus_raw.rs)
        super::raw::refuse_in_raw(self, "mark secure (that writes .gitignore into)")?;
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        crate::fsutil::with_file_lock(&path, || {
            // an unreadable .gitignore must not be rewritten from empty — that
            // would drop every OTHER secure note's ignore line
            let existing = read_existing_text(&path)?;
            if existing.lines().any(|l| l.trim() == rel) {
                return Ok(());
            }
            let mut out = existing;
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(rel);
            out.push('\n');
            atomic_write(&path, &out)
        })
    }

    /// Remove a path from the corpus `.gitignore` — called when a note's secure flag
    /// is cleared, so it isn't left needlessly ignored (the symmetric counterpart of
    /// gitignore_add). No-op when there's no `.gitignore` or the line isn't present.
    pub(super) fn gitignore_remove(&self, rel: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        crate::fsutil::with_file_lock(&path, || {
            let Ok(existing) = fs::read_to_string(&path) else {
                return Ok(());
            };
            if !existing.lines().any(|l| l.trim() == rel) {
                return Ok(());
            }
            let kept: Vec<&str> = existing.lines().filter(|l| l.trim() != rel).collect();
            let mut out = kept.join("\n");
            if !out.is_empty() {
                out.push('\n');
            }
            atomic_write(&path, &out)
        })
    }

    /// Make the hand-arranged Main and named-view manifests git-committable while
    /// the rest of `.rotli/` stays ignored. Unlike index/settings sidecars, these
    /// arrangements are user work that should travel with the memex.
    /// A bare `.rotli/` line ignores the whole dir — and git CANNOT re-include a file
    /// under an ignored dir — so narrow it to `.rotli/*` and add `!.rotli/main.json`.
    /// Idempotent; a no-op outside a git corpus.
    pub(super) fn ensure_main_committable(&self) -> Result<(), String> {
        if self.raw.is_some() {
            return Ok(()); // a raw mount's Main lives in its private sidecar
        }
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        if !path.exists() && !self.root.join(".git").exists() {
            return Ok(());
        }
        crate::fsutil::with_file_lock(&path, || {
            let existing = read_existing_text(&path)?;
            let mut lines: Vec<String> = existing.lines().map(str::to_string).collect();
            let mut changed = false;
            for l in lines.iter_mut() {
                if l.trim() == ".rotli/" || l.trim() == ".rotli" {
                    *l = ".rotli/*".to_string();
                    changed = true;
                }
            }
            if !lines.iter().any(|l| l.trim() == ".rotli/*") {
                lines.push(".rotli/*".to_string());
                changed = true;
            }
            if !lines.iter().any(|l| l.trim() == "!.rotli/main.json") {
                lines.push("!.rotli/main.json".to_string());
                changed = true;
            }
            if !lines.iter().any(|l| l.trim() == "!.rotli/views.json") {
                lines.push("!.rotli/views.json".to_string());
                changed = true;
            }
            if changed {
                let mut out = lines.join("\n");
                out.push('\n');
                atomic_write(&path, &out)?;
            }
            Ok(())
        })
    }
}
