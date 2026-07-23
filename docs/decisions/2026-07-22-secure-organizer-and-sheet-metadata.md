# Revised proposal: secure-note organization and companion metadata work

Date: 2026-07-22 · Status: **proposed; secure organizer not implemented**

This revision supersedes the secure-organizer transport described in commit
`ec316fc`. The companion secure-pattern prompt, secure-note explainer, and sheet
metadata ideas remain separate features and require their own implementation
reviews. This decision does not authorize a live-memex migration.

## Corrected current-state diagnosis

Current Rotli creation already places a secure note in `wiki/_secure/`. A file
that is both `secure: true` and physically present in `wiki/_inbox/` is legacy
or externally moved state, not the normal creation path. The organizer must not
read it in place. A repair command must first:

1. re-read and validate its security metadata;
2. add the destination `wiki/_secure/` ignore rule before any move;
3. move the same stable note id into the protected lane without changing prose;
4. retain a harmless stale ignore rule if later cleanup fails; and
5. journal the repair without recording title, summary, body, or tags.

The repair is explicit, previewable, and independently enforced in Rust. It may
be offered in the UI only after isolated tests prove it cannot target a
non-secure note or a path outside the registered root.

## Secure organization policy

Remote providers receive no secure-derived envelope. That prohibition includes
the title, area candidates, summary, tags, links, embeddings, scores, and any
other transformation of secure content. A remote filer does not participate in
this workflow.

Secure organization is available only when all of these are true:

- the default-off global setting `organize_secure_notes_with_local_ai` is on;
- the note explicitly contains `local_ai_allowed: true`;
- the selected model is registered as an on-device provider and its endpoint is
  independently verified as loopback-local; and
- the note is physically contained in `wiki/_secure/`, is not locked, and has a
  readable fail-closed security state.

The registered on-device model produces the final metadata locally. It receives
no network or mutation tools. Note text is delimited as untrusted structured
data, and any instructions found inside it are ignored.

## Final metadata boundary

Version 1 allows only:

- `area`: one normalized label, 1–80 characters;
- `summary`: plain text, at most 200 characters; and
- `tags`: at most eight unique normalized labels, each 1–32 characters.

Unknown keys, nested values, control or bidi-framing characters, markup,
newlines in labels, path separators, identifiers outside these shapes, and all
links are rejected. The output is parsed from a schema-bound object rather than
copied from prose. Rust and TypeScript validate the same limits independently.
The secret detector runs over every field and over the canonical serialized
object after validation. Any detector hit, parse ambiguity, truncation, model
error, or policy mismatch refuses the proposal without writing metadata.

The first release should present a diff and require user confirmation before
applying metadata. A later default-on apply mode would require a new review and
evidence that the local-only, dual-gate, validation, and journal properties have
not changed.

## Write and recovery behavior

An approved proposal changes only the allowlisted metadata. Secure prose and
the physical protected-lane location do not change. The normal remote organizer
continues to skip secure notes unconditionally. Writes preserve unknown
frontmatter, use optimistic revision checks, re-run security and containment
checks immediately before the atomic write, and append a content-free undo
record.

Disabling either consent gate stops future organization; it does not erase
existing user-approved metadata. Removing secure protection continues through
the existing protected move-back flow and is not part of this proposal.

## Required proof before implementation

- deterministic injection evals for note body, title, folder, model output, and
  attempted tool/network use;
- Rust and TypeScript gate-parity tests for global consent, per-note consent,
  provider registration/locality, locked state, lane containment, schema limits,
  and post-validation secret detection;
- isolated legacy-repair tests covering ignore-before-move and rollback;
- UI tests for preview, confirmation, cancellation, stale revision, local-model
  unavailability, validation refusal, and narrow-window keyboard behavior; and
- verification that no remote provider adapter is reachable from the secure
  organizer composition root.
