# App work for the next release — 2026-10-05

The owner's four asks for the app (the website round runs separately; this work
does not touch `site/`). Branch `feat/app-next-release`, stacked on
`fix/onboarding-on-stack`; nothing is pushed. This doc records what the code
says today, the proposed order, the risks, and the questions the owner must
answer before building.

## Decisions (owner, 2026-10-05)

| # | Question | Decision |
|---|---|---|
| 1 | Chart renderer | TanStack Charts 1.0 behind one adapter seam. The `chart` fence spec stays library-free, so an in-house SVG renderer can replace it. |
| 2 | `/ai` Accept | Consented insertion: a one-time grant for that insertion. It goes through the AI write lane as actor `inline`, is never applied to a locked note, is secure-gated by model class, and is journaled. |
| 3 | Sheets scope | Chat's sheet artifacts go to production with the editor. CSV gets the Beta badge too: everything that runs on Univer is Beta. |
| 4 | Chat images on Rotli Web | Keep Helper's refusal. Fix the web strip, chips, and the two web bugs, and say plainly that sending images needs the Mac app. |
| 5 | Slash form | Per-type commands (Bar chart, Line chart…). There is no colon grammar (the default; not asked). |
| 6 | Vault folder (feedback round) | Always the macOS folder panel ("people know exactly what to do"); creating a vault is New Folder in that panel; Rotli's in-app browser is removed. |
| 7 | Skipping setup | Offer a skip on every screen; the only required thing is a vault. |
| 8 | Chart command | One `/chart` that opens a picker of ten kinds (bar, horizontal bar, stacked bar, line, area, pie, donut, scatter, radar, heatmap), not one slash command per kind. |

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
| A file changed on disk while edits were parked: the edits are set aside with a visible note (`sheetEditor.tsx:101-108`). They are not silent, but they are lost, with no recovery copy. | **Fixed** The edits are held out of the flush; the sheet offers Save my edits as a copy (a new `.xlsx` in the managed lane, opened in a tab) or Discard. |
| A failed flush on window hide or page-hide is swallowed (`session.ts:143,146`). At quit, a failed flush aborts the quit, which is correct. | **Fixed.** A failed background save shows its reason. |
| Closing a dirty tab parks the edits in memory; they are written on the next hide or quit. | Acceptable for Beta. Document it. |
| Undo history resets on a theme change, a Raw/Themed toggle, or a tab switch, because the engine is rebuilt. | Beta limitation. Document it. |
| Unknown XLSX parts outside the refusal list may not survive a save; data validation and conditional formatting are not editable. | Beta limitation, already in the launch-readiness doc. |
| Files over 8 MB open read-only (same limit in TS and Rust); the viewer shows 2,000 rows. | Fine. |
| Univer portals its popups to the page; Rotli's overlays sit at 1000. There is no Rotli constant for this. | **Probed in the browser twin.** Univer's right-click menu sits at z **1070** (not 1020), and the open search panel at 1000. Clicking into search closes Univer's menu, so the two never overlapped. A Rotli overlay opened by keyboard while a Univer menu is open could sit under it. That is cosmetic, not a blocker; it is on the native checklist. |
| No e2e test opens, edits, or saves a sheet, and `session.ts` has no unit test. | `session.test.ts` added (the resume decision, set-aside, the CSV copy round trip, flush reporting). The browser twin has no file bytes (`corpusFileStat` is null), so create, edit, Save, and reopen are a native check. |

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

## Charts: the dependency record

- **Release-age override (owner's call).** `@tanstack/charts` 1.0.0 was two
  days old, younger than the three-day `minimumReleaseAge` hold in
  `bunfig.toml`. The owner chose to override the hold once, on 2026-10-05.
  - How: one `bun add --exact` run against a temporary copy of `bunfig.toml`
    with the hold and the frozen lockfile off. The repository's `bunfig.toml`
    is unchanged, and frozen installs accept the lockfile.
  - Only the TanStack package itself is new. Its D3 dependencies are long
    published.
- **Type packages deduplicated.** `bun dedupe` (the `deps dedupe-check`
  gate) settled `@types/d3-path` on 1.0.11, which `@types/d3-sankey` needs and
  every other consumer accepts. Both TypeScript lanes stay clean.
- **Pinned exact.** The version is pinned, as TanStack's stability guide asks.

## Native checklist (the owner, in the Mac app)

The browser twin can't prove these.

- [ ] **Beta in the file header.** Open a `.xlsx` and a `.docx`: the header shows Beta beside the name. A read-only sheet shows its reason instead.
- [ ] **Sheet round trip.** New Sheet, edit a cell, Save, quit, reopen: the value is kept and the header says Beta.
- [ ] **Conflict banner.** Edit a sheet without saving, switch to another tab, change the file in Excel or Numbers, then come back. The banner offers the copy.
- [ ] **The copy.** Save my edits as a copy opens a new workbook with your edits, and the original keeps the outside change.
- [ ] **Source-app compare.** Open an Excel-authored `.xlsx` with formulas, dates, and styles, save it, and compare it in Excel (launch-readiness item).
- [ ] **Univer menu vs a Rotli overlay.** Right-click a cell, then press ⌘K: note whether the search panel opens under Univer's menu.
- [ ] **Chat: attach at the caret.** In a chat on a vision model, type "compare ", put the caret there, attach two images with + → Add files or photos. `[Image #1] [Image #2]` appear at the caret, and the thumbnails show 64 px with × inside the corner.
- [ ] **Chat: remove a thumbnail.** × on the first image removes its tag; the other tag becomes `[Image #1]`.
- [ ] **Chat: pasted screenshot.** ⌃⇧⌘4 a region, then ⌘V into the composer: it attaches with its tag. A rich copy from a web page still pastes as text.
- [ ] **Chat: the sent chip.** The sent message shows each tag as a chip (image, file name, size) where it was typed; it reads the same after reopening the chat.
- [ ] **Chat: dropped and Finder-pasted images.** A Finder drop or a Finder ⌘C/⌘V still attaches, with the tag typed at the end.
- [ ] **Charts: insert one.** Type `/chart` in a note and pick Bar chart: a chart and its form appear. Edit a value, press Apply, and the chart redraws. ⌘Z undoes the Apply.
- [ ] **Charts: themes.** Switch through a light and a dark theme: the chart's colors and axes follow.
- [ ] **Charts: a narrow pane.** Split the pane: the chart and its form fit the narrow width, and the form scrolls sideways instead of overflowing.
- [ ] **Ask AI: your own note.** In a note you wrote, on the Mac's model, type `/ai`, ask for "a closing sentence", then Insert. It lands on the line where you typed `/ai`, and ⌘Z removes it.
- [ ] **Ask AI: a chart.** Ask for "a bar chart of: Mon 4, Tue 6, Wed 3". A `chart` fence is inserted and draws.
- [ ] **Ask AI: refusals.** On a locked note, and on one with "Let AI edit the text" turned off, Ask is refused before anything is sent.
- [ ] **Ask AI: a secure note.** With the Librarian on a connected model, a secure note is refused. With the Mac's model it works, unless Settings turns that off.
- [ ] **Ask AI: a list item.** In a bullet, type `/ai` and Insert a two-line answer: the second line is indented under the bullet.
- [ ] **Ask AI: the journal.** `rotli notes history ID` shows the insertion as an `inline` row.
- [ ] **Setup: your Librarian pick stands.** With Gemini signed in, pick On this Mac on the Librarian screen, then go Back and return: it is still On this Mac.
- [ ] **Setup: the folder panel.** On the vault screen, Choose a folder opens the macOS panel. New Folder there makes a fresh vault; picking an existing Markdown folder opens it in place. Picking Home itself is refused.
- [ ] **Setup: Skip.** Skip setup on the first screen: with a vault already chosen the app opens at once; without one, the app shows one prompt, "Rotli needs a folder for your notes" (no step count, no Back), and after the folder it opens with no Librarian or shortcuts screen. Quit at the prompt and relaunch: the same prompt, not setup's vault step. On the Librarian screen, Skip the rest finishes setup.
- [ ] **Settings and sidebar.** Settings → Location's folder choice and the sidebar vault menu's Connect both open the macOS panel.
