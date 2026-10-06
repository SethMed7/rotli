# Canvas and Graph — exploration (2026-10-05)

Status: **Graph ships through its own PR to `dev`; Canvas continues on its
branch** (owner decisions 2026-10-06, below).

- **Graph:** built for the Mac app and Rotli Web, with the Librarian's
  links (decision 4). The Rust projection is covered by cargo tests and the
  IPC contract check; the TypeScript side by unit tests and the browser-twin
  Playwright lane.
- **Canvas:** a working spike in development builds. Next: the owner's
  decisions plus New → Canvas, dragging notes in, groups and lines, and
  Rotli Web, as a second PR.

The ask (the owner, 2026-10-05): explore a canvas and a graph "like other apps
have" ([Obsidian Canvas](https://obsidian.md/canvas), Obsidian's graph), but
"find a clean way to do it that doesn't create visual clutter, and keep the
raw notes like it is now."

## The rule both follow

**Notes stay raw.** Neither view writes anything into a note, adds a panel to
the writing screen, or puts a row in the sidebar.

- **Graph** is a *projection*, like Tasks. It reads the `[[links]]` people
  already write and stores nothing. Closing it leaves no trace.
- **Canvas** is a *file of its own*: a `.canvas` file that points at notes by
  path. Arranging cards on a canvas never changes a note, and deleting the
  canvas deletes only the arrangement.
- **Both are reached on demand, never shown by default:** ⌘K, a note's
  context menu, and (for Canvas) the New chooser. The editor, the sidebar,
  and the title bar look exactly as they do today.

## Graph — built

### What it is

One surface with two scopes:

| Scope | How you get there | What shows |
|---|---|---|
| **All notes** | ⌘K → "Graph of all notes" (`view.graph`, no default chord; bind one in Settings → Hotkeys) | every live note, every link between them |
| **Around a note** | a note's context menu → **Show in graph**, or ⌘K → "Show this note in the graph" (`view.graphAround`) | the note and its neighbors, one or two steps out |

From inside the graph:

- Click a note to open it.
- ⌘-click opens it in a new tab.
- ⇧-click re-centers the graph on that note.

The local graph is the same surface, so there is no separate local-graph
panel to place.

### How it stays calm

The screenshot Seth sent is the reference for density. Rotli goes further in
the quiet direction:

- **Flat** (DESIGN.md, Flat material): one-pixel lines, filled dots, no glow,
  no halo, no shadow. Every color is read live from semantic tokens
  (`--border-strong`, `--text-muted`, `--text`, `--accent`, `--ground`), so
  all seven theme families work in light and dark with no new palette.
- **Few words at rest.**
  - A graph of 30 notes or fewer names every note.
  - A bigger graph names only its **12 most-linked notes**. This is a count,
    not a degree cutoff, so a dense vault never becomes a wall of words.
  - Every other label appears on hover, keyboard focus, a search match, or
    when zoomed in close.
  - A label that would overlap a more important one is skipped.
- **Hover isolates.** Pointing at a note turns its own lines to the accent
  and fades everything else to 25–30%.
- **Density-aware lines.** Lines draw fainter as the link count grows, so a
  thousand links read as texture rather than a scribble.
- **Search highlights in place.** "Find a note" lights up matches and fades
  the rest. It never removes dots, so the layout doesn't jump.
- **Header only:** Back to notes · Graph · a count · the search field. The
  "Around *note* · Show 2 steps · All notes" chips appear only in the local
  scope. A one-line hint sits at the foot of the pane and is hidden in narrow
  windows.

### Secure notes

- **Titles show and text never does.** There is no hover excerpt at all.
- Secure notes are drawn as **hollow rings**, so their state is never told by
  color alone, and the live region says "secure".
- `corpus_links_list` is **not agent-exposed**: no AI tool, MCP verb, or CLI
  command returns it. This is the same stance as the Tasks projection.

### Data path

The data path follows the Tasks model exactly:

| Layer | File |
|---|---|
| Rust projection (reads the walk cache, no second disk pass; fenced and inline code skipped; Trash/Archive/chats/boards excluded) | `src-tauri/src/corpus_links.rs` → `corpus_links_list` |
| TypeScript twin for Rotli Web / the browser twin | `src/services/webLinks.ts` + `src/graph/linkTargets.ts` |
| Both link readers agree on the same bodies | `scripts/fixtures/parity.json` `wikilinkTargets` |
| Resolution (one resolver: the editor's) | `src/graph/model.ts` → `resolveWikilink` |
| Scope (all / around, 1–2 steps) | `src/graph/workflow.ts` |
| Layout engine (the only `d3-force` import) | `src/graph/engine/forceLayout.ts` |
| Renderer (2D canvas, no React) | `src/components/graph/graphRenderer.ts` |
| Surface | `src/components/graphSurface.tsx`, content view `"graph"` |

Rust returns **raw** targets (`Note|label`, `Note#heading`). TypeScript
resolves them with the same function the editor uses to open a link, so an
edge in the graph is exactly a link that opens in the editor:

- An ambiguous title draws nothing.
- A missing target draws nothing.
- A link into a chat, a board, or Archive resolves but draws no edge, because
  only live Markdown notes are nodes.

Links someone wrote in a note's **body** are solid lines. The one-line
frontmatter `links: [[a]], [[b]]` the Librarian writes rides along
separately (`suggested` in `corpus_links_list`; `metadataLinkTargets` on
the web, parity entry `metadataLinkTargets`) and draws **dashed and
fainter** (decision 4):

- It is on by default, so people see what the Librarian does. One
  **Librarian links** chip hides it, shown only when the vault has any, and
  the choice is remembered on this Mac (`graphLibrarianLinks`).
- The count says how many lines are the Librarian's
  ("8 links · 2 from the Librarian").
- A pair someone linked by hand is never also a dashed line.
- Librarian links don't pull on the layout and don't count toward a dot's
  size or its resting label, so switching them never moves a dot. A local
  graph reaches through them only while they are on.
- A multi-line YAML `links:` list isn't read.

`d3-force@3.0.0` is now a direct dependency (`check:architecture` pins it to
`src/graph/engine/`). It was already in the lockfile through Mermaid, so
nothing new is downloaded.

### Accessibility

- The canvas is one keyboard stop (`role="application"`) with an
  instructional label.
- Arrow keys travel to the nearest note in that direction. Enter opens it,
  ⇧Enter centers on it, Esc clears the focus, `+`/`−` zoom, and `0` fits.
- An `aria-live` region names the focused note and its link count.
- Reduced motion runs the layout to rest in one step, with no animated
  settling.
- Every pointer action has a keyboard path. The search field reaches any
  note by name.

### Proof

- `src/graph/model.test.ts` and `viewport.test.ts` cover resolution,
  ambiguity, scope, labels, fit, hit tests, and arrow travel.
- The Rust tests in `corpus_links.rs` and the `wikilinkTargets` parity case
  check that both link readers agree.
- `e2e/graph-view.spec.ts` drives real controls in the **browser-twin**
  Playwright lane: the ⌘K pick, the row menu, the scope chips, the keyboard
  on the canvas, and opening a note. The Rotli Web lane (`e2e/web/`) has no
  graph spec yet.
- The Rust command itself has only run under `cargo test`, never in the live
  Mac app.
- The demo corpus gained four lines of `[[links]]`, so the browser twin has a
  graph to show. Each sits on a new last line, so existing text is unchanged.

Correction to the [2026-09-23 evaluation](canvas-tasks-logseq-eval-2026-09-23.md):
it says "the search index already resolves wikilinks". It doesn't. No index
of outgoing links existed until `corpus_links_list`.

### Not built (next slices if the owner keeps it)

- **Backlinks.** The same projection answers "who links here" for free.
  Adding a backlinks *panel* to a note is the roadmap item, but it adds chrome
  to the writing screen. A count in the note's context menu ("Linked from 4
  notes") may be all the chrome it needs.
- **Unresolved links as ghost nodes.** Obsidian shows them. Left out for calm.
- **Persisted pins and positions.** Positions are view state today, and a
  rebuild lays out again.
- **Filters** (folder, tag): `NoteSummary` carries no tags on the Mac app
  today.

## Canvas — spike

### Engine fork (owner decision 1)

The 2026-09-23 evaluation recommended building the freeform canvas **inside
Excalidraw**. Seth's link points at Obsidian Canvas, which is a different
product:

| | Excalidraw board (today) | JSON Canvas (proposed) |
|---|---|---|
| What it's for | drawing: shapes, arrows, handwriting | arranging: note cards, text cards, links between them |
| File | `.excalidraw` scene | `.canvas` — [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), an open spec Obsidian reads and writes |
| Chrome | Excalidraw's own toolbar and menus | none at rest (see below) |
| A note on it | a foreign embeddable, broken in other Excalidraw apps | a first-class `file` node; Obsidian shows the same card |
| Colors | Excalidraw's palette | spec presets `1`–`6` map to theme tokens; no raw colors |

**Recommendation: JSON Canvas, as its own kind, beside boards.**

- Boards stay for drawing. A Canvas is for arranging notes.
- The file opens unchanged in Obsidian. That is Rotli's "files are the
  product" positioning made literal.
- Doing it inside Excalidraw would keep one spatial surface but make every
  note card an embed hack.

### How it stays calm

- **No toolbar, no zoom widget, no minimap.**
  - An empty canvas shows one quiet line: "Double-click anywhere to write a
    card. A card holding just `[[a note]]` becomes that note."
- **Adding a note uses Rotli's own link grammar.**
  - Double-click, type `[[Pricing decision]]`, press Esc or click away, and
    the card becomes that note's card.
  - No picker or button is needed.
- **Controls appear only where attention already is.**
  - A card's four connect dots and its resize corner show on hover, on
    keyboard focus, or when the card is selected. Otherwise nothing floats.
  - A selected card shows only an outline.
- **Connecting.** Drag a side dot onto another card. The line leaves from the
  facing sides on a gentle curve.
- **Groups** are a labeled one-pixel outline with no fill. Moving a group
  carries the cards inside it.
- **Zooming and fitting** use pinch or ⌘-scroll, and `0` fits, as in the
  Graph.
- **Keyboard.**
  - Tab reaches each card, and each card announces its kind, color name, and
    title.
  - Enter edits a text card or opens a note.
  - Arrows nudge (⇧ moves farther), Delete removes, Esc deselects.
- **Colors.** A JSON Canvas color is kept in the file exactly as written.
  Rotli has no category palette yet (no red, yellow, or purple tokens), so a
  colored card shows a heavier border, never a raw hue. Its name ("yellow")
  is in the card's label. Naming the six preset roles in every theme is
  open question 7.

### Notes stay raw

- A note card is `{"type":"file","file":"<path>.md"}`. The note is never
  copied or touched.
- **Edges are canvas-only** (evaluation decision 1, option (a)). They are not
  wikilinks and are not counted in the Graph. Option (b), indexing them as a
  derived "linked from canvas X" projection, stays open (question 2).
- A text card is canvas-owned Markdown, edited in place. It lives in the
  `.canvas` file, like Obsidian's.

### What a note card shows (owner decision 3)

PRODUCT.md rules out "a decorative whiteboard wrapped around static
previews".

- The target is a card that **is** the note: the real editor mounted in place
  (the `embedHosts` pattern), read-only while that note's own tab is open
  (the one-writer rule boards already follow).
- The spike renders the note through `MarkdownPeek` (the same line grammar
  as the editor). Double-clicking or pressing Enter opens the real editor in
  a new tab.
- A **secure** note card shows its title and "Secure note. Open it to
  read." and never its text.
- A path no note answers to keeps its place as a "missing note" card. It is
  never deleted.
- **That is the spike, not the target.**

### What the spike is made of

| Layer | File |
|---|---|
| JSON Canvas 1.0 parse/validate/serialize. Unknown node types, extra fields, and hex colors survive a save; output is Obsidian-shaped (tab-indented, one item per line). | `src/jsonCanvas/model.ts` + `fixtures/obsidian.canvas` |
| Pure edits: add text/note card, move (a group carries its contents), resize, connect, remove, bring to front | `src/jsonCanvas/workflow.ts` |
| A note's vault path ↔ its id; the lone-`[[link]]` rule | `src/jsonCanvas/notePaths.ts` |
| Load, debounced revision-checked save (`corpus_write_file_bytes`), quit flush, note lookup | `src/jsonCanvas/composition.ts` |
| The editor (DOM cards plus one SVG for lines) and its file host | `src/components/jsonCanvas/` |
| Development-only gate | `launchFeatures().jsonCanvas` (desktop and development) |

Theme colors for canvas painters now come from one resolver,
`src/brand/tokenColors.ts`, which the onboarding banner shares.

**Not built in the spike:**

- a New-chooser "Canvas" kind
- Rotli Web listing and saving `.canvas` files
- dropping notes from the sidebar
- creating groups
- selecting or deleting a line on its own (lines go with their cards)
- editing an edge label
- "Arrange on a canvas"
- a storage lane
- color tokens
- the in-place real editor

### Graph ↔ Canvas

The two meet in one gesture: **"Arrange on a canvas"** from a local graph
writes a new `.canvas` with a note card at each dot's position. The graph is
for finding connections. The canvas is for arranging them. Not built in the
spike.

### Where `.canvas` files live

- **Mac app:** `.canvas` already lists as a file (`NoteKind::File`).
  - Saves go through `corpus_write_file_bytes` with a revision check, so they
    work in writable lanes (`wiki/`, a plain vault folder).
  - In a memex, `storage/` is read-only except the Excalidraw and office
    lanes. A `.canvas` lane there needs a Rust policy change plus a
    `parity.json` constant (question 5).
- **Rotli Web:** `folderNotes.ts` lists only `.md` and `.excalidraw`, so a
  `.canvas` file is invisible on the web until it does. This is required
  before Canvas leaves development builds.

### Naming

- `surfaceKind: "canvas"` already means the Excalidraw board tab. It is
  persisted in real users' view state, so it should not be renamed.
- The new code uses `jsonCanvas` internally and **Canvas** in the interface,
  per the evaluation's decision 4.

## Owner decisions (2026-10-06)

The seven open questions, answered by the owner on 2026-10-06:

1. **Engine:** JSON Canvas (`.canvas`) as its own kind. Excalidraw boards
   stay as they are, for drawing. This supersedes the 2026-09-23
   recommendation to build inside Excalidraw.
2. **Canvas lines:** drawing only. A line lives in the `.canvas` file and
   never changes notes, backlinks, or the Graph.
3. **Note cards:** rendered text that opens in a tab first (the spike).
   The real editor inside the card goes on the roadmap.
4. **Librarian links:** shown in the Graph by default, drawn dashed and
   fainter so they read as suggestions, with one quiet switch to hide them
   (the choice is remembered). The point is that people see what the
   Librarian does.
5. **Storage:** a new canvas goes beside notes, in the folder it is created
   from, like Obsidian. No storage lane.
6. **Entry points:** ⌘K and the note menu only. No sidebar or Home row.
7. **Canvas colours:** six roles (`--canvas-1`…`--canvas-6`) in every theme
   family, light and dark, so JSON Canvas colours paint.

**Sequencing:** the Graph (with decision 4) ships as its own PR to `dev`
first. The Canvas continues on its branch with the decisions applied and
these pieces added, as a second PR: New → Canvas, dragging notes in,
groups and standalone lines (select, label, delete), and Rotli Web support.
Native checks: the agent tests first in an isolated dev build on a
synthetic vault, then the owner reviews.
