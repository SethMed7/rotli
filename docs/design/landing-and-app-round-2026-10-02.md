# Landing + app round — 2026-10-02

Source: the owner's sketch note `wiki/tasks/prompt-for-rotli-landing-page-and-app`
(24 items). This doc sorts them into site vs app, records the decisions taken on
2026-10-02, and orders the work into reviewable PRs.

## Decisions (owner, 2026-10-02)

| # | Question | Decision |
|---|---|---|
| 1 | Hero video | Real screen capture from the synthetic demo vault, edited with `marketing/hyperframes`. Replaces the illustrated story film. |
| 2 | Hero angle | "Your flow". Draft: *Write like a person. Let AI do the filing.* |
| 3 | Theme button | Default flips light ↔ dark within the chosen family. Settings knob: `family` · `picks` (user-chosen cycle) · `all`. |
| 7 | Newsletter | Bun sidecar inside the site container behind Caddy (`/api/subscribe`) adds the address to a Resend Audience. Same shape as `~/portfolio/server.ts`. The form is hidden when `RESEND_API_KEY` is unset. |
| 7/16 | Quokka life | Rig the existing SVG in layers (eyes, head, arms, brows/mouth) and animate it in code. No new art pipeline. |
| 9 | Alignment | `<p align="center|right">…</p>`. Left is the default and is never written. |
| 14 | Quokka section | Cut from the landing page. In the app, the chat quokka becomes a fixed buddy you can decorate but not swap. |
| 24 | MCP/CLI to stable | **Not yet.** Build it out in dev builds. The site labels it "coming soon" / dev site only. |

## Findings that shape the work

- **#2 statistic.** The enterprise SaaS-seat numbers in the screenshot (Vertice/Zylo/Flexera) don't support a consumer-AI claim, and several don't match their sources. Use these instead:
  - Self Financial (Mar 2026, 1,272 US adults with a paid AI plan): 50.4% hadn't used ChatGPT in 30 days, 35.3% Gemini, 27.2% Claude.
  - Bango (Q4 2025): the average AI subscriber pays ~$66/mo across 4 tools.
  - Wording must stay "hadn't used in the past 30 days", never "wasted".
- **#2 side note.** AI write permission already exists: `created_by` + `ai_edit`, `ai_edit_policy.rs`, TS twin, "Let AI edit the text". What's missing is a diff/undo journal for agent and chat body edits. The Librarian's `brainJournal` already has one for its own actions.
- **#5 root cause (probable).** `src/editor/externalImageDrop.ts` `nativeDropPoints` divides by `devicePixelRatio` first. On macOS, wry already reports logical points, so on Retina the halved point wins in `dropRouting.firstTarget` and the drop lands roughly halfway up.
- **#8 root cause.** In `src/assets/characters/knowledge_system.svg`, the right flank outline is missing behind the card tree. This is in the art itself, not a viewBox clip. The fix lands in the app and the site at once.
- **#13.** The Helper/terminal decision lives in `docs/design/web-version-and-shell-batch-2026-09-16.md` §228-337. The site has `resources/rotli-helper.md` and `web-and-mac.md` but no "why".
- **#22.** Hand to AI (`src/lib/handToAi.ts`) passes `storage:` image links through as literal text. Agents can't resolve it, and the Librarian isn't involved.
- **#23.** The ⌘P picker (`quickNote.tsx` `NotePicker`) uses a subsequence match on title + a 140-char snippet. The ranked full-text engine (`useNoteSearch` / `search_match.rs`) is unused there.
- **#24.** Gaps: no MCP rename, no attachment/image tool, no trash, no Hand-to-AI tool, `rotli open` serves the default root only, and agents are dev-build-only.

## Work plan

Order: the owner asked for the video first. Small app fixes run in parallel. The
site message and structure follow. The story film (#21) comes last.

### PR 1 — Hero product video (#1)
- Script a 45–60s walkthrough on the demo vault: write → Librarian files → chat → keep.
- Capture it, cut it in hyperframes, add a poster, and keep the existing `FilmPlayer` behavior (muted autoplay once, reduced-motion poster).
- Under ~6 MB.
- Human step: the owner reviews the cut.

### PR 2 — App fixes (#5, #23, #6, #8)
- **#5:** start with a failing reproduction. Prefer the raw pair on macOS, or choose the candidate inside the editor rect. Update `externalImageDrop.test.ts`. Prove it with native validation (browser can't).
- **#23:** route the picker through the full-text engine with ranking. Title hits outrank body hits, diacritics fold, and the list stays honest while loading.
- **#6:** shrink and quiet the scroll-to-top button (smaller, low-contrast until hover, semantic tokens only).
- **#8:** patch the missing outline in `knowledge_system.svg`, then re-render `filled/*` + masks.

### PR 3 — App features (#3, #4, #9, #10)
- **#3:** add a theme-cycle knob (default `family`), plus a picker in Settings for `picks`.
- **#4:** add an image outline knob (Appearance), using the editor's semantic border token. Per-image override only if asked.
- **#9:** add align left/center/right commands with `<p align>` round-trip in live preview, and document it in `SYNTAX.md`.
- **#10:** reproduce what "proper tab" means first. List-aware nesting is the likely gap; Tab already inserts 2 spaces.

### PR 4 — Hand to AI v2 (#22)
- Resolve `storage:` to absolute paths and add an attachments section.
- Keep the deterministic template as "Basic".
- Add a toggle for "Refined": the Librarian's model rewrites it into a real prompt. It is on-device by default, secure rules apply, and it falls back to Basic on failure.
- Add deterministic offline evals for the refiner.

### PR 5 — Agents lane, dev builds (#24 + #2 side note)
- MCP: `rotli_rename`, an attachment read tool, trash, `rotli_hand_to_ai`, and multi-root `open`.
- `rotli agent config` for Claude Code, Codex, Cursor and Gemini CLI.
- An AI body-edit journal with diff + undo, reusing the brainJournal shape.

### PR 6 — Site message (#2, #11, #12, #13, #14, #19)
- Hero "Your flow"; new Overview headline; new "two kinds of notes" section; a sourced stat band.
- Privacy band: new headline, and the night palette moves from Rotli warm-dark to Ocean dark (`--deep-*` → ocean-dark values for that band only).
- Everywhere: say plainly that the browser reaches your Mac through the Helper started in Terminal. Link a new blog post on why.
- Remove the quokka carousel. Remove the founder.best badge and its CSP `img-src` host. Keep Launch Llama.

### PR 7 — Site structure (#15, #16, #17, #18)
- Resources becomes a dropdown: Guides · Blog · Developers (MCP/CLI, labelled coming soon) · Changelog. The blog gets "coming soon" stubs.
- Features page cleanup using fresh demo-vault captures (keep-docs-fresh). The owner can supply cleaner shots instead.
- Privacy page moves to the article flow: sticky left TOC with reading progress, a readable column, and the walking quokka in the footer.
- About: a story rewrite. Needs an owner interview (questions below).

### PR 8 — Living footer + 404 (#7)
- Newsletter form plus the Bun sidecar (CSP: `form-action`/`connect-src 'self'`). The owner sets `RESEND_API_KEY` + audience id on Railway.
- Quokka scenery:
  - Eyes track the cursor and arms reach.
  - Near their food they get mad; on the food they get sad.
  - Under reduced motion they stay still.
  - Shared with the 404.

### Later — Branding + story film (#20, #21)
- Per-page OG cards, banners, profile-picture set, embed images.
- The creation/why film comes last, once copy and product visuals have settled.

## Model split

- **Opus:** drag-drop, search engine wiring, MCP, Hand-to-AI refiner, SVG rig + interaction, privacy-page layout.
- **Sonnet:** copy passes and blog drafts, About interview → draft, stat verification (done), E2E spec drafting, screenshot capture runs.

## Status (2026-10-02)

Ten local branches, each built on the one before (none pushed yet):

1. `fix/keep-quokka-outline` — #8: the Keep quokka's missing outline is
   restored in the art; app and site re-rendered.
2. `fix/drop-search-scrolltop` — #5 Finder drops land under the pointer
   (failing test first), #23 ⌘P searches note text through the ranked
   engine, #6 a smaller, quieter scroll-to-top.
3. `feat/theme-cycle-image-outline-align` — #3 the theme button flips
   light/dark (cycle knob), #4 image outline knob, #9 align commands with
   `<p align>` round-trip.
4. `feat/hand-to-ai-v2` — #22 attachments as real paths, Basic and
   Refined modes with offline evals.
5. `feat/agents-lane-buildout` — #24 MCP rename, trash, attachment reads,
   and a journal for every AI body edit (the #2 side note).
6. `feat/site-message` — #2, #11, #12, #13, #19: the new hero line,
   TwoKinds, the sourced StatBand, the Ocean night privacy band, the
   Helper explained; carousel and Founder.best badge gone.
7. `feat/site-structure` — #15–#17: the Resources dropdown, blog, developer
   page, and the privacy article layout.
8. `feat/site-living-footer` — #7: the quokka footer and 404 scenery, and
   the Resend newsletter sidecar.
9. `feat/hero-product-video` — #1: the hero plays a real Rotli Web
   recording.
10. `fix/site-integration` — a new note in Rotli Web reads "just now"
    (date-only stamps are never read as hours); the privacy page and
    PRIVACY.md name only the Launch Llama badge and describe the Resend
    list; the privacy night uses the Ocean stars; `/mcp` goes straight to
    the developer page; episode 7 is retitled; the landing ends on one
    beach (sunset scene removed); the hero film's captions read on a
    phone, Watch again stays above them, and the film is re-recorded.

Remaining:

- #10 Tab (still needs the owner's answer on what feels wrong).
- #14 the chat buddy (app half).
- #18 About (needs the owner interview).
- #20 branding.
- #21 the story film, last.
- Native proofs: the Retina drop (#5) and Refined with a real model (#22).
- Building the site's Docker image.
- Setting the Resend environment (`RESEND_API_KEY`, `RESEND_SEGMENT_ID`)
  on Railway.

## Still open (non-blocking)

- About page: what story? (origin of the name, why local-first, who it's for). An interview gets the raw material.
- #10: what feels wrong about Tab today?
- #14 (app half): does the chat buddy's decoration live per-vault or per-Mac?
