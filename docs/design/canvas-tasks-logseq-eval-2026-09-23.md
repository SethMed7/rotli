# Canvas boards, task tables, and Logseq lessons — evaluation (2026-09-23)

Status: **evaluation only.** Nothing here is decided or built. It sizes three
ideas against today's code and the contracts they touch, so the owner can pick
what goes on [ROADMAP.md](../../ROADMAP.md). Sizes use the roadmap scale
(S hours · M days · L 1–3 weeks · XL a month or more).

Sources reviewed: [AFFiNE whiteboard](https://affine.pro/whiteboard),
[AFFiNE whiteboard docs](https://mintlify.wiki/toeverything/AFFiNE/features/whiteboard),
[AFFiNE database docs](https://mintlify.wiki/toeverything/AFFiNE/features/database),
[AFFiNE 0.15 release (quick connector)](https://x.com/AFFiNEOfficial/status/1807769980605489340),
[Logseq](https://logseq.com/),
[Logseq DB version docs](https://github.com/logseq/docs/blob/master/db-version.md),
[Logseq 2.0 beta on Hacker News](https://news.ycombinator.com/item?id=48896229),
[Excalidraw props](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props),
[Excalidraw presentation-mode issue #7568](https://github.com/excalidraw/excalidraw/issues/7568).

## Owner decisions this evaluation needs

These are contract calls, not code work. Each idea below is blocked or shaped
by one of them.

1. **Can a canvas hold links between notes?** Connectors between note cards are
   a link system outside Markdown. `memex-data-contract.md` (Markdown alone
   owns wikilinks and embeds; boards are "secondary bonus work surfaces … not
   parallel note systems") says no today. Options: (a) connectors are drawing
   only, never indexed; (b) connectors are indexed as a *derived* board-link
   projection (rebuildable, like search), with Markdown still the only
   authored link grammar; (c) amend the contract.
2. **What does a file card show?** `PRODUCT.md` rules out "a decorative
   whiteboard wrapped around static previews," and only images and video may
   be preview-only. So a PDF or sheet card must open into its real editor (or
   be live-editable in place), never a dead thumbnail.
3. **Where do tasks live?** `memex-data-contract.md` says there is no task
   database and no task metadata. A sheet that acts as a task tracker is a
   second task system next to the Tasks page. See §2 for the two paths.
4. **Naming.** "Board" already means two things: the quick-capture card view
   (`src/components/boardSurface.tsx`) and the Excalidraw file. A third meaning
   needs a different word — suggestion: **Canvas** for the freeform surface,
   keep "board" for Excalidraw drawings, and **Task board** for the kanban.

## 1. Freeform canvas (AFFiNE "Edgeless")

### What AFFiNE does

- One infinite canvas that holds shapes, text, sticky notes, **note blocks
  (full rich docs)**, images, attachments (PDFs), web embeds, **database views
  (table/kanban)** and **linked-doc cards**.
- **Connectors**: straight, curved, orthogonal; auto-attach to objects, route
  around obstacles, carry labels. The 0.15 "quick connector" is one click from
  any object's toolbar — the gesture that makes "drop docs, connect them" fast.
- **Frames** are named regions that double as slides. **Present** turns frames
  into an ordered deck (order = Navigator panel, drag to reorder; arrow keys to
  step). Export as PNG / SVG / multi-page PDF.
- Page ↔ Edgeless is one document in two modes.

### What Rotli has

- Excalidraw 0.18.1 behind one adapter, `src/boards/engine/excalidraw.tsx`
  (enforced by `check:architecture`). Five small files in `src/boards/`.
- Raw `.excalidraw` files in `storage/excalidraw`; revision-checked saves;
  Rust twin limits in `src-tauri/src/board.rs`; web twin in
  `src/services/folderBoards.ts`.
- Board embeds in notes (```` ```board ```` fence, view-only while the board's
  tab is open), Mermaid → board copy, agent `apply_board`.
- Nothing links out of a board, nothing drops into it, no frames UI, no
  presentation mode, no custom Excalidraw callbacks.

### Verdict: build inside Excalidraw, not a new engine

Every hard part is on Rotli's side and would follow any engine. Excalidraw
already has frames, arrow binding, embeddable elements with a
`renderEmbeddable` override, `customData` on elements, `onLinkOpen`,
`scrollToContent`, and host-controlled `viewModeEnabled`. It has **no
presentation mode** (issue #7568) — Rotli builds that overlay itself.

### Slices

| # | Slice | Size | Notes |
|---|---|---|---|
| C1 | **Real images on boards** | S or M | Today images are base64 inside the board. `validation.ts:29` and `board.rs:70` cap every string at 100k chars (≈75 KB image), so real screenshots fail to save — confirmed against the validator on 2026-09-23 (a 110 KB image data URL is rejected with "Board contains a string that is too long"); not yet reproduced end-to-end in the app. Two fixes, an owner call: **(S)** exempt image data (`files.*.dataURL`) from the per-string cap under a MB-scale limit, inside the existing 8 MB total — keeps `.excalidraw` files opening unchanged in Excalidraw and Obsidian; or **(M)** store images in the vault's asset lane with a reference in the element (`customData.rotli.asset`), resolved on load — smaller files, but other Excalidraw apps then show broken images. Both twins change either way. Prerequisite for everything else. |
| C2 | **Canvas drop target** | M | Native: `nativeFileDrop.ts` has no canvas branch; a Finder drop onto a focused board falls through to another note or Assets (§4 suspected bug). Web: only images, via Excalidraw's own handler. Sidebar rows use pointer-drag (`pointerDrag.ts`), not HTML5 drag, so rows need a canvas drop target too. |
| C3 | **File cards** | L | An embeddable element tagged `customData.rotli = {kind, id}` and rendered by Rotli through `renderEmbeddable`: note excerpt card, sheet card, board card, PDF card. Click opens the real surface (`rotli://open?id=…&kind=…` already exists); follows the one-writer rule (read-only while that file's tab is open). Must be a working surface, not a preview (decision 2). Mac CSP only allows `frame-src 'self' asset:`, so cards are React-rendered, never external iframes. |
| C4 | **Connectors between cards** | M | Excalidraw arrows bind to shapes; binding to embeddables must be confirmed in a spike. Semantics are decision 1. If (b), add a derived board-link index (Rust + TS twin) so backlinks can say "linked from canvas X". |
| C5 | **Frames + Present** | M | Frames exist in the schema. Add a frame list (order stored in `rotliMeta`, since Excalidraw has no frame-order field), then a Present overlay: `viewModeEnabled`, `scrollToContent(frame, {fitToViewport})`, ←/→ through the key registry (`ROTLI_KEYS`: no hard-coded chords), Esc exits. Export frames to PDF later. |
| C6 | **Quick connector gesture** | S–M | AFFiNE's one-click "connect to new/other card" from a card toolbar. Pure UX on top of C3–C4. |

**Total: XL** (C1–C5 ≈ 5–7 weeks). C1 + C2 + C5 alone (≈2 weeks) already give
"drop screenshots and files on a board, then present it by frames," with no
contract change. C3–C4 are the part that needs decisions 1 and 2.

**Spike before committing (1–2 days):** against the installed 0.18.1 types,
confirm (1) the `renderEmbeddable` signature and whether embeddables need a
click to become interactive, (2) whether arrows bind to embeddables, (3) frame
children and z-order behaviour when cards are inside frames. (2) decides
whether C4 is M or L.

**Open storage question** already on record: boards in `storage/excalidraw`
are gitignored (not versioned) and their Library placement was flagged wrong
(`docs/design/web-version-and-shell-batch-2026-09-16.md` item 18). A canvas
that becomes a presentation raises the stakes — resolve before C3.

## 2. Task-management tables (the screenshot)

The screenshot is AFFiNE's database block: typed columns (text, person,
rating, progress, select-status, date), table ↔ kanban views over the same
rows, filter/sort/group.

### What Rotli has

- **Sheets** store real `.xlsx` (ExcelJS codec + Univer grid). Round-trip is
  real for fonts, solid fills, borders, alignment, number formats, dates,
  merges, widths, heights, frozen panes. Not for data-validation dropdowns,
  conditional formatting, hyperlink targets, rich text, or shared formulas.
- Sheets are gated `desktop && development` (`src/lib/featurePolicy.ts:24`);
  launch readiness wants evidence from Excel/LibreOffice-authored files and a
  sheet-editing E2E first.
- Univer's data-validation, conditional-formatting, filter, sort, hyperlink and
  table presets are installed (via `@univerjs/presets`) but **not mounted**, and
  even if mounted their state lives in the snapshot's `resources` field, which
  `SheetModel` (`src/sheets/engine/types.ts:52-59`) and the bridge
  (`bridge.ts:221`) don't carry. Rules made in the grid would never reach the
  file.
- **Tasks page** aggregates Markdown tasks vault-wide. The task item carries
  `noteId, noteTitle, line, text` only; `[/]` is folded into "open", so there
  is no state to put in columns yet. No due date, priority, owner.
- `rotli notes query 'area:x tag:y updated:>=…'` exists in the CLI/MCP only.

### Path A — styled sheet templates (a document feature)

"New from template → Task tracker" builds a styled `.xlsx`: header row, status
dropdown (Todo/Doing/Stuck/Done) with colour rules, ★ priority, a progress
column with data bars, a date column, frozen header.

| # | Slice | Size |
|---|---|---|
| A1 | ExcelJS template builder in `src/sheets/create.ts` + 3–4 templates (task tracker, weekly planner, habit tracker, content calendar) | M |
| A2 | Carry Univer `resources` across the bridge (model type, both directions, save-reload identity test) | M |
| A3 | Mount data-validation + conditional-formatting presets; round-trip tests reopened in Excel | M–L |
| A4 | Kanban over sheet rows (row view on `tablesFromXlsx`, revision-checked write-back, one-writer guard, a "status column" convention) | L |

Excel-faithful by construction — the file *is* the export. But: chips are
plain cells in Rotli's grid until A2–A3 land; nothing ships until Sheets
ungates; and A4 makes a sheet a second task system (decision 3). Keep A to
**templates as documents** (A1–A3); treat A4 as out of bounds unless the
contract changes.

### Path B — task views over Markdown (contract-clean)

| # | Slice | Size |
|---|---|---|
| B1 | Add `state` (open / in progress / done) to the task item in Rust and the TS twin | S |
| B2 | **Task board view** — the existing roadmap idea: Tasks page as columns, drag between columns rewrites `[ ]`/`[/]`/`[x]` in the note | M |
| B3 | **Due dates on tasks** — existing roadmap idea (`due friday`), plus optional `!high` priority; needs a vocabulary decision (see Logseq §3) | M |
| B4 | **```` ```query ```` fence** — a Markdown-owned live table of tasks or notes, reusing the `rotli notes query` grammar | M–L |
| B5 | **Export to .xlsx** from a query/task view through the existing ExcelJS `saveXlsx` | S–M |

### Recommendation

Path B gives the screenshot's table (B4), the kanban (B2), and "open it in
Excel" (B5) while tasks stay in notes. Path A1 is still worth doing as a
cheap, separate win — good-looking planner templates — once Sheets ships.
A2–A3 are part of finishing Sheets anyway (launch readiness already needs
richer round-trip evidence).

## 3. Logseq — what people love, and what fits Rotli

**Positioning first.** The loudest complaint about Logseq 2.0 is the move from
Markdown files to a database: users can no longer keep their data as
Markdown, and "half the edits are done by Claude" workflows break. Rotli's
product law — user files are durable truth, `.rotli/` is a rebuildable
projection — is exactly what those users are asking for. That is marketing
copy, not just architecture.

What people praise: the outliner, the **daily journal** ("no more deciding
where a note goes"), **block references**, **bidirectional links**, **queries**,
tasks with SCHEDULED/DEADLINE, whiteboards built from existing blocks, PDF
highlights, flashcards, local-first Markdown, low capture friction.

| Logseq feature | Rotli today | Fit | Size | Notes |
|---|---|---|---|---|
| Daily journal | No (only a "Daily" `/template` preset) | **High** | S–M | A Journal folder in Main, "Today" command/hotkey that opens or creates `YYYY-MM-DD`, optional Quick Note → today. Pairs with Breve. |
| Backlinks + unlinked mentions | No (already a roadmap idea, M) | **High** | M | The search index already resolves wikilinks; this is a panel. |
| Query fence | CLI/MCP only | **High** | M–L | Path B4 above; one feature serves Logseq users and task tables. |
| Tasks: SCHEDULED/DEADLINE, priority, recurring | `[ ]` `[/]` `[x]` only | Medium | M | Extends roadmap "Due dates on tasks." Needs a written task-metadata vocabulary in `SYNTAX.md` + contract amendment. |
| Block references / block embeds | No (heading links only) | Medium | L | Obsidian-style `^block-id` anchors + `[[note#^id]]` + `![[note#^id]]` transclusion. Touches `SYNTAX.md`, the Rust index, the TS twin, and the editor. Keeps Markdown portable (Obsidian reads the same syntax). |
| Page embeds `![[note]]` | No | Medium | M | Transclusion widget; one-writer rule applies. |
| Natural-language dates (`[[Next Friday]]`) | No | Medium | S–M | Only after the journal exists; resolves to journal notes. |
| Outliner zoom into a bullet | Partial (indent, fold headings, block drag) | Low–Med | M | Bullet-level fold + zoom. |
| Graph view | No | Low | M | Pretty, rarely used daily; derived from the link index. |
| PDF highlights linked to notes | View only | Low (for now) | L | Needs a pdf.js surface; the contract forbids passive previews, so a PDF surface should edit (annotate) anyway. |
| Flashcards / spaced repetition | No | Low | M | Niche; could be an add-on once the Add-ons system exists. |
| Plugins | No (Add-ons system planned) | — | — | Already planned (§2 of the roadmap). |

## 4. Suggested order

1. **Task board view + task `state`** (B1–B2) — smallest, already on the
   roadmap, contract-clean.
2. **Daily journal** — highest Logseq-fit per day of work.
3. **Canvas foundations** (C1 real images, C2 drop target, C5 frames +
   Present) — fixes a real save failure and lands the presentation use case
   with no contract change.
4. **Query fence + Export to .xlsx** (B4–B5) and **Backlinks panel**.
5. Decide decisions 1–3, then **file cards + connectors** (C3–C4) and **due
   dates / task vocabulary** (B3).
6. **Sheet templates** (A1–A3) as part of finishing Sheets.
