# Design: Vault vs Brain — and the raw-vault opt-out

Date: 2026-07-26 · Status: **proposed — design only, no implementation in this
change**. Implementation requires its own session and MUST NOT alter the
behavior of any existing vault without the user explicitly flipping the new
choice themselves (Seth: "be very careful not to break my local memex").

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
