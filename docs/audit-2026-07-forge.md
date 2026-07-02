# rotli deep review — v0.19.0 (2026-07-02)

Anchor: `7e5c2e9` (v0.19.0, clean tree) · Rust 115 tests green · TS 282 green · 97 verified findings (96 CONFIRMED, 1 PLAUSIBLE, refuted claims already removed; 6 duplicate reports merged).

**Executive summary.** The app is structurally healthier than its size suggests: the organizer daemon, the pane/editor architecture, the service seam, and the low-pulse discipline are genuinely well-built, and most laws (secure-never-into-a-model, one write lane, files-as-truth) are enforced in code, not just prose. The debt clusters into five themes. (1) **Hand-maintained mirrors are drifting** — the markdown grammar exists in 4–5 copies, the sidebar tree is built twice, the TS/Rust contract band has split (3.6 vs 3.7), and settings/viewstate enumerations silently drop what they don't know; every "MUST mirror" comment in the codebase is a bug that hasn't happened yet, and several already have. (2) **Guarantees decay at the edges** — the secure `.gitignore` line goes stale on rename/filing (the one critical), brain perms live only in TS, and "local model" is a hardcoded `true` rather than a checked endpoint. (3) **Silent failure** — canvas/chat/filing errors die in `console.warn`, dirty sheets die on ⌘Q, and the daemon can strand a capture with no trace. (4) **Full-corpus I/O everywhere** — ~8 redundant disk walks per save beat, double-read search, an O(n²) journal; fine at 200 notes, not at memex-vault scale. (5) **The write side of organization lags the read side** — no move-to-folder, no Main-folder rename, dead right-click on chats/folders. **Do first:** the one-day security batch (findings 1, 2, 20–24, 42, 44) — the `.gitignore` staleness is live against a vault that really contains SSNs and card numbers.

## The scoreboard

Merged duplicates: #2 (chat-loop + contract-lanes), #7 (shell + chat-loop), #22 (daemon + contract-lanes), #24 (structure + contract-lanes), #32 (structure + daemon + contract-lanes).

| # | Sev | Verdict | Axis | Finding | Where | Effort |
|---|-----|---------|------|---------|-------|--------|
| 1 | CRIT | CONF | AI | Secure note's `.gitignore` line goes stale on rename/move/filing — flagged secrets become committable | src-tauri/src/corpus.rs:2232 | S |
| 2 | HIGH | CONF | AI | "Local model" invariant asserted, never enforced — secure notes ride to whatever endpoint the registry declares | src/ai/host.ts:40 | S |
| 3 | HIGH | CONF | AI | Brain perms ("read-only") + contract band enforced only in TS — Rust write gates never consult them | src-tauri/src/corpus.rs:1988 | M |
| 4 | HIGH | CONF | UX | Dirty spreadsheet edits lost silently on quit — no guard, no persistence | src/components/SheetEditor.tsx:59 | M |
| 5 | HIGH | CONF | UX | ⌘N with Archive/Trash selected creates the note inside the sink | src/services/createNote.ts:30 | S |
| 6 | HIGH | CONF | UX | Quick-note target can be a curated wiki area the gate refuses — ⌥Q silently dead forever | src/components/SettingsSurface.tsx:429 | S |
| 7 | HIGH | CONF | UX | Unsaved-chat web toggle rides persisted key `""` — every future new chat starts web-ON | src/components/ChatSurface.tsx:160 | S |
| 8 | HIGH | CONF | AI | Vision silently broken on the MLX generate path — the only vision model never receives the image | src-tauri/src/chat.rs:279 | S |
| 9 | HIGH | CONF | AI | Agent `search_notes` keyword-ranks 140-char snippets while full-text `corpus_search` ships unwired | src/ai/host.ts:34 | S |
| 10 | HIGH | CONF | AI | Every model/web call is a sync Tauri command — main thread blocks up to 120s per agent step | src-tauri/src/chat.rs:225 | M |
| 11 | HIGH | CONF | UX | Canvas/chat/filing/metadata/rename failures die in `console.warn` — zero user feedback | src/components/CanvasSurface.tsx:122 | M |
| 12 | HIGH | CONF | UX | Every 0.x update re-runs onboarding with the required location step un-seeded; mis-pick relocates the corpus | src/components/Onboarding.tsx:269 | M |
| 13 | HIGH | CONF | UX | Generic code fences (```js, plain ```) get markdown-styled and table-widgetized | src/editor/fences.ts:44 | M |
| 14 | HIGH | CONF | UX | Links render as links but can never be opened — no ⌘-click, no opener command anywhere | src/editor/livePreview.ts:69 | M |
| 15 | HIGH | CONF | UX | Move-note-to-folder has NO gesture anywhere — the service exists, nothing calls it | src/components/useNoteMenu.ts:84 | M |
| 16 | HIGH | CONF | UX | Main folders can never be renamed — the ⊕ mints permanent "New folder 2" rows | src/components/Sidebar.tsx:1605 | M |
| 17 | HIGH | CONF | STR | Every debounced save triggers ~8 redundant full-corpus disk walks (invalidation storm) | src/services/hooks.ts:189 | M |
| 18 | HIGH | CONF | STR | Sidebar's roving-cursor list is a hand-maintained mirror of the JSX tree | src/components/Sidebar.tsx:1024 | M |
| 19 | HIGH | CONF | STR | corpus.rs is a genuine god-module — 5391 lines, seven concerns, three clean extraction seams | src-tauri/src/corpus.rs:31 | L |
| 20 | MED | CONF | AI | memex_write_chat/note/read trust a webview-supplied root path — relative-only guard | src-tauri/src/memex.rs:645 | M |
| 21 | MED | CONF | AI | read_for_ai checks only the `secure:` flag, not the secret detector — unflagged secrets pass | src-tauri/src/corpus.rs:1915 | S |
| 22 | MED | CONF | AI | set_field skips writable() and AI_KEYS — "disjoint territories" is false in the user lane | src-tauri/src/corpus.rs:1750 | S |
| 23 | MED | CONF | AI | Card numbers without separators bypass BOTH secret guards at the web boundary | src/ai/guard.ts:19 | S |
| 24 | MED | CONF | STR | Rust contract band [3.4,3.6] drifted behind TS/docs [3.4,3.7] — a 3.7 brain opens read-only | src-tauri/src/memex.rs:36 | S |
| 25 | MED | CONF | AI | Failed mid-apply write permanently strands a capture as "classify-covered" | src-tauri/src/organizer.rs:1230 | M |
| 26 | MED | CONF | AI | Index proposals: never superseded, approved with no freshness guard — zombies pile up, stale approve sticks | src-tauri/src/organizer.rs:1536 | M |
| 27 | MED | CONF | AI | Enrich apply re-checks only the BODY hash — a field the user sets mid-model-call is clobbered | src-tauri/src/organizer.rs:1397 | S |
| 28 | MED | CONF | AI | Approving an enrich proposal freezes the field forever — lastFields never learns the approved value | src/services/brainJournal.ts:170 | M |
| 29 | MED | CONF | AI | Run-now consumed and lost when the gate blocks — on battery the explicit nudge never runs | src-tauri/src/organizer.rs:1804 | S |
| 30 | MED | CONF | AI | `reach:` scoping (§4.2.6) is not implemented — the daemon ignores it entirely | src-tauri/src/organizer.rs:551 | M |
| 31 | MED | CONF | AI | contract.ts documents the OPPOSITE secure policy from the daemon | src/memex/contract.ts:356 | S |
| 32 | MED | CONF | STR | Journal "append" rewrites the whole file per line, no compaction — O(n²) under the corpus lock | src-tauri/src/corpus.rs:2442 | M |
| 33 | MED | CONF | STR | Board/file rename kills its Main-manifest ref — committed main.json silently GC'd | src/components/useNoteMenu.ts:101 | M |
| 34 | MED | CONF | STR | Persisted viewstate drops FileTab/ActivityTab — tabs vanish, splits collapse on relaunch | src/state/persist.ts:366 | S |
| 35 | MED | CONF | STR | Whole-file settings.json rewrite destroys unknown keys incl. the daemon's documented knobs | src/state/persist.ts:535 | S |
| 36 | MED | CONF | STR | Every persisted knob hand-written in six parallel lists (blockHandles2 hack is the scar) | src/state/persist.ts:110 | M |
| 37 | MED | CONF | STR | ui.ts is a five-domain junk drawer — persisted vs transient invisible at declaration | src/state/ui.ts:112 | L |
| 38 | MED | CONF | STR | Three-way contract mirror (contract.ts / memex.rs / corpus.rs) guarded only by comments | src/memex/contract.ts:315 | M |
| 39 | MED | CONF | STR | tauri.ts: three duplicate guard helpers + three Filer wrappers violating its own guard law | src/lib/tauri.ts:586 | M |
| 40 | MED | CONF | STR | One global Mutex serializes every corpus command across ALL roots; list/search hold it for full walks | src-tauri/src/corpus.rs:3103 | M |
| 41 | MED | CONF | STR | search() reads every note body twice per query — no mtime cache anywhere | src-tauri/src/corpus.rs:2044 | M |
| 42 | MED | CONF | STR | with_file_lock silently proceeds WITHOUT the lock after 10s; live holders get dispossessed | src-tauri/src/memex.rs:99 | S |
| 43 | MED | CONF | STR | corpus_list/search aggregation triplicated — incl. a "keep in lockstep" test mirror; commands untested | src-tauri/src/corpus.rs:5255 | S |
| 44 | MED | CONF | STR | Daemon-owned organizer.json writable from the webview via corpus_settings_write | src-tauri/src/corpus.rs:2786 | S |
| 45 | MED | CONF | STR | Vault `_`-folders: phantom roving rows wedge j/k in an expanded linked-library subtree | src/components/Sidebar.tsx:1045 | S |
| 46 | MED | CONF | STR | Sidebar god-component (1725 lines, ~41 subscriptions) — split seams identified, one blocker | src/components/Sidebar.tsx:471 | L |
| 47 | MED | CONF | STR | Inline mark grammar in four copies — already drifted (nested marks: chat yes, editor no) | src/editor/livePreview.ts:61 | M |
| 48 | MED | CONF | STR | Block-prefix grammar in five sites — real divergence (`*` bullets) | src/editor/cmKeymap.ts:33 | M |
| 49 | MED | CONF | UX | Beautified copy silently strips link URLs (and structure) from the clipboard by default | src/editor/CmEditor.tsx:298 | S |
| 50 | MED | CONF | UX | Row-granular table reveal misaligns columns — the split twins size independently | src/editor/tableRender.ts:405 | M |
| 51 | MED | CONF | UX | Block drag: no end-of-note drop slot, no edge auto-scroll | src/editor/blockHandles.ts:126 | M |
| 52 | MED | CONF | UX | Aa panel presents global toggles under a "saved for this note" promise | src/editor/AaPanel.tsx:133 | S |
| 53 | MED | CONF | UX | Read-only / uneditable sheets mostly don't say why editing is off | src/components/FileSurface.tsx:368 | S |
| 54 | MED | CONF | UX | PDF viewer is a bare iframe — no pages, zoom, search, or keyboard focus | src/components/FileSurface.tsx:437 | M |
| 55 | MED | CONF | UX | ⌘K palette opens boards as notes → dead erroring pane (corruption claim refuted; routing bug real) | src/components/Palette.tsx:113 | S |
| 56 | MED | CONF | UX | Curating a capture makes it vanish silently; capture cards have no curation gestures | src/components/BoardSurface.tsx:30 | M |
| 57 | MED | CONF | UX | Right-click is a dead gesture on chats and corpus folders — in the release that made right-click the headline | src/components/Sidebar.tsx:1526 | M |
| 58 | MED | CONF | UX | j/k skips visible rows: Captures, Brain Activity, added roots; stray Tab stops | src/components/Sidebar.tsx:1569 | M |
| 59 | MED | CONF | UX | Note-row drag shows a ghost everywhere but only Main accepts — no invalid-target feedback | src/components/Sidebar.tsx:674 | S |
| 60 | MED | CONF | UX | All-notes counts disagree between sidebar and surface; Recent's count is meaningless | src/components/Sidebar.tsx:1565 | S |
| 61 | MED | CONF | UX | Trust ladder: reading what a rung does requires APPLYING it | src/components/SettingsSurface.tsx:1079 | S |
| 62 | MED | CONF | UX | Field/index proposals approved blind — proposed value and promised diff never shown | src/components/ActivitySurface.tsx:32 | M |
| 63 | MED | CONF | UX | Quick-access 5-star cap is invisible — picker star silently no-ops when full | src/state/quick.ts:58 | S |
| 64 | MED | CONF | UX | Settings IA stretches "Brain" across three meanings | src/components/SettingsSurface.tsx:71 | M |
| 65 | MED | CONF | AI | Conversation history unbounded in the prompt — long chats overflow small-model context | src/ai/prompt.ts:24 | S |
| 66 | MED | CONF | AI | No cancellation, no step transparency — tool events yielded but dropped | src/components/ChatSurface.tsx:218 | M |
| 67 | LOW | CONF | STR | Load-bearing cross-language "note not found" string match unpinned | src-tauri/src/corpus.rs:2090 | S |
| 68 | LOW | CONF | STR | Five registered commands with no frontend caller — incl. corpus_purge, the only hard-delete lane | src-tauri/src/lib.rs:750 | S |
| 69 | LOW | CONF | STR | Duplicate atomic_write, three timestamp helpers, shadow frontmatter parser | src-tauri/src/memex.rs:54 | S |
| 70 | LOW | CONF | STR | chat.rs has zero tests despite holding pure load-bearing parsers | src-tauri/src/chat.rs:130 | S |
| 71 | LOW | CONF | STR | Dead Capture/Inbox notes plumbing (live react-query subscription, unreachable) | src/components/Sidebar.tsx:476 | S |
| 72 | LOW | CONF | STR | Sidebar recomputes full tree bookkeeping on every render / focus twitch | src/components/Sidebar.tsx:899 | M |
| 73 | LOW | CONF | STR | SettingsSurface: six self-contained panes in one 1198-line file — mechanical split | src/components/SettingsSurface.tsx:1155 | S |
| 74 | LOW | CONF | STR | Three hand-rolled pointer-drag state machines share only the ghost | src/components/Sidebar.tsx:649 | M |
| 75 | LOW | CONF | STR | FileSurface declares a paneId prop it never uses | src/components/FileSurface.tsx:141 | S |
| 76 | LOW | CONF | STR | Wire-id root-prefix parsing hand-sliced at 6+ sites instead of one WireId module | src/services/destinations.ts:33 | S |
| 77 | LOW | CONF | STR | A real folder named "all" shares its query-key with the All-notes sentinel | src/services/hooks.ts:17 | S |
| 78 | LOW | CONF | STR | chatWeb/expandedDests persisted maps never GC'd (noteStyles shows the fix) | src/state/persist.ts:446 | S |
| 79 | LOW | CONF | UX | Sheet-save .bak backups surface as unexplained mystery files in Storage | src-tauri/src/corpus.rs:1652 | S |
| 80 | LOW | CONF | UX | No transparency checkerboard behind images — transparent art disappears into the theme | src/styles/memex.css:508 | S |
| 81 | LOW | CONF | UX | Tabs can't be middle-click closed — half of the app's own middle-click grammar | src/components/TabStrip.tsx:172 | S |
| 82 | LOW | CONF | UX | Main's empty state says "drag from the Brain" when the Brain section may not exist | src/components/Sidebar.tsx:1612 | S |
| 83 | LOW | CONF | UX | Collapse-all EXPANDS Main folders (default-open vs default-closed split) | src/state/ui.ts:417 | S |
| 84 | LOW | CONF | UX | Approve and Dismiss share identical ghost styling; confidence is a bare unlabeled "· 78%" | src/components/ActivitySurface.tsx:140 | S |
| 85 | LOW | CONF | UX | "Run now" says "Running a pass…" forever; its errors render unstyled | src/components/SettingsSurface.tsx:1108 | S |
| 86 | LOW | CONF | UX | Settings copy hardcodes default chords (⌥Space/⌥C/⌥Q) — stale after rebind | src/components/SettingsSurface.tsx:460 | S |
| 87 | LOW | CONF | UX | Chat pane header shows the de-dashed slug instead of the stored title | src/components/ChatSurface.tsx:280 | S |
| 88 | LOW | CONF | AI | Wait::For branch has the lost-wakeup race Park was hardened against | src-tauri/src/organizer.rs:1788 | S |
| 89 | LOW | CONF | AI | 45s MODEL_TIMEOUT conflates cold/slow with "offline" — false banner + doubled generations | src-tauri/src/organizer.rs:39 | S |
| 90 | LOW | CONF | AI | Approved filings skip filed_by/filed_at — audit trail differs from auto-applied moves | src/services/brainJournal.ts:158 | S |
| 91 | LOW | CONF | AI | Enrich/index cycles re-read the entire wiki (with secret-regex scans) up to twice | src-tauri/src/organizer.rs:745 | M |
| 92 | LOW | CONF | AI | Hand-maintained TS/Rust guard mirror has no sync test | src/ai/loop.test.ts:163 | S |
| 93 | LOW | CONF | AI | Duplicate/blocked tool calls don't count toward the two-strike exit | src/ai/loop.ts:93 | S |
| 94 | LOW | CONF | AI | "⚠" prefix is the failure sentinel; a failed turn silently loses the user's message | src/components/ChatSurface.tsx:227 | M |
| 95 | LOW | CONF | AI | Phantom "chats+inbox+file" Filer tier — canFile/mayFile never called by app code | src/memex/contract.ts:48 | S |
| 96 | LOW | CONF | AI | inbox.md is a declared, gate-allowed write surface no code writes | src-tauri/src/memex.rs:12 | S |
| 97 | LOW | PLAUS | UX | Unsaved frontmatter-banner text discarded when the widget is swapped away | src/editor/fmBlock.ts:90 | S |

---

## Structure

**Shape.** The codebase is two health profiles wearing one repo. The healthy half is real and worth naming: organizer.rs is a genuinely well-layered daemon (pure core, injected transport, 38 hermetic tests, short lock windows with fresh-hash re-checks); the editor's fences/tables/model modules own their grammar cleanly and blockRender's StateField architecture is right; the NotesService seam with its browser twin, the mirror-not-import contract codec, and the pure pane-tree helpers are unusually disciplined for a fast-moving 0.x. `Result<T, String>` everywhere is a defensible convention at this altitude — its only real cost is one unpinned cross-language string match (#67), not the convention.

The debt concentrates in three systemic patterns. First, **god-modules with clean seams**: corpus.rs (#19) is seven concerns in one 5391-line compile unit — location/config, a pure frontmatter codec, the store+watcher, a 41-command wire layer, and a 1600-line test mod — all coupled to one global mutex (#40) whose read primitives do full-corpus body re-reads under lock (#41); Sidebar.tsx (#46) carries three drag grammars, the roving list, and all creation flows; tauri.ts (#39) and ui.ts (#37) are junk drawers where every feature adds a line. Second, **hand-mirrored enumerations that silently drop or drift**: the tree is computed twice and has already desynced (#18, #45), the settings writer destroys unknown keys including the daemon's own knobs (#35, root cause #36), the viewstate validator knows 3 of 5 tab kinds (#34), the contract band has split (#24), and the corpus_list aggregation is proven against a copy of itself (#43). Third, **the query layer models one scan as eight** (#17) — the single biggest perf lever in the app — compounded by the O(n²) journal (#32) and the no-mtime-cache walks (#41). The wire-id duality (ULID vs relpath) is mostly tamed but leaks a real committed-data bug at board rename (#33).

### Rust shell

- **#19 corpus.rs god-module** (corpus.rs:31, L). Verified 5391 lines / 42 commands; ~200 lines of the same Location surface live split-off in lib.rs:411–559. Fix: three mechanical extractions — `location.rs` (lines 31–600 + the lib.rs Location commands), `frontmatter.rs` (660–1260, pure), `commands.rs` (registry/route + the 41 commands); tests move with each. corpus.rs keeps the coherent store+walk+watcher.
- **#40 global registry mutex** (corpus.rs:3103, M). route() locks everything; list/search walk every root reading every body under it — a slow linked brain stalls an ⌥C capture. Fix: per-root `Mutex<CorpusStore>` inside the registry; the journal-interleaving invariant is per-root and survives exactly.
- **#41 search double-read** (corpus.rs:2044, M). search() calls list() (full walk + body reads) then re-reads every body; list() itself has no mtime cache and runs on every sidebar invalidation. Fix: NoteMeta cache keyed on (mtime, len), search reuses the same pass's bodies. Files stay the source of truth — the cache validates per-entry against disk.
- **#32 journal O(n²)** (corpus.rs:2442, M — reported independently by three reviewers). journal_append reads the whole brain-journal.jsonl and atomic_writes it back per line; organizer supersede does full re-reads per stale row; no compaction ever, all inside route(). Fix: `OpenOptions::append` (the mutex already serializes writers; torn last lines are already parse-skipped), plus size-threshold compaction folding to latest-status rows.
- **#24 contract band drift** (memex.rs:36, S — two reviewers). Rust pins 3.6 with a test asserting `!contract_ok("3.7")`; contract.ts:37 is "3.7" with the opposite test; Rust's verdict is the effective one (brain_view/prepare_brain_connect degrade to read-only). Latent until anything stamps 3.7 — then rotli silently opens it read-only while every doc claims support. Fix: bump + flip the test + a lockstep assertion so drift fails CI.
- **#42 with_file_lock fail-open** (memex.rs:99, S). Falls through and runs f() anyway after 10s, and the stale-reclaim TTL equals the max wait so a live >10s holder gets its lockfile deleted. This guards the Breve-shared inbox/memex.json read-modify-writes. Fix: return Err on non-acquisition; reclaim TTL well above max wait (30s/10s).
- **#43 aggregation triplicated** (corpus.rs:5255, S). The production corpus_list/corpus_search bodies are never executed by a test — the invariants are proven against `aggregate()`, a doc-commented hand-lockstep copy. Fix: `list_all`/`search_all` methods on CorpusRegistry, commands become lock-and-delegate, delete aggregate().
- **#44 organizer.json webview-writable** (corpus.rs:2786, S). One dot_file table serves read AND write, so corpus_settings_write("organizer", "{}") wipes the daemon's convergence hashes; "main" likewise bypasses ensure_main_committable. Fix: split read/write whitelists.
- **#67 unpinned error string** (corpus.rs:2090, S). fsNotes.ts:25 branches on `"note not found"` minted here; rewording it during the split breaks the TS graceful path. Fix: `pub const NOT_FOUND_PREFIX` + a Rust test + bidirectional comments.
- **#68 dead commands** (lib.rs:750, S). corpus_purge (the only hard delete), chat_complete, show_quick_window, memex_inspect, memex_list_dir: registered, zero TS callers. An exposed unreachable destructive command is the wrong default. Fix: unregister until wired; store methods and tests stay.
- **#69 duplicated helpers** (memex.rs:54, S). Two atomic_writes, three RFC3339 helpers, two now_ms, and memex.rs's shadow `fm()` scanner (first-20-lines, can false-match). Fix: extract `fsx.rs` + one time home during the #19 split; list_chats parses via the real codec.
- **#70 chat.rs zero tests** (chat.rs:130, S). read_models' silent fallback, flatten_messages (the daemon's transport prompt), wire_to_openai vision encoding — all pure, all unpinned. Fix: ~80 lines of fixture tests.

### TS app layer

- **#18 roving-list double bookkeeping** (Sidebar.tsx:1024, M). The visible tree is built twice — JSX (compactRows/renderFolderTree/renderMainTree) and RovingRow[] (visibleNoteRows/subtreeRows/mainRovingRows) — held together by literal "MUST mirror … exactly" comments; #45 is the live drift. Fix: one pure `buildVisibleTree()` returning render-ordered rows that feed both useRovingList and a renderRow switch. This is also the enabling step for #46.
- **#45 phantom `_` rows wedge j/k** (Sidebar.tsx:1045, S). renderFolderTree filters `vault:_*` folders; subtreeRows doesn't, so an expanded linked-library subtree puts rows in the j/k order with no DOM element — move() re-computes into the phantom every keypress and the cursor sticks. Fix: apply the identical filter in subtreeRows now; buildVisibleTree retires the class.
- **#46 Sidebar god-component** (Sidebar.tsx:471, L). 1725 lines, ~41 subscriptions. Chat section, Inbox stub, AddedRootRow, and the inline new-folder machinery extract today with zero threading; the big three (Main/Brain/Dest) are blocked only by the single rowProps closure. Fix sequence: buildVisibleTree → mechanical extractions → section components rendering slices; target ~300-line composer.
- **#47/#48 grammar copies** (livePreview.ts:61 / cmKeymap.ts:33, M each). Inline marks in four copies with proven drift (renderInline recurses, scanInline doesn't — `**a *b* c**` renders differently in chat vs editor); block prefixes in five sites (stripMarkdown strips `[-*+]`, everything else only `- `). Fix: one `src/editor/grammar.ts` token/classifier home; render/livePreview/stripMarkdown/commands derive from it; explicitly exempt services/derive.ts (Rust-lockstep port) with a comment so nobody "deduplicates" it. This is the deferred editor-grammar centralization, and #13 is its user-visible face.
- **#71 dead inbox plumbing** (Sidebar.tsx:476, S), **#72 per-render recompute** (Sidebar.tsx:899, M — mostly free with buildVisibleTree), **#73 SettingsSurface colocation** (SettingsSurface.tsx:1155, S — pure file moves), **#74 three drag machines** (Sidebar.tsx:649, M — extract `lib/pointerDrag.ts` before cross-section drag clones it a fourth time), **#75 FileSurface paneId lie** (FileSurface.tsx:141, S).

### State & seams

- **#17 invalidation storm** (hooks.ts:189, M). One keystroke pause = invalidateNotes → ~8 active per-folder keys → 8 identical full-corpus Rust walks reading every body, serialized behind the mutex, plus a blanket ["note"] refetch whose results the editor buffer discards. Fix: ONE `["corpus"]` query holding the raw payload; per-folder views derive via select/useMemo (the filtering is already pure TS); drop the ["note"] invalidation from the save path. The single biggest perf lever in the app.
- **#35 settings unknown-key destruction** (persist.ts:535, S). settingsSnapshot rebuilds the file from an exhaustive literal; a hand-set organizerThreshold (the daemon's documented knob, organizer.rs:54) is destroyed by the next theme toggle. Fix: round-trip unknown keys (`{...unknownKeys, ...snapshot}`).
- **#36 six parallel knob lists** (persist.ts:110, M). UiState / initializer / PersistedSettings / parseSettings / applySettings / settingsSnapshot; the blockHandles2 fresh-key hack is the scar tissue. Fix: one declarative knob registry driving all three functions — gives passthrough (#35's root) and per-key migration for free.
- **#34 viewstate drops two tab kinds** (persist.ts:366, S). validTab knows note/canvas/chat of five; open xlsx/Activity tabs vanish at relaunch and single-tab leaves collapse their split. Fix: accept file/activity, move the validator next to the Tab union, add a round-trip test per surfaceKind.
- **#33 board rename GCs its Main slot** (useNoteMenu.ts:101, M). Add-to-Main has no kind gate; board ids are paths; rename mints a new id, retargets tabs but not the manifest, and the next setTree gcManifest-prunes the committed slot — the exact silent-GC failure the useMainGcIds doc block says already burned once. Fix: renameMainRef alongside retargetBoard (or gate Add-to-Main to ULIDs), plus a mainTree test.
- **#37 ui.ts junk drawer** (ui.ts:112, L). Five knob domains, one store; quick-note mutations live in a different module the file apologizes for. Fix: split along the persistence boundary the knob registry creates — appearance / settings / transient; quick-note fields into quick.ts. Sequence after #36.
- **#38 contract mirror without fixtures** (contract.ts:315, M). Three implementations of the write-gate law synced by prose; both suites stay green when one side adds an AI key. Fix: one contract-vectors.json (+ the AI_KEYS list) loaded by both bun and Rust tests. Same medicine for the secret-guard mirror (#92).
- **#39 tauri.ts guard violations** (tauri.ts:586, M). Three byte-identical *Invoke helpers, and corpusFileNote/corpusNotePath/corpusFilerMove call bare invoke() against the file's own line-1 law. Fix: one `guardedInvoke` (fixes the three as a side effect), then split by domain with re-exports.
- **#76 wire-id parsing ×6** (destinations.ts:33, S — latent divergence only), **#77 "all" key collision** (hooks.ts:17, S — one-line sentinel disambiguation), **#78 un-GC'd persisted maps** (persist.ts:446, S — apply the in-file noteStyles precedent).

---

## UI-UX

**Shape.** The craft is real where it counts: every editor affordance resolves to a plain text transaction or a guarded write, srcdoc/CSP reasoning is careful, big files refuse honestly, the low-pulse law is genuinely enforced (Accessory policy, one Activity count, silent throttled updates), captures are unloseable via the ack protocol, and the copy quality — trust captions, secure-skip hint, Location lead — is above the app's weight class. Tab drag is the most complete gesture in the app, and the roving listbox, context-menu host, and Esc stack are properly built.

Three worries. First, **the hand-rolled partial grammar surfaces as user-visible bugs** — the fence scanner knows five languages so the slash menu's own code block gets H1-styled and table-widgetized (#13); this is the deferred grammar refactor presenting as defects. Second, **a small set of silent-content-loss defaults** sits below the Crepe/Novel bar the release claims: sheets die on ⌘Q (#4), beautified copy strips URLs (#49), links can never be followed (#14), and failures across canvas/chat/filing/rename go to console.warn (#11) in violation of the code's own stated convention. Third, **the read side is polished while the write side of organization has first-week holes**: no move-to-folder (#15), no rename for Main folders/corpus folders/chats (#16, #57), captures vanish when curated with no explanation and no gestures where they live (#56) — and the useNotes-view vs useSearchableNotes-universe split keeps producing disagreeing counts (#60) and the palette's forgot-to-branch bug (#55). The shell adds two trust-surface gaps (blind approvals #62, reading-requires-applying #61) and the onboarding/location collision (#12), which is the most user-hostile thing shipping today.

### Editor & viewers

- **#13 generic fences** (fences.ts:44, M). scanFences returns only TARGET_LANGS; livePreview styles code as markdown and scanTables (zero fence awareness) turns a pipe-table example inside ANY fence into a live widget whose chips rewrite the user's code. SlashMenu ships the repro. Fix: return all closed fences with a target flag; livePreview and tableRender skip every fenced range; mono-voice styling for non-target fences; test with `# h` + a pipe table in a plain fence.
- **#14 links never open** (livePreview.ts:69, M). Accent+underline promises clickability; render.tsx stopLink preventDefaults; no opener command exists in TS, Rust, or Cargo.toml. Fix: ⌘-click + context "Open link" through a scheme-allowlisted Rust opener; plain click stays the edit path.
- **#4 sheet loss on quit** (SheetEditor.tsx:59, M). dirtySessions is a JS Map parked across tab switches — the UI teaches "your edits are safe" — and ⌘Q kills the process with no flush, prompt, or draft (notes flush; sheets don't). Fix: quit interception prompt or a .rotli sidecar draft.
- **#49 clipboard stripping** (CmEditor.tsx:298, S). Default-mode copy pipes through stripMarkdown; URLs are content, not styling. Fix: markdown on the clipboard by default; stripped output behind explicit "Copy as plain text"; at minimum `text (url)`.
- **#50 table twin misalignment** (tableRender.ts:405, M). Above/below halves are independent auto-layout tables; column edges jump on every caret move. Fix: shared ch-based colgroup computed from the full (already space-padded) source.
- **#51 block drag limits** (blockHandles.ts:126, M). Insert-before-only (no after-last slot) and no edge auto-scroll — cross-viewport reorders are impossible. Fix: synthesized end-of-doc target + the standard 20px hot-zone scroll loop.
- **#52 Aa panel honesty** (AaPanel.tsx:133, S). View/Blocks write global state under a "saved for this note" footnote; the related metadata-banner toggle lives in Settings. Fix: label the global rows or make them per-note; fold "File metadata" in as a third View option.
- **#53 unexplained read-only sheets** (FileSurface.tsx:368, S). .ods/.xls/oversize/failed-stat all fall silently to the read-only table though line 225 knows the reason. Fix: reason-bearing chip; visible fx glyph on formula cells.
- **#54 PDF hole** (FileSurface.tsx:437, M). Bare iframe: no pages/zoom/search/focus while every sibling viewer got real affordances this release. Fix now: focus treatment + header parity. The pdf.js viewer is deferred (see fix plan).
- **#79 .bak mystery files** (corpus.rs:1652, S — badge or fold under the original, map kind to the real extension), **#80 no checkerboard** (memex.css:508, S — theme-aware conic-gradient behind .file-image only), **#97 fm-banner destroy path** (fmBlock.ts:90, S, PLAUSIBLE — realistic triggers blur first; accepted for now, see fix plan).

### Sidebar & navigation

- **#5 ⌘N into the sink** (createNote.ts:30, S). routeDecision has no isHidden/isSink guard; a note is born trashed — excluded from All notes and search — and the Sidebar comment claiming newNote has guards is docs-drift inside the code. Fix: isHidden branch → localFallback/staging, unit test, fix the comment.
- **#15 no move-to-folder** (useNoteMenu.ts:84, M). moveNote exists (backed by corpus_move) but only archive/trash/restore call it; the drag hit-tests only Main. Users can create folders they can never put existing notes into. Fix: "Move to…" drill in useNoteMenu (contextMenu.ts already names it as the intended example); later extend the drag hit-test to folder rows.
- **#16 Main folders unnameable** (Sidebar.tsx:1605, M). The flagship "arranged your way" section accumulates permanent "New folder 2" rows from the first click of its only creation affordance — no rename mutation exists in mainTree.ts at all. Fix: name-first inline input on ⊕ + renameFolderInMain + context Rename.
- **#55 palette board routing** (Palette.tsx:113, S). openNote unconditionally; boards pass the searchable filter. Verification refuted the corruption claim (boards aren't in the ulid index — the pane opens dead, the file is safe), but the routing bug is real. Fix: openSummary(n, {newTab}) — summaries already carry kind.
- **#56 captures vanish** (BoardSurface.tsx:30, M). Star/Add-to-Main filters a card out instantly with no toast/copy, Quick access has no sidebar home, and the cards have no context menu — the graduating gestures are absent from the one place captures live. Fix: wire useNoteMenu onto cards + one line of footer copy.
- **#57 dead right-click** (Sidebar.tsx:1526, M). Chats and corpus folders have zero actions while the aside-level preventDefault suppresses even the native menu — a dead gesture in the release that made right-click the headline. Fix: minimal chat menu (Open in new tab now; rename/delete when backend lands) + folder menu (New note here / New folder inside).
- **#58 j/k skips visible rows** (Sidebar.tsx:1569, M). Captures, Brain Activity, added roots sit between roving rows with default tabIndex — the cursor visibly hops them and Activity is keyboard-unreachable. Fix: 'action' row kind + tabIndex={-1} on non-roving buttons.
- **#59 drag without feedback** (Sidebar.tsx:674, S). Ghost on every note row; only [data-main-id] accepts; drops on folders silently discard. Fix: no-drop ghost state; folder targets once #15 lands.
- **#60 disagreeing counts** (Sidebar.tsx:1565, S). Sidebar counts useNotes() (excludes staged), the surface counts useSearchableNotes — one ⌥C makes them disagree; Recent shows a meaningless total. Fix: one universe for both numbers; drop Recent's count.
- **#81 middle-click close** (TabStrip.tsx:172, S), **#82 empty-state references absent Brain** (Sidebar.tsx:1612, S — branch on hasBrain), **#83 collapse-all expands Main** (ui.ts:417, S — write explicit false for Main ids).

### Shell surfaces

- **#12 onboarding/location collision** (Onboarding.tsx:269, M). Deliberate 0.x re-onboarding + a required, never-pre-seeded location step = every release forces re-asserting where your notes live, with corpus_choose_folder's empty-folder branch silently RELOCATING the corpus behind the "wrong" answer. Fix: pre-seed a selected "Keep using <path>" card from corpusOverview, or require the step only on true first-run.
- **#11 console.warn failures** (CanvasSurface.tsx:122 + ChatSurface.tsx:258, useNoteMenu.ts:127, MetaPanel.tsx:73/95, Sidebar.tsx:1231, M). Violates the app's own EditorSurface.tsx:88 rule on exactly the surfaces where silence costs work — a failed board write is the closest thing to shell data loss. Fix: inline error notes at the failure site (the ActivitySurface/LocationPane pattern); no toasts needed.
- **#6 ⌥Q dead by Settings pick** (SettingsSurface.tsx:429, S). folderOpts offers curated wiki areas by bare last-segment name; Rust create refuses wiki/**; QuickNote.newNote has no .catch — the global hotkey breaks permanently and silently. Fix: exclude wiki/** and chats/ from folderOpts + surface the rejection in the quick window.
- **#7 web-ON leak** (ChatSurface.tsx:160, S — two reviewers). All unsaved chats share persisted chatWeb[""], never cleared after slug binding — one globe click flips the silent-egress default for every future fresh chat across relaunches. Fix: key unsaved chats by paneId (or clear "" on bind); exclude "" from persistence.
- **#61 trust ladder** (SettingsSurface.tsx:1079, S). Captions render for the selected rung only and selecting IS granting; reading "Organize" means granting auto-apply. Fix: four always-visible choice cards (the onboarding pattern) + a quiet not-a-memex gate note.
- **#62 blind approvals** (ActivitySurface.tsx:32, M). Field proposals approved without the proposed value; index rows without the diff the journal deliberately carries for that purpose; model never surfaced. Fix: truncated value on field rows; expandable before/after on index rows; muted model suffix.
- **#63 invisible 5-star cap** (quick.ts:58, S), **#64 "Brain" ×3 meanings** (SettingsSurface.tsx:71, M — rename the daemon pane "Organizer" or merge it into Location), **#84 identical Approve/Dismiss + bare %** (ActivitySurface.tsx:140, S), **#85 eternal "Running a pass…"** (SettingsSurface.tsx:1108, S — poll useOrganizerStatus + err class), **#86 hardcoded chords** (SettingsSurface.tsx:460, S — resolveChord/formatChord are already imported in the same file), **#87 slug-as-title header** (ChatSurface.tsx:280, S).

---

## AI

**Shape.** The daemon is the best-engineered feature in the app: plan_wait is a pure, table-tested energy law (parked condvar, zero idle wakeups), the secure/locked rules are enforced structurally (in-memory snapshots, secure peers stripped from haystacks and index renders, secure vetoing auto-apply at every rung), the trust ladder matches §4.3 verbatim with a table test, and every write rides the same v3.7 Filer primitives — no second lane. The chat loop has a clean host seam, scripted-model tests, tolerant parsing, per-model budgets, and deliberate TS+Rust defense-in-depth on secret egress. The two-lane contract's core gates are real, disjoint, and tested, with traversal defended in depth.

Three worries. First, **load-bearing invariants live in comments, not code**: "local model ⇒ secure allowed" is a hardcoded `true` against a registry other tools write (#2), the vision flag gates the composer while the transport drops the bytes (#8), and every transport call synchronously holds the main thread (#10). Second, **half-finished lifecycles in the daemon**: the convergence machinery that makes re-runs safe is exactly what persists a failed apply as "done" (#25); index rows lack supersede and freshness grammar (#26); every approval freezes a field the ladder says the daemon should keep maintaining (#28); the never-clobber TOCTOU is closed for `locked` but open for field values (#27). Third, **guarantees decay at the edges of the contract**: the gitignore promise is point-in-time (#1 — the one critical), perms and band are TS-only (#3), memex_* commands trust a webview root (#20), the user-lane set_field falsifies the disjoint-territories claim (#22), and contract.ts documents the opposite of the shipped secure policy (#31) in the very file re-syncs are made from. The closed verb set (add/move/annotate, no delete, no body writes) genuinely holds everywhere traced — none of this is data loss today.

### Contract & lanes

- **#1 stale gitignore (CRITICAL)** (corpus.rs:2232, S). gitignore_add fires only at flag time; relocate() (behind move_note/file_note/filer_move/undo) and write()'s title-rename change the rel and never sync it. Merely retitling a secure note — or filing it, which filer_writable permits — makes the secret committable, and Seth's vault holds live SSN/CC data. Fix: in relocate() and the rename branch, on secure+rel-change do gitignore_remove(old)+add(new); test flag→file_note→assert.
- **#3 TS-only perms** (corpus.rs:1988, M). startup_roots drops ConnectedBrain.perms; writable()/filer_writable never see "read-only" or the band — the editor save path writes into a user-set read-only brain today. Fix: carry perms + band verdict into CorpusStore at open; two gate lines.
- **#2 unenforced locality** (host.ts:40, S — two reviewers, same root). corpusReadAi(id, true) hardcoded; chat.rs posts to whatever endpoint registry.json declares, Bearer key attached; read_for_ai's model_is_local is a webview-supplied trust bit. All-localhost today — latent, but the gate the design hangs on doesn't exist. Fix: derive locality from the picked model's endpoint (loopback check) in Rust, drop the IPC parameter.
- **#21 flag-not-detector** (corpus.rs:1915, S). The auto-flag runs only in read_frontmatter; a never-panel-opened note with detectable secrets is served with model_is_local=false unobjected. Fix: run looks_secure in read_for_ai when the flag is absent.
- **#22 set_field ungated** (corpus.rs:1750, S — two reviewers). Refuses only RESERVED_KEYS: no AI_KEYS refusal, no writable(), no suppress.mark — the registered command can write `area`/`filed_by` on curated read-only wiki. Dormant (no UI caller), which is exactly when a hard guard must hold. Fix: writable() + AI_KEYS refusal + suppress.mark + the missing lane test; document set_locked/set_secure/auto-flag as sanctioned exceptions or gate them.
- **#20 webview-supplied roots** (memex.rs:645, M). memex_read(root:"/") reads any file; memex_write_chat can plant chats/ inside curated wiki — contradicting the module's own "regardless of what the frontend sends" doc. Fix: route by registered instance id like corpus_* does.
- **#31 inverted doc** (contract.ts:356, S). mayFile's comment says secure notes are "still classified on-device"; the daemon's constraint #1 and shipped Skip::Secure say never-any-model. A re-sync from contract.ts would reintroduce the project's brightest-line violation. Fix: one comment.
- **#23 unseparated PANs** (guard.ts:19 + secret.rs:32, S). "4242424242424242" and dash-less SSNs pass both egress guards — the exact shapes in the migrated notes. Fix: `\b\d{15,16}\b` Luhn-checked, both sides together per the mirror discipline; #92's shared fixture makes the mirror mechanical.
- **#95 phantom tier** (contract.ts:48, S) and **#96 writer-less inbox.md allowance** (memex.rs:12, S): contract surface that can only rot — rewrite/narrow to Phase-3 reality (see fix plan for what we deliberately don't build).

### Daemon

- **#25 stranded captures** (organizer.rs:1230, M). ns.hash/ns.area mutate before the fallible writes; any later dot_write in the cycle persists the poisoned entry — classify-covered, no journal row, invisible in Activity, unrescuable by sweep (the error-path comment claiming otherwise is wrong). Note stays visible in Captures and manually filable, hence medium. Fix: mutate NoteState only after writes succeed; add the forced-failure test.
- **#26 index-row lifecycle** (organizer.rs:1536, M). No supersede handle, no approve-time before-check (file and field branches both have one) — zombies inflate the badge and a stale approve overwrites `_index.md` until membership next changes. Fix: `proposed_row` on AreaState + the same freshness grammar in brainJournal's index branch.
- **#27 field-value TOCTOU** (organizer.rs:1397, S). Only the body hash is re-checked in the write window; a frontmatter-only user edit during the 45s call is clobbered. Fix: re-derive fields from the `fresh` text already in hand.
- **#28 approval freezes fields** (brainJournal.ts:170, M). lastFields never learns approved values, so field_eligible marks them user-owned forever — the trust ladder inverted: cooperation reduces maintenance. Fix: record approved values as daemon-owned (small Rust command or applied-with-model journal rows as baseline).
- **#29 run-now dropped** (organizer.rs:1804, S — swap after gates pass) and **#88 Wait::For lost-wakeup** (organizer.rs:1788, S — re-check run_now/sweep_at under the lock like Park does; bounded 15-min worst case).
- **#30 reach: unimplemented** (organizer.rs:551, M). §4.2.6 promises intersection; `reach` appears nowhere — reach-scoped titles/summaries land in the committed `_index.md`. Decision, not just fix: see plan (doc amendment now, implementation deferred).
- **#89 offline conflation** (organizer.rs:39, S — accepted for now), **#90 filed_by parity on approve** (brainJournal.ts:158, S), **#91 2× full-wiki reads per cycle** (organizer.rs:745, M — (rel, mtime)-keyed peer/secure cache; the watcher already reports changes).

### Chat loop

- **#8 vision drops the image** (chat.rs:279, S). messages_generate never forwards WireMsg.images; the mlx server routes to the vlm sidecar only when the body carries them — the composer's only vision model confidently answers about an image it never saw, and this never worked (verified at v0.9.0 too). Fix: collect images into the generate body; consider re-attaching at force-final.
- **#9 retrieval lag** (host.ts:34, S). searchNotes = corpusList + rankNotes over 140-char snippets (and a `/[^a-z0-9]+/` tokenizer that zeroes non-ASCII queries), while full-text corpus_search shipped in this very anchor commit and is already exposed. Fix: rewire Host.searchNotes to corpusSearch; keep rankNotes as the browser fallback.
- **#10 sync transport** (chat.rs:225, M). Zero async commands in the crate; every agent step queues autosave, corpus_list, Quick Note capture, and tray handling behind a blocking ureq call — the opposite of low-pulse. Fix: `#[tauri::command(async)]` + spawn_blocking; no frontend change (invoke is awaited). This also unblocks real cancellation (#66).
- **#65 unbounded history** (prompt.ts:24, S — add maxHistoryChars to Budget, trim/summarize oldest), **#66 no Stop, dropped tool events** (ChatSurface.tsx:218, M — AbortSignal into runAgent, Stop while busy, render the already-yielded tool args), **#93 futile steps don't strike** (loop.ts:93, S), **#94 "⚠" sentinel loses the user's message** (ChatSurface.tsx:227, M — typed error event, persist the user turn retriable, stop persisting "(returned nothing)"), **#92 guard-mirror fixture** (loop.test.ts:163, S).

---

## Recommended fix plan

**Batch 1 — Security & secrets (~1–2 days, all S except #20/#3).** Land before anything else; several are armed against the real vault. #1 gitignore sync in relocate/rename + test · #2 endpoint-derived locality (TS + Rust backstop) · #21 detector in read_for_ai · #23 unseparated PAN/SSN both sides · #22 set_field gates · #44 organizer.json write refusal · #42 with_file_lock fail-closed · #24 band bump to 3.7 + lockstep test · #20 memex_* root validation · #3 perms/band into the Rust gates · #31 fix the inverted contract.ts comment · #68 unregister corpus_purge & friends. All small, disjoint seams; Rust suite pins each.

**Batch 2 — Data-safety & correctness quick wins (~2–3 days, mostly S).** #4 sheet quit guard · #5 ⌘N sink guard · #6 folderOpts + QuickNote .catch · #7 chatWeb "" clear/paneId-key · #8 vision images · #9 searchNotes rewire · #34 viewstate file/activity tabs · #35 settings unknown-key passthrough · #33 Main-ref retarget on board rename · #55 palette openSummary · #45 phantom-row filter · #27 enrich freshness · #29 run-now restore · #25 state-mutation ordering · #26 index supersede/freshness · #28 lastFields teach · #65 history cap · #90/#93 and the S-effort lows (#60, #77, #78, #83, #86, #87).

**Batch 3 — Performance (~1 week, M).** In dependency order: #17 single `["corpus"]` query (the big lever, and it shrinks #72 for free) → #41 mtime-keyed NoteMeta cache + single-pass search → #40 per-root locks → #32 O_APPEND journal + compaction → #10 async transport commands (also unblocks #66's Stop button) → #91 daemon peer cache. Each is measurable; do them against a memex-vault-sized corpus.

**Batch 4 — UX debt (~1–2 weeks, M).** The write-side organization holes first: #15 Move to… · #16 Main folder rename · #57 chat/folder context menus · #11 inline error surfacing · #12 onboarding "keep current location" · #56 capture-card menus + vanish copy. Then trust surfaces: #62 proposal values/diffs · #61 trust cards · #84/#85 Activity polish. Then editor: #14 link opener · #13 all-fences scanning (interim fix; grammar.ts finishes it) · #49 clipboard markdown · #50 shared column widths · #51 drag end-slot + autoscroll · #52/#53 honesty labels · #58/#59 roving/drag feedback · #63/#64/#79/#80/#81/#82 small polish · #66/#94 chat run UX.

**Batch 5 — The mega-refactors (sequenced last, L).** (a) `buildVisibleTree` → retires #18/#45 structurally, then the Sidebar split #46 (+ #71/#72/#74 fall out; extract `lib/pointerDrag.ts` before cross-section drag ships). (b) `src/editor/grammar.ts` → retires #47/#48 and completes #13; decide the nesting question once; exempt derive.ts explicitly. (c) corpus.rs split (#19) → carries #69/#67/#43/#70 with it. (d) Knob registry #36 → then the ui.ts split #37. (e) `guardedInvoke` + tauri.ts domain split #39, WireId module #76. (f) Shared fixtures for the contract (#38) and secret-guard (#92) mirrors — cheap, permanent, and they convert this report's biggest theme (mirror drift) from a review problem into a CI failure. (g) SettingsSurface file moves #73 before the Phase-5 Brain panel grows it.

**Explicitly not fixing (accepted tradeoffs).**
- **#97 fm-banner destroy path** (PLAUSIBLE) — the realistic triggers blur (and therefore commit) first; the residual window is global-hotkey switches while the banner is focused. Accept until a real report; revisit if the banner gains more entry points.
- **#30 reach: implementation** — don't build the intersection now; amend docs/design/main-brain-daemon.md to mark §4.2.6 (and the §6.3 battery knob, §4.8 checkboxes) as Phase-5 deferrals so the shipped safety story is honest. The doc edit is the fix.
- **#89 45s offline conflation** — bounded backoff that self-corrects; accept until the transport goes async (Batch 3), which changes the timeout economics anyway.
- **#54 full PDF viewer** — do the S focus/header fix in Batch 4; the pdf.js viewer is a feature project, not audit debt.
- **#95 Filer perms tier / #96 inbox.md allowance** — don't build the tier or the writer; rewrite the comment and narrow the gates+docs to Phase-3 reality. Building either would add contract surface the product hasn't asked for.
- **#37 ui.ts split timing** — deliberately sequenced AFTER the knob registry (#36); splitting first would be churn the registry re-does.
