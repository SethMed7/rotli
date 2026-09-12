# The Librarian may file through a connected client the user chose

- Status: accepted
- Date: 2026-09-12
- Deciders: Seth Medina
- Supersedes: the "organizer → remote provider" retirement recorded in
  `docs/architecture/egress-threat-model.md` route 5 (2026-08-01) and the
  structurally on-device organizer of commit `eb121d3`

## Context

Since 2026-08-01 the organizer had exactly one transport, the on-device model
behind `chat::complete_local`; legacy `organizerModel` values such as
"claude" normalized to local on both sides so a settings file could never
reactivate provider execution. Settings said "note content never enters a
cloud-model provider".

On 2026-09-12 the owner asked for the first-run Models step to let a person
pick a model or subscription as the Librarian, Gemini by default when it is
available, after being told the consequence: the Librarian runs on a quiet
timer, so a connected Librarian sends every non-secure note it files to that
provider on a schedule with no per-note click.

## Decision

1. `organizerModel` accepts `local`, `claude`, `codex`, and `antigravity`
   (`LIBRARIAN_LANES`, byte-identical in TypeScript and Rust). Cursor is a
   read-only code-chat lane and never files notes; legacy ids and junk parse
   to `local`.
2. Two consents gate a connected Librarian: the lane choice AND the provider
   switch in Connections (`aiProviders[lane]`). Rust re-derives both every
   cycle (`organizer_knobs::connected_lane`); a chosen-but-off lane files on
   this Mac and the UI says so.
3. The organizer calls the same blocking seam as chat
   (`provider_lane::complete_blocking`): provider policy, the secret scan,
   binary and model allowlists, the cancel/watchdog child registry. A
   background lane can never reach a client on looser terms than a chat turn.
4. Secure and locked notes are skipped before any prompt exists, unchanged.
5. The Models step proposes Gemini (the Antigravity lane) as the Librarian
   when it is signed in on this Mac and nothing else was chosen; the proposal
   sets the choice only — the lane stays off until the person turns it on.

## Consequences

- Route 5 in the egress threat model moves from RETIRED to OPT-IN.
- Settings → Librarian and the Activity surface name the lane in use; the
  journal's `filed_by` records `provider:model`.
- The connected lane cannot be stopped mid-turn by the Librarian's Stop
  button; the child registry's watchdog (120 s) is the backstop.
