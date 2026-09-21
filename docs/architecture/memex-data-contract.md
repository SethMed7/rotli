# Vault data, Rotli layer, and creation contract

The user-facing durable workspace is a **vault**: one ordinary folder the user
chooses and owns. Rotli has no application database. Files in the vault are the
source of truth; indexes and `.rotli/` files are rebuildable projections or
explicit settings. Older portable files and internal modules retain literal
`memex` names (`memex.json`, `src/memex/`, and Rust command names) for format and
API compatibility. Those names describe Rotli's internal contract layer, not a
second user-visible product or storage location.

## One physical home, many views

- **Main is a view.** `.rotli/main.json` stores ordered item references and
  Main-only folder structure. It never owns or copies content.
- **Named views are subsets of Main.** `.rotli/views.json` version 1 stores
  uniquely named reference trees with their own virtual folders. Main retains
  every item assigned to a named view; switching views changes navigation and
  creation context, never physical storage.
- **Chats join named views (2026-08-03).** A view may carry a `chats` list of
  chat slugs (additive field, absent = none; singular membership like notes).
  Chats have no frontmatter `view_tag` — the list is their whole membership —
  and Rust round-trips the field verbatim. An active view with live chat members
  narrows the Chat front to them; an empty, legacy, or stale membership falls
  back to every saved chat instead of blanking a non-empty sidebar. Chat always
  names an inherited active view in its own front and offers a one-click return
  to Main/all chats, so a Notes-side view change never becomes an invisible
  filter. A chat created while a view is active joins it.
- **Web-search destination is an explicit vault setting.**
  `.rotli/settings.json` stores only `webSearchProvider` (`duckduckgo` by
  default, or `brave`); it never stores an API key. The per-chat globe remains
  the consent bit for whether that chat may use the network and is not a
  provider selector. It stays offered for every lane: frontier CLIs run
  tool-less inside Rotli, so the globe is their only web path, and a chat never
  turns it on by itself. With it off, a frontier lane still answers general
  questions from the model's own knowledge and mentions the globe only when an
  answer depends on live data; the on-device lane says it can't confirm
  outside-world facts. Brave credentials live under Rotli's allowlisted macOS
  Keychain account, while search execution and provider failure policy remain
  application/adapter concerns outside the vault contract.
- **Breve stays inside the active vault.** Its portable routine configuration
  lives under `.rotli/routines/`; its private runtime state and sanitized event
  source live under `.rotli/breve/`; its watchlist and generated briefs are
  ordinary canonical vault Markdown. Dashboard cards and Notifications are
  projections, never a parallel news database. A 30-day watchlist backfill is
  an explicit user-triggered routine and writes one ordinary brief through the
  same sandboxed runtime instead of silently fetching on Save.
- A Markdown note may belong to one named view. Rotli synchronizes the exact
  view name into managed `view_tag` metadata on assignment, rename, deletion,
  UI, CLI, and MCP writes. View names are unique case-insensitively and use
  letters, numbers, spaces, periods, underscores, or hyphens; `Main` is
  reserved. Boards and binary files remain frontmatter-free, so their view
  membership exists only as an explicit reference in `.rotli/views.json`.
- **Markdown notes** are plain `.md` files. With the Librarian enabled, a smart,
  Main, or Library selection routes a new note through **Library intake**, the
  portable staging lane at `wiki/_inbox/`. With the Librarian disabled, a new
  ordinary note lands directly under `wiki/`; no organizer exists to move it
  later. Secure notes keep their protected `wiki/_secure/` home in both modes.
  An explicit writable local folder remains the physical home.
- **Global capture destinations are explicit and independent.** Quick Note and
  Quick capture each default to the current writable vault, while Settings may
  pin either entry point to a different registered vault with `chats+inbox`
  access. The chosen root id lives in `.rotli/settings.json`; Quick Note syncs
  its choice between the main and floating webviews. An explicit root that is
  removed or becomes read-only fails closed instead of silently receiving the
  thought elsewhere. Quick Note's existing local-folder choice remains
  available only while it follows current routing.
- A Rotli-authored note's first H1 is its title. The filename is a derived,
  human-readable projection: lowercase title words joined with hyphens and a
  `.md` extension (`# Strategy master` → `strategy-master.md`). Stable identity
  lives only in frontmatter. Two same-title siblings use the familiar
  `strategy-master (2).md`, `strategy-master (3).md`, … sequence.
- Editing the title at the top of the note and choosing Rename from a note's
  menu are the same domain operation: both update the H1-derived title and
  physical filename while preserving the stable `id`. The first H1 wins even
  when prose or H2–H6 headings precede it. Legacy notes whose title is the first
  non-empty non-H1 line remain readable; a deliberate rename promotes that
  legacy title line to an H1 without reinterpreting the rest of the body.
- Filename normalization is adoption-on-write, not a scan-time migration. New
  notes use the readable form immediately; editing or explicitly renaming an
  older `<slug>-<id6>.md` note moves it to the readable form. Merely opening or
  listing a vault never rewrites user files.
- **Documents and sheets** created by Rotli live in the managed binary lane:
  `storage/rotli/` in a Rotli vault or `Storage/` in the legacy layout. A
  document's filename is its name: ordinary user creation collects the name
  first (like a board) and writes `<name>.docx`; only a nameless embed target
  falls back to `untitled-<timestamp>.docx`. Rename… on a document or sheet row
  or tab renames the file in its folder, keeps the extension, refuses a name
  another file already holds, saves any unsaved edits first, and retargets open
  tabs plus Main and named-view references (`corpus_rename_managed_file`,
  `services/itemRename.ts` owns which items are renamable).
- **Boards** are raw `.excalidraw` files. The corpus adapter chooses the writable
  Excalidraw lane for a Rotli vault and a selected writable folder for legacy storage.
  Ordinary user creation collects a nonblank name before writing anything, then
  creates the collision-safe final filename atomically; cancelling the prompt
  leaves no `untitled.excalidraw` placeholder behind.
- A populated item adds its one stable id/path to Main after durable creation
  and identity refresh; presentation may precede that structural work. A new
  plain Markdown note is the deliberate exception: its durable corpus file and
  editor tab exist immediately, but the empty session draft stays out of Main
  and named views until its first successful non-empty body save. That first
  save files the correctly titled note into the Main/view context captured when
  creation began. The corpus summary carries exact editor-body emptiness, so
  Main also suppresses a pre-existing blank Markdown reference without title or
  snippet heuristics; the manifest slot and user file remain intact and the row
  returns if content is later authored through another surface. Refiling the
  physical item does not duplicate or invalidate the Main arrangement.
- Creation from a named view also adds the item to that view and its current
  virtual folder. Creation from Main adds no `view_tag`. Removing a named-view
  assignment never deletes content or its Main reference.
- Clicking or keyboard-opening a Main or named-view folder makes that virtual
  folder the creation parent for every item kind. Opening the new-item chooser
  must retain that parent while the user chooses Markdown, document, sheet,
  board, or Mermaid. The chooser may also expose non-durable actions such as
  opening the system web browser; those actions create no vault item. Named-view
  creation also retains the global Main reference.
- ⌘T creates and activates a session-only pending tab synchronously, before file
  I/O. For Markdown, that tab renders and focuses the ordinary empty editor on
  its first paint; keystrokes live in a session buffer until creation returns a
  durable wire id and revision, then move onto that same note before the tab is
  retargeted. No blank/loading surface or query gap sits between the key event
  and typing. Closing the pending tab suppresses later reopening. For a plain
  Markdown draft, the authorized background creation is allowed to settle and
  Rust then hard-discards the result only if its body is still blank; populated
  formats remain durable. Main/view filing follows the refreshed identity index
  and, for plain Markdown, the first successful non-empty save, so projection
  filtering cannot mistake the new reference for a stale id or expose an
  empty `Untitled` row.
- The Librarian waits for the configured quiet window after the note's
  latest edit (five minutes by default) before classifying or refiling it. New
  edits reset that window; filing changes location/metadata, never note prose.
- A newly created DOCX remains a session-pristine draft until its first content
  mutation. Explicitly closing its final tab while it is still pristine moves
  the managed file to Rotli's recoverable Trash and removes its Main reference.
  Rotli never infers that a pre-existing blank document is disposable.

## Durability and concurrent edits

- Markdown, board, DOCX, sheet, CSV, and generic managed-file reads return a
  content revision derived from the exact bytes read. Every replacement write
  must present that revision; a mismatch normally leaves the newer disk bytes
  untouched. A human Markdown body save also presents the exact editor body
  associated with its revision. Under the same file lock, Rotli may rebase that
  save when the complete-file revision changed but the current disk editor body
  still equals that baseline—the safe location/frontmatter-only case—because
  the write path re-reads and preserves the newer metadata. If disk prose also
  changed, it remains a real conflict: the editor keeps its dirty buffer and
  surfaces it rather than overwriting either version.
- Saved chat updates use the same rule. Creation refuses an existing slug, and
  `secureContext` is a one-way transition inside the same locked write window,
  so concurrent windows cannot erase taint or overwrite a newer transcript.
- A successful direct chat-note write invalidates the owning `CorpusStore`
  generation before returning. Its initiating webview can therefore read the
  new note immediately instead of waiting for a watcher echo. Watcher delivery
  refreshes notes, chats, chat folders, Main, named views, and journal
  projections independently, so one failed refresh cannot suppress the rest.
- A physical path is a locator, not note identity. User and Librarian moves
  rewrite one source file and then rename it while preserving the frontmatter
  id; they never implement identity-preserving moves as copy plus best-effort
  delete. An open clean buffer adopts a move-only complete-file revision even
  when its visible body is unchanged. A dirty buffer keeps its local prose and
  adopts that revision only when the freshly read disk body still matches its
  saved baseline. External rename/delete and genuine body divergence retain the
  dirty bytes for recovery instead of guessing.
- Ordinary saves use same-directory temporary files, file sync, atomic replace,
  and a best-effort parent-directory sync. Disk, permission, serialization, and
  revision failures are errors, never reported as saved.
- Quit and in-app restart are coordinated with all three webviews. Every
  registered editor, board, document, sheet, settings, and projection flush must
  acknowledge the attempt; failure or timeout cancels exit/restart and restores
  the main window with an error. Forced process/OS termination can still lose
  unsaved in-memory debounce work; no durable draft journal exists yet.

## Editing capabilities

- **Workspace invariant:** images and video are the only preview-only file
  surfaces. Every other format advertised as supported must have a native edit
  and save path. A format without one remains unsupported and must lead to an
  explicit local conversion/import workflow rather than a passive preview.
- Audio is a work surface, not an exception: playback alone does not constitute
  editable support. Its complete workflow must expose user-owned output such as
  transcript, cuts, annotations, or metadata before Rotli calls it supported.
- Markdown is the primary knowledge surface. It exclusively owns slash commands,
  typed embed fences, wikilinks, note frontmatter, and note-native workflows.
  DOCX documents, sheets, and Excalidraw boards are secondary bonus work
  surfaces with conventional file behavior, not parallel note systems. Slash
  commands activate in paragraph or list-item content; list markers remain in
  place and multiline scaffolds indent their continuation lines inside the item.
- A Markdown `mermaid` fence owns its diagram source. The rendered block opens a
  View/Code workspace (Visual editing is development-only via the centralized
  launch feature policy); `/Mermaid` inserts a valid starter flowchart. View
  provides pan, zoom, and fit. Visual losslessly edits supported flowcharts as
  readable Mermaid shapes, labels, directions, connections, and portable node
  colors; unsupported diagram families and advanced syntax fail closed into
  Code without rewriting source. Applying edits replaces only the fence body.
  Visual-canvas positions are intentionally temporary because Mermaid owns
  final layout. The secondary `Convert copy to Excalidraw…` action creates a new
  user-owned `.excalidraw` file in the active creation context and leaves the
  Mermaid fence unchanged.
- Documents are conventional DOCX files. They do not host Markdown slash
  commands or embed syntax. Rotli creates and edits them locally through a
  structured document model, including native Word tables. The DOCX codec
  round-trips supported OOXML while preserving unknown package parts and
  unsupported Word objects; the Rust corpus boundary independently restricts
  writes to the managed binary lane. The document editor always presents light
  Word-style chrome, literal white paper, and black Arial defaults when the file
  does not specify formatting. It settles at the document top with one complete
  page fitted to the pane and does not expose Markdown block handles or canvas
  margin-corner guides. Portaled controls retain the document insertion range,
  and only content mutations—not viewport changes—activate Save.
- Chat artifact requests preserve the requested conventional format. Explicit
  Word/DOCX requests create a real editable `.docx` through the same managed
  document workflow, Main/view filing, and Rust corpus boundary as toolbar
  creation; they must never be silently substituted with a Markdown note.
  Bare “doc/document” requests are clarified as Word versus Markdown before
  any file is created. Raster images generated earlier in the same agent run
  are embedded as conventional DOCX media and rendered through the local
  document adapter; an unreadable or unsupported image fails the document
  creation visibly rather than becoming an invisible placement claim. Secure-
  tainted chat content cannot be written to DOCX because conventional files do
  not carry the secure-note policy.
- Legacy `.doc`, `.rtf`, and `.odt` conversion is local and copy-only: the fixed
  macOS system converter produces a new managed DOCX, the original is never
  overwritten, and the result is not added to Markdown slash results until it
  exists as an editable DOCX. Formats without a faithful local route remain
  explicitly unsupported.
- Sheets use the workbook editor/codec boundary; boards use the canvas boundary.
- The **Tasks** view is a per-call projection of open `- [ ]` checkboxes across
  ordinary Markdown notes (fenced code skipped; Trash/Archive/chats excluded;
  secure and locked notes included — it is the user's own local screen and is
  not exposed through the agent workspace). Adjacent two-choice result rows
  (`- [ ][ ]`, `- [x][ ]`, `- [ ][x]`) are explicitly not tasks. Radio-style
  choice rows (`- ( )`, `- (x)`) are also
  note content rather than tasks; adjacency plus equal indent defines their
  exclusive group, with no metadata record or choice database. Checking a
  task off rewrites that
  one line through the ordinary note write path after re-validating the exact
  text; no task database or task metadata exists. Spec:
  [`2026-07-25-tasks-surface.md`](../decisions/2026-07-25-tasks-surface.md).
- Sheet and CSV surfaces carry a read-only **Details** popover of derived facts:
  file name, the canonical absolute path resolved from the corpus router on
  every open (never copied into any file, where a move would strand it), byte
  size, filesystem stamps, format family (CSV/TSV delimiter and UTF-8 decode,
  or workbook), and per-sheet dimensions computed lazily on open. A parse cap
  reports "N+" rows rather than implying an exact total; boards and binaries
  remain frontmatter-free and nothing from this panel is ever stored.
- Markdown document slash commands list only formats the embedded document
  editor can edit. They may create a blank managed DOCX or embed an existing
  editable DOCX-family file without leaving the parent Markdown tab.
- **Provider-backed AI image generation is unavailable (2026-09-01).** The
  stable `generate_image` IPC command fails before root/path resolution,
  credential lookup, or process spawn. Existing generated images remain normal
  user-owned assets, and attached images remain available only to interactive
  chat models whose live capability record declares vision support.
- Chat-created images, boards, and Word documents stay closed after creation
  and are registered in the originating chat's portable `rotliArtifacts`
  frontmatter. A wide chat can reveal that list as a quiet artifact rail; when
  its pane becomes narrow, the same list remains available from the header
  control. Conventional documents additionally remain visible as file buttons
  attached to the final assistant turn. Selecting an artifact—not creation
  itself—uses the explicit UI preference: reuse one right-side pane (default),
  create a pane, or open a new tab. This preference is projection state and
  never changes the artifact's durable identity. A generated image
  observation supplies the exact `storage:` Markdown source. If the same run
  creates a note with only that image's basename, the host
  repairs it to the pinned storage source rather than leaving a broken root-
  relative link.
- Images selected or dropped into Chat are copied into the initiating registered
  root's managed image lane before the turn is sent. The transcript stores only
  a portable `storage:` reference; Rust bounds the payload, validates its image
  signature and extension, enforces root mutability, and writes atomically.
  Unsupported drops fail before Rotli imports them. A chat whose selected model
  cannot see images refuses the drop with a modal before importing any image;
  switching to an image-capable model and dropping again attaches it.
  With Tauri's multi-webview runtime, native drags arrive on the workspace
  webview event channel, not the window channel. Only local workspace webviews
  may forward them to `native_drag::handle`; private-browser children cannot
  grant workspace imports. Drops on a modal block all delivery fallbacks.
  A native Finder drop first
  creates short-lived, single-use grants for its exact canonical files; only
  then does Rust emit the authorized paths and drop position to the webview.
  An ordinary webview drag event cannot authorize an arbitrary path. When a
  runtime supplies byte-backed browser `File` objects instead of native paths,
  those bytes may use the separately bounded, signature-validating image-asset
  command. Markdown drops resolve nested pointer hits to the owning editor,
  accept physical or logical runtime coordinates, copy into that note's
  registered root, and normalize both default and root-prefixed import ids to a
  portable root-relative `storage:` source. `/attatch` (also searchable as
  `/attach`) opens a native multi-image picker whose returned paths receive the
  same single-use grants before import. A failed copy is surfaced and never
  reported as an inserted image. The drop router walks every element under the
  point past non-modal overlays and stops at a modal; a drop with no chat or
  note under it still copies into Assets and says so, and a drop Rust grants
  nothing for (folders) emits `rotli:native-drop-refused`. A Finder copy
  pasted (⌘V) into a note or chat takes the same path: Rust reads the
  pasteboard's file references and grants them at most once per pasteboard
  change, so the webview cannot re-import a copied file without a new copy.
- A requested PDF is an exported copy of a separate editable Markdown source,
  both attached to the originating assistant turn. Rust keeps both in the same
  registered root and refuses secure, secret-shaped, locked, read-only, or
  oversized sources before invoking the local macOS renderer.
- Unsent chat title, text, and image attachments are session state owned by the
  stable tab id. Switching tabs or temporarily unmounting a chat surface never
  clears that draft; sending it does. The first successful save binds the
  initiating tab rather than whichever tab happens to be active when an async
  write completes.
- A chat's filename comes from the title it is created with and never moves
  when the title later changes; only the `title:` line and the contract-owned
  H1 follow a rename. A chat the person left unnamed is created with a
  words-first title (image handles are not words) and, after its first reply
  is saved, may have that title improved once by the chat's **own** model —
  never the Librarian's or any other. The request goes through the same
  secure-context refusal as the chat's turns, its reply is accepted only as a
  short plain title that is safe to write bare into YAML, and a name the person
  typed (before or during the request) is never replaced. The
  `chatTitleByMeaning` setting turns the request off.
- A newly scaffolded vault contains one app-owned root note,
  `Welcome to Rotli.md`. It is real, durable Markdown, opens in the ordinary
  editor, gives the user a short list of things to try, and may be edited or
  moved to Trash through the normal note lifecycle. Its exact root path is a
  narrow interactive write lane; other root Markdown remains hidden and
  read-only. Because Library is the `wiki/` projection, the welcome note never
  appears there. Scaffolding still restores Home/Notes navigation after carrying
  the outgoing vault's reusable appearance and editor preferences.
- Every new vault starts with a **Welcome** folder in Main: the root welcome
  note first, then nine lessons. `src/assets/welcome.json` is the one catalog;
  its first entry is the welcome note body the scaffold writes, and the rest
  are ordinary Markdown notes in the vault (`wiki/Welcome/` in a memex layout,
  `Welcome/` in a plain notes folder). They open from the left menu in the
  ordinary editor, save like any note, and may be edited, removed from Main, or
  trashed through the normal lifecycle. Nothing about them is session-only, and
  there is no separate practice vault.
- Seeding happens only when a vault is created (onboarding's empty folder and
  the switcher's Connect on an empty folder, both through one activation path)
  and on the explicit Settings → General → **Open welcome folder** action.
  Opening an existing vault never writes. The native seed
  (`corpus_seed_welcome`) returns `{ created, noteIds }` in catalog order; the
  welcome note's id leads when the note still exists and is never recreated.
  An intact lesson is matched by exact title inside the lesson folder and
  reused, so user edits are never overwritten and a trashed lesson returns as
  a fresh file on the next seed. A reused lesson (or the welcome note) whose
  body, after CRLF→LF and trailing-whitespace normalization, hashes to a body
  Rotli once shipped is refreshed to the current copy through the ordinary
  atomic save; any other body is the user's and is left alone. The shipped set
  is `src/assets/welcome-history.json`, appended by
  `scripts/welcome-history.mjs` whenever `welcome.json` changes (a tooling test
  and a Rust test fail until it is). Existing vaults pick up copy changes on the
  next seed (Open welcome folder), not on launch. New lessons carry no capture shelf metadata
  and remain in Library. The frontend then files every id missing from Main
  under one `Welcome` root folder in catalog order; a Main save failure is
  reported and the next open retries the filing without creating files.
  Seeding never writes a named view.
  Expensive chat, board, and conventional-file surfaces may remain mounted in a
  small recent-tab cache so ordinary tab switching does not rebuild them on the
  WebKit main thread. The cache is bounded, inactive surfaces are inert and
  hidden, and each chat retains its own tab identity, draft, and active run.
- User turns are the navigation landmarks for a long transcript. The chat may
  derive a compact left-edge prompt navigator from rendered messages; it is a
  view only and does not create another chat index or durable identity.
- The Markdown chat file always keeps the complete transcript. On open, the
  interactive surface mounts only the newest 500 messages and says how many
  earlier messages remain in that file; completing another turn keeps the same
  rolling UI window. Model input is narrower still: the existing per-model
  character budget keeps only recent conversation history, while retrieval can
  reopen an older chat explicitly. Rotli never depends on or resumes a
  provider-owned session for continuity; switching models always uses the
  Rotli-owned Markdown transcript. A provider may still retain request data
  under its own policy.
- Every model adapter shares one bounded clarification response shape: one
  concise question with two or three mutually exclusive options. The loop
  accepts it only when a missing material choice changes the result or file
  action, renders it through the same application event for local, connected,
  and hybrid models, and never treats the options as tools or authority. The
  pending choice is scoped to its chat tab for the current session; the visible
  question remains ordinary durable chat text.
- File-format dependencies stay behind adapters and composition roots so a DOCX
  codec, document editor, workbook codec, or canvas engine can be swapped
  without changing creation commands or UI entry points.

## Metadata ownership

The Rust corpus boundary independently validates every write.

- Frontmatter is the vault's portable record, not an imitation database hidden
  beside it. Known fields have stable names, types, ownership, and canonical
  group order; unknown user fields survive byte-for-byte. New Rotli notes use:

  ```yaml
  ---
  id: 01...
  created: 2026-07-24
  updated: 2026-07-24
  pinned: false
  aliases: []
  owner: rotli
  shelf: [Inbox]
  reach: [seth]
  area:
  summary:
  tags: []
  links: []
  ---
  ```

- Rotli owns identity/provenance facts such as `id`, `created`, `updated`, and
  `pinned`. `id` is the primary key and never changes; paths, filenames, titles,
  and aliases are selectors rather than identity.
- `aliases` is a human-editable string list with Rotli-maintained rename
  history. A title/file rename appends the prior title and useful filename stem
  without deleting existing entries. A filename-only normalization retains the
  exact prior stem without redundantly adding the unchanged title. Current
  title, current filename stem, canonical title slug, and aliases all resolve
  local wikilinks and CLI note selectors; ambiguity fails closed and requires
  the stable `id`. Wikilink targets are normalized before resolution
  (2026-07-28): a `|display` alias, a `#heading` fragment, and a trailing
  `.md` are stripped, and a path-style target falls back to its last segment.
  Archived notes keep resolving (only Trash reads as deleted); a target that
  resolves to nothing renders visibly inert (dimmed, dashed) rather than
  silently ignoring the click.
- The user owns explicit organizational metadata such as `shelf`, `reach`,
  `view_tag`, `locked`, and the secure-note controls. Rotli manages `view_tag`
  through the named-view workflow so the Markdown and reference tree cannot
  drift. `local_ai_allowed` is a Rotli-managed permission bit, never a
  provider-owned field. It is TRI-STATE since 2026-08-01: absent means "follow
  the vault's `secureLocalAi` default", `true` pins on-device access on, `false`
  pins it off. It is written only on a secure note.
- The Librarian owns only its declared enrichment fields: `area`, `summary`,
  `tags`, and `links`.
- Unknown frontmatter is preserved byte-for-byte. Reserved provenance cannot be
  forged through the raw metadata editor.
- Boards and binary files never receive Markdown frontmatter.
- The metadata surface derives and displays the canonical absolute file path
  from the corpus router. Paths are never copied into editable frontmatter,
  where a title rename or Librarian filing move could make them stale.

## Queryable filesystem records

The vault must remain searchable like a database while staying ordinary files:

- The canonical record is `frontmatter + H1 + body + filesystem location`.
  Rebuildable indexes may parse and accelerate those records but never become
  authoritative.
- Exact lookup accepts stable `id`, title, current filename stem, or `aliases`.
  Human selectors are case-insensitive and return no result when ambiguous.
- Full-text retrieval searches title, body, and the declared searchable metadata
  vocabulary (`aliases`, `area`, `summary`, `tags`, `links`, `shelf`, `reach`,
  and `view_tag`). Secure-content gates still apply independently.
- Structured filtering uses the portable v3.8 grammar owned by the foundation's
  `QUERY.md`: quoted/bare text plus predicates such as `area:projects`,
  `tag:payments`, or `updated:>=2026-07-01`, joined with implicit `AND`. Rotli
  implements it through `rotli notes query` and read-only MCP `rotli_query`.
  Parsed clauses accompany bounded results; queries never mutate files or treat
  `.rotli/` indexes as durable data.
- Schema evolution is additive and versioned through the vault's internal contract.
  Unknown fields round-trip, malformed security fields fail closed, and any
  bulk filename/metadata normalization requires the migration protocol and an
  explicit user-approved apply step.
- The foundation command `bun scripts/repair-v38-filenames.ts` owns the v3.8
  bulk repair: dry-run JSON is the default and declares renames, duplicate
  suffixes, aliases, and wikilink effects before an explicit `--apply`. Rotli
  continues to normalize one note through its ordinary guarded write path; it
  does not scan-normalize at startup.

The present top-level vocabulary is already sufficient for database-like
retrieval without a content database. Candidate future additions
(`record_type`, `status`, `due`, and `source_refs`) remain non-normative until a
foundation contract bump gives each a fixed scalar/list type, owner, query
semantics, and absent-is-valid migration. Rotli must not infer or backfill them.

## Model capability and Model Mapping 0

Retrieval policy is capability-based. Context size selects bounded search,
history, note-read, and table-of-contents budgets; provider names do not grant
capability by themselves.

Chat quality controls are capability-based too. Reasoning effort and service
tier choices are derived from the exact connected model id, not merely its
provider: unsupported controls disappear when the model changes, and stale
per-chat values are omitted from the next request. The trusted provider adapter
independently validates the same model/choice pair before constructing CLI
arguments. These controls are local presentation state, never vault metadata.

Model Mapping 0 builds a fresh, bounded vault table of contents for each model
request:

- compact models receive a small area map and drill in through search;
- balanced models receive more prioritized titles and direct ids;
- expansive models receive a full per-note map when it fits, then degrade to a
  bounded area map.

The map is serialized as schema-shaped JSON marked `untrusted-data`. Titles,
folder names, and ids are length-limited, control/framing characters are
neutralized, and markup delimiter characters are JSON-escaped. The prompt wraps
the whole object in an explicit untrusted-data boundary; note-controlled values
never become headings, roles, tool declarations, or delimiters.

Pinned notes and recently touched notes rank first. These are transparent user
signals stored in normal vault metadata/filesystem state—not hidden learning in
a database. Future priority signals must remain inspectable and rebuildable.

## Master memory retrieval (RAG)

Rotli's vault layer exposes one retrieval protocol over two durable sources: organized
notes and prior chat transcripts.

1. **Ingest:** every successfully persisted chat owns one linked background
   Markdown note. Rotli maintains a bounded `Conversation memory` block in that
   note after each turn while preserving user text outside the block.
2. **Map:** Model Mapping 0 is the master, capability-sized table of contents.
   It provides prioritized areas and direct ids where the model can afford them.
   Since 2026-08-01 its scope is the Notes tree PLUS the reference lanes, so a
   model can learn that `identity/` exists and ask for it. The map stays a
   table of contents: reachability, never bulk preloading.
3. **Retrieve:** `search_memory` expands a natural-language question into
   inspectable keywords, merges exact-phrase and keyword full-text note hits,
   and ranks raw chat matches by title/body relevance. Results carry provenance
   (`note` or `chat`) and a stable id.
4. **Ground:** `read_memory` opens only the selected note or original chat. The
   model does not receive the whole vault or all transcripts by default.
5. **Generate:** tool observations, current conversation history, and the model-
   specific budget form the answer context. The existing step, history, scratch,
   note, and snippet caps prevent context overflow.

Tool observations and note bodies remain fenced untrusted data. Off-device tool
arguments pass both the secret detector and a substantial verbatim-overlap check
against locally retrieved results. The latter blocks ordinary private prose,
not only credential-shaped strings. Network tools exist only when their explicit
per-chat capability is on; blocked private text must be rephrased locally rather
than approved by prompt text. The connected-model scaffold identifies itself as
an application request, not a nested system identity or alternate reasoning
engine. Commands found inside a result stay ignored data, but do not replace or
abort the user's requested work when trustworthy evidence remains available.

Starting a chat from a Markdown note reuses the chat already attached to that
note or creates one durable chat with a stable note-derived identity. Each turn
preloads the attached note through the same host read gate as `read_note`, so a
remote model still cannot receive secure content and local access still follows
the note-then-vault knob chain. Secure-note chats use opaque attachment metadata,
offer only on-device models, and disable web/image egress; an unreadable security
state blocks the turn rather than guessing.

This is deliberately hybrid and local-first: filesystem full-text retrieval,
metadata/priority signals, rolling chat notes, and model-driven query refinement.
It requires no vector database. A future embedding adapter may augment recall,
but it must remain rebuildable, optional, and behind the retrieval port.

## Security and validation

- `Secure notes` is a protected filesystem lane inside the Library
  (`wiki/_secure/`), not a database or opaque vault. The underscore excludes it
  from normal organizer areas while the sidebar exposes it deliberately.
  Protection is also stored on each Markdown file as `secure: true`.
- Marking an existing note secure records its prior physical folder, moves the
  stable note id into `wiki/_secure/`, and updates its gitignore protection
  before either path changes. Removing protection moves it back before dropping
  the ignore rule. The organizer's Rust gate refuses this lane independently of
  the remote-model read gate.
- Quick captures and notes created from the Quick Note window are secure at
  birth. The user may deliberately remove protection from the note menu or the
  Quick Note shield control.
- A secure quick capture therefore lives in `wiki/_secure/` but keeps the
  capture shelf `Inbox`, and Rust projects it to the reserved `Board` root the
  sidebar reads as **Captures** — the same surface a plain staged capture in
  `wiki/_inbox/` uses. Captures are not full notes: they never appear under
  "Secure notes" or All notes until the user curates them into Main or Quick
  access. Protection is unchanged by the projection (gitignored spine,
  model-gated reads).
- **Only a capture carries the capture shelf (2026-09-17).** The `Inbox` shelf
  is written by the Quick capture (⌥C), the Quick Note window, and a merge of
  captures on the board — nothing else. A chat's background note (the
  conversation notes a chat keeps, or the note its header button creates),
  a ⌘N note, an AI-created note, and a duplicate of a non-capture are born
  with an empty shelf and project to the folder they live in (`wiki/_inbox/`
  staging until the Librarian files them, then their area). The projection
  rule itself is unchanged; this is writer policy, so the contract version
  does not move.
- A note created in the Quick Note window shares that on-disk shape (secure at
  birth, `wiki/_secure/`, shelf `Inbox`) but is a **full note**: the main window
  files it into Main's root the moment it is born, and curated-in-Main is the
  rule that keeps it out of Captures. Main hides the reference while the body
  is blank, so an untouched quick note never shows as an empty row.
- Summoning the capture card from another app never surfaces the main window:
  "in Rotli" means main was visible **and** focused, a visible-but-behind main
  is tucked away for the capture and restored after Rotli steps out, and
  finishing a capture never force-raises main (the Quick Note law).
- **`secure` and `locked` are independent controls on different axes
  (2026-08-01).** `secure` governs VISIBILITY against remote models; `locked`
  governs EDITING by every model. Neither implies the other. The full matrix and
  its threat cases are recorded in
  [`../design/ai-visibility-matrix.md`](../design/ai-visibility-matrix.md).
- Secure titles, snippets, and bodies are excluded from model maps and search
  observations for remote/frontier models, which can never read them under any
  setting. A loopback-local model registered to a recognized on-device runtime
  reads secure notes **by default**; two knobs may withdraw that — the note's own
  `local_ai_allowed: false`, and the vault's `secureLocalAi: false` in
  `.rotli/settings.json` (missing ⇒ enabled; an IO error ⇒ disabled). An explicit
  `local_ai_allowed` line overrides the vault knob in either direction. No knob
  exists, or will exist, that opens a secure note to a remote model. A frontier
  provider behind a localhost proxy still fails this gate.
- **`locked: true` refuses every AI edit** — interactive chat (`update_note`),
  the per-turn chat-memory sync, the headless workspace agents, and the
  organizer. Both layers enforce it: TypeScript fails fast and Rust refuses
  again inside `corpus_write_ai`. A locked note stays fully READABLE by every
  class of model, and the user's own editor is unaffected.
- Secure files are gitignored at creation and the ignore entry follows later
  moves. The organizer skips secure notes regardless of interactive local
  access, and skips locked notes entirely.
- Remote organizer choices apply only to non-secure, unlocked notes.
- **Lanes (2026-08-01).** In a Rotli vault, `wiki/`, `chats/`, and the exact
  scaffolded root path `Welcome to Rotli.md` are the Notes tree. They are
  writable through the interactive lane — all of `wiki/` since
  2026-08-03: the Librarian files staged notes into curated areas, and a filed
  note must stay editable rather than silently turning read-only the moment it
  leaves `wiki/_inbox/` (before that, only `_inbox` staging and `_secure`
  wrote). `wiki/_secure/` stays model-gated on read and is never an organizer
  area; the filer lane still owns the AI metadata keys exclusively. The welcome
  path is the sole root-note exception and remains outside Library.
  The vault's reference lanes — `identity/`, `personality/`, `history/`, `MAP.md`,
  `inbox.md` — are `Surface::Reference`: never in the Notes tree, never writable
  by any lane, and **retrievable by both classes of model** through the AI's
  search / knowledge-map / read tools. Reference note ids are relative paths.
  Vault plumbing (`memex.json`, `users.json`, `STRUCTURE.md`, `CONFIG.md`,
  `clients/`, `scripts/`, …) stays `Hidden` from the tree AND from every model;
  `read_for_ai` refuses a Hidden path outright.
- **Product vocabulary (2026-07-26):** the organizer layer is branded the
  **Librarian** and its organized area (the `wiki/` tree) the **Library**; a
  connected vault is a **Linked library**. These are display names only —
  legacy contract terms, folder ids (`Brain`, `wiki/`), and the `brainEnabled`
  setting keep their internal names for compatibility. Since 2026-07-28 the journal surface
  (formerly the sidebar's "Activity" row) is reached as **Librarian** in the
  sidebar's utility footer; "Activity" survives only in internal identifiers.
- **Active-vault switches preserve the way back.** Switching or creating the
  primary vault removes the incoming folder from its linked-library role and,
  when the outgoing folder is a compatible Rotli vault, records that outgoing
  folder as a linked library in the same `corpus.json` replacement. One path
  still has one role, while every known vault remains reachable from the
  sidebar switcher after the live transition. A switch to an already connected vault sends
  only its configured id across IPC; Rust resolves and revalidates the stored
  path. Arbitrary paths remain exclusive to the native-picker authorization
  flow used for choosing or creating folders.
- **Every user data surface has one active vault.** The
  process still owns one active corpus, organizer, and Breve runtime. Switching
  exchanges the already-open default store in place, retargets the organizer
  and Breve, and asks each webview to rehydrate its vault-scoped state without a
  process restart. Once hydration completes, presentation returns to the
  Home/Notes front; Chat and Breve are never inherited across the vault
  boundary. Connecting
  another compatible vault registers its independently routed store and watcher
  in the current process as a switch target; its notes never enter the active
  sidebar, panes, search results, System counts, or AI context. In
  development, an explicit `corpus.dev.json` selection preserves the same linked
  roots instead of collapsing them into a new primary root on every launch.
  Removing a connected vault persists the binding removal before dropping its
  live route and asset scope; it never deletes or rewrites the folder. Manual
  refresh flushes pending webview work, then reopens and rescans the active
  store while preserving its route and watcher generation. If the active folder disappears, Rotli promotes the
  first still-valid connected route and rehydrates Home; with no valid route it
  returns to vault activation without recreating the missing folder.
  The legacy `paneVaultMode` setting is normalized to `single`; a root-prefixed
  open is refused and directs the user to the explicit vault switch. Saved chat
  viewstate may retain an additive `vaultId` for migration and isolation, but a
  non-active id cannot open beside the current vault.
- **Vault identity survives ordinary Finder moves.** `corpus.json` remains the
  readable absolute-path binding, while the macOS app config may keep a private,
  machine-local Foundation URL bookmark keyed by the portable `memex.json`
  `mx_…` id. Startup resolves these references before registering roots and
  rewrites a stale locator only when the live folder's stable id matches. The
  bookmark sidecar is recovery metadata, never portable vault state or a
  content database. Plain adopted folders have no portable vault identity and
  remain path-based; if macOS cannot resolve a move, activation asks the user to
  select the folder again instead of falling back to the historical Documents
  location.
- **A vault may be raw** (vault-vs-brain, 2026-07-26): the per-vault
  `brainEnabled` setting (missing ⇒ on) turns the Librarian layer off entirely.
  Raw means the organizer never acts and the filer write lane refuses —
  enforced independently in the daemon's cycle gate and the corpus boundary.
  Flipping the switch never moves or rewrites a file; re-enabling resumes at
  Suggest. Security controls (secure notes, the detector, repairs) are vault
  properties and hold identically in both modes. Spec:
  [`2026-07-26-vault-vs-brain.md`](../decisions/2026-07-26-vault-vs-brain.md).
- A note explicitly flagged `secure: true` whose file still sits in Library
  intake is legacy or externally moved state; the organizer must never read it
  in place. The Librarian journal (the sidebar footer's **Librarian** entry)
  offers the explicit, previewable **legacy
  secure intake repair**: Rust re-validates the flag on disk per note, refuses
  non-secure targets, symlinks, and id-less files, completes the protected
  ignore-before-move into `wiki/_secure/` without changing prose, and journals
  each repair content-free (ULIDs and lane names only — never title, summary,
  body, or tags). Repair rows are applied at write time and are not undoable
  from the journal; leaving the lane remains the remove-protection flow.
- Secure organization remains unimplemented and the ordinary organizer still
  skips every secure note. Any future implementation must follow the revised
  [local-only proposal](../decisions/2026-07-22-secure-organizer-and-sheet-metadata.md):
  remote providers receive no secure-derived envelope, and both default-off
  global consent and on-device visibility (`local_ai_allowed` not pinned off,
  and the vault's `secureLocalAi` on) are required for a registered on-device
  model. Note that ORGANIZING a secure note remains a separate consent from
  READING one: the 2026-08-01 flip widened reading only.
- A non-secure note whose content fires the secret detector enters the
  Librarian journal's **secure review** instead of being silently modeled around: the
  organizer skips it and the pane offers _Make secure_ (the existing protected
  flow) or _Not sensitive_. The detector proposes; the user disposes — this
  lane never auto-marks a note. A dismissal is content-keyed rebuildable
  `.rotli/organizer.json` state (never note frontmatter) and re-arms when
  anything the detector sees changes. The existing auto-secure flag on the
  metadata read path is unchanged. Settings → Security carries the
  plain-language explainer for all of this; the contract remains the spec.
- Secret-shaped prior chats are omitted from remote search results and blocked
  on exact read; the provider egress detector independently checks the final
  prompt as a backstop. Local models may retrieve them on-device.
- The frontend registry improves UX but never replaces Rust path, extension,
  root-permission, and write-lane validation.
- Rust resolves each existing relative-path component with no-follow metadata,
  rejects symlinks, and canonicalizes it beneath the registered root before any
  read or mutation. The same check covers destination parents before folder and
  atomic-temp creation, both ends of a move, office/board lanes, `.rotli/`
  sidecars, and `.gitignore` protection.
- Excalidraw source is durable even when invalid. A corrupt or over-limit board
  does not mount a canvas or autosave. TypeScript and Rust independently enforce
  parity-pinned limits for bytes, elements, semantic actions, strings,
  coordinates, embedded files, depth, and total JSON nodes; the Rust boundary is
  shared by GUI, CLI, and MCP writes. Blank repair is an explicit confirmed
  replacement, never a parse fallback.
- Storage assets use a recoverable lifecycle: “Remove from Main” only removes a
  reference. Archive/Trash actions move the physical file under the vault sink
  while nesting its original storage path (`trash/storage/rotli/file.docx`), so
  restore remains possible without `.rotli/` state. File lifecycle actions never
  invoke macOS Trash; the Rust boundary validates both moves and restores.
- Excalidraw boards enter Archive/Trash through the board-safe note lifecycle
  move, which preserves their opaque JSON bytes; restore uses the recorded sink
  path. Frontend capability checks must not classify a board as a conventional
  file or gate it on storage-file writability.
- `bun run check:architecture` guards inward dependencies and keeps slash
  commands out of non-Markdown surfaces.
- `bun run check:structure` enforces camelCase source filenames and denies
  database dependencies.

The vault contract owns this portable policy vocabulary and its file representation. It
does not execute AI calls: provider clients, retrieval execution, and agent
loops stay in Rotli behind the host/corpus access boundary.
