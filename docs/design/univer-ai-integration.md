# Univer and AI: what fits Rotli, and the plan (2026-10-01)

The owner: "analyze Univer for our docs integration — they recently did some AI
rework that better lets AI work with your docs; let's enhance our integration
on that fully … use the proper integrations."

## What Univer shipped, and what fits

Univer reached **1.0 on 2026-09-23** (1.0.3 on 2026-09-29) and now calls itself
"the Office harness for AI agents". Rotli is on `^0.25.1`.

| Univer piece | License / runtime | Fits Rotli? |
|---|---|---|
| Univer MCP (`@univerjs-pro/mcp`, `sheets-mcp`) | Pro; the MCP client calls `mcp.univer.ai` with an API key | **No.** A cloud service and commercial; Rotli's own `rotli mcp` stays the agent surface |
| `univer-cli` + the `@univer-cli/*` AI SDK | CLI Apache-2.0, but `headless-univer` pulls ~20 Pro packages and ships a rotating 90-day license; docx/xlsx exchange is Pro | **No** to ship; its draft → review → merge flow is a good model |
| docx/xlsx import/export (`@univerjs-pro/exchange-*`) | Commercial (server or Pro node) | **No.** Rotli keeps its own Word codec and ExcelJS |
| **Facade API 1.0** (`@univerjs/sheets`, `@univerjs/docs`) | **Apache-2.0**, fully local, headless docs API with paragraph reads/edits | **Yes**, behind Rotli's adapters |
| Node presets (`preset-*-node-core`) | Apache-2.0 | Only for a headless sidecar (decision B below) |

New Univer Pro licences are paused (pro.univer.ai/license), so nothing Pro is an
option either way. Sources: docs.univer.ai/ai, docs.univer.ai/ai/packages, the
import/export guides, github.com/dream-num/univer releases, univer-mcp,
univer-cli, workbuddy-univer-office, and npm for each package.

## The principle

Rotli's own tools stay the AI surface (chat tools and `rotli mcp`). Reads come
from Rotli's own document and sheet models; edits are bounded action lists
applied to those models and saved through Rotli's codecs and the existing
revision gate. Univer's 1.0 Facade drives only a file that is open live in a
pane. Never import `@univerjs-pro/*` or `@univer-cli/*`.

## Done (slice 1, 2026-10-01)

Chat's `read_file` now reads what a model can point at, instead of flat text:

- an `.xlsx` as every non-empty cell by its A1 address, formulas with their
  last result, real row numbers kept (`src/sheets/aiView.ts`, from the engine's
  own `workbookToModel`); CSV files stay CSV;
- a Word document as numbered blocks: headings with their level, list items,
  table cells `r1c1…`, images by alt text (`editableDocumentForAi`,
  `src/ai/artifacts.ts`).

The secret gate is unchanged (a remote model never gets secret-shaped text).

## Done (slice 3, 2026-10-01): chat edits Word documents it created

The owner's 2026-09-29 rule for notes, applied to files: **Rotli's AI edits a
Word document only when Rotli's AI created it.** Files carry no frontmatter,
so the record is `.rotli/file-grants.json`, written only by Rust's
`corpus_create_managed_file_ai` (chat's `create_document` now uses it). A
document a person made, or any file without a record (a renamed one too),
stays closed to the AI; a per-file grant can open one later.

- `edit_document` (chat; `src/ai/hostFiles.ts`): bounded actions over the
  document model by the block numbers `read_file` gave (`replace`,
  `insert_after` with 0 for the top, `delete`, `set_cell`, `set_kind`; at most
  40; `src/documents/aiEdit.ts`). Numbers always mean the document as read.
- Saved through `corpus_write_file_ai` (`src-tauri/src/ai_files.rs`):
  provenance, then its own secret check on the text read from
  `word/document.xml` in the package itself, then the revision gate with a
  one-time `.bak`. Rotli's Word codec keeps every part the edit doesn't touch.
- Refused in a chat carrying secure-note content, and while the document is
  open in a pane (shown or parked): panes save on their own, so the edit
  waits until it's closed.

## Done (2026-10-01): links in Word documents

The owner, on Univer: "avoid what is paid, see what else we can support and
support what we can, only targeting docs for now." Univer's open-source
docs-hyper-link preset (`@univerjs/preset-docs-hyper-link`, Apache-2.0) is
mounted: the toolbar's link button, the hover card, edit and remove. Rotli's
side (`src/documents/README.md`, Editing boundary):

- the model's run `link` (web and mail only, `safeLinkUrl`);
- the Word codec reads and writes external `<w:hyperlink r:id>` with their
  relationships, adding Word's Hyperlink style for a new one; in-document
  anchors stay refused;
- a plain click in a link's text edits it; ⌘/Ctrl-click or the card's address
  opens it through Rotli's guarded `openUrl`, never the webview;
- chat reads and writes links as Markdown links; a chat-made document keeps
  its Markdown links.

## What else open-source Univer offers for documents (0.25)

| Piece | License | Status |
|---|---|---|
| Comments (`preset-docs-thread-comment`) | Apache-2.0 | **Next candidate.** Needs a `word/comments.xml` codec (read, add, reply, resolve via `commentsExtended.xml`), the comment ranges Rotli already keeps, and an author name (Settings → your name) |
| Quick insert (`docs-quick-insert-ui`) | Apache-2.0 | **No.** A slash menu; slash commands are Markdown's alone (AGENTS.md) |
| Find & replace for documents | — | Not in 0.25 (sheets only); with the 1.0.3 upgrade (slice 5) |
| Headers/footers, page setup, horizontal rule, checklists, H4/H5 | Apache-2.0 (core) | Shown when the codec learns each; hidden until then (`UNSAVABLE_MENU`) |
| Collaboration, print, docx exchange, AI, MCP | Pro | **No** |

## Next slices (each its own PR)

| # | Slice | Needs |
|---|---|---|
| 2 | `sheet_apply` in chat: set values/formulas in a range, insert/delete rows/columns, add/rename a sheet → model → ExcelJS save through a new `corpus_write_file_ai` (re-derives model locality, managed lane only, secret check, refuses in a secure chat) | decision 1 |
| 4 | Live-pane routing: a file open in a pane takes the same actions through Univer's Facade instead of a disk write (no revision clash). Note: document panes save on their own when the window hides or the app quits (`flushDirtyDocuments`, `src/documents/session.ts`), so this is not a review step; until it exists, an AI edit is refused while the document is open (live or parked) | — |
| 5 | Upgrade to Univer 1.0.3: retest `src/documents/engine/univer.ts` (it uses internal services, not the Facade); depend on `@univerjs/core` instead of the presets meta-package | native QA |
| 6 | `rotli mcp` document tools: **done 2026-10-01** through the agent bridge (`docs/decisions/2026-10-01-agent-app-bridge.md`); `rotli_read_sheet` / `rotli_apply_sheet` take the same bridge next | — |

## Decisions for the owner

1. **Can the AI edit a file it didn't make?** Applied (2026-10-01): the notes
   rule — only documents the AI created, by a `.rotli/file-grants.json` record.
   Open: a per-file grant so the person can open one of theirs to the AI.
2. **How `rotli mcp` (Rust, headless) reaches the TypeScript codecs.** (A) a
   second codec in Rust: works with Rotli closed, but two codecs; (B) a
   request/response bridge through the running app: one codec, open files
   update live, Rotli must be running; (C) a Bun sidecar: dev-only unless Bun
   is bundled. **Applied 2026-10-01: B, for reads and writes** — an apply
   addresses the block numbers the TypeScript model gives a read, so reads go
   through the bridge too; Rust's `docx_text` stays the pre-check, not the
   reader (`docs/decisions/2026-10-01-agent-app-bridge.md`).

Effort: slices 2–3 about two weeks, the rest four more, all behind the existing
development gates for sheets and agents.
