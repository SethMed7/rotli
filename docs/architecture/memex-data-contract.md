# Memex data and creation contract

Rotli has no application database. The memex folder is the source of truth;
indexes and `.rotli/` files are rebuildable projections or explicit settings.

## One physical home, many views

- **Main is a view.** `.rotli/main.json` stores ordered item references and
  Main-only folder structure. It never owns or copies content.
- **Markdown notes** are plain `.md` files. A smart/Main selection routes a new
  note through the configured memex staging rule; an explicit writable local
  folder remains the physical home.
- **Documents and sheets** created by Rotli live in the managed binary lane:
  `storage/rotli/` in a memex or `Storage/` in the legacy layout.
- **Boards** are raw `.excalidraw` files. The corpus adapter chooses the writable
  Excalidraw lane for a memex and a selected writable folder for legacy storage.
- Creating any item adds its one stable id/path to Main. Refiling the physical
  item does not duplicate or invalidate the Main arrangement.

## Editing capabilities

- Markdown owns slash commands, typed embed fences, wikilinks, and note
  frontmatter.
- Documents are conventional DOCX files. They do not host Markdown slash
  commands or embed syntax.
- Sheets use the workbook editor/codec boundary; boards use the canvas boundary.
- File-format dependencies stay behind adapters and composition roots so a DOCX
  encoder, preview parser, workbook codec, or canvas engine can be swapped
  without changing creation commands or UI entry points.

## Metadata ownership

The Rust corpus boundary independently validates every write.

- Rotli owns identity/provenance facts such as `id`, `created`, `updated`, and
  `pinned`.
- The user owns explicit organizational metadata such as `shelf`, `reach`,
  `locked`, and the secure-note controls. `local_ai_allowed` is a Rotli-managed
  permission bit, never a provider-owned field.
- The Brain filer owns only its declared enrichment fields: `area`, `summary`,
  `tags`, and `links`.
- Unknown frontmatter is preserved byte-for-byte. Reserved provenance cannot be
  forged through the raw metadata editor.
- Boards and binary files never receive Markdown frontmatter.

## Model capability and Model Mapping 0

Retrieval policy is capability-based. Context size selects bounded search,
history, note-read, and table-of-contents budgets; provider names do not grant
capability by themselves.

Model Mapping 0 builds a fresh, bounded memex table of contents for each model
request:

- compact models receive a small area map and drill in through search;
- balanced models receive more prioritized titles and direct ids;
- expansive models receive a full per-note map when it fits, then degrade to a
  bounded area map.

Pinned notes and recently touched notes rank first. These are transparent user
signals stored in normal memex metadata/filesystem state—not hidden learning in
a database. Future priority signals must remain inspectable and rebuildable.

## Master memory retrieval (RAG)

The Brain exposes one retrieval protocol over two durable sources: organized
notes and prior chat transcripts.

1. **Ingest:** every successfully persisted chat owns one linked background
   Markdown note. Rotli maintains a bounded `Conversation memory` block in that
   note after each turn while preserving user text outside the block.
2. **Map:** Model Mapping 0 is the master, capability-sized table of contents.
   It provides prioritized areas and direct ids where the model can afford them.
3. **Retrieve:** `search_memory` expands a natural-language question into
   inspectable keywords, merges exact-phrase and keyword full-text note hits,
   and ranks raw chat matches by title/body relevance. Results carry provenance
   (`note` or `chat`) and a stable id.
4. **Ground:** `read_memory` opens only the selected note or original chat. The
   model does not receive the whole memex or all transcripts by default.
5. **Generate:** tool observations, current conversation history, and the model-
   specific budget form the answer context. The existing step, history, scratch,
   note, and snippet caps prevent context overflow.

This is deliberately hybrid and local-first: filesystem full-text retrieval,
metadata/priority signals, rolling chat notes, and model-driven query refinement.
It requires no vector database. A future embedding adapter may augment recall,
but it must remain rebuildable, optional, and behind the retrieval port.

## Security and validation

- `Secure notes` is a normal filesystem destination, not a database or opaque
  vault. Protection is also stored on each Markdown file as `secure: true`, so
  it survives moves and does not depend on the current view.
- Quick captures and notes created from the Quick Note window are secure at
  birth. The user may deliberately remove protection from the note menu or the
  Quick Note shield control.
- Secure titles, snippets, and bodies are excluded from model maps and search
  observations. Remote/frontier models can never read them. A loopback-local
  model registered to a recognized on-device runtime can read one only after
  the user enables `local_ai_allowed: true` for that note; the default is
  denied. A frontier provider behind a localhost proxy still fails this gate.
- Secure files are gitignored at creation and the ignore entry follows later
  moves. Locked notes are never modified by the organizer. The organizer skips
  secure notes even if interactive local access was granted.
- Remote organizer choices apply only to non-secure, unlocked notes.
- Secret-shaped prior chats are omitted from remote search results and blocked
  on exact read; the provider egress detector independently checks the final
  prompt as a backstop. Local models may retrieve them on-device.
- The frontend registry improves UX but never replaces Rust path, extension,
  root-permission, and write-lane validation.
- `bun run check:architecture` guards inward dependencies and keeps slash
  commands out of non-Markdown surfaces.
- `bun run check:structure` enforces camelCase source filenames and denies
  database dependencies.

The memex owns this portable policy vocabulary and its file representation. It
does not execute AI calls: provider clients, retrieval execution, and agent
loops stay in Rotli behind the host/corpus access boundary.
