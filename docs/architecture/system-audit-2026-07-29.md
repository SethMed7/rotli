# System audit — 2026-07-29

Full-repo audit of rotli v0.45.0 (post-release, clean tree). Method: the three
mechanical gates ran first and all passed (`bun run lint`, `bun run
test:regression`, `cargo test`); six isolated reviewers then audited one
dimension each (architecture, security, correctness, Rust/Tauri, docs drift,
test coverage), and every high/medium finding below the cap was independently
re-verified by an adversarial agent instructed to refute it. 27 raw findings →
8 confirmed, 0 refuted, 7 high/medium unverified (beyond the verification
cap), 12 low (unverified). Supersedes
[`system-audit-2026-07-11.md`](system-audit-2026-07-11.md) as the current
findings list; the 07-11 code-organization audit (`code-audit.md`) remains the
decomposition baseline this audit measures against.

Fixed in the same session (not listed below): Visual mermaid nodes rendered
invisible — the generic `.rotli-mermaid-visual button` reset outranked
`.rotli-mermaid-visual-node` by specificity — and edges ran center-to-center
through the labels. Both corrected in `src/styles/render.css` +
`src/editor/mermaidFlowLayout.ts` with unit tests.

**Status update (same day, follow-up session):** the security/data-safety
items are FIXED with regression tests — confirmed #6 (keychain argv → stdin +
sandbox deny), #7 (chat secureContext taint), #8's sibling low 5 (pan guard),
leads 1 (uninstall containment), 2 (board egress gate), 3 (fail-closed reads,
incl. `journal_append` and the `.gitignore` rewrites), and low 4 (memex
`resolve_beneath`). Still open: confirmed #1-#5 (docs drift, convert-embed
test coverage, localStorage side-store, parity fixture, god-file debt), leads
4-7, and the remaining lows.

## Confirmed findings (adversarially verified)

### 1. HIGH · docs-drift — Mermaid-conversion contract is false since 0.45

`DESIGN.md:123` and `docs/architecture/memex-data-contract.md:79` still promise
conversion "creates an independent board … in the active Main/view context,
opens it, and starts its rename flow" and "leaves the Mermaid fence unchanged."
0.45 shipped the opposite: the board files **beside the source note**
(`besideNoteId`, `src/boards/composition.ts:56`) and a second confirmed path —
**Convert & replace in note** (`src/editor/blockRender.ts:698`) — rewrites the
fence into a ` ```board ` embed with `open:false` and no rename. Because
`docs/README.md` instructs agents to "fix both" on divergence, the stale
contract is actionable against shipped PR #3 behavior (including its TOCTOU
re-guard). **Fix:** update both docs to describe convert-beside + the two
confirmed outcomes.

### 2. HIGH · tests — the convert-and-embed note rewrite has zero coverage and is unreachable by e2e

`onConvertAndEmbed` (`src/editor/blockRender.ts:702`) rewrites user note text
behind a re-run stale-document guard (the Greptile P1 TOCTOU fix), but the
logic is module-private in the 893-line DOM-coupled `blockRender.ts`: no
`blockRender.test.ts` exists, and e2e cannot reach it because conversion is
Tauri-gated (`src/boards/composition.ts:63` throws in the browser twin;
`e2e/mermaid-workspace.spec.ts:31` asserts the menu item is *disabled*). A
regression re-introducing the fixed P1 pattern would silently replace the
wrong span of a user's note and no gate would fail. **Fix:** extract
`mermaidCodeRange` + the guard/replacement computation into a pure module and
unit-test the happy path, both stale-doc branches, and fence-at-boundary
cases.

### 3. MEDIUM · architecture — `embedSizeMemory.ts` localStorage bypasses the persist.ts chokepoint

`src/editor/embedSizeMemory.ts:12` is now the only browser-storage call in
`src/`, falsifying `code-audit.md:33` ("No … browser storage API is present")
and skipping the `adding-things.md` UI-state row (Zustand store + `persist.ts`
registration). Embed heights don't travel with a vault and collide across
vaults sharing a relative path. **Fix:** move the height map into a persisted
store, or record the exception in both docs and add a mechanical localStorage
grep to a check script.

### 4. MEDIUM · architecture — lifecycle roots hand-mirror Rust policy with no parity fixture

`src/services/destinations.ts` self-declares in five places that it mirrors
Rust `is_hidden_root` / `is_trash_folder` / `is_chats_folder` /
`split_root_id` (`corpus.rs:4582` etc.), but `scripts/fixtures/parity.json`
has no lifecycle-roots entry and neither parity suite references it —
violating `adding-things.md`'s "no hand-mirroring without a fixture." A
Rust-side root change passes every gate while TS listings and the
restore-only menu gate silently disagree. **Fix:** add a parity entry +
assertions in both suites.

### 5. MEDIUM · architecture — tracked god files are still absorbing new work

Against the 07-11 decomposition targets: `src-tauri/src/corpus.rs` 6753 →
8630 lines (+28%, 19 commits/3 weeks, 9 new `#[tauri::command]`s landed in it
after `adding-things.md:22` said to prefer sibling modules), `breveSurface.tsx`
+26%, `lib/tauri.ts` +12%. Eight new sibling Rust modules prove the escape
hatch works — corpus-domain commands are the exception, landing next to the
secure/locked write gates the audit says must be preserved verbatim.
**Fix:** execute the corpus.rs/breveSurface splits before the next feature
cycle, or add a growth tripwire for the named debt files.

### 6. MEDIUM · security — Breve keychain unlock password rides `security` argv

Every Breve secret read runs `security unlock-keychain -p <pw>`
(`breve-runtime/scripts/secret.ts:44,65,88`), exposing the unlock password to
same-user process-table snooping (KERN_PROCARGS2 — verified to work from
inside the repo's own sandbox profiles). The verifier confirmed one real
harvest lane: the agy image profile (`src-tauri/src/provider.rs:513`)
re-allows `~/Library/Keychains` reads, so a sandboxed model child that
harvests the password during a concurrent brief send can unlock
`breve.keychain-db` itself. Contradicts the repo's own standard in
`src-tauri/src/keychain.rs` ("the value never rides argv or `ps`").
**Fix:** feed the password over stdin (`security -i`) or use a native
Security.framework helper like keychain.rs; also deny the keychain dir in the
agy image profile.

### 7. MEDIUM · security — secure-note content reaches remote models via persisted chat history

The model-switch gate (`src/components/chatSurface.tsx:747`) only fires for
chats *attached* to a secure note. In a loose chat, a local model with
`local_ai_allowed` can `read_note` a secure note (permitted by
`corpus.rs:3058`) and quote it in a persisted reply; switching that chat to
Claude/Codex/Gemini then ships the whole transcript remote — `egress_allowed`
and `protected_for_remote` catch only secret-*shaped* text, not private
prose. **Fix:** taint the chat when any turn's tool trace read a secure note
(e.g. `secure_context: true` frontmatter) and apply the attachedSecure
treatment to tainted chats.

### 8. MEDIUM · correctness — dirty mermaid-workspace drafts silently destroyed by tab/nav chords

The workspace's discard confirm lives in `requestClose`
(`mermaidWorkspace.tsx:174`), but `OPEN_OVERLAYS` stores the raw `close()`
(`blockRender.ts:661`) and `themeWatcher.destroy()` sweeps all overlays on any
editor teardown (`blockRender.ts:887`). ⌘W, ⌘⇧/P, ⌘N, ⌘1-9, ⌃Tab — anything
that unmounts an editor view — destroys unapplied Visual/Code edits with no
confirm. Worst-class bug for a notes app. **Fix:** store the
requestClose-aware closer in `OPEN_OVERLAYS` (or have the key dispatcher stand
down while `transients` is non-empty), and/or stash dirty drafts keyed like
`INLINE_VIEWPORTS`.

## High/medium findings beyond the verification cap (unverified — treat as leads)

1. **rust/medium** — `local_model_uninstall` (`localmodel.rs:502`) trashes a
   registry-declared path with no containment check; the sibling
   `local_model_set_default` already canonicalizes and enforces
   under-models-dir. A hostile/corrupt `registry.json` path = Trash the vault.
2. **rust/medium** — remote-agent **board** reads (`workspace.rs:750`, CLI/MCP
   lane) bypass the secure-content gate notes get: no
   `looks_secure`/`protected_for_remote` over board scenes; a pasted API key
   in a board ships verbatim to an external agent.
3. **rust/medium** — `discard_blank` (`corpus.rs:4407`) uses
   `read_to_string(..).unwrap_or_default()`, so an unreadable/non-UTF-8 note
   reads as blank and gets trashed — the documented fail-closed guarantee
   fails open. Same idiom in `write_resolved` (`corpus.rs:3549`) can silently
   regenerate frontmatter (dropping `secure: true`).
4. **docs/medium** — `.carl/carl.json` ROTLI_SHELL rule 2 still teaches
   "⌘⇧T restores"; 0.45 rebound ⌘⇧T to New board, reopen is ⌘⌥T.
5. **docs/medium** — `memex-data-contract.md:49` "Creation from Main adds no
   view_tag" is false since 0.45's view inheritance for mirrored folders.
6. **docs/medium** — `DESIGN.md:105` Diagram section predates the 0.45
   cameras (inline-fence pan/zoom, still-click-to-open, Visual camera).
7. **tests/medium** — view-inheritance + convert-beside filing policy
   (`src/newItems/composition.ts:99-197`) untested at any level.

## Low findings (unverified)

1. **architecture** — mermaid/katex/jsxgraph have no `vendorSeams` entry in
   `check-architecture.mjs`; their single-adapter boundary is folklore.
2. **architecture** — `app.tsx:260` re-defines the raster-image extension
   policy inline (includes svg), diverging from `lib/fileKind.ts` IMAGE_EXTS.
3. **architecture** — the focused-pane/active-tab fallback is re-implemented
   in ≥7 places instead of one panes.ts selector.
4. **security/rust** — `memex.rs:470` read lane keeps a string-only `..`
   guard (no `resolve_beneath`, follows symlinks) and swallows read errors as
   empty content — weaker than every corpus lane.
5. **correctness** — Visual editor pan-guard on click-to-clear is dead code
   (`panRef` is nulled on pointerup before click; `moved` never read), so a
   completed pan can still clear the selection.
6. **rust** — `journal_append` (`corpus.rs:3962`) read-fail silently replaces
   the entire brain journal with one line.
7. **rust** — IPC-reachable `lock().unwrap()` in organizer/provider/localmodel
   can crash the app after a daemon-thread panic (corpus side already maps
   poisoning to a clean error).
8. **docs** — the ⌘N chooser tab is absent from every contract, and the pane
   empty state still labels ⌘N "new note" while dispatching a different
   action than the chord performs.
9. **docs** — `.carl` ROTLI_EDITOR rule 2 recalls only the independent-copy
   conversion (no replace-with-embed / beside placement).
10. **tests** — Quick Look failure/boundary states (unreadable note, 64KB
    cap, xlsx→metadata-card routing) have no coverage; only the Assets happy
    path is tested.
11. **tests** — the sole mermaid→Excalidraw converter check is an e2e that
    dev-server-imports `src/boards/engine/mermaid.ts` and asserts only
    element counts/types; it stays green if every converted board is mangled.

## Suggested order of attack

1. Data-loss class first: #8 (silent draft destruction), leads 1 and 3
   (uncontained trash / fail-open discard), then #2's regression tests.
2. Security pair: #6 (argv password + agy keychain profile) and #7 (chat
   taint), plus lead 2 (board egress gate).
3. One docs sweep closing #1 + leads 4-6 + the CARL rule refreshes in the
   same change, per the docs-ship-with-code rule.
4. Architecture debt (#3-#5) as scheduled work, not drive-by fixes.
