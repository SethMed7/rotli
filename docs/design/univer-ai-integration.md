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

## Next slices (each its own PR)

| # | Slice | Needs |
|---|---|---|
| 2 | `sheet_apply` in chat: set values/formulas in a range, insert/delete rows/columns, add/rename a sheet → model → ExcelJS save through a new `corpus_write_file_ai` (re-derives model locality, managed lane only, secret check, refuses in a secure chat) | decision 1 |
| 3 | `document_apply` in chat: replace a block's text, insert after, delete, set a table cell, set a heading level → docx model → Rotli's codec (untouched parts preserved) | decision 1 |
| 4 | Live-pane routing: a file open in a pane takes the same actions through Univer's Facade, so the person reviews and saves (no revision clash) | — |
| 5 | Upgrade to Univer 1.0.3: retest `src/documents/engine/univer.ts` (it uses internal services, not the Facade); depend on `@univerjs/core` instead of the presets meta-package | native QA |
| 6 | `rotli mcp` tools `rotli_read_sheet` / `rotli_apply_sheet` / `rotli_read_document` / `rotli_apply_document`, modeled on the board tools | decision 2 |

## Decisions for the owner

1. **Can the AI edit a file it didn't make?** Notes follow the 2026-09-29 rule
   (`created_by` + `ai_edit`); files carry no frontmatter. Either follow the
   board precedent (a secret check, no ownership grant) or keep a small
   `.rotli/` record of `created_by` / `ai_edit` / locked per file.
2. **How `rotli mcp` (Rust, headless) reaches the TypeScript codecs.** (A) a
   second codec in Rust: works with Rotli closed, but two codecs; (B) a
   request/response bridge through the running app: one codec, open files
   update live, Rotli must be running; (C) a Bun sidecar: dev-only unless Bun
   is bundled. Recommended: B for writes, a small Rust text extractor for
   reads and the secret check.

Effort: slices 2–3 about two weeks, the rest four more, all behind the existing
development gates for sheets and agents.
