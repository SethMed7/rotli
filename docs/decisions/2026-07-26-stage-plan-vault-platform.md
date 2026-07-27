# Stage plan: the Vault Platform

Date: 2026-07-26 · Status: **planned — the next stage's roadmap**. Builds on
[`2026-07-26-vault-vs-brain.md`](2026-07-26-vault-vs-brain.md) (the design) and
[`2026-07-25-vault-platform-direction.md`](2026-07-25-vault-platform-direction.md)
(the direction), incorporating the ZenNotes reception analysis (2026-07-26).

## The model, confirmed

- **Many vaults** — each a plain-files folder. Already real in `corpus.json`
  (active vault + connected vaults) and surfaced by the sidebar switcher.
- **A Brain per vault** — `brain: on|off` is vault-local. A raw work vault and
  a brained personal vault coexist; flipping never moves or rewrites a file.
- **One layer over all of them** — the vault format (lanes, frontmatter
  grammar, secure rules) is rotli's contract for every vault; the Brain is the
  optional intelligence a vault opts into.
- **Honest limitation**: one *active* vault per running app; switching
  relaunches. True simultaneous vaults are Phase 3's multi-window work.

## Phase 1 — the raw-vault switch  *(1–2 sessions; the core)*

Implement `2026-07-26-vault-vs-brain.md` exactly:

1. Additive vault-local config field (missing = `on`, today's behavior
   byte-for-byte; no migration pass of any kind).
2. Organizer spawn site and creation/intake routing consult it; raw vaults
   never route through `wiki/_inbox` and never write enrichment fields.
3. Settings → Brain gains the master switch above the trust ladder; sidebar
   and Activity drop Brain surfaces for a raw vault.
4. Onboarding leads with the trust story (the Zen lesson): "your vault is just
   a folder," then the choice — **Brain** ("rotli's AI keeps it organized") vs
   **Raw** ("just your files, organized by you"). Same format either way.
5. **Acceptance gate before the switch reaches the UI**: toggle a COPY of a
   real populated memex raw-and-back → zero file diffs, empty journal.
   Seth's live memex is never an implementation or test target.

## Phase 2 — per-vault Brain identity  *(1 session)*

- The vault switcher and Location cards show each vault's state (Brain ·
  raw) so switching is informed, using the existing quiet-badge grammar.
- Audit which organizer knobs are truly vault-local (trust, quiet window,
  organizing model live in the corpus's own settings sidecar — verify, and
  move anything global that should be per-vault).
  **Audited 2026-07-27: all vault-local.** Every knob (`brainEnabled`,
  `organizerTrust`, `organizerModel`, `organizerQuietSecs`, settings-only
  `organizerThreshold`) lives in the vault's own `.rotli/settings.json`;
  the daemon re-reads it per cycle (`parse_knobs`), `root_brain_enabled`
  reads each root's own sidecar, and `corpus.json` deliberately stores none
  of them. Secure/locked handling is hardwired at three layers, not a knob.
  One caveat carried to the Phase 3 notes: `carry_settings` copies
  `organizerModel` (remote-model consent) onto newly adopted vaults — per-knob
  curation belongs to the future settings split.
- "New vault…" in the switcher: scaffold an empty vault with the Brain/raw
  choice at creation (reuses onboarding's cards; relaunches into it).

## Phase 3 — multi-vault ergonomics  *(investigate, then decide)*

- **Open vault in new window**: a real Tauri multi-window investigation —
  per-window corpus binding touches the registry, watcher, organizer, and
  every `default_id` assumption. Timebox a spike; if the cost is high, the
  honest relaunch switcher stands and this defers without shame.
- Per-vault UI state isolation audit (panes, expansion, recents — `.rotli/`
  is per-vault, so this should mostly hold; prove it).

### Spike result (2026-07-27): **NO-GO — the relaunch switcher stands**

Four parallel investigations (Rust bootstrap · registry/wire grammar ·
frontend state · UI-state isolation) against the code at `02ea52e`.

**Why no-go.** "Open vault in new window" is not a window feature — it
inverts the restart-based single-active-corpus design on five fronts at once:

1. **Lifecycles have no teardown.** The per-root fs watcher and the organizer
   daemon are detached `std::thread`s bound by value at `setup()`
   (`lib.rs:1197`, `organizer.rs:1930`); `brain_off` only parks the organizer.
   Live multi-vault needs stop/rebind for both, plus Breve-supervisor rebind.
2. **The bare-id wire grammar IS the single-vault assumption.** ~12 commands
   hard-pin `default_id` (settings/viewstate/main/views/journal/tasks), all
   bare ids mean "the process's vault", and per-vault `.rotli/` state stores
   bare ids on disk. Per-window binding means a window-label→root map threaded
   through the IPC boundary or root-prefixing every id everywhere.
3. **`settings.json` is a mixed bag.** App-global chrome (theme, OS hotkeys,
   AI lanes, onboarded, userName) lives in the *vault's* sidecar, written
   whole-file last-writer-wins by one elected writer (`isMainSurface`). Two
   writer windows fork global settings per vault and clobber passthrough keys.
   A global-vs-vault-local settings split (with migration) is a hard
   prerequisite.
4. **The event fabric is single-window.** Corpus/journal refresh events are
   `emit_to("main", …)`; JS broadcasts (`rotli:quick-set`, theme, rebind)
   assume every webview views one vault. A second content window silently
   never refreshes.
5. **Security regresses without new machinery.** The asset protocol has
   `allow_directory` and no revocation in use, and `corpus.json` mutates
   without cross-process locking — the relaunch is what currently guarantees
   scope hygiene and registry consistency.

**Cost.** Multi-window over the *same* active vault: **M** (event routing,
QuitFlush label list, summon/blur laws — the Quick window proves the
multi-webview pattern). Window-per-vault: **XL** — a rewrite of the `setup()`
bootstrap into a dynamic root manager, plus the settings split, plus event
vault-scoping, with heavy regression surface (corpus.rs ~8k lines, persist.ts,
tauri.ts, the parity suites). Not worth it while the honest relaunch switcher
covers the workflow.

**If ever revisited, in order:** settings split (global vs vault-local) →
teardown-capable watcher/organizer lifecycles → window→root IPC routing →
event-fabric scoping → asset-scope revocation + corpus.json locking.

### UI-state isolation audit (2026-07-27): **holds, with three findings**

Everything per-vault genuinely lives in that vault's `.rotli/`
(`settings.json` + `viewstate.json` via the single debounced writer, plus
`main.json`/`views.json` and organizer sidecars) — panes, MRU, expansion,
zoom, quick ids, per-note Aa styles are ISOLATED by construction. Findings:

1. **`carry_settings` over-copies** (`corpus.rs:705`): adopting a fresh vault
   copies the whole `settings.json`, including note-id-keyed maps
   (`quickNoteIds`, `captureOrder`, `noteStyles`, `expandedDests`) that can't
   resolve in the new vault until per-surface prunes run. Cosmetic today;
   would need per-key curation in any settings split.
2. **App-global prefs fork per vault by design-accident**: theme, OS-global
   hotkeys, AI provider lanes, onboarded, userName ride the vault sidecar —
   switching vaults can change the theme and re-register different global
   shortcuts. Same root cause as spike item 3; fix belongs to the settings
   split, not a point patch.
3. **`chatWeb`/`chatMeasure` key by bare chat slug** while chats union across
   connected brains — a slug collision across brains shares one web-egress
   toggle (privacy-adjacent; narrow). Fix is vault-qualifying the key when the
   settings split happens.

## Phase 4 — consolidation completion  *(Seth's explicit go, per item)*

- App copy + docs finish adopting **Vault** as the public word (the memex term
  stays internal/contract-level where renaming would churn ids or paths).
- External steps, each individually Seth-authorized: archive `SethMed7/memex`,
  repoint memex-vault tooling references, update CLAUDE.md guidance.

## From the ZenNotes analysis

| # | Item | Why (from the reception data) | Where |
|---|---|---|---|
| A | **One-scroll product story** | Their site/App Store page carries the whole pitch; rotli has no public page. Vault story, four-theme screenshots, agent workspace demo, download. | smLab (brand home), not this repo |
| B | **Onboarding trust pass** | "Just a folder" is what wins people; our flow leads with mechanics. | Phase 1 item 4 |
| C | **Editor paper-cut sweep** | Their issue tracker is tables/navigation/indent edge cases — that's what users actually file and judge by. One focused QA pass over rotli's tables, back/forward, indentation, template flows; fix the top findings. | Its own session |
| D | **Agent-workspace visibility** | Independent analysis called their MCP "the standout differentiator" — rotli already ships CLI + MCP first-party; it's underexposed, not underbuilt. | Item A's page + docs |
| E | **Sync/mobile answer, in words** | Their gap and ours; the honest local-first answer is "your folder, your sync" — document recommended setups (iCloud Drive, git) in SUPPORT.md instead of building a service. | Small doc task |
| F | **CSV-as-database view** | Genuinely envied feature in their community; rotli has the sheet machinery to do a calmer version later. | Backlog, after the stage |

## Sequencing

1 → 2 → C (paper-cut sweep as the palate cleanser) → 3 (spike) → 4 + A/D/E as
Seth green-lights the external/brand pieces. F stays backlog until the stage
lands.
