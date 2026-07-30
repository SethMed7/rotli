# Performance audit — 2026-07-30

Multi-model performance audit of rotli v0.45.0 (clean tree, post-release).
Scope: async/await discipline, useEffect/render behavior, imports, dead code,
speed, bundle size. Audit-only deliverable — no code changed.

**Method.** Six isolated perspectives, each auditing one lane, then
deduplicated here (same finding from multiple models = one entry; convergence
is confidence):

| Perspective | Model / tool | Lane | Status |
| --- | --- | --- | --- |
| opus5-async-ipc | Claude Opus 5 | async, main-thread, IPC | complete |
| sonnet-react | Claude Sonnet | React, useEffect, render | complete |
| fable-imports-bundle | Claude Fable | imports, dead code, bundle | complete (build ground truth measured) |
| opus48-cli | Claude Opus 4.8 (CLI) | independent full pass | complete (verified `corpus_search` at source) |
| agy-gemini | Antigravity/Gemini CLI | async only | degraded — timed out twice on full scope; narrow-scope retry only |
| codex | Codex CLI | independent full pass | **pending** — its captured mid-run conclusion converged on the invalidation-fanout root cause |

## Executive summary

Two structural root causes account for most user-felt slowness; one bundle
headline accounts for most startup weight.

**A. 100 of 105 Tauri commands are sync (`pub fn`) → main-thread execution.**
In Tauri v2 a non-`async` command runs on the main thread. `spawn_blocking`
exists in only 4 places (`chat.rs:269`, `localmodel.rs:259`,
`provider.rs:466/651/703`). Consequences: `Promise.all` over sync commands
buys **zero** parallelism (N invokes serialize on the main thread), and every
full-vault walk, blocking `ureq` network call (`web.rs:38,200` — up to 20s
timeout ×3 redirect hops), and subprocess spawn (`textutil`, `bun validate`,
30s email test) freezes the window for its full duration.

**B. Broad `invalidateNotes()` per 400ms typing tick fans into ~9 full-vault
walks.** The editor sync debounce (`src/editor/model.ts:100`,
`SYNC_DEBOUNCE_MS=400` line 14) invalidates the whole
`["notes"]`/`["note"]`/tasks namespaces (`src/services/hooks.ts:216-221`).
With global `staleTime: Infinity` (`src/services/query.ts:11`), invalidation
is the only refetch gate, and `FsNotesService.listNotes(folderId)`
(`src/services/fsNotes.ts:59-60`) always calls the **uncached** full-walk
`corpus_list` (`corpus.rs:3308` → `walk()` 4643) then filters in JS.
`useNoteUniverse` (`hooks.ts:106-115`) alone is 6 walks; + `useNotes` +
`useFolders` + `useTasks` (2× walk) ≈ 9 walk-equivalents, serialized on the
main thread (root cause A). Measured: 350 notes ≈ 10-20ms per walk warm →
100-180ms frozen per save; cold 5-20×. Every downstream consumer
(TabStrip, wikilink decorations, note lists) re-derives per tick.

**Bundle headline.** 12 quokka SVGs inlined `?raw` into the entry chunk =
~450 KB = **29% of startup JS** (`character.tsx:27-38`); katex is bundled
**twice** (2× 260 KB identical chunks — `blockRender.ts:91` vs mermaid.core);
~5 MB of shipped JS is prunable dictionaries (Univer hyphenation dicts +
Excalidraw locales). Ground truth: 245 chunks, 22.1 MB total JS, entry
1.57 MB (469 KB gz). Lazy discipline is otherwise genuinely good.

## Ranked findings

| # | Sev | Finding | Evidence | Found by |
| --- | --- | --- | --- | --- |
| 1 | HIGH | `invalidateNotes` × uncached `corpus_list` = ~9 main-thread full-vault walks per 400ms typing tick | `model.ts:100` · `hooks.ts:106-115,216-221` · `fsNotes.ts:59-60` · `corpus.rs:3308,4643,4702-4726` | Opus 5 · Sonnet · Opus 4.8 · Codex (mid-run) |
| 2 | HIGH | Sync command surface: 100/105 commands run on the main thread; `Promise.all` zero-parallel | `spawn_blocking` only in chat.rs/localmodel.rs/provider.rs | Opus 5 · Opus 4.8 |
| 3 | HIGH | `web_fetch`/`web_search` sync blocking `ureq`: 20s timeout ×3 redirect hops, each re-running `vetted_resolve`; search = 2 sequential 10s fetches; fired per agent tool call | `web.rs:38,200,244,256` | Opus 5 · Opus 4.8 |
| 4 | HIGH | AI permission probe reads the whole corpus before the FIRST token of every `runAgent`: `knowledgeMap` feeds unfiltered `corpusList` → `aiReadableHits` does ~350 full reads over serialized IPC to build a map truncated to 1200-6000 chars | `host.ts:67-79,282-289` · `loop.ts:40-46` · `budget.ts:68-109` | Opus 5 |
| 5 | HIGH | `corpus_search` + `corpus_tasks` each DOUBLE full-vault walk (list() then re-read+parse every body), sync, under the corpus mutex; `useTasks` mounted in sidebar re-derives per invalidation; ⌘K hitches per settled keystroke | `corpus.rs:3343,3360,3405,3417,5082` · `sidebar.tsx:342` · `hooks.ts:220` | Opus 5 · Opus 4.8 (verified at source) |
| 6 | HIGH | 450 KB inlined `?raw` SVGs = 29% of startup JS | `character.tsx:27-38`; worst: excalidraw_board 92 KB, notes 57, ai_chat 57 | Fable |
| 7 | HIGH | katex bundled twice (2× 260 KB) + double-load at runtime | `blockRender.ts:91` vs mermaid.core; fix = `resolve.dedupe` | Fable |
| 8 | HIGH | Editor keystroke path: `EditorSurface` re-renders every keystroke with 4 full-document string passes (`doc.toString()` + `split("\n")` + `join("\n")` + word-count regex, word count used only in focus mode); CmEditor not memo'd | `editorSurface.tsx:111-115,237-239,345-349` · `cmEditor.tsx:485` · `model.ts:78` | Sonnet · Opus 4.8 |
| 9 | HIGH | CmEditor wikilink effect force-dispatches a no-op CM transaction per sync cycle → whole-doc wikilink decoration recompute every 400ms while typing | `cmEditor.tsx:215-229` | Sonnet |
| 10 | MED-HIGH | Chat re-parses the entire transcript's markdown on every composer keystroke and every stream tick (controlled textarea in `ChatSurface`; `renderMessage` per assistant message, no memo) | `chatSurface.tsx:558,675,1107-1112,1217` | Opus 4.8 |
| 11 | MED | TabStrip rebuilds an O(all-notes) title Map per invalidation × per pane; unmemoized tab rows re-render every 400ms while typing | `tabStrip.tsx:91-96,218` | Sonnet · Opus 4.8 |
| 12 | MED | Note list re-sorts the whole corpus per search keystroke (`q` in memo deps though sort ignores it); `NoteListRow` unmemo'd with fresh inline props | `noteListSurface.tsx:49-58,119-131` · `noteListRow.tsx:11` | Sonnet · Opus 4.8 |
| 13 | MED | Launch hydration: `hydrateMain`/`hydrateViews` awaited serially though independent; `gcPersistedMaps` serial `listChats` loop; corpus walked 3-4× per launch; `main.tsx:24` awaits before first render = blank-window time | `persist.ts:609,686-704,746-758` · `app.tsx:308` | Opus 5 · Opus 4.8 · Antigravity |
| 14 | MED | Sync commands spawning subprocess/network on main thread: `corpus_convert_document` (textutil ≤32 MB, multi-sec) · `memex_validate` (bun, unbounded) · `breve_test_email` (ureq 30s) · `breve_test_signal` (unbounded) · `system_profile` · `local_model_install_progress` (GB-scale dir walk) | `corpus.rs:5332` · `memex.rs:942` · `breve.rs:1049,1083` · `localmodel.rs:226,351,94-108` | Opus 5 |
| 15 | MED | 750ms IPC poll (`workspaceTakeOpenRequest`) for app lifetime, ~115k calls/day; Rust already emits 6 events | `app.tsx:214-238` | Opus 5 |
| 16 | MED | Deleting/archiving an image note runs K **serial** full-corpus searches (K × finding-5 cost) | `noteLifecycle.ts:53-59,71,79` | Opus 4.8 |
| 17 | MED | Univer Docs ≈ 8.1 MB = 37% of shipped JS, mostly hyphenation dictionaries; Excalidraw i18n ~68 locale chunks > 1 MB; ~5 MB prunable via aliases | univerTheme chunk 3.49 MB + 77 dependents 4.58 MB | Fable |
| 18 | MED | Eager startup surfaces that could `lazy()`: SettingsSurface (46 KB), BreveSurface (33 KB), Onboarding (14 KB); Excalidraw CSS imported top-level though its JS is lazy | `app.tsx:13,17,23` · notesSurface | Fable · Opus 4.8 |
| 19 | MED | System browser marquee: `setSelection` per pointer-move re-renders and re-sorts every expanded folder's contents (only depth-0 memoized) | `systemSurface.tsx:217,431-459,475-479` | Opus 4.8 |
| 20 | MED | Watchlist serializes the whole document to markdown per render just to derive `dirty` (breve-watchlist-ux branch) | `breveWatchlist.tsx:154-155` | Opus 4.8 |
| 21 | LOW | Sequential awaits of independent IPC: `invalidateNotes`/`invalidateJournal`/`invalidateBoth` internals; `searchMemory` (notes search vs chat memory, +100-300ms); `readNote` (`corpusReadAi` + `corpusFrontmatter`) | `hooks.ts:217-220,229-231,270-274` · `host.ts:147-150,186-200` | Antigravity |
| 22 | LOW | `onQuitFlush` never unregisters — one closure leaked per board opened/switched, pins dead scenes, quit fans over all | `canvasSurface.tsx:139-142` · `quitFlush.ts:20-26` | Opus 5 · Sonnet |
| 23 | LOW | Poll debt: 3× 60s polls exist only because `staleTime: Infinity` (brain-journal event already listened); 1 Hz install-progress poll duplicated in two surfaces, each tick a GB dir walk | `hooks.ts:247-262` · `app.tsx:242-249` · `settingsSurface.tsx:1357-1363` · `onboarding.tsx:383-388` | Opus 5 |
| 24 | LOW | Minor render debt: ModelsPane catalog merge + HotkeysPane grouping per keystroke; breveSurface 2× `JSON.stringify` dirty-checks per keystroke ×3 views; `filterSlashItems` + 5× `new Compartment()` per render in the hottest path | `settingsSurface.tsx:~288-295,~1907-1914` · `breveSurface.tsx:414,674,1136-1137` · `cmEditor.tsx:171-175,615` | Sonnet |
| 25 | LOW | Dead code: 4 zero-reference exports (~50 LOC: `corpusNewFileBytes`, `corpusSetField` in `lib/tauri.ts:694,771`; `useFocusedBoardId` `state/panes.ts:1026`; `createBlankDocxBase64` `documents/create.ts:113`); ~370+ orphaned CSS lines (memex.css 41 selectors, command.css 14, quick.css 7 — verify notes.css, some may be classList drag states); `@resvg/resvg-js` devDependency has zero imports; `endpointIsLocal` written twice (`ai/guard.ts:88-103` vs `breve-runtime/scripts/config.ts:57-65` — security-relevant, undocumented mirror) | see refs | Fable |
| 26 | LOW | `app.tsx` drag-drop listener: `unlisten` resolved async, cleanup may skip it on fast unmount → listener leak | `app.tsx:289-302` | Antigravity |
| 27 | LOW | `memex_list_chats` reads full transcripts for frontmatter — fine at 6 files, scales badly | `memex.rs:541` | Opus 5 |

### Detail on the top cluster (findings 1/2/5)

`corpus_list` does `read_to_string` + `parse_document` + title/snippet/aliases/
stamps per .md (`corpus.rs:4702-4726`). TanStack dedupes by key, not fn, so
`useQueries` over 6 folderIds is 6 distinct walks. The trigger set is
`invalidateNotes` at ~21 call sites, dominated by the editor's 400ms sync
tick. The single highest-leverage fix: make `corpus_list` async and memoize it
against the fs-watcher generation (watcher already debounces 300ms,
`corpus.rs:4806-4856`); share one in-flight promise in `listNotes`. That
collapses finding 1 and most of 5, and Sonnet's findings 9/11/12 shrink to
noise once identities stop churning.

## Correctness-adjacent findings (data safety, not just perf)

These surfaced during the perf passes but are loss-of-data risks. Track them
separately from the perf backlog.

1. **Silent editor save failures** — `model.ts:102-109` handles only "unknown
   note"; every other rejection is swallowed; the only signal is a muted dirty
   dot. Read-only volume / permissions / disk-full = typed content lost at
   quit. (Opus 5)
2. **`embedSheet` quit-flush + dual-writer gaps** — `embedSheet.tsx:75-89`
   never registers `registerLiveDirty`/`setParked` → invisible to
   `flushDirtySheets` and `onQuitFlush`, so ⌘Q within the 500ms window loses
   edits; failures `.catch(()=>{})` silent; no `tabOpen` guard (unlike
   `embedBoard.tsx:96`) → embed + SheetEditor pane = two uncoordinated writers
   to `corpusWriteFileBytes`, last-completion-wins. (Opus 5)
3. **`main.json` write races** — `state/main.ts:36-49` fires
   `void write.catch(console.warn)` with no sequence guard; callers fire
   `setTree` back-to-back (`useNoteMenu.ts:370-512`, `mainAddDrag.ts:41`,
   `draftComposition.ts:67/83`, `newItems/composition.ts:127-193`).
   Last-completed wins ≠ last-called → lost Main arrangement.
   `views.ts:24,36-46` has the correct `writeSequence` + `saveState` pattern
   to copy. (Opus 5 · Opus 4.8 — independently converged)
4. **Persist marks settings written before the write lands** —
   `persist.ts:853-866` assigns `lastSettings` pre-write and `allSettled`
   swallows failures → one transient failure means the payload is never
   retried; theme/keys/panes revert at next launch. (Opus 5)
5. **boardSurface multi-select clobber** — reveal effect
   (`boardSurface.tsx:36-40,52-62`) has overbroad deps: any app-wide
   `mainTree`/`quickIds` change re-fires it and resets multi-select to
   `new Set([focusedNoteId])` while a Board is open. (Sonnet)

Related lows: async block renderers swallow rejections so a broken mermaid
renders blank ≡ loading (`blockRender.ts:441-453,748-758`;
`mermaidWorkspace.tsx:145-153` is the correct shape); finding 26's listener
race.

## Verified clean — do not re-audit

Union of the perspectives' clean lists:

- **State/render:** zustand selector discipline (per-field selectors, zero
  whole-store subs) · CM `EditorView` lifecycle (`[noteId,paneId]` gated +
  teardown) · FormatBar/AaPanel/Slash stores · CanvasSurface (theme-only sub,
  keyed, 500ms batched saves) · `UpdatedAt` isolates its 30s tick in a leaf ·
  activity/tasks/allChats/notes/mermaid surfaces + embedHosts · all `app.tsx`
  effects have correct deps + cleanup (modulo finding 26).
- **Async/IPC:** search debounce (`hooks.ts:201-210` + gates, 180ms) ·
  persist saver shape (debounce, payload dedup, `allSettled`, flush on
  `visibilitychange`/`pagehide`, awaited quit flush — modulo
  correctness-item 4) · board save coalescing (`canvasSurface.tsx:144-169`) ·
  chat-folder RMW (`sidebar.tsx:412-429`) · fs watcher 300ms debounce ·
  `organizer_run_once` condvar · CLI/provider detect on `spawn_blocking` ·
  rAF resize handling · codeHighlight parallel loads.
- **Bundle/deps:** heavy engines all lazy + build-budget-guarded
  (`vite.config.ts:36`): mermaid, katex, jsxgraph, Excalidraw JS, Univer,
  exceljs, jszip, docx, 20+ CM language modes · all 40 runtime deps verified
  imported (`imapflow`/`kokoro-js` are Node-only breve-runtime deps, correctly
  outside the app graph) · import-type discipline (one exception:
  `univerTheme.ts` `defaultTheme` value-import fuses the theme chunk) ·
  `cargo check`: zero warnings.
- **Policy:** `staleTime: Infinity` is the right model for a local-first app —
  the fix is scoping invalidation, not changing the policy · `useBreveSnapshot`
  15s poll correct.

(Note: Opus 4.8's sweep of `lib/tauri.ts` reported no dead exports; Fable's
reference-count pass found the 4 named in finding 25 — Fable's is the
ground-truth list.)

## Recommended sequencing

### Quick wins (≤1 day each, independent)

1. **SVG `?raw` → `?url` + `<img>`** (or lazy raw-loader) — entry 1.57 →
   ~1.1 MB (gz 469 → ~370 KB). Biggest single startup win.
2. **katex dedupe** — `resolve.dedupe: ["katex"]` in vite.config. One line,
   −260 KB + kills the runtime double-load.
3. **Lazy SettingsSurface/BreveSurface/Onboarding** (paneTree precedent) +
   move Excalidraw CSS into the lazy engine module (preserve the cascade-order
   coupling vs `styles/canvas.css`). ~90 KB min. With #1: −35% startup JS.
4. **Scope `invalidateNotes()`** — invalidate affected folderId keys; split
   which-notes-changed from body-changed. Collapses Sonnet 1-3, softens 8/11/12.
5. **Parallelize hydration** — `Promise.all` `hydrateMain`+`hydrateViews`;
   `Promise.all` the `gcPersistedMaps` `listChats` loop.
6. **Dead code/CSS removal** — finding 25's list (~420+ LOC) + document or
   unify the `endpointIsLocal` mirror.
7. **Drop `@resvg/resvg-js`** — zero imports.

### Structural workstreams (0.49)

1. **Async-ify the sync command surface** with `spawn_blocking`, priority
   order: `web_fetch`/`web_search` → the subprocess/network six (finding 14) →
   `corpus_search`/`corpus_tasks` → the rest. This is what makes existing
   `Promise.all` call sites actually parallel.
2. **`corpus_list` caching against the watcher generation** + one shared
   in-flight promise in `listNotes`. Pairs with quick-win 4; together they
   kill root cause B.
3. **Batched AI permission probe** — `corpus_readable_ids(ids, model)` or a
   `secure` flag on `NoteMeta`; removes the pre-first-token full-corpus read
   from every chat message (and most of `searchMemory`'s probe cost).
4. **Event-driven open-request** — add a `rotli:open-request` emit in Rust,
   delete the 750ms poll. Same pattern retires the 60s status polls and the
   1 Hz install-progress polls (finding 23).

### Process

Add an e2e pre-check that a reused dev server on :1420 actually matches the
current tree (compare a build stamp/mtime before running) — the stale-server
incident during this audit produced findings against code that wasn't running.

## Cross-model observations

**Converged (independent agreement = high confidence):** sync-command/
main-thread surface (Opus 5 + Opus 4.8) · invalidation fanout (Opus 5 +
Sonnet + Codex's captured mid-run conclusion) · `web_*` blocking network
(Opus 5 + Opus 4.8) · `main.json` race (Opus 5 + Opus 4.8) · TabStrip title
map (Sonnet + Opus 4.8) · note-list re-sort per keystroke (Sonnet +
Opus 4.8) · serial hydration (Opus 5 + Opus 4.8 + Antigravity) ·
`onQuitFlush` leak (Opus 5 + Sonnet).

**Unique contributions:** Antigravity's narrow pass still surfaced the
`readNote` sequential-await micro-find (`host.ts:147-150`) nobody else caught ·
Opus 4.8 verified `corpus_search` at source (sync `pub fn` at
`corpus.rs:5082`, double read confirmed) and uniquely found the chat
transcript re-parse, the marquee re-sort, and the serial image-reference
scans · Fable supplied the build ground-truth numbers (245 chunks, 22.1 MB,
1.57 MB entry) that turned "bundle feels big" into ranked bytes, plus the
katex duplication and the dead-code inventory · Sonnet uniquely caught the
wikilink force-dispatch and the boardSurface multi-select clobber · Opus 5
uniquely mapped the AI permission-probe cost and the sync subprocess set.

**Pending:** Codex's full report; fold in on arrival — its mid-run conclusion
already matched root cause B, so material new findings are unlikely but its
ranking may differ.
