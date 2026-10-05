# App work for the next release — 2026-10-05

The owner's four asks for the app (the website round runs separately; this work
does not touch `site/`). Branch `feat/app-next-release`, stacked on
`fix/onboarding-on-stack`; nothing is pushed. This doc records what the code
says today, the proposed order, the risks, and the questions the owner must
answer before building.

## Order

1. Sheets and Docs: Beta badge, and Sheets on in production desktop builds.
2. Chat attachments like a modern composer.
3. The `chart` fence and its slash commands.
4. `/ai` inline helper. Comes after charts, because it should be able to write a `chart` fence.

Size ceilings shape every slice. New UI goes in new files:

| File | Lines | Ceiling |
|---|---|---|
| `cmEditor.tsx` | 907 | 908 |
| `chatSurface.tsx` | 2799 | 2864 |
| `blockRender.ts` | 815 | 919 |
| `tableRender.ts` | 780 | 797 |

## 1. Sheets to production, Beta on Sheets and Docs

**What the flag covers.** "Sheets" means `.xlsx` workbooks. CSV editing already
ships in every desktop build. `LAUNCH_FEATURES.sheets` (`src/lib/featurePolicy.ts`)
is the only gate, and Rust has none. Flipping it turns on more than the editor:

- the Sheet card in the New chooser, the + menu, the palette's `items.newSheet`,
  and the Settings "New tab creates" option;
- opening `.xlsx` (today production shows "unsupported in this build");
- the ` ```sheet ` embed fence and `/Sheet`. As a side effect, CSV embeds stop
  being hidden in production.
- chat's sheet artifacts (`src/ai/artifacts.ts`, `tools.ts`, `prompt.ts`).

The CLI and MCP have no sheet kind, so there is nothing to flip there.

**Readiness audit** (Sheets save through ExcelJS over the original workbook;
saving is explicit with ⌘S or Save, plus a flush on hide and on quit;
revision-checked atomic writes; a one-time `.bak`):

| Finding | Verdict |
|---|---|
| A file changed on disk while edits were parked: the edits are set aside with a visible note (`sheetEditor.tsx:101-108`). They are not silent, but they are lost, with no recovery copy. | **Fix with the flip.** Write the set-aside edits to a sibling recovery file instead of dropping them. |
| A failed flush on window hide or page-hide is swallowed (`session.ts:143,146`). At quit, a failed flush aborts the quit, which is correct. | **Fix with the flip.** Surface a failed background save. |
| Closing a dirty tab parks the edits in memory; they are written on the next hide or quit. | Acceptable for Beta. Document it. |
| Undo history resets on a theme change, a Raw/Themed toggle, or a tab switch, because the engine is rebuilt. | Beta limitation. Document it. |
| Unknown XLSX parts outside the refusal list may not survive a save; data validation and conditional formatting are not editable. | Beta limitation, already in the launch-readiness doc. |
| Files over 8 MB open read-only (same limit in TS and Rust); the viewer shows 2,000 rows. | Fine. |
| Univer portals its popups to the page at z 1020; Rotli's overlays sit at 1000. There is no Rotli constant for this. | Check during the slice: a Univer menu must not cover the palette or a dialog. Not a blocker. |
| No e2e test opens, edits, or saves a sheet, and `session.ts` has no unit test. | **Add in the slice:** one e2e (create, edit a cell, Save, reopen, value kept) and a `session.test.ts`. |

**Beta badge.** One shared component (`src/components/betaBadge.tsx`) built from
semantic tokens, in the calm pill voice of `.file-readonly`, never nested in
another badge (DESIGN.md). Where it goes:

- the New chooser cards for Sheet and Document;
- the file header of an open `.xlsx`, `.csv`, or `.docx`;
- the Settings "New tab creates" option labels.

The tab strip gets none; the brief allowed "tab or surface header".

**Other places to change in the same slice:**

- `README.md` (:98, :195), `ROADMAP.md` (:17, :157, :187), `docs/development/testing.md:60`,
  and `launch-readiness-2026-09-07.md`;
- about 11 unit tests that assert Sheets is "coming soon".

**For the website thread** (not touched here): `site/` `Formats.astro`,
`Features.astro`, and `Experiments.astro` say Sheets is coming soon.

## 2. Chat attachments

**Most of this already exists on the Mac.** The composer already has:

- a thumbnail strip with a remove ×;
- a `#n` number on each thumbnail;
- an inline `#n` chip in the sent message;
- images stored as vault assets and written into the transcript as portable
  `[Image #1]` links to `storage:images/…`.

What's missing:

- **The chip names nothing.** It should show the image, the file name, and the
  size, like the reference. Size isn't stored. Look it up with `corpusFileStat`
  when the chip renders rather than changing the token format, which four
  parsers and Rust's image preamble share.
- **Pasting a screenshot doesn't attach it.** Raw image bytes on the clipboard
  are only accepted by the note editor (`dropRouting.ts:114`). Add a paste
  handler on the composer that stores the image as an asset and attaches it.
- **Two Rotli Web bugs:**
  - The + picker attaches an image with no asset id, then fails on send.
  - After a reload, sent images don't show, because `fileAssetUrl` returns `""`
    on the web. `resolveImageSrc` does work there.
- **Web sending is refused on purpose.** Rotli Helper rejects image turns at
  three layers (`helperLink.ts`, `helper.rs:52-53, 373-377`), because an image
  turn enables the CLI's file-read tool from a browser-delivered prompt. See
  question 4.

Images only, as today. Other file types keep going to Assets with a notice.

## 3. Charts

**The library exists.** The brief assumed TanStack had no charts library, but
`@tanstack/charts` 1.0.0 was published 2026-10-03, two days ago, after two
months of 0.x alphas. It is MIT, SVG by default, with a React adapter, and it
uses D3 sub-packages as dependencies. Measured here, a tree-shaken build of bar,
line, and pie is 120 kB minified and **42 kB gzipped**, with no `eval`, so it
fits the production CSP and the lazy-chunk budget.

| Option | Size | Licence | CSP | Notes |
|---|---|---|---|---|
| **A. TanStack Charts 1.0** | ~42 kB gzip, loaded lazily | MIT | OK | The owner's ask. Has pie (`polar` + `pie` + `radialArc`). Needs one adapter file and a `vendorSeams` entry. The API has been stable for two days. |
| **B. In-house SVG** (bar, line, pie) | ~3–5 kB | ours | OK | No dependencies, and colours come straight from tokens (`check:hex`). Enough for "a basic way". |
| **C. Reuse Mermaid** `xychart-beta` / `pie` | 0 new | MIT | OK | Already shipped, but it is a `mermaid` fence in Mermaid's syntax, not a plain data spec. |

**Recommendation: A, behind a renderer seam.** The fence spec is the portable
truth and the renderer can be swapped behind it. If TanStack's young 1.0 API
breaks, B drops in without touching any file. If the owner prefers zero new
dependencies, build B now and A later on the same spec.

**Fence spec (draft for SYNTAX.md).** Options first, then a blank line, then the
data as CSV with a header row. The first column holds the labels; each further
column is a series.

````markdown
```chart
type: bar
title: Hours this week

Day, Writing, Reading
Mon, 4, 1
Tue, 6, 2
Wed, 3, 2
```
````

- `type` is required and is one of `bar`, `line`, `area`, or `pie`. `title` and
  `unit` are optional.
- Pie uses only the first value column.
- **Fails closed.** An unknown type, a non-numeric value, ragged rows, or an
  unknown option renders as code with the reason, and the source is never
  rewritten.
- **Edits only replace the fence body**, through Mermaid's stale-source guard.
- **Inline form.** The rendered block has an Edit mode: a small grid of the
  rows, in the pattern of `tableRender.ts`, plus a type picker. Apply writes
  the fence body back.
- **Chat** renders the fence as plain code for now (`chatMessageBlocks.ts`), so
  scope it in only if asked.

**Slash commands.** The slash grammar has no colon form: a query is one word,
and SYNTAX.md rules out inline arguments. So `/charts:bar` would be a grammar
change. The proposal is one command per type in the Insert group, in the same
pattern as Today, Yesterday, and Tomorrow:

- **Bar chart**, **Line chart**, **Area chart**, **Pie chart**;
- each one is found by typing `/chart`, `/bar`, and so on;
- each inserts a starter fence and opens the Edit form.

## 4. `/ai` inline helper

**How it works.** Typing `/ai` opens a small prompt popover at the caret, built
like the image-generation popover. The model comes from the Librarian's model
selection, which is on-device by default, the same way Hand to AI's Refined mode
picks its model. Its context is the note around the caret. The output is shown
as a preview in place and is not yet in the file.

- **Prompt asset.** The prompt is versioned in `src/ai/prompts/inlineAi.md`.
- **Offline evals.** A stub host checks that a chart request yields a valid
  `chart` fence, a sources request yields a list, and a secret in the prompt is
  refused.
- **Web.** Withheld on Rotli Web, like the Librarian, because the web build has
  no model lane.

**The contract question.** Under the current contracts, text a model puts into a
note is an AI write. It must go through `corpus_write_ai`, which refuses locked
notes, checks `ai_edit`, applies the secure laundering rule, and writes the AI
edit journal. A note the owner typed is `person-written`. Three options:

- **A. Strict AI write.** Accept saves through `corpus_write_ai`. On the owner's
  own notes it is refused unless "Let AI edit the text" is on, which is most
  notes, so `/ai` would mostly say no.
- **B. Accept as the person's own edit.** Accept puts the text in the buffer, the
  way pasting from chat does today. There is no grant and no journal entry, and
  AI text can then land in a locked note, which is what the locked law exists
  to prevent.
- **C. Consented insertion (recommended).** Accept is an explicit, one-time
  grant for that one insertion. It goes through the AI write lane with a new
  `inline` actor:
  - it skips the person-written rule because the person just consented;
  - it is still refused on locked notes;
  - it is still secure-gated by model class;
  - it is still journaled.

  This needs a Rust change (a new journal actor and the consent path), plus
  updates to `ai-visibility-matrix.md` and the 2026-09-29 AI body edit decision.

## Questions for the owner

1. **Charts:** A (TanStack Charts 1.0, ~42 kB, two days old), B (in-house SVG), or
   A behind a seam with B as the fallback?
2. **`/ai` Accept:** A (strict), B (the person's own edit), or C (consented
   insertion, journaled, never on locked notes)?
3. **Sheets scope:** should chat's sheet artifacts go to production with the
   editor, or stay dev-only for now? And does CSV, which already ships, get the
   Beta badge too?
4. **Chat images on Rotli Web:** Helper refuses image turns on purpose. Should it
   stay that way, so the web strip and chips work but the web can't send images
   until a later Helper change? Or should this round open it, which needs a
   threat-model review?
5. **Slash form:** per-type commands (Bar chart, Line chart…), or make the
   `/chart:bar` colon form part of the slash grammar?
