# Canvas, Graph, and setup round — audit (2026-10-06)

Scope: the working branch `work/canvas-graph-round`, which joins four PRs
into one: #169 (sideways scroll), #170 (Graph), #171 (Skip setup), and #172
(Canvas, development builds).

Sources:

- the owner's review agent on each PR;
- three code audits of the joined branch: Canvas, Graph, and setup plus
  integration. Each one confirmed or refuted every review finding against the
  code and looked for more.

Every item below was confirmed in code unless it says otherwise. The joined
branch passes typecheck, 2,951 unit tests, and every structural check.

## P0 — fix before anything merges

These break a product law (secure notes fail closed, user files are the
truth), lose work, or ship a development feature into stable builds.

1. **Canvas shows secure note bodies before it knows they are secure.**
   - Where: `jsonCanvas/composition.ts` `useCanvasNotes` builds its secure set
     from `links.data ?? []`.
   - What goes wrong:
     - Until the Links query settles, or for good if it errors, every note
       card fetches and renders its body.
     - On the Mac, a note in an added vault is never in the projection, so it
       always shows.
   - Fix: fetch and render a body only after the projection has settled and
     says the note is not secure. Treat a note missing from the projection as
     secure.
2. **Canvas saves can lose or reorder edits.**
   - Where: `composition.ts` `flush`.
   - What goes wrong:
     - `flush` clears `pending` before the write succeeds, and a failed write
       is never retried.
     - Overlapping flushes (the timer, unmount, quit) race. On the web, the
       revision check and the write are not atomic.
     - `flush` swallows errors, so quit believes the canvas saved.
   - Fix: one write in flight per file; keep `pending` until the write
     succeeds; rethrow during quit.
3. **Typed card text is lost when you then drag another card (new).**
   - Where: `canvasEditor.tsx` `onPointerDown`.
   - What goes wrong: it commits the open edit, then starts the drag from the
     doc as it was before that commit. The first move writes the old doc back,
     and it saves.
   - Fix: `commitEdit` returns the doc it saved, and the drag starts from
     that doc.
4. **The Graph never settles after you drag a dot (new).**
   - Where: `forceLayout.ts`. `hold()` sets `alphaTarget(0.25)`, and nothing
     resets it.
   - What goes wrong: the simulation and redraw run every frame until the
     Graph closes, using CPU and battery on an idle view.
   - Fix: set `alphaTarget(0)` on pointerup and pointercancel, keeping the
     dot pinned.
5. **A missing file on the web opens as an empty canvas.**
   - Where: `services/canvasFiles.ts`. `webIo.read` turns a null read into
     `""`, which parses as an empty canvas.
   - Fix: return null and refuse with "isn't in the vault anymore".
6. **Stable builds present `.canvas` as a supported format.**
   - What goes wrong:
     - In every build, the Rust walk titles a `.canvas` without its extension,
       `glyphForNote` draws the canvas mark, the tab drops the extension, and
       `corpus_create_canvas` is registered.
     - In stable, it then opens in the file viewer as an unknown file, against
       the rule that a format presented as supported must be editable.
     - Development builds have a second problem: a `Plan.canvas` next to
       `Plan.md` makes every existing `[[Plan]]` ambiguous, so the link breaks.
   - Fix: gate all of the above on the Canvas flag (in Rust, debug builds
     only). Make a note win a title collision against a canvas.

## P1 — should fix in this round

### Graph

- **Stale after edits.** `applyNoteWrite` never invalidates `keys.links`.
  Fix it together with the next item.
- **The layout fingerprint depends on row order and titles.** Every refetch
  after an edit or pin re-lays out the whole graph. Fix: sort ids and edge
  keys, keep titles out, and restart at a low `alpha` when positions already
  exist.
- **The canvas swallows app shortcuts** (⌘0, ⌘=, ⌘−, ⌘←/→, ⌘⌥ arrows).
  `onKeyDown` matches on the key alone. Fix: skip modifier chords other than
  ⌘Enter.
- **A cancelled pointer leaves a drag stuck.** Fix: handle `pointercancel`
  and `lostpointercapture`, and end the drag when `buttons === 0`.
- **Links inside some code are counted.** Double-backtick code spans,
  `~~~` fences, and longer fences still produce links, and a lone backtick
  hides real links. The rule is shared by TS and Rust, so the fix must land
  in both: CommonMark run-length matching, plus parity fixtures.
- **Large sparse vaults show no resting labels**, because of the
  `degree >= 2` cutoff. Fix: rank by degree ≥ 1, falling back to the most
  recent notes.
- **Turning Librarian links on fades the written lines.** Fix: count only
  written edges in `restingLineAlpha`.
- **The Mac and the web disagree on what counts as secure.** The Mac uses
  the flag, the chat taint, or the detector; the web uses the flag or the
  folder. Fix: one rule on both sides, with a parity fixture. Canvas item 1
  depends on this too.
- **Big vaults stall.**
  - Labels are measured and placed even when off-screen, which is quadratic
    when zoomed in.
  - The layout runs on the main thread with no cap, so with reduced motion
    it runs about 194 synchronous ticks.
- **Keyboard focus can move a note off-screen.** Fix: pan to keep the
  focused note in view.

### Canvas

- **Invalid values in known fields are dropped** instead of kept in `extra`.
- **Every position is rounded on every save**, even nodes nobody touched.
  Fix: round only what Rotli moved or resized.
- **A read-only canvas, or one after a save conflict, still edits in
  memory.**
- **The Mac and the web disagree on where a new canvas goes.**
  - Legacy root: `Inbox` on the Mac, the vault root on the web.
  - `chats/` and the lanes count as note folders on the Mac only.
  - A name containing `/` is refused on the Mac and turned into `-` on the
    web.
  - Fix: one rule, with a parity test.
- **Obsidian image and PDF cards read "This note isn't in the vault
  anymore".** Fix: give non-`.md` file cards their own branch.
- **`getNote` loops forever** for a card whose note returns null. Fix:
  record nulls, and set state only when something was added.
- **`[[Some board]]` becomes a card pointing at a `.md` path that doesn't
  exist.** Fix: resolve only Markdown notes.
- **Dragging a group lifts it above its own cards**, so they can no longer
  be picked or connected.
- **No pointer-cancel handling**, so a stale drag or a half-drawn line can be
  left behind.
- **Keyboard gaps.** There is no key to make a card, connect two cards, or
  resize one, so an empty canvas needs a pointer.

### Skip setup

- **Phase "skipped" with a vault already configured asks for a folder
  again**, for example after quitting mid-switch.
  - Fix: finish setup when skipped and configured.
  - Test: relaunch with a saved "skipped" phase.
- **The prompt doesn't take focus**, so focus falls to the page body.
  - Fix: focus the button on open.
  - Show the ⌘↩ hint, the way setup's own buttons do.
- **Missing tests:**
  - `persist.test.ts` doesn't round-trip "skipped";
  - a cancelled folder pick from the prompt;
  - a failed folder pick from the prompt.

### Hover labels

- **"New private browser"** becomes second from the right when the theme
  button is hidden, and probably overflows by about 1 px. Fix: `tb-trail`.
- **The Quick Note window's trailing buttons cut off their labels** at the
  window edge. This was there before this round.

## P2 — nits

- Graph:
  - A move to another display with a different scale isn't redrawn.
  - Changing the accent doesn't repaint a mounted graph.
  - The literal `30` duplicates `LABEL_ALL_UP_TO`.
  - `neighborhood()` is quadratic on hub notes.
  - The first frame can show "Untitled" dots.
- Mac and web scope:
  - `chats/` is skipped on the web but not on the Mac in a plain vault.
  - The Mac's Links projection reads only the default vault.
- Canvas:
  - A note edited elsewhere stays stale on its card.
  - Bad UTF-8 in a canvas is mangled on save on the Mac.
  - `"nodes": null` and a missing `edges` key are rewritten as `[]`.
  - A colon in a folder name lands a web canvas in the wrong folder (not
    confirmed).
- Setup: `.rename-btn` has no disabled style.
- Docs:
  - The `noteGlyph.tsx` comment still says the Excalidraw logo is used for
    canvases.
  - The design doc says Rotli Web has no graph spec.
  - The design doc has a stale `folderNotes` line.
- "Show in graph" is hidden for archived notes, which are still Graph nodes.

## Checked and fine

- The Graph keeps secure text out of labels, search, and AI tools, and
  `corpus_links_list` isn't an MCP tool.
- Librarian links stay out of the layout and out of dot size.
- The startup fix is correct (it also stops a newest PDF opening as a note).
- The ⌘K row dedupe is correct.
- Every importer of the moved `glyphForNote` was updated.
- The app-settings key is wired end to end.
- Source ownership is complete.
- The `corpus_files.rs` move didn't regress Archive, Trash, or restore.
- The hand-edited `bun.lock` passes a frozen install.
