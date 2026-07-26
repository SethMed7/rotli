# Design: Vault vs Brain — and the raw-vault opt-out

Date: 2026-07-26 · Status: **implemented same day (Phase 1)** — with two
recorded refinements below. The prime rule held: no existing vault's behavior
changes without the user explicitly flipping the new choice themselves.

*Implementation refinements (2026-07-26):*

- **Intake stays as a plain folder.** A raw memex-layout vault still creates
  quick captures in `wiki/_inbox/` — but with no Brain it is just an inbox
  folder (surfaced as Captures): nothing stages, classifies, or refiles from
  it. Divergent creation paths per mode would have doubled the routing surface
  for zero user benefit; explicit folder selection already creates in place.
- **The worker parks rather than never spawning.** The daemon thread exists
  for any memex corpus but is fully inert for a raw vault: every wake signal
  is consumed, the queue and review hints drain, no sweep, no model call, no
  state write. This keeps the runtime toggle instant in both directions
  (structural no-spawn would demand a relaunch to enable).

## The two concepts, finally separated

Rotli has been using one word for two things. The split:

- **Vault** — where a person's data lives. One local folder of plain files:
  Markdown notes, boards, assets. Readable in any editor, portable forever,
  no database, no account. The vault is *just data* and is complete without
  any AI. This is the public vocabulary for what the memex format provides —
  the consolidation direction (2026-07-25) lands here: rotli owns the vault
  format; "memex" remains at most an internal/contract term.
- **Brain** — the optional AI layer rotli runs *over* a vault: the organizer
  (files captures into areas, fills area/summary/tags), the model map and
  retrieval, chat-knows-your-notes. The Brain only ever touches location and
  metadata, never prose — and with this decision it becomes fully **optional**.

## The raw-vault opt-out

A person must be able to say: *rotli manages my vault, no AI organizes it.*

**The choice** — per-vault, explicit, reversible:

- `brain: on` (current behavior) — organizer per its trust ladder, enrichment
  metadata, Brain intake for new notes, the Brain sidebar section.
- `brain: off` (raw vault) — the organizer worker never spawns for this vault;
  no enrichment fields are ever written; new notes land in the folder the user
  picked instead of routing through intake; the sidebar drops the Brain
  section and Activity's organizer surfaces. Chat may still exist, but reads
  the vault only under the same secure/locked gates as today.

**Rules that make it safe:**

1. **Flipping the switch never moves or rewrites a file.** Turning the Brain
   off stops future AI activity — existing areas, metadata, and layout stay
   exactly as they are. Turning it back on resumes at **Suggest** (never
   auto-apply on re-entry), with the journal as the review surface.
2. **Default preserves the present.** Existing vaults keep `brain: on` with
   their current trust rung; the knob only changes when the user changes it.
   No migration pass, no config rewrite on upgrade beyond an additive field.
3. **Storage of the choice** is vault-local, additive, and rebuild-safe (the
   settings sidecar next to the existing organizer trust — `.rotli/` is a
   projection, but explicit settings already live there by design). A missing
   field means `on` (the present).
4. **Security invariants are unconditional.** Secure-note gates, the secret
   detector, and locked-note protection are vault properties, not Brain
   properties — they hold identically in a raw vault.
5. **Onboarding offers the choice up front** (the Zen lesson: their vault
   pitch is "just a folder", and it reads as trust). Two cards: "A brain —
   rotli's AI keeps it organized" / "A raw vault — just your files, organized
   by you." Both are the same format on disk; the difference is only whether
   the AI layer runs.

## Relationship to the trust ladder

Trust `Off` already exists but is a *Brain setting* — the Brain is present,
merely idle, and intake routing still assumes it. `brain: off` is structural:
no intake routing, no organizer worker, no enrichment vocabulary in the UI.
The ladder remains the Brain's internal dial; the new switch decides whether
there is a Brain at all.

## Implementation sketch (for the implementing session)

- Rust: an additive vault-config field; the organizer spawn site and the
  creation-routing policy consult it. Both already have single choke points
  (the worker spawn in `lib.rs`, intake routing in the creation workflow).
- Frontend: the onboarding choice, a Settings → Brain master switch above the
  trust ladder, sidebar/Activity conditionals.
- Tests: flip-never-moves-files (byte-identical corpus before/after toggling
  both ways), raw-vault creation lands outside intake, organizer never spawns,
  re-enable resumes at Suggest, existing-vault default unchanged, and a
  fixture proving an untouched config yields today's behavior byte-for-byte.

## Required proof before shipping

The live-memex protection is the acceptance test: open a copy of a real
populated memex, toggle raw and back, and diff the tree — zero file changes,
zero moves, journal empty. Only then does the switch reach the UI.

## Pressure-test record (2026-07-26, 24-agent adversarial workflow)

16 confirmed findings; the fixes that shipped with Phase 1:

- **Live off signal.** The switch gained trust's in-memory channel
  (`organizer_set_brain` + a per-model-call re-check), so turning raw stops an
  in-flight cycle before its next model call — not after the debounced
  settings write or the queued candidates drained.
- **Gate placement.** The corpus-side gate moved out of `filer_writable`
  (which also fronts agent edits and Breve writes — both vault features) into
  the organizer-specific operations: `set_ai_field`, `file_note`,
  `write_index`, `filer_move`.
- **Choices survive the corpus switch.** `carry_settings` copies the current
  settings file to a newly adopted root that has none, so an onboarding
  raw-vault choice is not silently dropped; a root with its own settings keeps
  them.
- **Fail closed.** A genuine IO error reading the settings sidecar now reads
  as Brain-off; only a genuinely missing file means "on" (the compatibility
  promise).
- **No dead actions.** Raw vaults hide Approve and Undo in Brain Activity
  (Dismiss stays — journal-only), the onboarding re-pick clamps to Suggest
  like the Settings toggle, and the sidebar Brain section speaks raw-mode
  copy while keeping the folder tree (the files are real either way).

Accepted, not fixed here: the browser-demo settings-write mismatch (demo
plumbing predates this feature), the first debounced save writing the resolved
`brainEnabled` value like every other setting, and stale "Brain/AI" vocabulary
in a few menus — the last folds into the pending rename decision.
