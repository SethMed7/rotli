# Agent workspace contract

> Status 2026-09-11: the MCP server (`rotli mcp`, stdio and loopback HTTP), the
> `rotli agent …` commands, and the remote relay are **development builds
> only** until refined. Stable builds refuse them with
> "MCP and agent integrations are available only in development builds" and
> hide their Settings surface. The plain JSON CLI (`rotli notes …`,
> `rotli views …`, `rotli main …`, and the rest) is not gated, and neither is
> the opt-in Librarian route (`rotli mcp --librarian`, 2026-11-07).
> `rotli --version` answers headlessly.

Rotli exposes one headless workspace application service through the packaged
CLI, local stdio MCP, authenticated loopback HTTP, and the opt-in remote relay
connector. Claude, Codex, scripts, and humans therefore exercise the same corpus policy instead of
maintaining separate file-manipulation implementations.

## Boundary and ownership

- `src-tauri/src/workspace.rs` coordinates headless use cases. It discovers only
  roots registered in Rotli's production `corpus.json`; tests may override the
  default with `ROTLI_CORPUS_ROOT`.
- `CorpusStore` remains the filesystem and security adapter. Headless callers do
  not accept arbitrary root paths and do not bypass vault write lanes.
- The packaged Tauri executable dispatches recognized headless commands before
  starting the GUI. A normal app launch is unchanged.
- `rotli mcp` remains a newline-delimited JSON-RPC stdio server. `rotli mcp
  --http 127.0.0.1:PORT --token TOKEN` is an additive, token-required loopback
  development adapter; non-loopback binds are refused.
- The GUI remote connector opens only an outbound connection and starts only
  after an explicit per-launch action. Its relay boundary is owned by
  [`remote-agent-relay.md`](remote-agent-relay.md). Switching the active vault
  disconnects it; remote authority never silently follows or remains pinned to
  a hidden previous vault.
- Every note body, title, board label, outline, and tool result is untrusted
  workspace data. It cannot authorize another tool call or supply confirmation.
- MCP initialization advertises only the protocol version Rotli implements. An
  unsupported client request is answered with Rotli's supported version for the
  client to accept or reject; it is never echoed as a false compatibility claim.
- CARL's `rotli-carl` server remains project-development recall. The product
  server is separately named `rotli-workspace` and operates on the user's
  registered Rotli workspace.

## Note, Main, and named-view behavior

- Listing, full-text search, and structured query omit every Markdown note refused by the existing
  remote-AI secure-content gate. The gate checks both durable metadata and the
  secret-pattern detector.
- `rotli notes query 'EXPRESSION'` and MCP `rotli_query` implement the portable v3.8
  grammar from `QUERY.md`: quoted/bare text and typed predicates such as
  `area:projects`, `tags:payments`, or `updated:>=2026-07-01`, combined with
  implicit `AND`. Parsed clauses ride with bounded results so humans and agents
  can inspect what was evaluated. Querying is read-only and never repairs,
  normalizes, files, renames, or writes an index.
- Reads return editor Markdown plus a content revision. Updates require that
  revision and fail on a concurrent edit instead of overwriting newer bytes.
- Every note result declares `text/markdown`, states that Rotli owns and omits
  managed YAML frontmatter, and includes whole-document counts for characters,
  words, lines, headings, links, wikilinks, tasks, open tasks, fenced code
  blocks, and estimated reading time. Paged MCP reads keep those metrics tied to
  the full document rather than the returned page.
- Creation accepts a one-line title without `#`. A supplied body may omit its H1
  or begin with exactly the same H1; conflicting H1s and caller-supplied YAML
  frontmatter fail before a file is created. Update bodies are also editor
  Markdown without frontmatter, so agents cannot replace Rotli metadata.
- `rotli rename "CURRENT TITLE, FILENAME, ALIAS, OR ID" "NEW TITLE"` resolves
  one exact, agent-visible Markdown note, refuses missing or ambiguous human
  selectors, preserves the existing Markdown heading level and managed
  frontmatter, and uses the corpus write path so the physical filename follows
  the new title. Prior human selectors remain in `aliases`; note-list results
  expose those aliases while stable `id` remains authoritative. MCP
  `rotli_rename {id, title, expectedRevision?}` is the same service call; with
  `expectedRevision` (CLI `--revision`) a rename of a note changed since the
  caller's read is refused.
- External-agent text edits (`update`, `patch`, `rename`) and Trash refuse a
  note a person wrote unless they turned on "Let AI edit the text"; notes an
  agent creates carry `created_by: agent` and stay editable (2026-09-29,
  `docs/decisions/2026-09-29-ai-body-edit-permission.md`).
- `rotli notes trash ID --revision REV` and `rotli_trash_note` move one
  Markdown note to Rotli's Trash through `CorpusStore::delete`, the soft
  delete the note menu uses; the person restores it from Trash, and nothing
  is ever hard-deleted. Order, all under the note's file lock around the move
  (`CorpusStore::trash_for_remote_agent_if_revision`, mirroring the write
  seam): remote read gate (secure refuses), body-edit policy (locked,
  person-written, and revoked refuse), then the revision. A note locked or
  made secure while the call waits on the lock is refused.
- `rotli notes attachments ID` and `rotli_note_attachments` list the files a
  note's Markdown links and images name, resolved as the editor resolves them
  (`storage:NAME` is `storage/NAME`; a bare relative path is read from the
  vault root when that file exists, else from the note's folder, Markdown's
  reading, which Rotli writes since 2026-10-13; `![[path]]` embeds count too;
  a path that leaves the vault and absolute paths are refused; external URLs
  are listed, never fetched). The note passes the remote read gate first, so a secure note's
  attachments are never enumerated. Each file then takes the document lane's
  records gate (agent-visible surface, no secure keyword in its name) and the
  secure-home check (nothing under `wiki/_secure/` or `Secure notes/`, any
  layout, any case); a linked `.md` also takes `read_for_ai` exactly as a
  remote read of it would (secure flag, chat taint, body detector, name). A
  refused file is answered with `source`, `path`, `available: false`, and one
  reason, "not available to agents", even when a linked note is absent, so
  the answer never tells a present secure note from a missing one; it never
  carries a size, MIME type, or absolute path. Otherwise results carry the
  vault-relative path, MIME type, size, and kind; local callers (CLI, stdio,
  loopback) also get the absolute path, the relay connector does not.
  `--text`/`includeText` returns text attachments up to 20 KB by default
  (200 KB max), withholding secret-shaped text. Binaries are never base64.
- External-agent updates and moves refuse secure and locked notes. Explicit
  user-directed calls may edit or file non-secure `wiki/**` notes through the
  existing filer ownership gate; this is distinct from autonomous organizer
  behavior and never widens `self/`, history, control-file, or binary lanes.
- New Markdown notes land in `wiki/_inbox` for a Rotli vault or `Inbox` for a
  legacy corpus. Their stable ID is added to `.rotli/main.json` immediately.
- Main folders are virtual organization only. Disk folders require an explicit
  `disk` scope and remain subject to corpus ownership rules.
- Main and named-view JSON returned to headless callers is recursively filtered
  through the same remote read gate as note listing, including after mutations.
  Agent status reports opaque root ids and filtered counts, never absolute root
  paths or the number of withheld secure references.
- Removing an item from Main removes only its reference. It never deletes the
  underlying note or board.
- `rotli views` and the matching MCP tools list, create, rename, delete, assign,
  unassign, and add virtual folders to named views. Assigning is singular and
  never removes the item from Main. Markdown receives the exact managed
  `view_tag`; boards and binary files remain frontmatter-free.
- `notes create --view NAME` and `rotli_create_note.view` make the named view the
  additional creation context while retaining the ordinary intake and Main
  behavior. Workspace metrics report named-view, reference, and virtual-folder
  counts separately from Main.

## AI edit history

Every successful AI body write, through `write_for_ai_if_revision` (chat and
chat memory), `insert_for_ai_if_revision` (an Ask AI passage the person
accepted), and `write_for_remote_agent_if_revision` (CLI, MCP, relay),
appends one row to `.rotli/ai-edit-journal.jsonl`
(`src-tauri/src/corpus_ai_journal.rs`). Rows follow the brain journal's
grammar: JSON per line, `id`, `ts`, `status`, and a same-id re-append is a
status change (last line wins). A row records the note's id and path, the
actor (`chat`, `inline`, or `agent` with the MCP client name), the model lane, the
before and after file revisions, and a one-hunk reversible patch of the
editor body. A note no remote agent could read at write time (secure, in a
protected lane, or secret-shaped) is journaled content-free: no patch, no
text. Hunks over 32 KB are kept without text. The newest 500 rows are kept.
Journaling is best effort after the write lands; it never fails an edit. The
file is a deletable sidecar: deleting it loses history, never a note. Trash by
an agent adds a content-free `trash` row.

`rotli notes history ID` and `rotli_note_history` return the note's rows
newest first, each with a unified diff when it has a patch (and no
secret-shaped text), after the same remote read gate as a note read.
`rotli notes undo-ai-edit ID --revision REV` and `rotli_undo_ai_edit` revert
the latest applied edit only when the note's current revision is that edit's
after revision and the caller's revision matches. The revert is written
through the agent write seam under every body-edit rule, journaled as an
`undo` row, and the edit is re-appended as `reverted`. An edit that was
overtaken, or kept without text, cannot be undone. The app does not show this
journal yet.

The on-device organizer still changes only location and metadata. A Claude or
Codex body edit is a separate, user-directed workspace action with an explicit
tool call and revision token; it is not organizer autonomy.

## Boards

Boards remain raw `.excalidraw` files in the existing board lane. The MCP read
tool returns metadata and a compact element outline rather than the entire scene
JSON. `rotli_apply_board` supports bounded semantic `add`, `update`, and `remove`
actions for rectangle, ellipse, diamond, text, and arrow elements; logical
agent IDs live in `customData.rotliAgentId`. Unknown user-created elements and
top-level scene fields are preserved. Raw scene replacement is available only
through the CLI and is schema-checked before the atomic save.

Board creation requires a nonblank name and writes the collision-safe final
filename directly. GUI, CLI, and MCP creation do not create and then rename an
`untitled.excalidraw` placeholder.

Board reads and writes share the corpus's bounded validator: 8 MB source,
10,000 elements, 1,000 embedded files, 100,000 characters per string,
10,000,000 absolute coordinate magnitude, depth 64, 200,000 JSON nodes, and 500
semantic actions per request. Invalid source is returned as a recovery error and
is never silently replaced.

Board writes also require the revision returned by the immediately preceding
read. This is optimistic conflict protection, not a long-lived edit lock.

## Word documents

Word documents (`.docx`, listed by `rotli_list` as files) travel through the
running app (decision: `docs/decisions/2026-10-01-agent-app-bridge.md`), so
agents use Rotli's own codec and chat's own edit path. Rotli must be running;
otherwise the tools answer "Rotli isn't running".

- `rotli_read_document {file}` returns numbered blocks (headings, paragraphs,
  list items, table cells `r1c1…`, images by alt text; links as Markdown
  links), warnings, and a revision.
- `rotli_apply_document {file, expectedRevision, actions}` (destructive) takes
  at most 40 actions by the read's block numbers, which keep meaning the
  document as read: `replace`, `insert_after` (0 = top), `delete`, `set_cell`,
  `set_kind`; text at most 8,000 characters each, Markdown links to https or
  mailto allowed.
- `rotli_create_document {title, body}` writes a document from Markdown into
  managed storage, files it in Main without opening it, and records the
  agent's `clientInfo.name` as its maker.

Agents count as remote. Refused: a vault other than the one open in Rotli;
writes to a read-only vault; a document hidden from agents, named with a secure
keyword, or holding secret-shaped text; an edit to a document no AI created
(`.rotli/file-grants.json`); an edit while the document is open in a pane; a
stale revision. Every answer, a refusal included, passes the secret check
before it leaves Rust. A headless `rotli mcp` reaches the app through
`agent-bridge/bridge.sock` in Rotli's app-support folder (a 0700 folder, a
0600 socket); the paired relay runs inside the app.

## The Librarian route

`rotli mcp --librarian` is a second stdio server, `rotli-librarian`, over the
same workspace service (`src-tauri/src/workspace_librarian.rs`; plan and
rationale in
[`../design/librarian-mcp-and-t3-chat.md`](../design/librarian-mcp-and-t3-chat.md);
how hosts wire it per vault in [`vault-thread-protocol.md`](vault-thread-protocol.md)).
It is the opt-in, much smaller surface for keeping a vault organised; the full
`rotli-workspace` server is unchanged.

- **One vault per process, bound at start.** `rotli mcp --librarian --vault
  PATH` serves that vault; without `--vault` it serves the folder it was
  started in. Either must resolve (links followed, then compared by real path)
  to a vault registered in Rotli with the Librarian on, or the server refuses
  to start. Every call then opens that vault and never the app's default, so
  switching the default mid-session can't redirect a thread (audit
  2026-11-08). The server also records the folder's identity (device and
  inode, read without following a link) at start, and every call refuses if
  another folder, or a link, now stands at that path. `--root` is refused here.
- **Off by default.** Every call except `librarian_guide` refuses unless the
  vault's `.rotli/settings.json` holds `"librarianMcp": true` (anything else,
  missing or malformed, is off). Rust only reads that file. Unlike the rest of
  MCP, the route runs from stable builds too: the per-vault switch is its
  opt-in (`skips_agent_gate`).
- **Nine tools:** `librarian_guide`, `librarian_search`, `librarian_read`,
  `librarian_capture`, `librarian_file`, `librarian_link`, `librarian_index`,
  `librarian_log`, `librarian_review`. Behaviour lives in five skills compiled
  from `src-tauri/librarian-skills/*/SKILL.md` and served by `librarian_guide`.
- **Reads** use the remote read gate exactly as `rotli_read_note` and
  `rotli_search` do; secure notes are never listed, read, or proposable. A
  read judges and returns the same bytes (`read_doc_for_ai`): one read of the
  file, gated, with the revision of exactly what was returned.
- **Creates** use the remote-agent create seam in intake: a capture carries
  `created_by: agent`, the two pages `created_by: librarian` plus
  `librarian_page: index` or `librarian_page: log`. A new note's
  file name is claimed without replacing anything, so two captures that pick
  the same name at once both survive.
- **Rewrites** are limited to the Librarian's own pages, "Librarian index"
  and "Librarian log", through `write_for_remote_agent_if_revision`. Its own
  means the exact title, the `created_by: librarian` stamp, and the
  `librarian_page` marker. `created_by: librarian` alone is not enough: Rotli's
  in-app Librarian stamps the People notes it makes the same way, and a
  person may be called "Librarian index". `librarian_page` is a Rotli-reserved
  key that only this route's page creation writes: agents never write
  frontmatter, the metadata editor refuses reserved keys, the raw editor
  restores them (`RAW_IMMUTABLE_KEYS`), and no other create path sets it. A
  note that only shares the title, carries it as an alias, or lacks the
  marker is never touched, and the Librarian makes its own page instead.
  Pages made before the marker existed (unreleased builds only) are left
  alone and replaced by new ones.
- **Proposals:** `librarian_file` and `librarian_link` append to
  `.rotli/librarian/proposals.jsonl` (JSON per line, `id`, `ts`, `kind`,
  `note`, `noteTitle`, `folder` or `target` with `targetId`, `reason`,
  `status`; a later line for the same id wins; a deletable sidecar). The file
  is opened through `containment::open_sidecar`: on Unix each folder from the
  vault root down is opened through the one before it with `openat` and
  `O_NOFOLLOW | O_DIRECTORY`, so a link at any step is refused even if it was
  swapped in after an earlier check, and the opened file must be a regular
  file with one link (checked on the open descriptor), so a hard link to a
  file outside the vault is refused for appends and reads alike. A repeated
  pending proposal returns the existing one. `librarian_review` lists only
  proposals whose note, and link target, the agent may still read. The
  target checked is `targetId`, the exact note the title named when the link
  was proposed; resolving the title again could let another public note's
  alias stand in for a page that has since turned secure. A row written
  before `targetId` existed is shown only when exactly one note has that
  exact title and it is readable. The person's `rotli librarian proposals`
  lists them all. Reasons, sources, and log entries are one line and
  refused when secret-shaped.
- **Every result is an MCP object.** `structuredContent` must be a JSON
  object, so a list answer (search, review, and the workspace server's list
  tools) travels as `{"items": [...]}`, and any other non-object as
  `{"value": …}`. The text part carries the same value. Found by a real Claude
  Code session on 2026-11-08, which rejected list results as malformed.
- **No tool applies a proposal.** The person runs `rotli librarian apply ID`
  or `dismiss ID` (a Rotli review list is next). Apply uses
  `move_for_remote_agent` for a move and the agent write seam for a link (one
  `[[target]]` added to the note's closing `Related:` line), so secure,
  locked, and person-written rules still hold; a refused apply stays pending.
- **What it doesn't stop.** A process running as the same user that swaps
  files under the vault while a call runs is outside the threat model
  ([`egress-threat-model.md`](egress-threat-model.md) O5). The checks above
  narrow it: the proposals file can't be reached through a link at any step,
  and a replaced vault folder is refused at the start of each call. Note
  reads and writes still go through paths, so a swap made after that check
  and before the store's own containment check is not caught; on Windows the
  proposals file falls back to the path check, and the folder identity check
  is skipped.

## Opening in Rotli

`rotli open` and the MCP `rotli_open` tool write one item ID and kind to the
default corpus's rebuildable `.rotli/workspace-open.json` mailbox, then activate
Rotli. An item in a connected vault (`--root ID`, `rootId`, or an `ID:path`
wire id) is queued in the same default mailbox under its root-prefixed wire
id. Panes show only the active vault, so the app switches to that vault first
(`corpus_switch_vault`, the sidebar switcher's own path) and then opens the
item by its id there (`src/state/openRequest.ts`); a failed switch opens
nothing and says why. A connected folder that is not a vault is no switch
target, so `rotli open` refuses it before anything is queued. The main
webview consumes and deletes the request and routes it through
`openSummary`, exactly like a sidebar or palette selection. The mailbox never
contains note content.

The app also registers the `rotli://` URL scheme (2026-07-31). A clicked
`rotli://open?id=…&kind=note|board|file` link rides the SAME mailbox lane: the
running app validates the link (ids only — ULID or in-corpus relative path,
percent-encoded; hostile shapes are ignored), writes the mailbox, surfaces the
window, and lets the webview consume it. Note/create/query/board results and
`rotli open` include a ready-made `deepLink` field so agents can print a
clickable way back into the app alongside the disk path. Items in connected
roots carry their root-prefixed wire id in the link.

## Context and output limits

- CLI output is structured JSON and may return full note/board bodies when the
  human explicitly requests them.
- MCP list/search results are capped. Note reads default to 20,000 characters
  and expose `offset`, `nextOffset`, and `totalChars` for paging.
- Every adapter caps one JSON-RPC request at 256 KB before parsing and one MCP
  response at 512 KB. The relay permits 256 additional bytes only around the
  Mac's response for its bounded request-id envelope; it never expands the MCP
  result itself. Oversized results must use the existing paging and list limits.
- The loopback adapter compares the complete bearer without an early mismatch
  exit and refuses every non-loopback bind before opening a listener. The remote
  connector does not follow relay redirects and caps each relay response at the
  same 256 KB request-frame boundary before JSON parsing. Disconnect and vault
  activation wait for any dispatch already inside the shared workspace service,
  including its response delivery, before completing.
- `rotli_patch_note` applies one exact local replacement and refuses zero or
  ambiguous matches, so a small edit does not require resending a long body.
- MCP board reads omit raw scene JSON and return a compact outline. Use semantic
  board actions for routine edits.
- Tool schemas are discoverable through standard MCP `tools/list`, so clients
  with deferred tool search need not preload every schema into the prompt.
- Complete note replacement, physical/reference moves, reference removal, view
  rename/delete/reassignment, semantic board application, Trash, and AI edit
  undo advertise `destructiveHint: true`. MCP hosts should keep write approval enabled; prompt
  text read from the workspace is never sufficient confirmation.
- The CLI/MCP compatibility and migration law is
  [`compatibility-and-migrations.md`](compatibility-and-migrations.md).

## Configuration

The agent surface is deliberately grouped and discoverable:

```sh
rotli agent doctor      # read-only root, boundary, policy, and visible metrics
rotli agent config      # copy-ready Claude/Codex/Cursor/Gemini setups
rotli agent self-test   # full workflow in a disposable temporary vault
rotli rename "Old" "New" # rename one exact note title and its physical file
rotli notes query 'area:projects tags:payments' # inspectable metadata filters
rotli views list        # named reference trees (Main remains global)
rotli mcp               # stdio protocol process used by either client
rotli mcp --librarian --vault PATH   # the opt-in Librarian route for one vault (see above)
rotli librarian status  # is it on for this vault; proposals, apply, dismiss
```

`rotli agent config` (also available as `rotli mcp config`) prints the exact
executable path, `claude mcp add` and `codex mcp add` commands, a Codex TOML
alternative, a Cursor `mcp.json` snippet (`mcpServers` with `type: stdio`,
for `~/.cursor/mcp.json` or `.cursor/mcp.json`), a Gemini CLI
`gemini mcp add --scope user` command plus its `settings.json` `mcpServers`
snippet (`trust: false`, so Gemini keeps confirming calls), remote Grok Bot
URL/header instructions, and verification commands
(`workspace_help.rs::mcp_setup`). Rotli does not silently edit global
agent configuration. Use the packaged app binary; a `target/debug` path is only
appropriate during development.

`agent doctor` forces the selected root open in read-only mode and counts only
agent-visible content; it does not reveal how many secure notes were withheld.
`agent self-test` creates notes, searches, patches, undoes the journaled
patch, exercises stale-write and
secret refusal, edits a board, computes metrics, and initializes MCP entirely in
a temporary vault that is removed when the command exits. It never targets the
configured live workspace.

The CLI and MCP never mutate a live workspace during automated tests. Rust tests
open isolated temporary corpora and prove success, secure/locked refusal,
revision conflicts, Main/named-view reference and `view_tag` behavior, and board
action round trips.
