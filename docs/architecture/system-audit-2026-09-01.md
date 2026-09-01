# System audit — 2026-09-01

Nine-area audit of the `main` worktree at 0.83.0 plus a large uncommitted
batch (⌘T pending tabs, `[][]` / `( )` grammars, Finder-drop rework, Cursor ACP
lane). Method: seven read-only reviewers mapped one area each from code, tests,
and contracts; findings below cite file and line. Fixes landed in the same
session are marked **FIXED** and carry tests; everything else is a ranked
recommendation. Supersedes
[`system-audit-2026-07-29.md`](system-audit-2026-07-29.md) as the current
findings list (its still-open items are folded in where relevant).

**Build gap first.** The installed app was the 0.83.0 bundle built 2026-08-31
20:53. Every ⌘T, ⌘W, and Finder-drop fix in the worktree was written on
2026-09-01, so the reported symptoms (“⌘T slow”, “⌘W slow”, “drops broken”)
were measured against a binary that predates all of them. Nothing was rebuilt
or installed in this session.

## 1. ⌘T / ⌘W latency

Already in the worktree: ⌘T opens a synchronous pending tab before any I/O
(`src/state/panes.ts` `openPendingItemTab`, `CHANGELOG` “Command-T opens the
real editor in the original key event”); ⌘W defers the large-note save flush
past the close paint (`editorSurface.tsx` `flushNoteAfterPaint`). Persistence
is debounced 500 ms and off the hotkey path.

**Measured (same day, follow-up).** In browser mode ⌘T reaches a focused
editor in 18–25 ms and its first frame by 37–56 ms, with the pending→real
remount visible ~10 ms later — the frontend is not the lag. The dev app's lag
was the post-creation refresh against the real vault: `notes list` on the
250-note memex took 4.6 s in the unoptimized debug build versus 0.28 s in
release, and creation invalidated the listings, every open tab's body, and the
Tasks projection. **FIXED**: `tauri dev` now builds Rust at `opt-level = 1`
(0.40 s for the same walk), creation refetches the note listings only
(`invalidateNoteLists`), and `invalidateNotes` runs its three refetches in
parallel. The Rust walk cache still invalidates wholesale on any internal
write; patching a created note into `list_cache` instead is the next lever.

Still on the path, ranked:

1. **Every ⌘ press runs a whole-document layout.** `hotkeyPeekDelay` returns
   0 ms outside modals (`src/keys/useHeldModifier.ts:27-30`), so the badge
   overlay’s `useLayoutEffect` (`hotkeyBadges.tsx:120-149`) does a
   `querySelectorAll`, a forced layout, and an ancestor `getComputedStyle`
   walk before the `T`/`W` keydown even arrives. Recommendation: ~120 ms
   delay for the non-modal case; `e2e/tab-hotkeys.spec.ts:10-15` asserts the
   badges on hold, not their instant appearance. UX judgement call, not
   applied.
2. **Two CodeMirror mounts per ⌘T.** `paneTree.tsx:74-92` renders the pending
   `EditorSurface`, `:152-158` renders the resolved one, and `CmEditor` is
   keyed on `noteId` (`editorSurface.tsx:440`), so the pending→real id swap
   rebuilds the whole extension stack and re-derives the O(corpus) wikilink
   key (`cmEditor.tsx:311-316`). Render one surface for both phases and stop
   keying on the id so `adoptPendingDocument` hands over in place.
3. **Note tabs are not keep-alive** (`paneTree.tsx:163-190` keeps canvas,
   chat, file, browser only), so ⌘W’s dominant cost is mounting the
   neighbour’s editor, and ⌘T destroys the previous note’s view.
4. **Creation still fans out** through `invalidateNotes()`
   (`services/hooks.ts:256-269`, three sequential awaited invalidations that
   the code itself calls “~9 uncached full-vault walks”), and `sidebarHome.tsx`
   calls `useNotes()` six times.

## 2. Tab lag in lists

`tabIndent` itself is one line, one transaction. The per-keystroke floor is
`livePreview.build` rebuilding every decoration on each transaction
(`livePreview.ts:1156`) with three whole-document passes first
(`scanTaskProgress`, `scanFences`, `scanTables` which nests a second
`scanFences`), plus the model round-trip materialising the document four
times per keystroke (`cmEditor.tsx:641-651` → `model.ts:447`). Tab-specific
extras: the table keymap ran `scanTables` on every Tab/Enter/arrow to learn the
caret was not in a table, and `tabIndent` runs its own `scanFences`.

- **FIXED**: `tableCtxAt` now returns at once for lines without a pipe
  (`cmKeymap.ts`), removing one table scan and one nested fence scan from
  every Tab, Enter, and arrow on ordinary lines. Guarded by
  `cmKeymap.test.ts` (“Tab outside a table”).
- Open: share one fence scan per document change (a `StateField` consumed by
  `livePreview`, `tableRender`, `blockRender`, and the keymap), and stop the
  toString/split/join round trip in `setDocumentText`. Note the uncommitted
  `parseBlock` gained two regexes at the head of its chain
  (`render.tsx:75-93`) that `scanTaskProgress` now pays on every line.

## 3. Word documents

Architecture is sound (framework-free model, Rotli-owned OOXML codec that
preserves opaque parts, one-time `.bak`, loud refusal on hyperlinks and
tracked changes). The gaps are in what the Univer toolbar advertises versus
what the codec keeps:

1. **Silently discarded toolbar edits**: subscript/superscript, highlight
   colour, H4/H5, checklists, horizontal rules, header/footer, and page setup
   all mark the document dirty and are dropped on save
   (`engine/univer.ts:93-101`, `:132-144`, `:380-440`, `:456-460`). Either
   hide them through the preset `menu` config or extend the model.
2. **Untouched paragraphs get re-encoded**: `sameParagraph` is
   `JSON.stringify` equality (`codec/docx.ts:406-408`) while the two style
   builders emit keys in different orders and Univer merges Word’s split
   runs, so most paragraphs of a real Word file re-encode, and one hyperlink
   in an unedited paragraph refuses the entire save.
3. **Numbered lists** decode by literal `numId === "2"` (Rotli’s own id) and
   always encode `numId="1" ilvl="0"`; page breaks become line breaks;
   run-property retention is positional.
4. **Zero Word-authored `.docx` fixtures** in the repo; the regex XML walker
   has only ever seen its own encoder’s output.
5. Missing: find/replace, hyperlinks, print, PDF export from DOCX,
   DOCX→Markdown, search/AI visibility of document text, autosave interval.

Report only; none of this was changed.

## 4. `[][]` result rows and `( )` choice groups

Two grammars, not three, and neither is multi-select: `- [ ][ ]` is a
two-button pass/fail **result** (`resultState.ts`, `[x][x]` fails closed to
prose), `- ( )` / `- (x)` is a radio **choice** group of adjacent same-indent
rows (`choiceState.ts`). Both are defined once and imported by the parser,
live preview, keymap, copy path, format toggles, and read-only previews; Rust
only strips the prefixes and refuses to treat them as tasks. Entry is the
Space shorthand only (`[][]`+Space, `()`+Space).

Colouring is per state, not per option: yes uses `--success`, no uses the new
`--failure` token, a selected choice uses `--accent-text`. `--failure` is
pinned to two values across all twelve themes in `src/brand/tokens/colors.css`
while `--success`/`--accent-text` are theme-tuned in `styles/themes.css`, so
Paper and Charcoal render “passed” grey and “failed” red — the only chroma in
a monochrome theme — and the yes-label `color-mix` has no contrast entry.

- **FIXED**: a right/middle press no longer answers a result, selects a
  choice, or toggles a task (`livePreview.ts`, e2e “secondary click”); result
  answers join the input undo group.
- **FIXED**: slash commands work inside a result’s ` — reason`
  (`slashSpanAtCaret` in `slashMenu.tsx`): the trailing `/query` token is the
  command and its block lands on a continuation line beneath the row.
- Open: per-theme `--failure` in `themes.css`, contrast entries, `role="radio"`
  semantics and option text in choice labels, slash entries for both grammars,
  `ChoiceWidget.select` stringifying the whole document per click.

## 5. Drag and drop, images, video

The note lane is native-only by design (`lib.rs:2864` emits
`rotli:native-drop-authorized` after issuing one-shot import grants; the HTML5
fallback in `app.tsx` cannot fire while Tauri’s drag-drop stays enabled).

- **FIXED (chat)**: `chatSurface.tsx` read the imported asset back with
  `fetch(asset://…)`; the CSP `connect-src` is ipc-only, so every drop failed
  with “Load failed” after the file was already copied in. Attachments now
  read back through `corpusFileBytes` with the 25 MB ceiling shared with Rust
  via `parity.json` (`chatImageAssetMaxBytes`); the drop lane honours the
  paperclip’s vision gate; `.svg` dropped on a chat files to Storage instead
  of being refused and lost. `check:security` now fails any undeclared raw
  `fetch(` under `src/`.
- **FIXED (note)**: only `.cm-editor` was a target; a drop on the header or
  margins imported to Storage and inserted nothing. `dropEditorHost` now
  resolves through the note surface.
- **ADDED**: video embeds. `mp4`, `mov`, `webm`, `m4v`, `ogv` dropped on a
  note or picked through `/attach` use the same `storage:` image source;
  `ImgWidget` swaps in `<video controls preload="metadata">` and keeps
  resolution, rescue, `|width`, the resize grip, and selection. Tauri 2.11’s
  asset protocol already serves range requests, so seeking works with no
  Rust change. Video is path-lane only (the byte-backed fallback is capped).
- Open: the native drop event is broadcast to every window, so a Quick Note
  drop is handled by the main window’s DOM (add the window label to the
  payload); no paste lane for clipboard images; no vision-capable local
  model in the catalog, so a local-model chat still refuses images at send.

## 6. Mermaid

Configured once per render with `securityLevel: "strict"`, lazy-loaded and
budget-guarded, cached by source and theme colours for the inline fence, and
opened into a View / Visual / Code workspace whose Visual mode edits a
flowchart subset losslessly at the model level and fails closed by name and
line for everything else.

- **FIXED**: closing or switching the note under an open workspace
  force-closed it and dropped the unapplied draft (audit 07-29 #8). Drafts
  now wait in `MERMAID_DRAFTS` keyed by fence source and are restored on
  reopen; Apply and Discard clear them (e2e “survive closing the note”).
- Open, ranked: (1) twelve app themes collapse to mermaid’s stock
  `default`/`dark` with no `themeVariables` or `fontFamily`
  (`mermaidRender.ts:26-30`) while `ctx.tokens` is already available at the
  call site; (2) the workspace and chat never re-theme live and bypass the
  render cache; (3) no unit test covers `mermaidCodeRange` or the two stale
  guards that rewrite note text; (4) no SVG/PNG export; (5) no in-workspace
  undo; (6) `suppressErrorRendering` unset; (7) `DESIGN.md:425-429` and
  `memex-data-contract.md:183-185` still describe the pre-0.45 conversion.

## 7. MCP / CLI as a remote for an external bot

The premise that a remote MCP is missing is stale: the relay
(`services/rotli-mcp-relay/`, `src-tauri/src/remote_agent.rs`) is merged on
`main`, documented in `remote-agent-relay.md`, and marked SAFE in the egress
threat model (row 16a). The app binary doubles as the CLI (`workspace.rs`
`run_if_requested`), `rotli mcp` speaks newline JSON-RPC over stdio with 26
tools, and the relay inverts the connection: the Mac long-polls a stateless
rendezvous over HTTPS with role-bound Keychain tokens, so nothing listens on
the Mac.

What an external bot cannot do today, in build order:

1. **No relay is deployed** — `rotli agent config` prints
   `https://YOUR-RELAY.example/mcp`. Deploy the pinned Dockerfile (Railway,
   one replica) and replace the placeholder (`workspace.rs:2199`).
2. **Protocol compatibility is untested** — POST-only, no SSE stream, no
   `Mcp-Session-Id`, and any `Origin` header is rejected
   (`server.ts:73-77`). Smoke-test the bot’s client with `initialize` →
   `tools/list` → `rotli_search` before designing further.
3. **No per-client tool allowlist** — the `read_only` flag threaded through
   `handle_mcp_request_for_root` is hard-wired to `false` in release; extend
   it to an allowed-tool set chosen in Settings → Connections.
4. **No audit trail** of remote calls (`remote_agent.rs` logs nothing).
5. **No “speak” surface** — the only write that lands text is
   `rotli_create_note` into `wiki/_inbox`. A conversational bot needs an
   append-only `rotli_capture` into a per-agent daily note (a workspace
   contract change), not a write into `chats/`, which the Chat front owns and
   search deliberately excludes.
6. Requires an awake Mac with Rotli open and “Connect this session” pressed
   each launch, by design.

## 8. Project icon / favicon

The t3Code project icon resolved to `index.html`’s `<link rel="icon">`, which
pointed at the bare `src/assets/characters/_logo.svg`. **FIXED**:
`public/favicon.svg` (white disc, ink quokka, explicit `color`) and
`index.html` now points there. The marketing site’s `site/public/favicon.svg`
keeps its linen disc; making it white is a brand call.

## 8b. Rest state (“All clear”)

**FIXED**: the three actions wrapped their labels inside `.be-sub`’s 320 px
prose measure and rendered as UA-bevelled buttons; and a filled quokka drew
its body line art in the theme text colour on dark themes because placement
CSS (`.be-quokka`, `.empty-stage .quokka`) overrode `color` while the
accessory ink layer kept the dark ink token — the pale contour in the
screenshot. Filled treatments now pin `color: var(--quokka-ink)` inline.

## 9. Live charts (`/charts`) — evaluation

Request: a `/charts` block that renders a live chart, shows its code, lets
values be edited, and can be produced by chat.

- **TanStack Charts** (`tanstack.com/charts`): headless grammar (marks,
  scales, channels), SVG by default with opt-in Canvas, React adapter plus
  vanilla DOM and a static-output adapter, ~29 kB gzip for a basic React
  line, 188+ example types. It is labelled **alpha** on its own site, so it
  is not yet a dependency Rotli should pin (Rotli pins every vendor and
  budgets every lazy chunk).
- **Fit with Rotli’s laws**: a chart must be Markdown source truth like
  `mermaid` and `jsxgraph` fences — a ```` ```chart ```` fence holding a small
  declarative spec (type, series, data rows, optional axis labels), rendered
  by `blockRender` through one adapter in `src/editor/`, lazy-loaded and
  budget-guarded, with `check:architecture` `vendorSeams` naming the single
  import site. Values edit in the fence (reveal-on-caret) and, later, in a
  View / Data / Code workspace mirroring the Mermaid one. Chat generates it by
  emitting the fence, exactly as it emits mermaid and tables today; the
  `draw_board` precedent shows the tool classification (`local`, never
  egress).
- **Recommendation**: build the fence and spec first with the static-output
  adapter (SVG string, no framework coupling, trivially themeable from brand
  tokens and printable through the existing PDF lane); switch the renderer to
  the React adapter for tooltips/zoom once TanStack Charts leaves alpha. Do
  not add Recharts/D3 (97/90 kB) for this.

## Verification

`bun run verify` (check, build, site, Playwright, clippy, cargo test) passed
on the quality, e2e, and rust lanes at the end of the session: 1,511 Bun unit
tests, 433 cargo tests, the full Playwright suite including four new cases in
`e2e/markdown-editing.spec.ts` and `e2e/mermaid-workspace.spec.ts`, plus
`check:security` (new `src/` raw-`fetch(` scan), `check:parity`
(`chatImageAssetMaxBytes`), and `check:react-compiler`. Not proven in browser
mode: a real Finder drop through the Tauri grant lane, video playback over
`asset://` in WKWebView, and the t3Code icon re-probe.

Known limitation: `MERMAID_DRAFTS` is keyed by fence source, so two notes
holding byte-identical Mermaid fences share one stashed draft.
