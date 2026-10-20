//! The Librarian's write windows, split from the coverage they earn (#25,
//! audit 2026-07). A `write` performs one note's fallible disk writes and is
//! never handed the `OrganizerFile`; `commit_pass` is the only way a pass is
//! recorded, so a refused write (a note locked between read and apply) can't
//! leave the note marked covered. A child of `organizer`.

use super::*;

/// Record one note's pass, then persist the whole state. Entry-mutate, never
/// insert-clobber: fields an earlier job recorded for the note survive.
pub(super) fn commit_pass(
    s: &corpus::CorpusStore,
    state: &mut OrganizerFile,
    key: &str,
    record: impl FnOnce(&mut NoteState),
) -> Result<(), String> {
    record(state.notes.entry(key.to_string()).or_default());
    s.dot_write("organizer", &state_pretty(state))
}

/// One classify decision, ready to land.
pub(super) struct ClassifyPass<'a> {
    pub rel: &'a str,
    pub body_hash: &'a str,
    pub verb: Verb,
    pub area: &'a str,
    pub conf: f64,
    pub apply: bool,
    pub stamp: &'a str,
    pub model_label: &'a str,
    pub row_ulid: &'a str,
    pub ts: i64,
    /// The outstanding proposal from an older body, retired here if still
    /// pending (a user-resolved row stays).
    pub old_row: String,
}

impl ClassifyPass<'_> {
    /// Apply (when the rung allows), retire the stale proposal, journal the
    /// row. Returns the note's new rel when filing moved it.
    pub fn write(&self, s: &mut corpus::CorpusStore, row: &mut JournalRow) -> Result<Option<String>, String> {
        let (rel, area) = (self.rel, self.area);
        let mut moved: Option<String> = None;
        if self.apply {
            match self.verb {
                Verb::FileStaged => {
                    // the Filer gates re-read `locked` FRESH inside these
                    s.set_ai_field(rel, "area", area)?;
                    s.set_ai_field(rel, "filed_by", self.model_label)?;
                    s.set_ai_field(rel, "filed_at", self.stamp)?;
                    let meta = s.file_note(rel)?;
                    let new_rel = s.resolve_note_rel(&meta.id)?;
                    row.note_id = new_rel.clone();
                    moved = Some(new_rel);
                }
                Verb::Annotate => {
                    s.set_ai_field(rel, "suggested_area", area)?;
                    s.set_ai_field(rel, "area_confidence", &format!("{:.2}", self.conf))?;
                }
                Verb::Refile | Verb::Index => unreachable!("classify never emits these"),
            }
            row.status = "applied";
        }
        supersede(s, &self.old_row)?;
        s.journal_append(&journal_line(row, self.row_ulid, self.ts, self.model_label))?;
        Ok(moved)
    }

    pub fn record(&self, ns: &mut NoteState) {
        ns.hash = self.body_hash.to_string();
        ns.processed_at = self.stamp.to_string();
        ns.proposed.file_row.clear();
        if self.apply {
            match self.verb {
                Verb::FileStaged => ns.area = self.area.to_string(),
                Verb::Annotate => {
                    ns.last_fields.insert("suggested_area".into(), self.area.to_string());
                    ns.last_fields.insert("area_confidence".into(), format!("{:.2}", self.conf));
                }
                Verb::Refile | Verb::Index => unreachable!("classify never emits these"),
            }
            ns.proposed.file.clear();
        } else {
            ns.proposed.file = self.body_hash.to_string();
            ns.proposed.file_row = self.row_ulid.to_string();
        }
    }
}

/// One enrich reply, ready to land.
pub(super) struct EnrichPass<'a> {
    pub rel: &'a str,
    pub snap: &'a NoteSnapshot,
    pub eligible: &'a [&'static str],
    pub apply: bool,
    pub model_label: &'a str,
    /// Still-pending field rows from an older body, retired here.
    pub old_rows: Vec<String>,
    /// The daemon's last written values for this note (the never-clobber
    /// baseline) as of the read.
    pub baseline: BTreeMap<String, String>,
}

/// What a successful enrich write window produced.
pub(super) struct EnrichWrote {
    pub proposed: usize,
    pub applied: usize,
    pub superseded: bool,
    pub new_rows: Vec<String>,
}

impl EnrichPass<'_> {
    /// Retire stale rows, then apply or propose each eligible field. Every
    /// field value that reached disk is pushed to `landed` as it lands (even
    /// when a later write fails): it is daemon-authored from then on.
    pub fn write(
        &self,
        s: &mut corpus::CorpusStore,
        fresh_fields: &BTreeMap<String, String>,
        out: Option<&EnrichOut>,
        landed: &mut Vec<(String, String)>,
    ) -> Result<EnrichWrote, String> {
        let mut superseded = false;
        for old in &self.old_rows {
            superseded |= supersede(s, old)?;
        }
        let mut wrote = EnrichWrote {
            proposed: 0,
            applied: 0,
            superseded,
            new_rows: Vec::new(),
        };
        for (fkey, value) in out.into_iter().flat_map(EnrichOut::fields) {
            if !self.eligible.contains(&fkey) {
                continue; // user-owned — never clobbered, never even proposed
            }
            let current = fresh_fields.get(fkey).cloned().unwrap_or_default();
            // never-clobber, re-checked FRESH: `eligible` was sampled before
            // the model call — an edit inside that window makes the field the
            // user's (empty or daemon-authored stays fair game).
            let still_ours = field_value_is_empty(&current)
                || self.baseline.get(fkey).map(String::as_str) == Some(current.as_str());
            if !still_ours {
                continue;
            }
            if current == value {
                continue; // compare-before-write: already on disk ⇒ no-op
            }
            let row = JournalRow {
                action: "field",
                note_id: self.rel.to_string(),
                note_title: self.snap.title.clone(),
                note_ulid: self.snap.id.clone(),
                area: None,
                field: Some(fkey.to_string()),
                before: current,
                after: value.clone(),
                confidence: None,
                status: if self.apply { "applied" } else { "proposed" },
            };
            let row_ulid = Ulid::new().to_string();
            if self.apply {
                // the Filer gate re-reads `locked` FRESH inside this
                s.set_ai_field(self.rel, fkey, &value)?;
                landed.push((fkey.to_string(), value));
                wrote.applied += 1;
            } else {
                wrote.proposed += 1;
                wrote.new_rows.push(row_ulid.clone());
            }
            s.journal_append(&journal_line(&row, &row_ulid, now_ms(), self.model_label))?;
        }
        Ok(wrote)
    }
}
