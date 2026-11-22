//! The AI read gate: the one place a note's or file's bytes are judged
//! before any AI lane sees them (`read_for_ai`, `read_doc_for_ai`,
//! `judge_for_ai`, `file_for_ai`). Moved out of corpus.rs unchanged, to keep
//! that file under its size ceiling (2026-11-21); the policy it applies lives
//! in docs/design/ai-visibility-matrix.md and, for agent lanes,
//! `protected_path` (corpus_protected_path.rs).
//!
//! Declared as a child of `corpus` (`#[path]` mod in corpus.rs).

use super::*;

impl CorpusStore {
    /// Read a note FOR an AI model — the ONE read gate every AI lane passes
    /// (docs/design/ai-visibility-matrix.md).
    ///
    /// * A `Hidden` path is refused outright: vault plumbing is not knowledge,
    ///   and no model has a reason to read `memex.json` or `STRUCTURE.md`. A
    ///   `Reference` path (identity/, personality/, history/, MAP.md, inbox.md)
    ///   IS readable — that is the 2026-08-01 flip.
    /// * A SECURE note is ALWAYS refused to a remote/frontier model. No knob
    ///   changes that and none will exist.
    /// * A SECURE note is readable by a registered on-device model BY DEFAULT
    ///   (the maintainer, 2026-08-01: "only local AI can see secure notes" — see, not
    ///   "see if separately permitted"). Two knobs can still say no: the note's
    ///   own `local_ai_allowed: false`, and the vault's `secureLocalAi: false`.
    ///   The per-note bit wins over the vault default in BOTH directions.
    ///
    /// Location in either secure home is checked even without frontmatter.
    /// The secret DETECTOR also runs on the body (#21, audit 2026-07) — the auto-flag only fires when
    /// the metadata panel is opened, so a never-inspected note with detectable
    /// secrets must not slip through on the flag alone.
    /// Takes a wire id OR a rel path (resolve_note_rel — same bridge as the filer lane).
    pub(crate) fn read_for_ai(
        &mut self,
        id_or_rel: &str,
        model_is_local: bool,
    ) -> Result<String, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        if surfaced(self.layout, rel) == Surface::Hidden {
            return Err(format!("not available to AI: {rel}"));
        }
        let abs = self.guard_rel(rel)?;
        let text = crate::fsutil::read_own_text(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        self.judge_for_ai(rel, &text, model_is_local)?;
        Ok(text)
    }

    /// An agent's whole read in ONE read of the file: the gate judges these
    /// bytes, and the document and its revision are built from the same bytes.
    /// Gating one read and returning another let a file swapped in between
    /// (secure ↔ plain) reach a remote model (audit 2026-11-08).
    pub(crate) fn read_doc_for_ai(&mut self, id: &str, model_is_local: bool) -> Result<NoteDoc, String> {
        let rel = self.path_of(id)?;
        if surfaced(self.layout, &rel) == Surface::Hidden {
            return Err(format!("not available to AI: {rel}"));
        }
        let abs = self.guard_rel(&rel)?;
        let text = crate::fsutil::read_own_text(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        self.judge_for_ai(&rel, &text, model_is_local)?;
        self.agent_doc(self.doc_from_text(id, &rel, &abs, &text))
    }

    /// The AI read gate over one file's text (see `read_for_ai`).
    pub(super) fn judge_for_ai(&mut self, rel: &str, text: &str, model_is_local: bool) -> Result<(), String> {
        let (fm, body) = parse_document(text);
        let fm = fm.unwrap_or_default();
        let secure = self.file_is_protected(rel)
            || fm.foreign.iter().any(|l| secure_field(l) == Some(true))
            || fm
                .foreign
                .iter()
                .any(|l| secure_context_field(l) == Some(true))
            || crate::protection_mark::marked(text, "secureContext")
            || looks_secure(body)
            || self.secure_by_name(&title_of(editor_body(body)), rel);
        if secure {
            // remote FIRST and unconditionally — the refusal must never depend
            // on, or leak the state of, a local-visibility knob
            if !model_is_local {
                return Err("This note is secure and can never be sent to a remote model.".into());
            }
            if !self.secure_readable_locally(&fm) {
                return Err(
                    "This secure note is hidden from AI — turn Local AI access back on for it (or for this vault) to use it here."
                        .into(),
                );
            }
            // The read is ALLOWED, and it is about to put secure prose into an
            // on-device model's context. Remember it: from here on, every egress
            // seam refuses outbound text that quotes this body, whatever the
            // (untrusted) agent loop asks for. This is the ONE recording site —
            // the same choke point that decided the read.
            crate::secret::remember_secure_text(body);
        }
        Ok(())
    }

    /// AI-purpose access to a frontmatter-free file. The editor's file reads
    /// remain separate; this check runs before any AI decoder sees bytes.
    pub(crate) fn file_for_ai(&self, rel: &str, model_is_local: bool) -> Result<PathBuf, String> {
        validate_rel(rel)?;
        if surfaced(self.layout, rel) == Surface::Hidden {
            return Err("not available to AI".into());
        }
        let secure = self.file_is_protected(rel);
        if secure && !model_is_local {
            return Err("blocked: a secure file cannot be sent to a remote model".into());
        }
        if secure && !self.secure_local_ai() {
            return Err("blocked: local AI access to secure files is off for this vault".into());
        }
        let abs = self.guard_rel(rel)?;
        if !abs.is_file() {
            return Err("not a file".into());
        }
        Ok(abs)
    }
}
