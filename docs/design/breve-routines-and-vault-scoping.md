# Breve: editable routines + per-vault scoping (design notes)

Status: **BUILT** (2026-07-31, same day). What shipped:

- **Custom routines** — the seven built-ins are locked-shape and disable-only;
  users add **custom briefs** (scheduled research on their own prompt) and
  **reminders** (their text delivered as-is), daily-at-a-time, slug ids
  (≤ 20 routines total). `BreveRoutine.prompt` carries the instructions —
  required on customs, optional extra instructions on the built-in briefs
  (appended to the wrapper PROMPT). The scheduler dispatches custom ids on
  `kind` → `custom-brief.sh` / `reminder.ts`; the routine's id/label/prompt/
  stem ride the job env. Custom stems (`YYYY-MM-DD-<slug>`) pass `brief_stem`
  and surface in Briefs with the slug as their kind. Signal delivery for
  text-only routines uses `send-signal-text.ts --receipt <stem>.signal` (an
  exact-name claim satisfying `verifyRun`); email reuses `send-brief.ts`
  (PDF-less).
- **Brief prompt surface** — `breve_brief_skill` / `breve_write_brief_skill`
  expose the materialized SKILL.md; edits write `.rotli/routines/
  skill.custom.md` (sync-immune) and the scheduler points
  `ROTLI_BREVE_SKILL` at it per job — applies within one poll. Reset returns
  to the shipped default. UI: Routines → "Brief instructions".
- **Vault-scoping** — per-vault state was already structural (per-root homes +
  the PR #32 `BREVE_KNOWLEDGE`/`BREVE_STORAGE` pins). Added: vault-agnostic
  **shared defaults** (`<app-data>/breve-shared-defaults/`) — saves of the
  routine config and delivery settings mirror into it, and a fresh vault's
  Breve home seeds from it copy-if-absent, so a new vault starts from the
  current setup and diverges freely. One supervisor follows the ACTIVE vault
  (vault switches relaunch the app, which also makes per-root React Query
  keys unnecessary — the cache dies with the process). Simultaneous multi-
  vault supervisors remain out of scope (single Signal bot number, single
  launchd agent).

The original investigation below is kept for the record.

## Where things stand today

### The routine set is hardcoded in three places that must agree

- `src-tauri/src/breve.rs` — `default_routines()` is a literal 7-element vec
  (`morning`/`lunch`/`night` briefs, `creators`, `watchers`, `doctor`,
  `signal`); `validate_config()` enforces an id allowlist **and
  `routines.len() == 7`**; `legacy_config()` unconditionally overwrites
  routines with the defaults, so imported configs cannot carry custom entries.
- `breve-runtime/scripts/rotli-scheduler.ts` — `commandFor()` is a
  `switch (routine.id)` over the same seven ids mapping to hardcoded script
  paths; unknown ids are silently skipped. `stemFor()` and the
  delivery-receipt verification assume the seven-id stem convention.
- `src/components/breve/breveSurface.tsx` — arrivals render from a literal
  `["morning","lunch","night"]`; the only mutations are enable/cadence/lanes
  (`patchRoutine`) and delivery time/lead. No add/remove UI exists.

`BreveRoutine` (Rust + the `src/lib/tauri.ts` mirror) carries
`id/label/kind/enabled/schedule/lanes` — **no prompt field**. The one existing
precedent for a user prompt riding a routine: `watchers` page entries
(`.rotli/routines/pages.json`) carry a free-text `condition` string.

### Where the brief system prompt lives

- Canonical: `breve-runtime/skills/breve/SKILL.md` (uses `{{BREVE_HOME}}`).
- Materialized into `<vault>/.rotli/breve/skills/breve/SKILL.md` by
  `src-tauri/src/routines.rs` `sync_runtime` — which **overwrites on every
  supervisor start**, so hand edits to the materialized copy are clobbered.
- Per-slot differences live in the shell wrappers
  (`breve-runtime/scripts/{morning,lunch,night}-brief.sh`): each builds a
  `PROMPT="Read the Breve instructions at $SKILL … <slot task>"`.
- Audio rewrite prompts are separate (`breve-runtime/scripts/audio-brief.ts`).
- **Existing override hook:** every wrapper honors
  `SKILL="${ROTLI_BREVE_SKILL:-…}"`, and `routines.rs` sets that env on the
  supervisor. Pointing it at a user-owned, sync-immune file (e.g.
  `<vault>/.rotli/routines/skill.custom.md`) is the cheapest path to a
  user-editable prompt; a read-only "view prompt" surface can simply render
  the materialized SKILL.md.

### Editable-routines epic — what a build touches

1. `validate_config`: drop the `== 7` and the id allowlist; validate id shape
   (slug, unique, length) instead. `kind` stays a closed set — it selects the
   executor.
2. `default_routines` / `legacy_config`: defaults become a seed, never an
   overwrite.
3. `BreveRoutine` + TS mirror: add `prompt?`/`purpose?` (length-capped in
   validation).
4. `rotli-scheduler.ts`: dispatch on `routine.kind` (not id), pass id + custom
   prompt via env (the `ROTLI_BREVE_LANES` pattern); generalize `stemFor` +
   receipt verification.
5. `breveSurface.tsx`: add/remove UI; unhardcode the arrivals literal.
6. `initialize_scheduler_state`: seed jobs from the config, not the seven ids.
7. Prompt surfacing: show the materialized SKILL.md read-only + an "edit a
   copy" flow that writes the custom file and flips `ROTLI_BREVE_SKILL`.

### Vault-scoping epic — what a build requires

Breve is pinned to the **default root**: `breve.rs::active_root()` returns
`state.default_root_path()` and every `breve_*` command starts there. All
state hangs off that root by fixed rel constants (`.rotli/routines/*`,
`wiki/reference/watchlist.md`, `wiki/reference/briefs`, `storage/breve*`).
Meanwhile **breve-runtime resolves the knowledge base independently**:
`config.ts` reads `knowledgePath`/`storagePath` from `config.local.json`
(currently hand-pointed at `~/memex-vault`) — rotli never writes or reconciles
those values. Two sources of truth that agree today only by hand.

Build shape:

1. Vault-aware root accessor (thread a `root_id` through the `breve_*`
   commands and `state.route`), replacing `default_root_path()`.
2. Per-root managed runtime: `routines.rs` already joins `.rotli/breve` onto
   whatever root it gets — but `BreveSupervisor` is a single child; it becomes
   a root→child map (or one supervisor reading N configs). Shared singletons
   need decisions: one Signal bot number, one Resend Keychain entry, one
   launchd agent.
3. Config split — per-vault: briefs, watchlist, creators/pages, scheduler
   state, receipts, logs, artifacts. Shared: LLM block, recipients, signal,
   mail accounts, policy, pronunciation, Keychain secrets, PDF theme defaults.
   `sync_runtime`'s defaults copy becomes copy-if-absent + inherit/override.
4. Reconcile path resolution: pass `BREVE_KNOWLEDGE`/`BREVE_STORAGE` env on
   supervisor spawn (already honored by `config.ts`) — cheaper than writing
   `config.local.json` per vault.
5. Frontend: fold the root id into `BREVE_QUERY_KEY` and the brief-body query
   key, or vault switches serve stale Breve data.

## Already fixed separately (2026-07-31)

- Briefs "Open in Notes" resolved the rel→ULID door mismatch
  (`corpusResolveRef` before `openNote`).
- Brief audio (`storage/breveAudios/<stem>.mp3`) surfaces as `audioPath` on
  `BreveBrief` with an inline player in the reader.
- Stale doc note: `breve-runtime/skills/breve/SKILL.md` claims audio lands in
  `briefs/` — it lands in the storage lane (`storage/breveAudios/`).
