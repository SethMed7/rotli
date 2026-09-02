# System audit — 2026-09-02

Seven-area audit of `dev` at 59258d7 (0.84.0 plus the quality-guard batch,
tree clean). Areas: half-integrated features, feature bugs, UI/UX
consistency, providers, latency, vault writes, and Breve (usability, delivery,
and PDF theming). Method: five read-only reviewers mapped one area each from
code, tests, and contracts; the Breve section was walked by hand against the
live vault's runtime state (read-only) and browser-mode screenshots. Findings
cite file and line. Fixes landed in the same session are marked **FIXED**;
everything else is a ranked recommendation. Supersedes
[`system-audit-2026-09-01.md`](system-audit-2026-09-01.md) as the current
findings list; its still-open items are folded in where relevant.

**State of the installed app first.** `/Applications/Rotli.app` is still the
**0.83.0** bundle built 2026-08-31 20:53 and launched 21:13 (pid 6763). 0.84.0
was published on 2026-09-02 00:11Z but has not been installed. Everything in
§1 about Breve's delivery outage follows from that gap, and every fix in the
0.84.0 notes is invisible to Seth until the app is updated and relaunched.

## 1. Breve

### 1.1 Briefs have not been delivered since 2026-08-16 (bug, root-caused)

The live vault's scheduler state (`~/memex-vault/.rotli/breve/scheduler-state.json`,
read-only) shows every brief slot failing with `missing generated brief`:
morning last succeeded 2026-08-16, lunch 2026-08-12, night 2026-08-13. The
supervisor retries each slot **every five minutes** until the slot expires,
so the day log carries 370–440 failures per day (`logs/2026-08-18.log` …
`2026-09-02.log`).

Root cause chain:

1. The materialized runtime under `~/memex-vault/.rotli/breve-runtime/` is the
   **0.83.0 bundle** (`morning-brief.sh` dated 2026-08-13). That version still
   runs `claude -p --model … --dangerously-skip-permissions` inside a
   `sandbox-exec` seatbelt profile.
2. From 2026-08-16 11:30 the claude CLI fails instantly inside that seatbelt
   with `An internal error occurred (EPERM)`; after the CLI updated on
   2026-08-31 the message became `An unknown error occurred (Unexpected)`.
   The haiku fallback fails identically and the gemini lane is a stub, so
   every attempt exhausts all providers in ~4 s.
3. 0.84.0 replaced the cloud path with the on-device writer
   (`breve-runtime/scripts/local-brief.ts`, commit eb121d3 2026-09-01). That
   path works: a plumbing probe against the live MLX server (`gemma-3-12b`
   on `localhost:11435`) returned in ~1 s. But `sync_runtime` only
   re-materializes the runtime on supervisor start (`src-tauri/src/routines.rs:442`),
   so nothing changes until 0.84.0 is installed and launched.

What made this a silent 17-day outage rather than a one-morning blip:

- **No health surface.** `breve_snapshot` never reads `scheduler-state.json`
  (`src-tauri/src/breve.rs:1193-1264` only reads config, watchlist, briefs,
  and a sanitized log tail). The sidebar says “Managed by Rotli”, the Routines
  banner says “Rotli is actively managing these routines”, and the Dashboard
  shows the 2026-08-16 issue as “latest”. Only Notifications hints at it,
  as an undifferentiated stream of “morning failed” rows.
- **The doctor reports OK.** `breve-doctor.ts` `checkArtifacts` proposes a
  rerun over Signal once per day; the scheduler records `doctor.lastOk: true`
  and nothing surfaces in the app.
- **Retry without backoff.** `rotli-scheduler.ts:302` retries a failed slot
  every 5 minutes for the whole slot window with no backoff and no
  “give up after N”, which also means each failed morning spawns ~100
  `bun` + `caffeinate` processes.
- **Misleading log labels.** The 0.84.0 wrapper still prints
  `try claude (sonnet)` while running the on-device writer
  (`morning-brief.sh:52-55`), so the next outage will be misread too.

**Recommendation (P0):** (a) install 0.84.0 and relaunch, then confirm one
brief lands — **open, Seth's action**; (b) **FIXED** — per-routine health
rides the snapshot (`breve_health.rs` projects `scheduler-state.json`;
`breveHealthModel.ts` reduces it to one sentence) and renders in the rail
status, the Today page, and the Routines banner (“No brief for 17 days —
morning is failing: missing generated brief …”); (c) **FIXED** — a slot is
retried three times then left for the next slot (`scheduler-core.ts`
`slotAttemptAllowed`), and the wrappers log “on-device writer”.

### 1.2 The on-device writer cannot research (product regression to decide)

The 0.84.0 policy (`breve-runtime/docs/provider-fallback.md`,
`provider-policy.ts`) makes brief generation local-only for account-safety
reasons. `local-brief.ts:38-41` tells the model it has “no live web, cloud
provider, tools, or filesystem access” and must “never claim to have
researched current information”. A brief is therefore a rewrite of the
watchlist plus the last three briefs — the daily research digest that made
Breve worth opening no longer exists in the scheduled path. The Signal
assistant and `/breve` chat still have web access through Rotli's own
`web_search` lane, which the scheduled writer does not use.

This is the single biggest reason “I don't find myself wanting to look at
it”: even after 1.1 is fixed the content will be thin. Options, in order of
fit with the product laws:

1. Give the scheduled writer the same ReAct loop the on-device chat already
   has (`src/ai/loop.ts` + `web_search`/`web_fetch`), driven from Rotli
   rather than the runtime — local model, Rotli-owned egress, no
   subscription CLI. Medium effort; reuses the proven chat path.
2. Allow an explicitly authorized connected model for the brief only, behind
   a knob that defaults off, with the same egress ledger the chat uses.
   Small effort, but re-opens the account-safety boundary 0.84.0 closed.

Seth's call; the audit recommends option 1.

### 1.3 Findability and shape (usability)

Observed in browser mode (screenshots in the session; empty snapshot) and in
code:

- **Entry is an unlabeled 28 px coffee icon** in the sidebar's top row
  (`src/components/sidebar.tsx:286-297`), between the vault switcher and the
  create icons, with a tooltip. The Home/Chat segmented control does not
  include Breve, the app Settings tabs do not mention it
  (`settingsSurface.tsx:159-175`), and `view.breve` has `defaultChord: null`
  (`src/keys/actions.ts:265`) so there is no shortcut. The palette lists the
  action as “Open or close Breve”, which is the only text path.
- **Entering Breve replaces the whole sidebar** (vault name, Home/Chat, Main,
  System all disappear; a quokka icon labelled “Back to Rotli” is the way
  out). It reads as a separate application, which is exactly the “hard to
  find / where am I” feeling.
- **Six sections for what is really three jobs** (read the brief · shape the
  watchlist · configure). “Notifications” is a raw scheduler log;
  “Routines” and “Settings” both carry save-button forms; the Dashboard and
  Briefs pages both show “today's brief” and the Briefs page shows the
  same empty state twice (reader and library,
  `breveSurface.tsx:700-716` and `:801-921`).
- **A parallel design language.** `src/styles/breve.css` is 2,385 lines with
  414 `breve-` selectors, its own toggle (three sizes: `breve.css:1434` and
  `:1907`), its own buttons, chips, four empty-state families, the only
  skeleton loader in the app, and window `@media` queries (`:476`, `:506`,
  `:2095`, `:2150`) while it renders inside a pane. The Settings page puts
  “Save model policy” above the policy it saves, offers a “Fallback order”
  picker for a local-only policy, and shows “On this Mac · 0 models ·
  Unavailable” when the local model is fine.
- **Save-button forms with `window.confirm` dirty guards**
  (`src/state/ui.ts:835-859`) while every other Rotli setting saves
  instantly (the UI/UX reviewer confirmed all 11 settings toggles do).
  Timezone is a free-text input.

**Recommendation:**

1. **FIXED** — Breve is the third labelled segment of the Home/Chat
   switcher, the vault switcher and the utility footer stay visible in
   Breve, and `view.breve` defaults to ⌘⇧B. The unlabeled coffee toggle is
   gone.
2. Collapse to three sections: **Today** (the brief reader with the library
   below it, health strip on top), **Watchlist**, **Settings** (routines +
   delivery + appearance, instant-save rows using the settings `Toggle`
   and select rows). Notifications become the health strip plus a “recent
   activity” list inside Today.
3. Move Breve's controls onto the shared primitives (`Toggle`/`.sw`,
   `.ghostbtn`, `EmptyState`, `.setselect-row`) and container queries; delete
   the Breve-only families as each page converges. Ratchet `breve.css` in
   `scripts/ratchet-baseline.json` so it can only shrink.
4. Timezone becomes a select fed by `Intl.supportedValuesOf("timeZone")`.

### 1.4 PDF and rendered output are not on the user's theme

- The PDF palette is a Breve-only choice of four presets plus custom
  (`src/brand/brevePdfThemes.ts`, `breve-runtime/scripts/pdf-theme.ts`) and
  defaults to Charcoal regardless of the app theme. The live vault's
  `config.json` has no `pdfTheme` key, so every brief since July rendered
  Charcoal while the app runs Warm.
- The four presets are **duplicated verbatim** in TypeScript and in the
  runtime with no parity test, and they cover only Warm and Mono — Ocean,
  Grove, Iris, and Midnight (eight of the twelve environments) have no
  PDF equivalent.
- Nothing outside the supervisor passes `ROTLI_BREVE_CONFIG`
  (`routines.rs:478` is the only setter). `readPdfTheme()` falls back to
  `.rotli/breve/settings.json`, which does not exist in a Rotli-managed
  vault, so an interactive `/breve` render, `email-topic.ts`, and any
  terminal run ignore the chosen palette and render Charcoal.
- **A second, unthemed PDF pipeline.** Chat's `create_artifact pdf`
  (`src/ai/host.ts:571`) calls `corpus_export_note_pdf`, which prints the
  note as plain text through `/usr/sbin/cupsfilter`
  (`src-tauri/src/document_conversion.rs:66-97`): monospace, no headings, no
  links, no theme. Breve's renderer (`render-brief.ts` + `chrome-pdf.ts`)
  is the only themed HTML→PDF path and it requires a Chromium-family
  browser on disk.

**Recommendation (built in this session where marked):**

1. **FIXED** — `rotli` preset, the default: `src/state/appearanceSync.ts`
   reads the six live tokens (`src/brand/pdfPalette.ts`, oklch normalized
   through a canvas round-trip) after every theme/accent change and
   `breve_write_pdf_palette` (`src-tauri/src/breve_pdf.rs`) merges only
   `pdfTheme.resolved` into `.rotli/routines/config.json`; `pdf-theme.ts`
   renders `resolved` when the preset is `rotli` (Warm Light until the first
   sync). Both config writers (`breve_write_config`, `write_pdf_palette_at`)
   hold the file lock across their read-merge-write, so a Routines save and
   an appearance sync in the same instant cannot lose either side. The named
   presets remain explicit choices; their TS↔runtime tables stay pinned by
   `test-pdf-theme.ts`. Deriving them from the twelve theme token sets is
   still open. The retry ceiling is a stated trade-off: three attempts at the
   5-minute gate is ~15 minutes per slot, after which the doctor's Signal
   proposal is the recovery path; spaced attempts (5/15/45 min) are the next
   step if a local-model restart ever takes longer.
2. **FIXED** — every runtime entry point resolves `config-path.ts`
   `CONFIG_PATH` (`ROTLI_BREVE_CONFIG`, else the vault's
   `routines/config.json`); `breve.rs` passes the env on its own spawns.
3. **FIXED** — the chat PDF artifact renders through
   `breve-runtime/scripts/render-document.ts` (same palette, same
   `chrome-pdf.ts`, Rotli reading rules, task boxes, tables, code) from the
   managed runtime or the bundled one; `cupsfilter` stays the fallback and
   the reason is logged.

### 1.5 Breve on the main thread (latency)

`breve_snapshot`, `breve_write_config`, `breve_write_brief_skill`,
`breve_write_watchlist`, `breve_write_delivery_settings`, `breve_import_legacy`,
`breve_takeover`, and `breve_retire_legacy` are all plain sync commands, so
they run on Tauri's main thread. `snapshot_at` reads the **full markdown of
every brief** (`scan_briefs`, `breve.rs:981-1005`), five `read_dir`s for the
artifact count, and a 512 KB log tail — every 30 s while the lens is open
(`useBreve.ts:16`) and again after **every** save, because each write
command returns a fresh snapshot. A year of briefs makes each of those a
100–300 ms freeze. **FIXED** for the thread: every `breve_*` read/write now
runs through `off_main` (`spawn_blocking`). Still open: the writers still
return a full snapshot, and `scan_briefs` still reads every brief body.

### 1.6 Vault scoping is still half-integrated in the prompt

`breve-runtime/skills/breve/SKILL.md` hardcodes `~/memex-vault` eight times
(inbox, storage, PDF output paths) while the supervisor pins
`BREVE_KNOWLEDGE`/`BREVE_STORAGE` per vault (`routines.rs:485-486`). A second
vault's briefs would be written into memex-vault's storage. **FIXED**:
templated through `{{BREVE_KNOWLEDGE}}`/`{{BREVE_STORAGE}}`
(`breve::materialize_skill_text`). The stale audio-path note remains.

### 1.7 Zero Breve end-to-end coverage

`e2e/` had no Breve spec and browser mode renders `EMPTY_BREVE_SNAPSHOT`
only. **Partly FIXED**: `e2e/breve-lens.spec.ts` proves the switcher
segment, the chrome surviving the trip, and the Match-Rotli preview
following a theme switch. A browser-mode fixture behind a query flag would
let Playwright exercise the reader, routines, and health strip too.

## 2. Providers

Map (provider → client → auth → streaming → UI):

| Lane | Client | Auth | Streams | Surfaces |
|---|---|---|---|---|
| Claude Code | `provider.rs:79-88`, `:190-225` (`claude -p --output-format json`) | CLI login, probed by `claude auth status` | no | chat picker, Settings lane card, onboarding |
| Codex | `provider.rs:89-103`, `:230-294` (`codex exec --json`) | `codex login status` | no (JSONL read to EOF) | same |
| Cursor | `provider.rs:104-113`, ACP over stdio | `agent status` | receives chunks, discards them (`:680-695`) | same |
| MLX (local) | `chat.rs:479`/`:530`, Ollama wire on `:11435` | none | **yes** (only lane) | picker, Settings “On this Mac”, onboarding, Breve, organizer |
| llama.cpp (local) | `chat.rs:636`, OpenAI wire on `:11436` | 0600 key file | no | picker only, no management UI |
| Ollama | id recognized only (`guard.ts:123`) | — | — | none |
| Image generation | `provider.rs:986` refuses unconditionally | — | — | none (parked) |

Ranked:

1. **`cli_detect` has no timeout and inherits stdin** (`provider.rs:1023-1065`,
   `:1036-1043`). `chatSurface.tsx:1651` gates model resolution on it, so a
   hung `claude auth status` leaves the picker unresolved indefinitely. Fix:
   the same watchdog as `run_registered` (~5 s) plus `Stdio::null()`.
2. **Every AI note read/write spawns PlistBuddy on the main thread.**
   `corpus_read_ai`/`corpus_write_ai` (`corpus.rs:8268/8358`, sync) →
   `model_is_local` → `read_models` → `local_model_default`
   (`localmodel.rs:202-213`). Every `read_note` tool step pays a subprocess
   on the UI thread. `chat_models` (`chat.rs:116`) is the same chain, called
   on mount by four surfaces. Fix: async + `spawn_blocking`, short-TTL memo.
3. **Connected-model allowlists are duplicated across the IPC boundary and
   not parity-pinned** (`models.ts:179-199` vs `provider.rs:79-114`). Add a
   `cliModelAllowlist` entry to `parity.json`.
4. **Settings probes all three lanes** (`settingsSurface.tsx:2233-2238`,
   `enabled: isTauri()`) while chat probes only enabled lanes; six
   subprocess spawns on opening AI Models.
5. **`LANE_PING_MODEL` is dead** (`verify.ts:20`, `models.ts:262-266`): the
   only caller passes `defaultModel`, so enabling a lane pings Sonnet /
   gpt-5.6-sol instead of the cheap model, at up to 90 s.
6. **Starter presets reference a model the install catalog cannot install**
   (`models.ts:276-292` and `chat.rs:17` hardcode `gemma-3-12b-it-qat-4bit`;
   `LOCAL_CATALOG` offers Qwen/Llama/Phi/Ministral). A fresh install's
   presets dead-end at `hybrid.ts:73`.
7. **Budget tiers mis-tier half the catalog** (`budget.ts:52-55`): Phi-3.5 and
   Ministral (128k) fall to the 8k “frugal” tier.
8. **Streaming is one-lane.** Cursor already receives token chunks and
   concatenates them; Codex JSONL and llama.cpp could stream with the
   existing `channelStream` plumbing. Claude's CLI supports `stream-json`.
9. Dead code: the `generate_image` TS chain (`loop.ts:46,108`, `prompt.ts:157,283`,
   `tools.ts:235,495`, `host.ts:526`) behind a Rust stub that always refuses;
   the `gemini` mark/logo branch (`chatMark.ts:21-68`, `modelLogo.tsx`).
10. Smaller: `messages_openai` ignores the caller's timeout (`chat.rs:654`);
    five transport deadlines with no shared constant; `ensure_llamacpp_up`
    keyed on the substring `"11436"` (`chat.rs:717`); usage dashboard scans
    only Claude/Codex roots and prices retired models (`usage.rs:214-218`,
    `modelUsageSummary.ts:19-70`); `["chat","models"]` has `staleTime`
    Infinity in three surfaces and 60 s in Breve.

## 3. Latency

Command surface today: 186 `#[tauri::command]`, **151 sync** (main thread),
35 async. The heavy walkers converted since the July audit; the per-action
lane did not.

Tier A, every keystroke or pointer frame:

1. **`corpus_write` is sync and double-fsyncs** (`corpus.rs:8379` →
   `fsutil.rs:191,198`): the 400 ms editor sync tick writes the note on the
   main thread with a file fsync and a directory fsync. 1–10 ms typical,
   30–80 ms spikes under FileVault/Spotlight. Fix: async + `spawn_blocking`
   (revision-based conflict detection already covers ordering).
2. **Sidebar divider drag re-renders the tree per pointer event and
   stringifies the settings twice per frame.** `app.tsx:637` subscribes the
   appearance broadcaster to the whole ui store; `sidebarWidth` lives there
   and `RailGrip.onMove` sets it un-rAF'd. Fix: rAF-coalesce, and subscribe
   with a selector over appearance fields only.
3. **Every editor keypress round-trips the whole document**
   (`cmEditor.tsx:647` → `model.ts:447`): `doc.toString()` + `split("\n")`,
   and a second full `toString()` + scan when Find is open.

Tier B, frequent discrete actions:

4. **Chat send → first token** (`loop.ts:114` → `corpus.rs:7541-7566`):
   before any event is yielded, `corpus_notes_ai` re-acquires the corpus
   mutex **per note** and reads + parses + secure-scans every note from
   disk. The walk cache already holds `body`, `metadata`, and `secure`
   (`corpus.rs:2841-2851`). Fix: answer non-secure notes from the cache under
   one lock; yield a `status` first.
5. **Connected models never stream** (`host.ts:617-632`, `chat.rs:373-375`):
   time-to-first-token equals the whole response.
6. `corpus_read` sync (`corpus.rs:7569`) and behind the corpus mutex — a note
   open can queue behind a walk or a Tantivy commit.
7. **First ⌘K after any edit rebuilds the search index**
   (`search_index.rs:195-252`): a new 15 MB `IndexWriter` every sync, every
   note body cloned and hashed, a segment commit under the mutex. 20–80 ms.
   Fix: one long-lived writer fed the changed-id set.
8. `list()` deep-clones the whole `CorpusList` on a cache hit
   (`corpus.rs:4503-4508`) and serializes it across IPC.
9. `memex_list_chats` sync per-file reads (`memex.rs:598-601`) on sidebar and
   palette mount.
10. ⌘K allocates lowercase copies of every title and snippet per keystroke
    (`palette.tsx:35-45`, `:117-305`).
11. No list virtualization anywhere (`noteListSurface.tsx:131-155`).

Tier C, surface opens: the Breve snapshot (§1.5); Breve writers return a
snapshot (§1.5); `cliDetect` ×3 with 60 s staleness on every chat open
(`chatSurface.tsx:1633-1638`); `.docx` settle gated behind 250 + 500 ms
timers (`documents/engine/univer.ts:771,782`); `vault_browser_*` (eight
sync `read_dir` commands), `corpus_overview`, `memex_read_chat`, and the
three `secret_*` Keychain calls all sync.

Tier D, startup: Rust `setup()` walks every registered root synchronously
before the event loop pumps (`lib.rs:2711` → `warm_secure_ledger` →
`ensure_walked`, 0.28 s per 250 notes per root); the webview awaits five
serialized IPC reads before `createRoot` (`main.tsx:27` →
`persist.ts:1332-1371`); three webviews (main, quick, capture) each boot the
1.5 MB entry and run that hydration at once (`tauri.conf.json` windows).

Structural: the corpus `Mutex` (`corpus.rs:7029`) is the app's serialization
point and the read paths take `&mut self`, so `RwLock` alone will not help;
`list_cache`/`search_index` need their own cells first. Still open from
09-01: `hotkeyPeekDelay` 0 ms, tabs not keep-alive, wholesale walk-cache
invalidation on every write (which is why #7 fires after typing).

Verified clean: CSS motion ≤180 ms on interactive elements; all intervals
gated; debounce values defensible; no keyless invalidation; Quick Note and
capture windows are pre-created and show natively fast.

## 4. UI/UX consistency

Ranked (canonical pattern in parentheses):

1. **Twelve `var()` references to tokens that do not exist**, each killing
   its declaration: `--focus` (`canvas.css:115`, the recovery control has no
   focus ring), `--line`, `--font-ui` (`editor.css:744`, `:1253`),
   `--text-faint` ×4 (`memex.css`), `--surface-3`, `--dur-fast`, `--ease`
   (`notes.css:167-172`), `--surface-1` ×2 (`memex.css:1600`), `--r-sm`,
   `--mono` (`breve.css:157`, `:1430`), `--font-mono` ×4. Verified by script
   this session. Fix the references and add a `check:design-system` rule.
2. **No focus trap in any of ~14 dialogs**; only five carry `aria-modal`.
   (`boardNameDialog.tsx` is the model; put one trap in `lib/popover.ts`.)
3. **Chat delete is destructive with no confirmation**
   (`sidebarChat.tsx:319-323`, `:566-568`) while Home's equivalent drills to
   a confirm (`sidebarHome.tsx:327`).
4. **`--danger` is an alias of `--accent-text`** (`base.css:26`), so every
   destructive control renders in the accent hue; `--failure` is the real
   per-theme role.
5. `.sheet-view-toggle` has inverted state semantics (`memex.css:2285-2302`).
6. Breve uses window `@media` inside a pane (§1.3); `notes.css`, `editor.css`,
   `board.css`, `canvas.css`, `quick.css` have no narrow-window handling at
   all; 17 distinct breakpoints app-wide.
7. Six segmented controls with six selected states; `.dashboard-tabs` uses a
   solid accent fill against DESIGN.md's own rule, and DESIGN.md's
   “solid-accent segmented state” sentence is stale. (`.sb-switch-seg`.)
8. Two switch geometries plus two raw checkboxes (settings `Toggle`/`.sw`).
9. Two icon systems in one footer row (`sidebarFooter.tsx:42-84`); 17
   distinct icon sizes; the Breve toggle jitters 1 px between 16 and 17
   (`sidebar.tsx:294`).
10. Four secondary and four primary button families (`.ghostbtn` + `.btn`).
11. 621 literal font sizes across 47 values; the four type tokens are used
    9 times. Extend the scale to ~6 steps, then migrate.
12. No `--font-mono` token; 37 monospace stacks in four spellings.
13. No toast system; 25 bespoke inline error classes; `role="alert"`
    coverage uneven (missing in `renameDialog`, `quickNote`, `captureCard`,
    `previewModal`, `tabStrip`, `paneTree`).
14. Context menus cannot show shortcuts (`MenuSpec` has no chord field) while
    the palette and slash menu always do.
15. 24 empty-state families; the shared `EmptyState` has one caller.
16. Loading states exist for three surfaces only.
17. Nine disabled opacities, six focus-ring treatments, 66 literal radii, two
    scrims that bypass `--scrim`, ad-hoc z-index ladder.
18. `RenameDialog` lacks the role, pending, and error states its twin
    `BoardNameDialog` has.
19. Ten chip families (`.soonpill`, `.metaempty` are dead CSS); sixteen
    popover families over one good primitive, only `.ctxmenu` has arrow keys.
20. Text glyphs (`✓ ★ ⚠ ✗ 👁 ✎ ‹`) where SVG glyphs exist.
21. Code vocabulary drift: `"Brain"` root id / `brain` settings id /
    “Librarian” / “Library”; a raw `memexId` shown on the vault card
    (`settingsSurface.tsx:1472`).

Verified clean: exclusive-choice menus use the tinted row, never a checkmark;
0 raw colors outside the token files; inline styles are dynamic only;
settings rows all carry descriptions and save instantly; nothing is
hotkey-only.

## 5. Half-integrated features

Method note: `src/editor/cmEditor.tsx:314` contains literal NUL and SOH bytes
(a join separator written as raw control characters), so `file` reports the
file as `data` and plain `grep`, `rg`, and `git grep` **skip the whole
926-line file**. Verified this session. Every grep-driven agent (and every
CARL recall) is blind to it; the mechanical guards use `readFileSync` and
are unaffected. Fix: ` `/`` escapes.

Ranked:

1. **Image generation is five layers of scaffolding with no live path.**
   `provider.rs:986` discards every argument and refuses; no TS wrapper
   exists; `host.ts:526` returns a fixed error string; `imageTool` is
   threaded through `types.ts`, `prompt.ts`, `loop.ts` and set only in a
   test; the slash item “Generate image” (`slashMenu.tsx:303`) and
   `ImageGenPopover` still advertise it and render “unavailable”. Finish
   (L) or delete the TS chain and the slash item (S).
2. **`local_queue_status` is registered and never called** (`lib.rs:2553`,
   `compute.rs:629`): the chat queue lane only listens for transitions, so a
   pane mounted while requests are queued shows an empty queue until the
   next event. One `localQueueStatus()` on mount fixes it (S).
3. **`corpus_new_file_bytes` (CSV→XLSX convert) has no caller**
   (`corpus.rs:7757`); `fileSurface.tsx` has no convert action (S/M).
4. **`corpus_set_field` (per-field frontmatter) is built and unused**
   (`corpus.rs:8052`); the metadata panel edits raw YAML through
   `corpusWriteFrontmatterRaw` instead (`editorSurface.tsx:260-308`) (M).
5. **`rename_note` reaches the CLI only** (`workspace.rs:467`, one caller at
   `:1867`); the MCP inventory has `rotli_rename_view` but no
   `rotli_rename_note`, against `agent-workspace.md`'s “same policy for every
   caller” (S).
6. **`memex_read` — an unrestricted spine-file read with a documented past
   traversal bug (`memex.rs:381`), still registered (`lib.rs:2597`), zero
   callers.** Highest-value deletion on the list (S).
7. `corpus_add_folder` / `corpus_forget_folder` (`lib.rs:2443-2444`) —
   superseded by the connect-brain lane, no callers (S).
8. `paneVaultMode` — a persisted setting whose only legal value is
   `"single"` after the 2026-07-27 NO-GO (`ui.ts:179-181`, `:802`) (S).
9. `organizerModel` — a one-option segmented control whose setter ignores
   its argument (`ui.ts:136-138`, `:1075`, `settingsSurface.tsx:1887`) (S).
10. `local_model_default` registered with no TS reader; `chat_models` already
    carries `isDefault` (S).
11. “knip clean” is weaker than the 09-01 audit states: `knip.json` lists
    `src/**/*.test.ts` as entries, so a module imported only by a test counts
    as reachable. Add a second knip project without test entries.

Verified clean: every declared command is registered; slash menu, pickers,
attach, and the raw-editor toggle are all mounted; the AI tool registry's
15 names match 15 dispatch arms; the MCP relay's four routes are documented
and guarded; the local-compute knobs are UI-less by documented design; zero
`TODO`/`FIXME` in `src/` and `src-tauri/src/`.

## 6. How the app writes to the vault

Two primitives are the intended chokepoints and most lanes honour them:
`fsutil::atomic_write_bytes` (`fsutil.rs:180`: same-dir tempfile → write →
fsync → rename → parent fsync) and `fsutil::with_file_lock` (`fsutil.rs:46`:
cross-process `<target>.lock`, PID-liveness recovery, 10 s ceiling, fails
closed), plus the in-process registry `Mutex` entered through `route()`.
Autosave is a 400 ms trailing debounce per note (`editor/model.ts:17`),
typing never waits on disk, revision conflicts preserve the dirty buffer,
and quit is a real three-webview flush handshake that aborts on timeout
(`lib.rs:597-640`). The only loss window is a hard kill inside the 400 ms
debounce, which the data contract already documents.

Every write lane, with the shape it produces:

| Lane | Command / entry | Atomic | File lock | Watcher mark | Frontmatter by |
|---|---|---|---|---|---|
| Editor autosave, rename | `corpus_write` (sync) | yes | yes | yes | Rust `write_resolved` |
| Move / trash | `corpus_move` | yes | yes | yes | Rust |
| Locked / pinned / local-AI flags | `corpus_set_*` | yes | yes | **no** | Rust |
| Task checkbox | `corpus_toggle_task` → `Store::write` | yes | **no** | yes | Rust |
| Chat `update_note` | `corpus_write_ai` | yes | yes | yes | Rust |
| Librarian | in-process `set_ai_field` / `file_note` | yes | yes | yes | Rust |
| Board / sheet / DOCX | `corpus_write_board`, `corpus_write_file_bytes` | yes | **no** | yes | n/a |
| Note create (local route) | `corpus_create` → `create_with_policy` | yes | no | yes | **Rust inline literals** |
| Note create (memex route), Quick Note, capture | `memex_write_note` | yes | dir lock | yes | **TS `composeNote`** |
| Chat transcript / rename / trash | `memex_write_chat` … | yes | yes | **no** | TS |
| `main.json`, `views.json` | revisioned tracked writes | yes | yes | yes | JSON |
| `.rotli/settings.json` | `corpus_settings_write` | yes | **no**, no revision | no | JSON |
| CLI / MCP | `workspace.rs` dispatcher (separate process) | yes | mostly | own store | Rust |
| Breve watchlist + briefs | `breve.rs:461 write_atomic` | **no dir fsync** | **no** | **no** | **`note_document`, no `id`** |
| Breve daily digest | `daily-log.ts:85` `writeFileSync` | **no** | no | no | inline stub, no `id` |
| Breve inbox capture | `signal-daemon.ts:946` `appendFileSync` | **no** | no | no | none |

Ranked:

1. **Unlocked read-modify-write of `.gitignore` for a secure note**
   (`memex.rs:1204-1215`). `memex_write_note` inlines its own append under
   only a directory lock while `corpus.rs:3717 gitignore_add` does the same
   job under the file lock. Two concurrent secure creates (Quick Note +
   capture, or a second process) can lose an ignore line, which is exactly
   what `gitignore_add` was written to prevent. Fix: call `gitignore_add`.
2. **Breve's daily digest truncates in place** (`daily-log.ts:85,117,120`)
   into `history/`, which the contract declares never writable by any lane.
   A crash mid-write leaves an empty day. Fix: temp + rename, and long-term
   route through Rust.
3. **`toggle_task` writes through the only unlocked body-write entry**
   (`corpus.rs:4979` → `5083`); a CLI/MCP patch between its read and write
   is silently discarded.
4. **Board and sheet/DOCX saves revision-check without a file lock**
   (`corpus.rs:6144`, `3309`); a 500 ms board autosave racing an MCP board
   apply can lose one.
5. **Breve writes real Library notes through a second, weaker `write_atomic`**
   (`breve.rs:461`): no directory fsync, no lock, no watcher mark, so every
   Breve write echoes as an “external change” and a user editing the
   watchlist note has no mutual exclusion with Breve.
6. **Breve's frontmatter has no `id`** (`breve.rs:892 note_document`,
   `daily-log.ts:66`): those notes cannot be resolved by `path_of`, are
   absent from `index.json`, and `set_secure` refuses them. This is the
   fourth frontmatter grammar in the codebase.
7. **Chat writes never mark the watcher** (`memex.rs:886,1071,1136`), so every
   chat turn fires the 300 ms watcher → `refreshAfterExternalCorpusChange`
   (notes, folders, chats, Main, views, journal) and bumps the walk
   generation. A long agent run turns every turn into a full-vault refresh.
8. **Mutating commands are sync, hold the registry mutex, and can sleep up
   to 10 s in the lock loop on the main thread** (`fsutil.rs:35-36,83`
   after a killed CLI leaves a `.lock` that passes the PID check).
9. **Any internal write invalidates the whole walk cache** (`corpus.rs:2526
   mark()` → `bump()`), so the next list/search/⌘K re-walks and re-hashes
   the vault. With #7 that is often within the same second.
10. Three flag writers skip `suppress.mark` (`set_locked:3562`,
    `set_pinned:3583`, `set_local_ai_access:4034`) and fire a spurious
    external-change refresh; `create_with_policy:6019` stamps RFC3339 on a
    Memex-layout vault where `write_resolved` uses `YYYY-MM-DD`.
11. **Four producers of the same note shape, two ULID minters**
    (`contract.ts:481`, `corpus.rs:6020-6035`, `breve.rs:892`,
    `daily-log.ts:66`), already drifting on `reach`, on stamp format, and on
    the `secure: true` exact-string match at `memex.rs:1179` that routes a
    note to `_secure` vs `_inbox`. Fix: `memex_write_note` takes
    `{title, body, shelf, reach, secure}` and Rust composes.
12. Smaller: `persist_index` rewrites `.rotli/index.json` per save and
    swallows errors (`corpus.rs:4401-4411`); `journal_append` rewrites the
    whole journal per line (`:5677`); `settings.json` has no lock or
    revision while it carries `secureLocalAi` (`:6449`, `:8666`);
    `seed_main_from_disk_if_missing` is an unlocked TOCTOU (`:4533`);
    `append_scheduler_event` can interleave lines (`breve.rs:1798`).

Verified clean: `corpus_set_field` and `corpus_write_frontmatter_raw` cannot
forge reserved keys; the non-revision agent writes are test-only; view
writes have a cycle-free lock order with rollback; moves are
rewrite-then-rename; external-edit reload is dirty-aware; the organizer
never holds a lock across a model call; Tantivy syncs incrementally and only
on search.

## 7. Suggested order

1. Install 0.84.0, relaunch, confirm a brief lands (§1.1). Then the health
   strip, bounded retries, and the writer-name log fix.
2. Decide §1.2 (research-capable scheduled brief). Without it the rest of
   the Breve work polishes an empty product.
3. PDF theme alignment (§1.4 items 1–3) and the Breve main-thread commands
   (§1.5) — small, contained, and they remove a class of user-visible wrong.
4. `corpus_write` async (§3.1), chat pre-token corpus read from cache
   (§3.4), Breve snapshot async (§1.5): the three largest felt delays.
5. Undefined tokens, focus trap, chat delete confirm, `--danger` role
   (§4.1–4.4).
6. Breve findability + three-section shape (§1.3), on the shared primitives.
7. Provider probes (timeout + stdin) and the PlistBuddy-on-main-thread chain
   (§2.1–2.2).
