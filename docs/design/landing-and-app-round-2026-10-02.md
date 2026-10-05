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
- 2026-10-05: the owner asked for a polished launch cut (no caption bar, cards between cuts). The plan is [launch-video-plan-2026-10-05.md](launch-video-plan-2026-10-05.md).

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
- About: a story rewrite. Done in #161 as a first-person story; the owner can still add a personal moment (the `[[OWNER]]` notes in the page).

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

## Status (2026-10-05)

### Website round 2 (owner feedback of 2026-10-03)

The owner reviewed the stack's preview and gave seven website notes
(`_review/opus-website-feedback-2026-10-03.md`, local only). Opus built all
seven on `feat/website-round-2026-10-05`, a branch off #165's tip, in
`.claude/worktrees/opus-website-2026-10-05`. The full record is
`_review/opus-website-result-2026-10-05.md`. **Not committed and not pushed.**
The owner stopped the session and the preview at 2026-10-05 16:36.

| # | Note | Built |
|---|---|---|
| 1 | Not Mac-only | "A private workspace for your notes" plus "Mac first. Windows and Linux apps are planned." (`PLATFORMS` in `site.ts`); download page says Planned; home card and banners re-rendered |
| 2 | Before/after without cards | Two open columns; the Librarian's lines are tinted with a "+"; the example area is now `Clients` (fixes the #156 finding) |
| 3 | Dead stat section | A bench scene: four idle AI tools, and the quokka hands each one a note; the footnote matches the source |
| 4 | Privacy passage | The whole site, header included, steps into Ocean Dark while the band holds the middle of the window (`passage.ts`) |
| 5 | Footer scene | Each quokka has its own pose: eating, nibbling, a guard, two playing catch, one strolling. The visitor drags a leaf to hand over; a keyboard button does the same |
| 6 | 404 game | A canvas runner (`site/src/runner/`) that jumps obstacles and scores in metres; nothing is stored |
| 7 | Living resources | `ResourceScene` per guide, and a pinned "N% through" meter (`reading.ts`) |

Also fixed: theme-studio steps sit on one row at 390px (#156 finding), and the
privacy line no longer mixes up locked and secure notes. Proof so far: 19 new
rule tests, 20 new site specs (`bun run test:e2e:site`, 100/100 under repeat),
and `astro check` clean. Full `verify` stopped only on the `tab-indent` flake
(below); its later lanes passed when run on their own.

### Review holds and integration (2026-10-05, later)

Every review hold and the tracked should-fixes are fixed, each committed on
its own PR's branch and merged up the chain. **Nothing is pushed.**

| PR | Fix |
|---|---|
| #154 | Secure-folder links are decoded and normalized (`%20`, `..`, `%2e%2e`, backslashes) before the check, and anything undecodable or escaping the vault fails closed. Refine can't overwrite Basic edits. Path survival is whole-token, missing paths included. Rotli Web checks that non-image attachments exist |
| #155 | A linked `.md` goes through `read_for_ai`, and secure folders are refused, with no `absPath`. **Connected-vault open now switches the app to that vault (closes the current tabs) — owner to approve.** Trash re-checks policy and revision under the move lock |
| #160 | The web date window is now the reader's local day widened to the UTC day; the contract and CHANGELOG are made true |
| #161 | About copy matches the site ("past 30 days", AI optional) |
| #162 | `tab-indent` flake: Chromium caps the resource list at 250 entries, so the spec now imports the module directly (20/20 under load). Tab no longer breaks fence markers |
| #163 | Ocean and Grove profile pictures use real theme grounds; the contrast claim is honest; the About card restates the page |
| #164 | `/Link note` leaves out the open note. The contract records the Mac (UTC timestamp) vs web (local day) stamps |
| #165 | The buddy stops "thinking" once the reply shows, there is one buddy per view, and it never cheers a Stop |

The merge of #164 into #163 needed a real fix: Rust kept the old -14h/+36h
window while #160 had tightened the TS one. Both now use the tightened rule,
and the `noteDateStamps` fixture holds in every zone.

On top of #165 now sit:

- `feat/website-round-2026-10-05`: the seven 2026-10-03 items, plus a
  Features cleanup. The real product film leads; the episode strip is gone,
  because episodes 4 and 7 carry stale burned-in copy, whose source is the
  studio repo. A drawn note menu replaces the cropped capture, and the page is
  1,200px shorter. Long code lines wrap, and the privacy scene text is
  balanced.
- `fix/onboarding-on-stack` (worktree `~/rotli-stack`): the two local
  onboarding branches merged in, with their commits kept so the opening-hang
  fix can still be cherry-picked as a 1.7.x hotfix.

Proof on the tip: `bun run verify` passed in one run (secrets, quality, app
E2E 275, web E2E 66, Rust 692), and `bun run test:e2e:site` passed 20/20.

### Website prompt pass (2026-10-05)

A fidelity pass on `feat/website-prompt-pass`: each website item in the
owner's prompt checked against the built site at 390, 768, and 1440, not
against this log. Committed locally, not pushed.

| Item | Found | Done |
|---|---|---|
| 2 | Hero and TwoKinds land the message; the landing never said notes are the foundation of more, or that AI costs nothing extra (only About did) | Overview lede, StatBand close, two FAQ entries (also the FAQPage JSON-LD); the closing lede "Warm enough… Quiet enough… Local enough…" replaced with one plain line |
| 11, 12 | Both lines gone from pages, `llms.txt`, and the cards; the privacy page still said AI is "a visitor, not the owner" | That sentence cut. `rotli-promo.vtt` (holding page only) still carries "Room to think. Files you keep."; it waits on the promo re-cut |
| 14 | No quokka carousel anywhere; the only carousel is the theme studio's | A stale comment fixed |
| 16 | TOC and footer quokka in place; no reading meter on `/privacy/` or posts | Both pass `progress` |
| 7, 19 | Hidden form leaves no gap at any width; no founder.best anywhere | Nothing |
| 390/768 | Changelog scrolled sideways (inline code); the island ran under "Make it yours" from 761 to about 1100px; Overview steps sat in one sparse column on tablets; small touch targets | `overflow-wrap: anywhere`; island from 1180px; quokka beside its step 560–900px; coarse-pointer hit areas. `e2e/site/narrow-layout.spec.ts` holds them |
| Theme captures | No script makes `public/themes/` | Left as is; re-capture by hand when the owner wants |

Owner: accept or reword the new copy (Overview lede, StatBand close, the two
FAQ answers, the closing line).

### Owner decisions now

- Push the updated branches and open #166 (website round) and #167
  (onboarding) as stack positions 16 and 17.
- Approve connected-vault open switching vaults (#155).
- Re-cut or delete story episodes 4 and 7 in the studio; nothing links them
  now.
- Send the fresh captures on the wish-list: Mac chat, the note menu, a Mac
  board, a Word document, the Library after filing, and optionally the
  themes.
- Earlier items still stand: the site E2E lane in CI, the 1.7.2 hotfix,
  Resend, the Docker image, banner uploads, native proofs, and #21 last.

### Superseded: what blocked merging (morning of 2026-10-05)

The stack is linear, so a hold on one PR blocks every PR above it. Only
#151–#153 can merge today.

1. **#154: a fail-open on the secure boundary.** Secure-folder matching skips
   canonicalization, so `Secure%20notes/…` and `../Secure notes/…` read as
   non-secure. Secure notes must fail closed. This is the most serious open item.
2. **#155:** `describe_attachment` doesn't check a linked note's frontmatter
   `secure`. Connected-root open is rejected by `canOpenVaultInPanes`. Trash has
   a revision window.
3. **#162: `e2e/tab-indent.spec.ts` flakes** (it fails 2–4 runs in 10, with
   "editor commands module is not mounted"). #162 adds this spec, and it isn't
   on `dev`, so the stack introduced the flake. Fix it before merging or CI
   will flake.
4. Reviewer polish on #156–#165: About wording, Tab across fence markers,
   brand-image grounds and contrast claims, and chat-buddy pose states. Check
   these against the tip.

### Outside the stack

- `fix/opening-never-hangs` (`ff63b64b`) and `fix/onboarding-polish`
  (`f5a9c997`) are local only and unpushed. `ff63b64b` fixes a launch hang
  that shipped in 1.7.1 on macOS 27, so it's a hotfix candidate. These branches
  change 11 files that the stack also changes (onboarding, `thanksDialog`,
  `settingsSurface`, `lib.rs`, CHANGELOG, DESIGN). Expect conflicts whichever
  lands second.
- The dev-registry backups `*.dev.json.before-dev-test-2026-10-02` in
  `~/Library/Application Support/com.rotli.app/` still exist. Restore them
  once the owner is done with the `~/test` dev vault.

### Owner decisions next

- Commit the website round and open it as #166 on `feat/chat-quokka-buddy`.
  Accept or reword its proposed copy.
- Decide whether `test:e2e:site` joins `verify` and CI.
- Fix the #154/#155 holds and the #162 flake now. They gate every website PR,
  so they come before more site polish.
- Ship 1.7.2 from `fix/opening-never-hangs` alone, or fold it into the stack.
- Owner-only steps: watch the hero cut, set the Resend segment and key on
  Railway, build the site Docker image once (to check the sidecar), upload the
  banners, do the native Retina-drop and Refined Hand to AI checks, and the
  #21 story film last.
