# Agent workspace contract

Rotli exposes one headless workspace application service through two adapters:
the packaged `rotli` command-line interface and a local stdio MCP server. Claude,
Codex, scripts, and humans therefore exercise the same corpus policy instead of
maintaining separate file-manipulation implementations.

## Boundary and ownership

- `src-tauri/src/workspace.rs` coordinates headless use cases. It discovers only
  roots registered in Rotli's production `corpus.json`; tests may override the
  default with `ROTLI_CORPUS_ROOT`.
- `CorpusStore` remains the filesystem and security adapter. Headless callers do
  not accept arbitrary root paths and do not bypass memex write lanes.
- The packaged Tauri executable dispatches recognized headless commands before
  starting the GUI. A normal app launch is unchanged.
- `rotli mcp` is a newline-delimited JSON-RPC stdio server. It opens no socket,
  calls no model, and performs no provider orchestration.
- MCP initialization advertises only the protocol version Rotli implements. An
  unsupported client request is answered with Rotli's supported version for the
  client to accept or reject; it is never echoed as a false compatibility claim.
- CARL's `rotli-carl` server remains project-development recall. The product
  server is separately named `rotli-workspace` and operates on the user's
  registered Rotli workspace.

## Note, Main, and named-view behavior

- Listing and full-text search omit every Markdown note refused by the existing
  remote-AI secure-content gate. The gate checks both durable metadata and the
  secret-pattern detector.
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
- External-agent updates and moves refuse secure and locked notes. Explicit
  user-directed calls may edit or file non-secure `wiki/**` notes through the
  existing filer ownership gate; this is distinct from autonomous organizer
  behavior and never widens `self/`, history, control-file, or binary lanes.
- New Markdown notes land in `wiki/_inbox` for a memex or `Inbox` for a legacy
  corpus. Their stable ID is added to `.rotli/main.json` immediately.
- Main folders are virtual organization only. Disk folders require an explicit
  `disk` scope and remain subject to corpus ownership rules.
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

Board writes also require the revision returned by the immediately preceding
read. This is optimistic conflict protection, not a long-lived edit lock.

## Opening in Rotli

`rotli open` and the MCP `rotli_open` tool write one item ID and kind to the
default corpus's rebuildable `.rotli/workspace-open.json` mailbox, then activate
Rotli. The main webview consumes and deletes the request and routes it through
`openSummary`, exactly like a sidebar or palette selection. The mailbox never
contains note content.

## Context and output limits

- CLI output is structured JSON and may return full note/board bodies when the
  human explicitly requests them.
- MCP list/search results are capped. Note reads default to 20,000 characters
  and expose `offset`, `nextOffset`, and `totalChars` for paging.
- `rotli_patch_note` applies one exact local replacement and refuses zero or
  ambiguous matches, so a small edit does not require resending a long body.
- MCP board reads omit raw scene JSON and return a compact outline. Use semantic
  board actions for routine edits.
- Tool schemas are discoverable through standard MCP `tools/list`, so clients
  with deferred tool search need not preload every schema into the prompt.
- The CLI/MCP compatibility and migration law is
  [`compatibility-and-migrations.md`](compatibility-and-migrations.md).

## Configuration

The agent surface is deliberately grouped and discoverable:

```sh
rotli agent doctor      # read-only root, boundary, policy, and visible metrics
rotli agent config      # copy-ready Claude/Codex commands and Codex TOML
rotli agent self-test   # full workflow in a disposable temporary memex
rotli views list        # named reference trees (Main remains global)
rotli mcp               # stdio protocol process used by either client
```

`rotli agent config` (also available as `rotli mcp config`) prints the exact
executable path, `claude mcp add` and `codex mcp add` commands, a Codex TOML
alternative, and verification commands. Rotli does not silently edit global
agent configuration. Use the packaged app binary; a `target/debug` path is only
appropriate during development.

`agent doctor` forces the selected root open in read-only mode and counts only
agent-visible content; it does not reveal how many secure notes were withheld.
`agent self-test` creates notes, searches, patches, exercises stale-write and
secret refusal, edits a board, computes metrics, and initializes MCP entirely in
a temporary memex that is removed when the command exits. It never targets the
configured live workspace.

The CLI and MCP never mutate a live workspace during automated tests. Rust tests
open isolated temporary corpora and prove success, secure/locked refusal,
revision conflicts, Main/named-view reference and `view_tag` behavior, and board
action round trips.
