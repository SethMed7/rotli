# Rotli Web, site fixes, and the shell batch — plan (2026-09-16)

Status: **PLAN** for branch `feat/web-version-and-shell-fixes`. Three
workstreams, in the order they land: (1) the web version served from rotli.co,
(2) site fixes, (3) fifteen shell bugs and enhancements from the owner's
review. Evidence is cited as `file:line` against `7f0ae539` (1.0.0) unless a
commit on the branch is named. Nothing here changes a product law; where a
phase defers one, it says so.

## 1. Rotli Web

### What it is

The same frontend bundle the Mac app runs, served from the marketing site at
`https://rotli.co/app/`, with the user's vault persisted **in their own
browser**. No account, no server-side state, no telemetry. The page's
Content-Security-Policy is `connect-src 'none'`: the browser refuses every
outbound request, which is a stronger and more verifiable statement than the
Mac app can make. That is the product story: "your notes never leave this
tab, and the browser itself enforces it."

### What exists today (measured)

- The frontend already renders without Tauri. `src/lib/tauri.ts:24`
  (`isTauri`) gates 38 files; the E2E suite runs against this "browser twin"
  daily.
- Notes in the twin are an `InMemoryNotesService` behind the `NotesService`
  port (`src/services/notesPort.ts:6`, `src/services/notes.ts:39`). It already
  mirrors the Rust corpus rules the UI depends on: reserved folder ids, the
  three-valued restore origin (`notes.ts:252`), the rename refusal, the vault
  read-only ceiling. It is lost on reload.
- Main and named-view manifests work in memory and skip persistence off-Tauri
  (`src/state/main.ts:59`, `src/state/views.ts:40`). Settings hydration and
  the debounced writer return early off-Tauri (`src/state/persist.ts:1326`,
  `:1613`). Board saves are no-ops off-Tauri (`src/boards/composition.ts:32`).
- Every `corpusInvoke` rejects off-Tauri (`tauri.ts:364`): boards, welcome
  seeding, settings, Main, views.
- **Serving spike (2026-09-16, passed):** `vite build` with `base: "/app/"`
  produces a bundle with no absolute `/assets/` references. Served by Caddy
  under a `handle /app/*` block with its own CSP (`connect-src 'none'`,
  `style-src 'self' 'unsafe-inline'`, `worker-src blob:`), the app loads with
  zero console errors or warnings, the sidebar and welcome note render, and
  unknown `/app/...` paths fall back to the app's `index.html`.

### Product laws: kept, bent, deferred

| Law | W0 | Later |
|---|---|---|
| Local-first; user files are durable truth | **Bent.** The vault lives in IndexedDB, which is browser-private storage, not a folder the user owns. W0 must say so in the app and offer export. | W1 adds "Open a folder on this computer" (File System Access API, Chromium only) so files are real `.md` on disk, and a zip export/import so a browser vault can move into the Mac app. |
| One folder is one vault; Main and views are projections | Kept. Same manifests, persisted beside the notes. | |
| Markdown owns slash commands, wikilinks, fences | Kept; identical editor. | |
| Secure notes: TS and Rust enforce independently | **Deferred.** No Rust half exists; no remote model exists either, so nothing can egress. The `secure:` classification still applies to the Librarian, which is absent. | Revisit if any model lane is ever added to the web build. |
| Locked = no AI edits | Trivially kept (no AI). | |
| Breve is a Rotli capability | Not in the web build; surface says "In the Mac app". | |
| Theme families | Kept; identical CSS. | |
| Nothing writes outside the vault | Kept and strengthened: `connect-src 'none'`. | |

### Phase W0 — served from the site, persistent, honest (this branch)

Status 2026-09-16: items 1 to 4 and 6 to 8 landed and were proven in the
Docker prod twin (first visit seeds and opens Welcome; a typed edit, Main,
settings, and the open tabs survive a reload; console clean under
`connect-src 'none'`). Item 5 is the Settings → General notice. Item 9's
Playwright lane is still to write.

1. **Build knob.** `vite.config.ts` reads `ROTLI_WEB_BASE` (`/app/`) and
   `ROTLI_PLATFORM` (`web` | `desktop`) and injects `__ROTLI_PLATFORM__` the
   way `__ROTLI_BUILD_CHANNEL__` is injected. Landed on the branch.
2. **Platform policy.** `src/lib/featurePolicy.ts` gains the platform
   dimension next to the channel. Web withholds: chat and every model lane,
   Librarian, Breve, agents/MCP, DOCX and sheets, Finder drops and pastes,
   System browser disk views, connected-CLI detection, updater, native
   windows. Each withheld surface shows one calm caption ("Available in the
   Mac app") through the same caption mechanism as `COMING_SOON_CAPTION`, not
   a broken control.
3. **Browser vault (persistence).** One effectful service,
   `src/services/browserVault.ts` (declared in `SERVICE_FILE_OWNERS`), backed
   by IndexedDB through a ~40-line in-house wrapper (no new dependency; the
   lockfile is frozen and release-aged). It snapshots and restores:
   - the `InMemoryNotesService` state (folders, notes, origins) via new
     `export()`/`import()` methods on that class;
   - the Main and views manifests (`state/main.ts`, `state/views.ts` get a
     browser writer where they currently `return` off-Tauri);
   - settings and viewstate through the existing `createPersistDrain`
     (`persist.ts:1580`), with a browser `write` in place of
     `corpusSettingsWrite`;
   - boards are **deferred to W1**: creating one goes through
     `corpusCreateBoard`, which has no in-memory twin, so read/write
     persistence alone would not make boards usable.
   Writes are debounced and flushed on `visibilitychange`/`pagehide` by the
   writer that already exists. Hydration is awaited in `src/main.tsx` before
   first render, beside `hydratePersistedState`.
4. **Seeding.** The demo corpus in `services/notes.ts:360` seeds only when
   `platform !== "web"`. A fresh web vault gets the reserved roots plus the
   Welcome folder through the existing idempotent `seedInMemory`
   (`services/welcome.ts:27`). **First failing test:** reload after editing
   the welcome note must not re-seed over the edit.
5. **First-run explainer.** A one-time card in the web build: where the notes
   live (this browser, this device), that clearing site data deletes them,
   and how to export. Copy follows `DESIGN.md`; no new UI framework.
6. **Serving.** `site/Caddyfile` gains the `handle /app/*` block from the
   spike (own CSP, `X-Robots-Tag: noindex`, immutable cache on
   `/app/assets/*`, SPA fallback). The site's own header block must not leak
   onto `/app/`; the prod twin proves it with `curl -I`.
7. **Docker.** `site/Dockerfile` gains a stage that runs the root
   `bun ci` and `ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web bun run build` and
   copies `dist/` to `/srv/app`. Risk: `sharp` (used by
   `scripts/build-character-fills.mjs`) on Alpine/musl; if it fails, the
   stage moves to `oven/bun:1.4.0-debian`. The CSP inline-style guard in
   `astro.config.mjs` scans Astro's output only, so the copied app is not in
   its path; confirm by building the image.
8. **Site.** A `WEB_APP_ENABLED` knob in `site/src/site.ts` that fails closed
   like `SOURCE_REPOSITORY_PUBLIC`. When true: a secondary hero action
   ("Try it in your browser"), a nav entry, and a short section stating what
   the web version is and is not.
9. **Proof.** A Playwright lane against the `/app/` build: create a note,
   reload, the note is there; edit the welcome note, reload, the edit is
   there; a board saves and reloads; the console is clean under the CSP; the
   withheld surfaces show their caption. Plus the Docker prod twin.

### Phase W1 — files you own

- "Open a folder" via the File System Access API (Chromium; permission is
  re-asked per visit unless installed as a PWA — measure it). The
  `NotesService` implementation reads and writes real `.md` files; Main and
  views land in `.rotli/` exactly as the Mac app writes them, so the same
  folder opens in both.
- Zip export and import of a browser vault (JSZip is already behind an
  adapter in the documents lane).
- Assets (images) stored as blobs; the editor's image embeds resolve them
  through a blob URL instead of the asset protocol.

### Phase W2 — installable and local AI

- PWA manifest and service worker (offline, home-screen install, durable
  folder permission).
- Optional on-device chat through WebGPU. Only if the secure-note gate can be
  enforced in TypeScript alone with evals; otherwise it stays in the Mac app.

## 2. Site fixes

Landed on the branch in `7963b5b8`: theme-studio orbs blank and the 404 page
unstyled under the production CSP (colours moved to `data-orb` rules,
stylesheets never inlined, build fails on any inline style); richer link
preview (quokka social card, Open Graph dimensions and type, PNG icons, a
GitHub-sized export). Remaining site work in this batch is the web-app entry
point above (W0 items 6 to 8).

## 3. Shell bugs and enhancements

Fifteen items from the owner's list. Each lands as its own commit with a
failing reproduction first, its tests, and a `CHANGELOG.md` line, so the
branch can be split into pull requests later. The table is filled from the
code map below.

| # | Item | Owner (file:line at 1.0.0) | What the code does today | Change | Proof |
|---|---|---|---|---|---|
| 1 | Delete a folder | `src/components/sidebar/sidebarHome.tsx:267-350` (the Main folder menu); `src/services/folderTrash.ts:12-37`; `fsNotes.ts:86` throws "folder delete is not in the corpus yet"; no Rust `corpus_delete_folder` | Main folders are virtual manifest nodes. The menu offers Rename, Move to view, Remove from Main, and "Move folder contents to Trash…" which is disabled for an empty folder. Real directories can be created but never deleted. | Add **Delete folder** to the Main menu: trash the contents (existing drill) then remove the node, enabled at zero items. Real-directory delete needs a new Rust command that routes to the OS Trash behind `writable()`; scoped as its own commit. | `folderTrash.test.ts`, `mainTree.test.ts`, `e2e/sidebar-context-menu.spec.ts` |
| 2 | Drag an image into a note | `src/editor/nativeFileDrop.ts:100-152` (native path), `:157-190` (DataTransfer fallback); `dropRouting.ts:114-143` | The native lane works. The fallback lane accepts only `isImagePath` files and never routes through `planDrop`; a non-embeddable file dropped on a note goes to Assets with no notice. | Route the fallback through `planDrop` + `deliverFiles` with `isEmbeddablePath`; give the editor branch of `planDrop` a notice when files are stored. Add unit tests for the two routing modules (see "why it keeps regressing"). | `dropRouting.test.ts`, new `nativeFileDrop.test.ts`; native acceptance |
| 3 | Drag an image into a chat | `src/components/chat/chatDrop.ts`; `chatSurface.tsx:2273-2283` (vision gate) | Native drops work when the model can see. When it cannot, the paths are discarded with only a hint, nothing stored. Chats have no DataTransfer fallback at all. | Store refused paths through `corpusImportFile` + `showFileNotice`; add chat to the fallback target resolution; notice on the chat branch of `planDrop`. | `dropRouting.test.ts`, `chatSurface.test.ts`; native acceptance |
| 4, 11 | Back button in Trash, Library, Assets, Archive | `src/components/systemSurface.tsx:674-683` (`fdr-up`, hidden at root) | The only control is up-one-folder and it disappears at the root, which is where Trash is always browsed. | Render the `board-back` "‹ Back to notes" precedent (`boardSurface.tsx:262-275`) in the System header at the root; keep `fdr-up` below it. | `systemBrowser.test.ts`, `e2e/system-browser-reveal.spec.ts` |
| 5 | Restore returns to Captures, not the origin | `src-tauri/src/corpus.rs:5251-5262` (origin stamp, correct); `src/components/useNoteMenu.ts:560-568` (trash strips the Main ref) | The file goes home on disk. But trashing removes the note from Main and restore never re-adds it, so a restored memex note sits in `wiki/_inbox` with no Main ref, which is exactly the Captures projection. A null-origin restore in a memex layout throws instead of misfiling. | Keep the Main ref through the sink (the projection already filters sink-resident items) or record it beside `origin` and reapply on restore; make the null-origin fallback layout-aware. | `corpus.rs` origin test, `notes.test.ts`, `mainTree.test.ts`, new e2e trash→restore→Main |
| 6 | Captures "Make a note" does nothing | `src/components/boardSurface.tsx:205-229` (`merge`) | Creates straight into the literal folder `Inbox`, which is `Hidden` in a memex layout, so Rust refuses; `merge()` has no `catch`, so the button fails silently. Works only in legacy vaults. | Create through `createRoutedNote` like every other creation site; surface refusal via `setRowActionError`. | `createNote.test.ts`, `e2e/capture-vault-routing.spec.ts` |
| 7 | Captures: Select all | `boardSurface.tsx:70,191-198,337-364` | Click-to-toggle only; toolbar appears only with a selection; no ⌘A action. | `Select all` in the header, a `captures.selectAll` action bound to ⌘A while the Captures view is active. | `captureReveal.test.ts`, keys registry test |
| 8 | Captures: shift-click range | `boardSurface.tsx:191-198,315-321`; precedent `systemSurface.tsx:438-460` | The click handler drops the event; no anchor. | Lift the System browser's range slice into a pure `src/lib/rangeSelect.ts`; Captures and System both call it with their visible order. | New `rangeSelect.test.ts`, one e2e for both surfaces |
| 9 | Main tree: shift-click range | `sidebarHome.tsx:431,591-608` | ⌘-click gathers; ⇧ is never read. Plain note lists have no selection model. | Same helper, fed the flattened Main row order. Keep `mainSel` separate from `ui.systemSelection`. | `sidebar.test.ts`, `e2e/sidebar-cross-section-drag.spec.ts` |
| 10 | Restore from inside a trashed note | `src/editor/editorSurface.tsx:352-434`; `useNoteMenu.ts:144-200` | A trashed note opens and edits normally; the only cue is the location chip. `NoteDoc.origin` is fetched and unused by the editor. | When `isSink(note.folderId)`, one `Restore` chip in the header that dispatches the exact menu branch, extracted into a shared `restoreAction(note)`. | `useNoteMenu.test.ts`, new e2e beside `file-folder-management.spec.ts` |
| 12 | Is "All notes" global? | `noteListSurface.tsx:41`; `viewTree.ts:302-306` (`assignedView`) | Global by design (`e2e/named-views.spec.ts` asserts it). No row shows its view. | Validation, no filter change: a muted view chip on each row from `assignedView`. | `notesSurface.test.ts`, `named-views.spec.ts` |
| 13 | Wrapped list lines misaligned | `src/editor/listGeometry.ts:49-53`; `styles/editor.css:869-881`; `cmEditor.tsx:576` (line wrapping) | The hanging-indent arithmetic is right. Two real causes remain: CodeMirror's `break-spaces` carries a preserved space to the start of a wrapped line, and `.rotli-marker.num` has a fixed width that wide numbers overflow. | `white-space: pre-wrap` on wrapped lines; `min-width` + `width: auto` on numeric markers; revisit `text-align: center` on bullets. | Visual e2e in `markdown-editing.spec.ts` measuring first vs wrapped line left edges |
| 14 | Header buttons read as cards | `editorSurface.tsx:393-433`; `styles/editor.css:137-158` (`.aachip`) | Three `.aachip` buttons carry a surface background and padding; the location chip is already flat. | Flat chips: no background, colour change on hover and for `.on`, hit area kept ≥24px; consider the shared `iconButton`. | `e2e/theme-flatness.spec.ts` assertion |
| 15 | Copying a chat loses Markdown | `chatSurface.tsx:1461-1467` (per-message copy is already raw); no copy handler on the thread | Selecting across rendered messages and pressing ⌘C serialises the DOM, so assistant Markdown is already consumed. | A `copy` listener on the thread maps the selection to `[data-chat-message-index]` rows and writes their source Markdown; a "Copy chat" action for the whole thread. | `chatMessagePresentation.test.ts`, `e2e/chat-workspace.spec.ts` |

| 16 | Chat: leave mid-run, come back — no "working" sign, and when the run finishes the reply never appears | `src/components/chat/chatSurface.tsx` (in-flight row, message list source); the `chatRuns` store (the sidebar's Working/Done badge reads it); the transcript persistence path | Reported 2026-09-16 with two screenshots: send a message, open another tab, return. The sidebar row says Working, the thread shows no in-progress row; when the sidebar flips to Done the thread still shows only the user's message; closing and reopening the chat tab shows the reply. The run completes in the store, so the surface's pending row and its appended reply both live in component state that a remount discards, and the remounted surface reads a transcript that the finishing run has not written yet or does not invalidate. | Derive both the in-flight row and the finished reply from the `chatRuns` store (the same truth the sidebar reads): a remounted surface shows the working row, streams into it, and on completion the reply is in the list without a reload. Confirm the transcript write and the query invalidation on completion. **Highest priority of the batch: a finished answer is lost from view.** | `chatSurface.test.ts`, `e2e/chat-workspace.spec.ts` (send, navigate away, complete, return) |

Cross-cutting: one range-select helper (8, 9); one back control (4, 11);
`createRoutedNote` is the single creation router and `merge()` is its only
bypass (6); silent `void promise()` without a `catch` is the shared failure
pattern behind 3, 6, and 15 while `setRowActionError` and `showFileNotice`
already exist as the honest error lanes.

### Why drag-and-drop keeps regressing

Finder drops reach the editor through Tauri's native drag session, not a
browser `DataTransfer` (`src/editor/nativeFileDrop.ts:1-12`). The browser
twin cannot produce that event, so no E2E spec exercises a real drop, and the
two files that route drops (`nativeFileDrop.ts`, `nativeFilePaste.ts`) have
**no unit tests of their own**; only the pure helpers beneath them
(`dropRouting.test.ts`, `externalImageDrop.test.ts`) are covered. The drop
path has been touched by seven commits since 2026-08-19 (chat drops, drop
routing, Finder paste, the paste-lane fix on 2026-09-14). Every one of those
could only be proven by a human in the native app, and the launch-readiness
audit records native acceptance as unproven. The fix for the regression
class, not just the two items, is: (a) unit tests for the two routing
modules that feed synthetic native events through the same code path the
Tauri listener uses, and (b) a native acceptance step for drops in the
`validate-in-the-native-app` skill, run before every release that touches
the editor or chat.
