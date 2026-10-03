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

## Status (2026-10-03)

Fifteen pull requests, stacked in one line (`dev ← #151 ← … ← #165`), each
proved by `bun run verify` on the stack tip:

| PR | Branch | Items |
|---|---|---|
| #151 | `fix/keep-quokka-outline` | #8 the Keep quokka's outline |
| #152 | `fix/drop-search-scrolltop` | #5 Retina drops, #23 ⌘P body search, #6 quieter scroll-to-top |
| #153 | `feat/theme-cycle-image-outline-align` | #3 theme cycle knob, #4 image outline, #9 `<p align>`; slash rows no longer select on mouseenter |
| #154 | `feat/hand-to-ai-v2` | #22 attachments as paths, Basic/Refined with offline evals |
| #155 | `feat/agents-lane-buildout` | #24 MCP rename/trash/attachments/roots/configs, the AI edit journal (#2 side note) |
| #156 | `feat/site-message` | #2, #11–#14 site message, TwoKinds, StatBand, Ocean night, carousel retired |
| #157 | `feat/site-structure` | #13, #15–#17 Resources menu, blog + Rotli Web post, Developers, article layout, Features |
| #158 | `feat/site-living-footer` | #7, #19 quokka footer and 404, Resend list, one badge |
| #159 | `feat/hero-product-video` | #1 real product film in the hero |
| #160 | `fix/site-integration` | Rotli Web "just now" dates, privacy truth, one beach, legible film captions |
| #161 | `feat/about-story` | #18 About as a first-person story |
| #162 | `feat/tab-indent` | #10 Tab as a visible indent |
| #163 | `feat/brand-images` | #20 per-page link cards, banners, profile pictures, thumbnails |
| #164 | `fix/native-date-age` | the Mac app's date-only ages; `[[` never offers the current note |
| #165 | `feat/chat-quokka-buddy` | #14 the chat buddy; quokkas only in Chat, Settings, setup |

Decisions taken under the owner's delegation (2026-10-03): the footer
quokkas' idle motion is the site's one timer exception; the landing ends on
the footer beach (sunset removed); chat-buddy decoration stays per Mac; the
launch opening drops its quokka; Tab stops paragraphs at one level; new notes
keep full UTC `created` timestamps.

Remaining, owner-blocked:

- Review and merge the stack bottom-up (stack-and-merge-down).
- Resend: a segment + full-access key; Railway runtime `RESEND_API_KEY`,
  `RESEND_SEGMENT_ID`.
- Build the site Docker image once (Bun sidecar stage untested locally).
- Upload banners, profile picture, and GitHub social preview.
- About: optionally supply a real "why I started" moment and the quokka
  reason (marked in code comments).
- Native proofs: a Retina Finder drop (#5), Refined with a real model (#22).
- Review the hero film cut by eye.
- #21 the story film — last, after the above settles.

Known follow-ups: nested ordered lists indent 2 spaces (CommonMark wants 3);
an in-app viewer for the AI edit journal; `![[file]]` embeds as Hand to AI
attachments; `public/night-stars.svg` is unused.
