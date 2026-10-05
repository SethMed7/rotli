# Rotli — marketing site

A product-led landing page for Rotli, the free, local-first workspace built on
plain Markdown files, where one ordinary folder remains the durable source of
truth. The Mac app and Rotli Web exist today; native Windows and Linux apps are
coming soon (see "Where rotli runs"). The launch page explains
the Markdown workspace (tasks, links, views), the Playground, optional local or
connected chat, the privacy boundary, theme families, the optional quokka
companion, and local stdio MCP. Docs and Sheets are named as beta (see
"Docs and Sheets"). Features under review (Breve, boards, Mermaid visual
editing, remote agents) appear only on the dev site under an explicit
experiment label.
Built with [Astro](https://astro.build).

## This is a separate sub-project

It has **its own dependencies** and does **not** touch the app's root
`bun.lock` or `package.json`. Its Bun 1.4 lockfile uses script-free isolated
resolution under the same three-day release-age gate as the app and Breve.
Install and build from inside `site/` only.

## Develop

```sh
cd site
bun install
bun run dev      # local dev server
```

## Build

```sh
cd site
bun run check    # Astro + TypeScript diagnostics
bun run build    # static output → site/dist/
bun run preview  # serve the built dist/ locally
```

The interactive pieces have two proofs, both run from the repository root:
`bun test scripts/site-interactions.test.ts` (the rules without a browser: the
privacy passage's trigger and the contrast of every frame of its crossfade, the
theme studio's autoplay, the reading meter, the 404 game, the footer scene's
play and the visitor's person) and `bun run test:e2e:site` (`playwright.site.config.ts`: builds the
site, serves it with `astro preview` on port 4392, and drives `e2e/site/`).
The unit file runs inside `bun run verify`; the site's E2E lane is not yet
wired into `verify` or CI (an owner decision: it would add a site build to
the e2e lane), so run it by hand after changing those pages.

Narrow widths are part of that proof: `e2e/site/narrow-layout.spec.ts`
checks that no page scrolls sideways at 390 and 768, and the landing at 320,
1024, and 1920 too (inline code in the changelog breaks inside the column).
It also checks that the theme studio's island never sits under its lede, that
each Overview card puts its picture beside its words on a tablet, and that
the landing's smallest controls (the footnote marks, the 404's other ways in)
answer a 44px touch. Small controls grow their hit area under
`(pointer: coarse)`, never their glyphs. `e2e/site/landing-layout.spec.ts`
holds the landing's order and grounds, the cards, the tour (mouse, keyboard,
phone, no script), and the closing panel, whose art never touches its words
from 320 to 1920.

## Production details

- The canonical origin comes from `SITE_URL` (default `https://rotli.co`) in
  `src/site.ts`; the sitemap, robots.txt, and canonical metadata derive from it.
- `SITE_MODE` decides what a build contains (one policy, `src/site.ts`):

  | Mode          | Deployment                    | Pages                    | Downloads | Indexed |
  | ------------- | ----------------------------- | ------------------------ | --------- | ------- |
  | `coming-soon` | holding page                  | holding page + 404       | no        | yes     |
  | `dev`         | live dev site · `dev.rotli.co`| full site + drafts + the full developer reference | no | no |
  | `full`        | production · `rotli.co`       | landing, Features, Privacy, Resources (Guides, Blog, Developers, Changelog, Roadmap), About, 404 | yes | yes |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change — see "Going live" below. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
- **Structure and navigation.** `src/nav.ts` is the one navigation policy.
  The header links real pages, never landing anchors: Features · Privacy ·
  Resources · About. Resources is a dropdown of five pages, each with a
  one-line description: Guides (`/resources/`), Blog (`/blog/`, listed only
  once a post can be read, so an index of nothing but "coming soon" is never
  linked), Developers (`/resources/developers/`, marked "Coming soon" outside
  the dev site), Changelog (`/changelog/`), and Roadmap (`/roadmap/`, see "The
  roadmap: votes and requests" below). The dropdown is a disclosure:
  a button with `aria-expanded` (Enter/Space/click toggles; ArrowDown opens
  into the list; ArrowUp/ArrowDown, Home, End move; Escape closes and returns
  focus; tabbing away or an outside click closes). Without script the button
  is hidden and "Resources" is a plain link to `/resources/`. On the right sit
  the GitHub mark (icon only, while the source is public) and one Download
  button, which opens `/download/`. Download is not also a menu item. The
  footer's link columns (Product · Learn · Open source, the last only while
  the source is public) and tagline default from the same file. Pages pass
  only `current` (a dropdown's label is marked current when any of its pages
  is). The header stays pinned on a solid ground (flat: no blur, no shadow);
  `[id]` targets carry a matching `scroll-margin-top`. Below 1080px the pages
  fold into a Menu disclosure (`<details>`; Escape, an outside click, or
  choosing a link closes it), where the dropdown's pages are listed under its
  name; below 560px the GitHub mark and Download move into it too. The
  footer's lead column holds the brand, the tagline, and the "Hear when it's
  ready." sign-up, always shown (see "The coming-soon list" below); its
  closing row holds the maker line, with a drawn X mark (not the platform's
  artwork) linking to `https://x.com/iamsethmedina`, `rel="me"`, in a 44px
  target, and the Launch Llama badge; the quokka scenery runs along its bottom
  edge.
- **The landing page** (`src/components/Landing.astro`) only composes its
  chapters from `src/components/landing/`, in the order set out in
  `docs/design/landing-layout-2026-10-05.md` (each thing said once; grounds
  alternate plain and warm):
  1. Hero (the product film; plain).
  2. Overview ("Write it down. rotli puts it away."; warm): three cards, each
     a small picture of the app drawn in HTML on the site's tokens (a rendered
     note, the fields the Librarian filled with an area pill and ticks, a chat
     reply that names the notes it came from), with the app's quokka standing
     on the panel, then a heading and one sentence. The pictures are one image
     each to assistive tech (`role="img"` and a label); no "sources" control is
     drawn because the app has none. Its lede carries the owner's item 2
     message, as does the FAQ.
  3. StatBand (plain): two sourced figures, footnoted, beside a bench by the
     sea where four idle AI tools, two asleep, are each handed a note by the
     quokka. Keep the sources and the "never wasted" wording. The text column
     ends on "Where these numbers come from", a link to the post
     `the-ai-you-already-pay-for`, which sets out both surveys in full. It is
     the one chapter whose headline has no lede: its figures are the lede.
  4. TwoKinds ("You write for yourself. AI reads differently."; warm): the
     same file as typed and as the Librarian files it, in two open columns on
     the band with no card around either. The added frontmatter lines carry a
     "+" and a tint, the body is marked unchanged, and `area` is a flat area,
     as the memex contract requires.
  5. Tour ("A closer look."; plain): a disclosure list with one part open at a
     time. Each name is a `<button aria-expanded>` in an h3, with arrow keys,
     Home, and End; pressing the open part leaves it open. The parts are Notes
     and Markdown, Docs and Sheets (`DOCS_AND_SHEETS.status`), Chat with your
     notes, Boards, the Librarian, and, only while `WEB_APP_ENABLED`, Rotli Web
     and the Helper. That last part replaced the ways-in chapter (2026-10-05):
     which browsers open the folder, why the others go through Rotli Helper,
     the copyable install line, the Windows guide, and the "why Terminal" post.
     From 960px, with script, the open part's preview fills a fixed-height
     right column, so switching never moves the page. Narrower, and without
     script, the preview sits inside the open part (without script every part
     shows). Previews are `public/shots/` captures or drawings in the cards'
     panel language. The tour never moves on its own. It ends on the one link
     to `/features/`.
  6. The dev-only Experiments.
  7. Personal (the theme studio; warm), with a faint island vignette from
     1180px up. Narrower, its left edge would reach into the lede, so it steps
     out.
  8. PrivacyBrief: the night scene in Ocean Dark via `.band-night` in
     `Base.astro`, three facts, and a link to `/privacy/`. While it is the
     focal passage the whole page steps into its night (see "The privacy
     passage").
  9. Faq (plain): two entries carry the owner's item 2 message. Notes are the
     foundation of a workspace, and rotli charges nothing for AI.
  10. Closing (plain, one framed panel on the warm colour). The two-tone
      headline "Start with one note." / "It stays in your folder." has its
      first line in full ink and the second muted. Under it are "Free, with no
      account to make." and the hero's two ways in (`SiteActions`). The writing
      quokka comes in from the right, cut off by the frame. Under 900px it
      steps below the words, never onto them. It asks for a first step rather
      than repeating the hero (the earlier invitation was cut for that). Right
      under it is the footer's quokka beach.

  `/features/` has no closing panel. The landing page carries exactly one
  video. **`/features/`** has
  one display headline with the product film right under it (the hero's
  `FilmPlayer`, the same real Rotli Web session: the real product leads, not
  the illustrated story; visitors asked for it, 2026-10-05), then the chapters
  in full (Features with every smaller habit, Folder, Personal). Every chapter
  is one idea: the same section head (one h2 at `--step-h2` and a lede) and
  one picture, with no second explanation of something another chapter or
  page owns (Rotli Helper is explained by its guide; /features/ links there).
  The chapters alternate plain and warm grounds. The landing page's dev-only
  Experiments chapter is not repeated there. On narrow screens the theme
  studio is a carousel (previous/next and a swipe on the capture).
  Each chapter owns its
  markup, scoped styles, and script. `Base.astro` owns the tokens, the shared
  section grammar (`.wrap`, `.section`, `.section-title`, `.section-lede`,
  `.band-warm`, `.band-deep`, the spacing and type steps), and the one
  scroll-reveal script. Scroll reveals (the drawn scenes included) fire once
  and rest. Three things move on their own, each the owner's call: the theme
  studio (2026-10-05, "Make it yours" below), the quokka scenery under the
  footer (2026-10-02), described below, which lives in its own band, below
  every word, and the 404 page's game, which moves only after the visitor
  presses Play. None of them moves on its own under reduced motion. Two-column rows share a
  top edge so each heading starts level with its picture.
- **The theme studio plays** (`landing/Personal.astro`, rules in
  `src/themeCycle.ts`; the owner, 2026-10-05: "when you arrive it should be
  going through them on its own and change on what you hover over"). The first
  time the studio is on screen it steps through the fourteen environments
  every 3.2 s. A hovered or focused swatch shows at once and holds the cycle;
  leaving the swatches resumes it 2.4 s later from there. A click, the
  carousel's previous or next, or a swipe pins the choice: the cycle stops for
  good and a hover only previews. It never plays under reduced motion, off
  screen, or in a hidden tab (one timeout, no frame loop), waits a full step on
  coming back, and swaps only to a capture that has decoded. Its own steps
  are not announced (`aria-live="off"`); the visitor's are.
- **The bench's AI tools** (`landing/StatBand.astro`; the owner, 2026-10-05:
  "so people know we are talking about gemini/antigravity, chatGPT, claude")
  are ChatGPT, Claude, Gemini, and Grok: each bot wears its product's public
  signature colour (the `--bot-*` tokens in `Base.astro`), a generic cue on its
  head (a speech bubble, an asterisk, a four-point sparkle, a slanted antenna),
  and its name in plain HTML under it, placed by the bot's centre in the
  drawing so the names never touch at any width. Never trace or store a
  product's logo artwork or wordmark here; the names are text, and the
  colours are the only borrowed thing.
- **`/privacy/`** is the full privacy policy in plain language: the short
  version, where notes live, every network connection and when it happens, AI
  and secure/locked notes (with the access table), Rotli Web and Rotli Helper,
  this website (no cookies, analytics, or third-party scripts; the two footer
  badges load from their own hosts), retention, and changes, each with the
  reason it works that way. `PRIVACY.md` at the repository root stays the
  product's source of truth: change this page in the same change as
  `PRIVACY.md` whenever a data class, destination, retention rule, or control
  changes. Features that are off in released builds (Breve, remote agents)
  are described as off, not as available.
- **Subpages** (`WritingPage.astro`) sit on the site grid: breadcrumb, title,
  lede, and an optional metadata line (`meta`: a date, "Updated …", a reading
  time) line up with the header's brand, and a full-width rule divides the
  head from the body. Long pages pass `toc` and read as an article: a sticky
  "On this page" tree beside a reading column of about 70 characters, the
  section in view highlighted and a slim rail filling as you read (one
  bundled script; without it the tree is plain links). Below 900px the tree
  becomes an "On this page" disclosure above the text. Privacy, resource
  articles, and blog posts use it (articles and posts build it from their
  `##` headings), and all three pass `progress` for the reading meter below,
  so every article on the site reads the same way (the owner's item 16:
  the flow of the claude.dev mods post, with the footer's strolling quokka as
  its walking character). Resource articles end with "More guides".
- **Resource articles** open on their own scene (`ResourceScene.astro`, the
  guides' answer to the night frame on `/privacy/`): the island by day, the
  app's quokka in the pose that fits the question, and what the article is
  about around it (the folder and keys for Getting started, the folder at
  home for Why local, the on-device model and a locked note for AI, the
  browser and the folder for Rotli Helper, the laptop and the browser for
  Web and Mac). `pages/resources/[...slug].astro` maps each guide to its
  scene; a new guide without one gets the plain beach. They pass `progress`,
  so a reading meter is pinned under the header on every width: a bar and
  "N% through", measured over the article alone (`src/reading.ts`, the same
  measure that fills the tree's rail), so the end of the article reads 100%
  and the related links and footer never count. It follows scrolling either
  way and jumps through the tree, re-measures when the article changes
  height, and hides when the whole article fits in the window. It is a
  position, not proof of reading: nothing is recorded or sent. Blog posts
  and `/privacy/` carry the same meter (2026-10-05). Index lists
  (`WritingList.astro`) are plain entries in columns with a hairline above
  each, never boxes; an entry without a link is announced ("Coming soon").
- **Writing.** Resources (evergreen, question-titled) and blog posts are
  Markdown in one content collection, `src/content/writing/{resources,posts}/`
  (schema: `src/content.config.ts`). `src/writing.ts` decides what a build
  publishes: nothing in `coming-soon`; `draft: true` and `experiment: true`
  entries only on the dev site. `status: coming-soon` announces a piece: it is
  listed on its index with a "Coming soon" label and no link, and has no
  page, Markdown twin, sitemap entry, or llms.txt line until the field comes
  off (`publishedWriting` vs `upcomingWriting`). Routes: `/resources/`, `/resources/<file>/`,
  `/blog/`, `/blog/<file>/`, and `/about/` (the maker's first-person story of
  why rotli exists: notes first, people and AI note differently, the vault
  you own beside the "stays local" quokka, no extra AI fee, house rules for
  AI, then the name story and who makes it; it links the
  `the-creation-of-rotli` post once it is published). Markdown code
  blocks wrap long lines at their spaces inside the box (the Helper's install
  line included) and are not syntax-highlighted: Shiki writes inline `style=` attributes,
  which the production CSP drops. Keep article images local.
- **`/download/`** is where the header's Download button goes. It leads with
  the visitor's own system (`Base.astro` stamps `data-os`: mac, windows,
  linux, mobile, or other): the Mac download on a Mac; on Windows and Linux,
  a native app that is coming soon, with Rotli Web to use in the meantime and
  Rotli Helper for browsers without folder access. Without script the Mac
  panel shows. Below, "Every platform" lists Mac, Windows, Linux, and any
  browser with their status (Windows and Linux: "Coming soon", the owner's
  call on 2026-10-05, replacing the earlier "Planned").
- **Where rotli runs** (the owner, 2026-10-05). The promise is a free
  workspace, not a Mac app: pages lead with what it is and what it costs
  ("Free. No account. Works offline." under the hero's ways in) and state
  availability separately, with `PLATFORMS` in `src/site.ts` ("On the Mac
  today. Windows and Linux apps are coming soon.", or "In your browser and on
  the Mac today. …" while `WEB_APP_ENABLED`; `PLATFORMS.soon` is the status
  label). The ways-in section is "On your computer. In your browser." Never
  imply the Mac is the only platform rotli will have, or that Windows or
  Linux apps exist today.
- **Docs and Sheets** (Word `.docx` and Excel `.xlsx`, edited with Univer in
  the Mac app) are named as beta (the owner, 2026-10-05; Sheets leaves
  development builds in the same release). The word comes from
  `DOCS_AND_SHEETS` in `src/site.ts` (`status` for a label, `inline` inside a
  sentence); never write "Beta" by hand, and say no more about them than that
  they open and edit. The hero, the Overview, the Features page's formats,
  the FAQ, and `llms.txt` use it.
  Sentences about what the Mac app does today (the on-device model, the
  Keychain) stay about the Mac. The hero's Download for Mac still fetches the DMG directly
  (`DOWNLOAD_HREF`). The Helper guide is `/resources/rotli-helper/`; the 404
  page's `/helper` hint links there.
- **The 404 page** (`src/pages/404.astro`) has no header or footer: "This
  note wandered off." in the middle of the window, one "Take me home" button
  with a quiet line of other ways in, and along the bottom edge a small game
  on the footer's beach (`src/runner/`: `game.ts` is the game without a
  screen, `stage.ts` draws it on a canvas). The quokka (the walking pose)
  runs, Space, ↑, W, a click, or a tap jumps (letting go early makes a short
  hop), and rocks, bushes, logs, and sandcastles come at a speed that grows;
  the score is metres, and a fall shows the distance and "Play again". It
  never starts by itself: Play starts a run and moves focus to the stage,
  which alone reads the keys, so Space on "Take me home" or any other
  control is never taken. Escape or P pauses; so does leaving the stage (a
  Tab, a click elsewhere), hiding the tab, or scrolling it out of view. The
  frame loop runs only during a run. Reduced motion keeps the game playable
  (the visitor chose to start it) but stills the decorative layers (drifting
  clouds, the run's bob, kicked-up sand). The best run lasts as long as the
  page: no score is stored. Without script the footer's quokka scenery stands
  there instead. The missing path and a hint (`/app`, `/helper`) are chosen
  in the browser.
- **The quokka scenery** (`src/components/QuokkaScene.astro`, under every
  footer, `/subscribed/`, and the 404 without script) is a strip of Rottnest
  by day in the film's palette (sea, the far lighthouse, scrub on the dunes,
  sand) where the quokkas live, each doing its own thing (the owner's brief,
  2026-10-05): the sitter, up on its haunches by the leaf pile, eating a leaf
  from its paws; the nibbler beside it, a paw at its mouth, chewing (hidden
  below 760px); the guard, minding the pile; two players in the right-hand
  corner tossing a beach ball between them; and now and then a stroller
  walking the dunes behind them in profile. Every pose is the app's own art,
  never redrawn: `base.svg` is rigged (`src/quokka/art.ts` thins its outline
  and takes the outer ring as the body fill); `waving.svg` and
  `celebrating.svg` are swapped in whole (their outer ring is their body
  fill, and celebrating's confetti is dropped); the sitter, nibbler, and
  stroller are the approved layered poses (`concepts/layers/`) as SVG masks
  filled with the scene's tokens, split at the neck. `src/quokka/rig.ts`
  holds every landmark (pivots, eyes, paws, the ball, each layered pose's
  view, neck, and seam). There is no drawn reaching arm: arms move only as
  the art does (the wave, the catch).
  `src/quokka/scene.ts` (one external module) brings them to life. The guard's
  eyes and head follow the pointer, it waves when the visitor arrives, frowns
  when the pointer nears the pile, looks sad with a hand on it or a leaf
  wasted, and cheers when a leaf reaches a friend. The eaters take bites (the
  leaf shrinks), stop to look at a pointer that comes close, look to the pile
  when theirs is gone, and fetch another after a while. The players watch the
  ball, pause to watch a visitor who comes close, and the catcher reaches up
  (the cheering pose) as it arrives; a click or tap on them or the ball sends
  it high. Everyone blinks.
  **The person** (the owner, 2026-10-05: "when I am hovering over it with my
  mouse it inserts a human I am controlling. I can walk my human all the way
  to the food and feed the quokkas. I can also go play with the quokkas with
  the ball"). A small person drawn in code in the scene's ink and tokens (a
  round face, a bucket hat, a shirt in `--lantern`, trousers in
  `--wood-dark`, outlines at about the art's weight; nobody in particular)
  appears when the pointer comes onto the sand, a short walk in from the
  nearer side, and walks to the pointer's x with an eased stride (it speeds
  up, slows to arrive, never overshoots), legs and arms swinging, facing the
  way it goes, on the sand line and behind the residents. Only where it
  stops counts, so passing by does nothing: at the pile it picks a leaf up
  (the guard is cross while it carries their lunch), at a quokka it stands
  beside it (never in front) and hands the leaf over through the same feed
  and guard-mood rules as the drag, and by the two with the ball it joins
  their catch, which then goes player, person, other player until it walks
  away (and it hands the ball back if it leaves holding it). It wanders off
  seven seconds after the visitor stops playing. On a touch screen a tap
  sends it; from the keyboard, "Walk on the beach", a button before the band
  (visible on focus, with a described instruction), takes ← and →: held, it
  walks, and let go near the pile or a quokka it stops at it. Its rules
  without the DOM (the walk, the swing, what it does where it stops) are
  `src/quokka/human.ts`; `src/quokka/person.ts` poses the drawing.
  **The drag** (the decision, 2026-10-05) stays alongside as the second way to
  play: the visitor can press on the pile and carry a leaf (mouse, pen, or
  touch; `touch-action: none` only on the pile). The residents watch it, a
  hungry eater perks up as it comes near, and letting go over a quokka hands
  it over (it eats, the others hop, the guard is pleased); letting go over
  open sand wastes it (it drifts down, rests, fades, and the guard is sad). A
  tap on the pile without dragging carries nothing off (on touch it sends the
  person). The leaves are their lunch, so both give the visitor a part in the
  scene's one story rather than moving the quokkas around like objects. "Hand
  the quokkas a leaf", the other button before the band (outside its
  `aria-hidden`), does the same from the keyboard (visible on focus, with a
  polite status line saying who took it, which the person's deeds use too).
  The rules without the DOM (who receives a leaf, the ball's arc, a falling
  leaf, the guard's mood) are `src/quokka/play.ts`. It runs one
  `requestAnimationFrame` loop only while the scene is on screen and the tab
  is visible, uses pointer events only, and writes SVG attributes and CSSOM
  transforms (never an inline `style` attribute, which the CSP would drop).
  Under reduced motion nothing moves on its own: no stroll, no game of catch
  between the quokkas, no blinks, bites, hops, or heads following the
  pointer; the scene stands at rest (each resident in its pose, the sitter
  and nibbler holding a leaf, a player holding the ball) and the loop runs
  only while the visitor plays. The person then steps straight to where it is
  sent instead of walking, and leaves and the ball arrive at once. Without
  script nothing runs and both buttons stay hidden. The band is decorative
  (`aria-hidden`), has a fixed height (no layout shift), clips its own
  content, and holds no text, so nothing can overlap a word or a link.
- **The motion studio** lives at `studio.rotli.co` (`STUDIO_URL` in
  `src/site.ts`): the footer's Learn column links it whatever the source flag, and the Caddyfile
  sends `/studio` there.
- **Download and the browser.** `SiteActions.astro` renders the two ways in —
  Open in browser and Download — in the hero (the header has only its
  Download button to `/download/`). `DOWNLOAD_HREF` in
  `src/site.ts` is where those Download buttons go (today the newest Mac DMG,
  directly). `Base.astro` stamps `data-platform` on `<html>`; off a
  Mac (iPads included) the browser action leads and the download reads
  "Download for Mac". Without script the Mac order stays.
- `WEB_APP_ENABLED` decides whether pages link to **Rotli Web**, the app bundle
  served from `/app/` on this origin. Fails closed: only the exact string
  `"true"` shows the hero action, the navigation entry, and the footer link.
  The bundle is built by the `app` stage of `site/Dockerfile` (repository
  root, `ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web bun run build`) and served
  by the `handle /app/*` block in `site/Caddyfile` under its own headers
  (`connect-src http://127.0.0.1:*` only, for Rotli Helper — held by `check:web-privacy`; inline styles allowed for the editors; `noindex`).
  Design and phases: `docs/design/web-version-and-shell-batch-2026-09-16.md`.
- **Locally, `/app/` on the site is the web app's dev server** (the proxy key
  is `/app/` with the slash; a bare `/app` also caught `/apple-touch-icon.png`). `astro dev` and
  `astro preview` have no Caddy and no Docker `app` stage, so they pass `/app/`
  through to `bun run dev:web` (port 1437, run at the repository root). "Open
  in browser" then works on the site's own port, as on rotli.co. With that
  server off, `/app/` says so (a 503 page with the command) instead of the
  site's 404. Server config only (`astro.config.mjs`); the build is untouched.
- To SEE Rotli Web locally: `bun run dev:web` at the repository root serves it
  with hot reload at `http://localhost:1437/app/` (no security headers; for
  those, build the Docker prod twin below with `--build-arg WEB_APP_ENABLED=true`
  and open `http://localhost:8080/app/`).
- `SOURCE_REPOSITORY_PUBLIC` decides whether pages link to the source
  repository (GitHub header/footer links, "Explore the source", LICENSE,
  PRIVACY.md, ROADMAP.md, and the MCP contract documents). The repository is
  private, so those links would 404 for visitors. The toggle fails closed: only
  the exact string `true` enables the links; unset or any other value hides
  them and the pages use local anchors instead (`#workspace`, `#playground`,
  `#privacy`, `#film`). No page may claim the source is public while this is
  off. The Dockerfile defaults it to `false`; Railway can set it later.
- The download button, when enabled, deliberately opens the newest published
  release page. Do not construct a DMG URL from the app package version: a
  version bump can merge before its signed asset is published.
- Site tokens in `src/layouts/Base.astro` keep every page in Rotli Light,
  regardless of OS appearance or previously saved site preferences, with one
  exception, the privacy passage below. The theme showcase changes its own
  screenshot and caption; it never recolors the site. Drawn scenes use
  `--ink` (the art's own line colour) rather than `--text`, so a drawing keeps
  its lines in either environment.
- **The privacy passage** (the owner's call, 2026-10-05; `src/passage.ts`).
  A section marked `data-passage="ocean-dark"` (the landing's privacy band)
  takes the whole page into the app's Ocean Dark while it is the focal
  passage: the ground, text, accents, bands, buttons, and the sticky header
  with its navigation, dropdown, and Menu all switch to Ocean Dark tokens
  (`:root[data-passage='ocean-dark']`, values from `src/styles/themes.css`),
  the night's stars spread over the plain grounds, `color-scheme` and the
  `theme-color` meta follow, and it all fades back out on leaving the band in
  either direction. It turns on once the band fills 40% of the window (or of
  itself, if shorter) and off once it fills under 25%, so a page resting near
  a boundary never flickers; a reload mid-band lands in the night at once.
  It reads as one dusk (the owner's "more smooth and better polished",
  2026-10-05). The cut the owner saw came from the band always painting its
  own night while the page followed only once the middle of the window was
  well inside it, with the header, buttons, stars, and ground each fading on
  its own clock. Now the band's top and bottom edges are feathered into the
  neighbours' empty section padding (`[data-passage]::before/::after`, the
  band's own night to transparent; in the night they vanish into the ground),
  and the crossfade runs on the tokens themselves, registered with
  `@property` and transitioned on the root, so everything that reads them
  changes in the same frame. Grounds ease over 900 ms
  (`cubic-bezier(0.65, 0, 0.35, 1)`); text never fades through the ground
  (where both cross, it would vanish), so the inks switch whole at 459 ms,
  when the ground is mid-tone, while muted and accent text lean onto `--text`
  around the switch and a primary button's label (`--on-text`) switches with
  its button. `scripts/site-interactions.test.ts` measures every frame: never
  under 3:1, and under 4.5:1 for under 80 ms. It is a time-based eased
  crossfade at a threshold, not a scroll scrub (the owner rejected scrubbing
  for the story). Reduced motion switches at once. It is a passage, not a preference: nothing is stored. Lowest night pair:
  muted text on `--surface-2`, 6.75:1. The site is flat like the app (DESIGN.md "Flat material"): no
  shadows, blur, or glows. The one deliberate exception is the theme studio's
  orb swatches (the owner's call, 2026-09-23):
  each orb is lit with radial gradients and an inset shadow so it reads as the
  environment itself. Keep tokens aligned with `src/brand/`.
  Every text/background pair measures at least WCAG AA (lowest: muted text on
  the warm band, 4.90:1).
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark comes from `src/assets/characters/`. The
  celebrating quokka in `src/assets/characters/cocoa/` is generated at
  1536 × 1536 from the canonical SVG with the existing fill pipeline
  (`bun scripts/build-character-fills.mjs --site`); app-sized 512px exports
  stay unchanged.
- The companion renders in `src/assets/characters/showcase/` (renders +
  `showcase.json`; the landing page no longer shows them), produced by `bun scripts/build-companion-showcase.ts`. That
  script composites body preset, accessory, line color, and pose with the same
  placement rules as `src/components/character.tsx`, so every slide is a
  combination a person can pick in Settings → Companion. Edit `COMBOS` there
  and re-run; never hand-draw a variant the app cannot produce.
- `src/components/SiteHeader.astro` and `SiteFooter.astro` are the only header
  and footer; their shared styles live in
  `src/layouts/Base.astro`. Pages own only their sections.
- Rotli Web and Rotli Helper are the tour's last part on the landing page
  (only while `WEB_APP_ENABLED`): words, the copyable install line, and links,
  with no screenshot.
- The hero is the promise (a private workspace for your notes), the two ways
  in, where rotli runs (`PLATFORMS.availability`), and the product film right
  under them (`FilmPlayer.astro`, see "Films" below), on `public/hero-pattern.svg`
  (the social card's faint note, folder, checklist, and chat icons, masked so
  they fade out behind the headline). The words land in one short CSS
  entrance and the clay line (`.inked`, `public/ink-underline.svg`)
  draws itself under "the filing." Besides the film, the landing page shows
  captures in two places: the theme studio, and the tour's previews
  (`public/shots/render-note`, `chat`, `board`). `public/rotli-app-warm-light@3x.png` (the social
  card) and the theme studio's `public/themes/` are lossless browser-demo captures (1280 × 800 logical
  viewport at 3× and 2× density), never a live vault. The coming-soon page
  uses the 4320 × 2700 `rotli-playground@3x.png`. The `@3x.png` filenames
  replace the old 1× URLs so cached blurry images cannot persist. Do not
  upscale screenshots.
- **Feature captures** (`public/shots/`) are real app UI on synthetic data,
  never a live vault, at 2× density:
  - `render-*`: the stable browser twin (`ROTLI_BUILD_CHANNEL=stable bunx vite
    --port 1431`), a "Launch week" note typed through the editor with every
    control trigger from SYNTAX.md, clicked to real states, plus Aa → Raw
    markdown for `render-raw` and the Tables and code lesson for `render-tables`.
  - `board`: an Excalidraw board drawn with its own toolbar in Rotli Web
    (`bun run dev:web`, an origin-private test vault, the same path as
    `e2e/web/rotli-web-boards.spec.ts`).
  - `chat`: a frame of the Mac launch shoot's raw take
    (`_review/promo-v5/rec/R5d.mov` at 130.8 s; synthetic Notebook vault),
    cropped with the cursor painted out. The note menu beside "You decide what
    AI may touch" is not a capture: it is drawn in HTML from the app's own
    labels (`useNoteMenu.ts`, `noteProtectionItems.ts`); change it when they
    change.
  Re-capture rather than hand-edit them. `--capture-ground` in `Base.astro` is
  the editor paper those captures sit on.
- **The features area** (`landing/Features.astro`, on `/features/` under the
  product film) is organized as you meet the product:
  RenderShowcase (the same note rendered and as raw Markdown, which already
  shows tasks, results, switches, and choices; then only the two blocks the
  pair cannot show, diagrams and tables/code/math, with their syntax) →
  ChatFlow (a real reply; three steps: asks, keeps "Conversation notes" after
  every reply, writes notes and files on the Mac; then "You decide what AI may
  touch": notes you wrote are closed to AI edits until Let AI edit the text,
  Lock, and Mark secure, beside the drawn note menu) → Formats (Documents on
  Univer, Sheets coming soon, Boards on Excalidraw, with status chips from
  `featurePolicy.ts`, and one line on where Assets live) → the Librarian and
  the smaller habits → ConnectAI (each provider's own CLI in one terminal;
  rotli never signs in, reads login files, or stores credentials; the install
  lines mirror `src/ai/connectorGuides.ts`; one line links the Rotli Helper
  guide while `WEB_APP_ENABLED`).
- **Scenes from the film**, drawn in inline SVG on the film's palette (the
  `--sea*`, `--sand`, `--olive*`, `--limestone`, `--lake`,
  `--wood*`, and `--lantern` tokens in `Base.astro`) with the app's own
  character art. Each plays once when revealed (`[data-reveal]`) and rests;
  reduced motion shows it at rest. `SecureScene.astro` is the film's "secure
  stays home" night, in Ocean Dark under `public/night-stars-ocean.svg`
  through `.band-night` (the landing privacy band and the night frame on
  `/privacy/`); `IslandScene.astro` is the island by
  day (a faint vignette behind Make it yours, and the framed scene opening
  the `/about/` story, captioned with where the name comes from); the
  StatBand's bench by the sea and each resource article's
  `ResourceScene.astro` are the island by day too; the FAQ has the searching
  quokka among question cards; the closing panel has the writing quokka.
  The footer's quokka beach, right below that panel, is the page's one
  closing scene. `/privacy/` and
  `/about/` place their scene through `WritingPage`'s `scene` slot; `/about/`
  uses the centered layout (`center`).
- The landing privacy band is brief and points to `/privacy/`: the promise and
  three facts on the left, the night scene on the right.
- The coming-soon page keeps the same Rotli Light foundation and shows the real
  Playground capture. The introduction begins with the coming-soon label. Its
  one call to action is "Follow development on GitHub" when the source is
  public, "Watch the film" when the film exists, and otherwise nothing. Mobile
  uses one column; the product preview sits beside the copy from 960px.
  It does not expose downloads or the full landing page's navigation.
- **`/resources/developers/`** is the one home for MCP and the CLI, for
  agents (Claude Code, Codex, Cursor) working in a configured vault; facts
  restate `docs/architecture/agent-workspace.md`. MCP and the agent commands
  run in development builds only and have not shipped, so the launch site
  shows an honest "Coming soon" summary, and the dev site
  (`showsExperiments`) shows the full reference under the experiment label:
  connecting a local stdio client, `agent doctor` and `agent self-test`, the
  tools, the rules every call follows, the JSON CLI, limits, and remote
  agents (Grok Bot, the relay, self-hosting). Do not publish a hosted relay
  URL there until that deployment has been verified. The old
  `/resources/mcp/` guide (itself moved from `/mcp/`) folded in on
  2026-10-02: the build writes a refresh page there (`redirects` in
  `astro.config.mjs`); the Caddyfile sends `/mcp` straight to the developer page.
- `public/social-card.svg` is the editable source for the link preview, set on
  the story film's island by day: the wordmark and the hero line over a faint
  file-icon pattern that fades out before the bay, the lighthouse on its hill,
  the bay and a beach along the bottom, the Warm Light app capture tilted in
  from the right, and the quokka waving from the sand (its line art over the
  silhouette in `src/assets/characters/masks/`, filled with the film's cocoa).
  Colors are the film's palette (the site's `--sea`, `--sand`, `--limestone`
  tokens), written out because the card renders outside the site. Run
  `bun run build:social-card` from the repository root to render it with the
  bundled fonts and every `href="asset:<repo path>"` raster inlined, with no
  external requests. The
  results are `public/social-card.png` (1200×630, what iMessage, Slack,
  LinkedIn, X, and Discord show for a rotli.co link) and
  `public/social-card-github.png` (1280×640: the card scaled to cover 2:1 and
  trimmed 16 px top and bottom, so the scenery still runs to the edges; the image GitHub wants for
  the repository's Settings → Social preview, which has no API and is uploaded
  by hand). Keep the copy and palette aligned with the current hero before
  rendering. `layouts/Base.astro` publishes the card with explicit
  `og:image:width/height/type` so scrapers render it on the first fetch, and
  ships PNG icons (`favicon-32.png`, `apple-touch-icon.png`, both exported from
  `src-tauri/icons/icon.png`) for the previews that cannot use the SVG favicon.
  LinkedIn and Facebook cache scrapes; re-scrape with their post inspectors
  after a deploy.
- **Per-page link cards** (`public/og/`, 1200×630) give each page its own
  preview: home, Features, Privacy, Guides (and every guide), Blog, each
  published post (`public/og/blog/<slug>.png`, from its frontmatter title),
  About, Download, and Developers. One family: the warm ground, the wordmark,
  the page's own heading and one line of its lede, and the quokka pose that fits
  the page, standing on a beach over the bay. `src/og.ts` holds the words, the
  poses, and the alt text; pages pass `{...ogImage('<page>')}` (posts
  `postOgImage`) to Base's `image` / `imageAlt`. A post without a rendered card
  falls back to the Blog card, and pages without one (the changelog, the 404,
  the holding page) keep `social-card.png`. After changing a heading or adding
  a post, run `bun run build:brand-images` from the repository root: it renders
  every card in Chromium with the bundled fonts and the network off, shrinks a
  title only as far as its three-line limit, fails if any text leaves the safe
  area or touches the quokka or the lighthouse, or if the title and line colors
  fall under 4.5:1 on the solid warm ground (text over the pattern, sea, sand,
  or underline is not sampled; check the contact sheet), and
  palette-compresses the PNGs (about 35 KB each). The same run writes the
  banners, profile pictures, and thumbnails described in `brand/README.md`, and
  a contact sheet of everything at `_review/brand-images/contact-sheet.png`
  (gitignored).

## Agents and search engines

`src/agents.ts` is the one home for what the site tells crawlers and AI
agents; every sentence in it restates a claim the pages already make.

- **`/robots.txt`** allows everything except `/app/` (Rotli Web's shell) and
  names each AI crawler in its own group (`AI_AGENTS`). Each entry must match
  what the edge enforces: Cloudflare's AI-bot blocking is a zone setting outside
  this repository, and a robots.txt that welcomes an agent the edge then refuses
  reads as a broken promise. To block an agent, set `allow: false` *and* block
  it at the edge. The dev site disallows everything.
- **`/llms.txt`** ([llmstxt.org](https://llmstxt.org)): a title, a one-line
  summary, the key facts, and links to the pages and to each resource's
  Markdown twin, built from the published writing so a link cannot go stale.
  It is also served as `/index.md`, the landing page's twin.
- **Markdown twins.** Every writing page has `index.md` beside its
  `index.html` (the source Markdown under a title and summary), declared with
  `<link rel="alternate" type="text/markdown">`. The Caddyfile answers a request
  whose `Accept` names `text/markdown` with the twin when one exists, and with
  HTML otherwise (`Vary: Accept`); `/sitemap.xml` serves the sitemap index.
  Cloudflare ignores `Vary` for everything but images; negotiation is safe only
  because it caches no HTML, `.md`, or `.txt` by default. A "Cache Everything"
  rule would hand cached Markdown to browsers: exclude the negotiated paths first.
- **JSON-LD.** The landing page carries `WebSite`, `SoftwareApplication`, and
  `FAQPage` (the FAQ's own list, `src/faq.ts`); `/download/` carries
  `SoftwareApplication`; writing pages carry `Article` or `BlogPosting` with a
  `BreadcrumbList`.
- The build fails if an `llms.txt` link points at a page it did not emit, or if
  a JSON-LD block does not parse (`astro.config.mjs`, `rotli-agent-files-guard`).
- To check reachability as agents see it, scan with
  [agentcapable.dev](https://agentcapable.dev/methodology) or request a page
  with an agent's User-Agent (for example `curl -A 'GPTBot/1.1' https://rotli.co/`).

## Validate a build under production headers (the prod twin)

`astro dev` and `astro preview` send no security headers, so a page can look
right locally and break on rotli.co, where Caddy serves every response under
`style-src 'self'` (inline `style` attributes and `<style>` blocks are dropped
silently). Two guards and one rehearsal cover this:

- The Astro build fails if any generated page carries an inline style
  (`astro.config.mjs`, `rotli-csp-inline-style-guard`), and stylesheets are
  never inlined (`build.inlineStylesheets: 'never'`). The same build step fails if a literal
  `:global(` survives into the built CSS (Astro leaves it untransformed inside
  `:has()`, and the browser then drops the whole rule); such rules belong in a
  `<style is:global>` block. This runs in `bun run
  verify quality`, in CI, and inside the Railway image build.
- To rehearse the exact production image, headers included, build and run the
  site's own Dockerfile from the repository root (no version bump, no deploy):

```sh
cd ..   # repository root: the Dockerfile's build context
docker build -f site/Dockerfile --build-arg SITE_MODE=full -t rotli-site-twin .
docker run --rm -p 8080:8080 rotli-site-twin
# open http://localhost:8080 — same Caddyfile, same CSP, same cache headers
```

The dev deployment (`dev.rotli.co`, built from the `dev` branch in `dev` mode)
is the hosted rehearsal for everything else: it is not indexed and offers no
download, so landing there first costs nothing.

## Railway deployment

The site is a static Astro build served by Caddy from a pinned two-stage
[`Dockerfile`](Dockerfile). [`Caddyfile`](Caddyfile) is the one home for the
browser-security and cache headers. There is no SSR, adapter, or Worker.
The footer's Launch Llama badge is the site's only third-party image:
`img-src` allows only `https://tools.launchllama.co` beyond same-origin and
data images, and `check:security` keeps literal remote `<img>` origins aligned
with that deployed policy so a local-preview success cannot become a blank
production badge. Pages may talk only to their own origin (`connect-src
'self'`, `form-action 'self'`), which is all the coming-soon list needs.

The Docker build context is the **repository root**, because the pages import
the canonical mark and companion art from `src/assets/characters/`. The
service therefore has no root directory; it points at the Dockerfile with a
variable. Automatic deployments follow `dev` and `main`, respectively; an
explicitly authorized CLI upload can deploy a reviewed local snapshot. The
environments use these variables and domains:

| Railway project `rotli-site`, service `site` | production                   | dev                          |
| -------------------------------------------- | ---------------------------- | ---------------------------- |
| `RAILWAY_DOCKERFILE_PATH`                    | `site/Dockerfile`            | `site/Dockerfile`            |
| `SITE_MODE`                                  | `full`                       | `dev`                        |
| `SITE_URL`                                   | `https://rotli.co`           | `https://dev.rotli.co`       |
| `WEB_APP_ENABLED` (set 2026-09-18)            | `true`                       | `true`                       |
| Custom domain                                | `rotli.co`                   | `dev.rotli.co`               |

Railway forwards service variables to the Dockerfile as build args; the image
listens on `$PORT`. DNS lives in Cloudflare (registrar: GoDaddy, nameservers
delegated to Cloudflare): each hostname needs **two** records, the CNAME to the
target Railway prints for `railway domain <host>` and the `_railway-verify.<host>`
TXT ownership token (the CLI omits it; read it from the dashboard or the API's
`customDomain.status.verificationToken`). Without the TXT record Railway answers
`Application not found` even though the CNAME routes. Cloudflare's proxy may
stay on with the SSL/TLS mode set to **Full** (not Full strict).

### The coming-soon list (Resend)

The footer's "Hear when it's ready." sign-up adds an address to a Resend
segment: the list the owner sends Broadcasts to. The static site cannot hold
an API key, so the image runs one more process: a small Bun sidecar
(`server/main.ts`, a few files, no dependencies) on `127.0.0.1:8787`. It
answers the list (`server/subscribe.ts`) and the roadmap's votes and requests
(`server/roadmap.ts`, below). Caddy proxies `/api/*` to it under the site's
own headers (`Cache-Control: no-store`); `entrypoint.sh` starts it in a retry
loop and then execs Caddy, so Caddy is PID 1 and the sidecar fails soft: if it
is down, `/api/*` answers 503, the footer says the list isn't open yet, the roadmap says
voting opens soon, and every page keeps serving.

- `GET /api/subscribe` → `{ "live": true | false }`. The form is always shown
  (the owner, 2026-10-05). Unless the probe reads `live: true` (as under
  `astro dev` and `astro preview`, which have no sidecar), a submit says "The
  list isn't open yet, so nothing was sent. Check back soon." and posts
  nothing, so the address never leaves the browser; a 404 or 503 from the post
  itself reads the same.
- `POST /api/subscribe` (JSON from the footer's script, or a plain form post
  without JavaScript, which is redirected to `/subscribed/`): validates the
  address, drops a filled honeypot field (`website`) with a fake success,
  limits each visitor to 5 tries per 10 minutes (keyed on `CF-Connecting-IP`,
  then `X-Real-IP`; 120 per 10 minutes overall), then calls Resend's
  `POST https://api.resend.com/contacts` with
  `{ email, unsubscribed: false, segments: [{ id }] }`. Contacts are global
  per address in Resend, so when the contact already exists it calls
  `POST /contacts/{email}/segments/{segment_id}` instead; a repeat signup is
  answered exactly like a new one, and an earlier unsubscribe is never
  overridden. Addresses are never logged (only Resend's status and error name).
  This is Resend's current Contacts API: Audiences are now Segments, and
  Broadcasts take a `segment_id` (checked against resend.com/docs, 2026-10-05).
- Consent: one sign-up (single opt-in) with the footer's line ("Unsubscribe
  anytime") and `/privacy/#website`, which says what is kept and how to leave.
  Unsubscribing is Resend's own Broadcast link. Double opt-in is not built: it
  needs a verified sending domain and a confirmation email (an owner decision).
- Tests: `bun run test` (Resend mocked; part of `bun run verify` and CI).

**Owner setup: the same Resend account as the portfolio.** The portfolio's
contact relay only sends email (`POST /emails`) and has no list; rotli adds
contacts to a segment so there is a list to broadcast to.

1. In Resend (the account the portfolio uses) → Audience → Segments, create a
   segment, e.g. "rotli updates", and copy its id.
2. API keys: contacts need a **Full access** key. A sending-only key (which is
   what a contact relay usually holds) is refused with 401/403. Either give the
   portfolio's key full access or, better, create a dedicated full-access key
   on the same account named for rotli.co. Never paste it into a file.
3. Railway → `rotli-site` → `site` → Variables (production; dev too if wanted):
   set `RESEND_API_KEY` and `RESEND_SEGMENT_ID` as runtime variables, then
   redeploy. `GET https://rotli.co/api/subscribe` answers `{"live":true}` and
   the footer shows the form.
4. To send an update: Resend → Broadcasts → Create, choose the segment, write
   it, and keep the unsubscribe link (`{{{RESEND_UNSUBSCRIBE_URL}}}`, which
   Resend's editor inserts) in the footer. The **From** address must be on a
   domain verified in that Resend account (the portfolio's verified domain
   works; verify `rotli.co` there to send as rotli). Send a test to yourself,
   then send or schedule. The API equivalent is `POST /broadcasts` with
   `segment_id`, `from`, `subject`, and `html`, then `POST /broadcasts/{id}/send`.

Set these as **runtime** service variables in Railway (never build args; the
Dockerfile does not declare them, so no secret lands in an image layer):

| Variable            | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `RESEND_API_KEY`    | A Resend API key with full access (contacts need it; a sending-only key is refused). Unset: the list is off. |
| `RESEND_SEGMENT_ID` | The segment new contacts join (Resend → Audience → Segments; the old Audiences API is deprecated). Unset: the list is off. |
| `ROADMAP_DB_PATH`   | The roadmap's SQLite file on a Railway volume, e.g. `/data/roadmap.sqlite`. Unset or unwritable: votes and requests are off (503) and the page says they open soon. |
| `ROADMAP_HASH_SALT` | Optional. A long random string keying the in-memory rate-limit hashes. Unset: a random salt per start (limits reset on restart). It is never stored or logged. |
| `ROADMAP_FILE`      | Optional. Where the sidecar reads ROADMAP.md (default: the copy in the image, `/opt/rotli/ROADMAP.md`). |
| `SUBSCRIBE_PORT`    | Optional. The sidecar's loopback port, read by both Caddy and the sidecar (default `8787`). |

To rehearse it in the prod twin, pass the variables to `docker run`
(`-e RESEND_API_KEY=… -e RESEND_SEGMENT_ID=… -e ROADMAP_DB_PATH=/tmp/roadmap.sqlite`);
with a test key, use a test segment.

### The roadmap: votes and requests

`/roadmap/` is `ROADMAP.md` (repository root) rendered at build time by
`src/roadmap.ts`; the Dockerfile copies the file in, as it does the changelog.
It shows the three public sections (In the work as cards with a small drawing
from `RoadmapMock.astro`, Planned and Ideas as a list) and leaves the rest of
the file (known bugs, web parity, platforms, later) in the repository. Each
item carries a stable id (`<!-- id: … -->` after its title; the convention is at
the top of ROADMAP.md), and votes attach to ids, so a retitle keeps its votes.
The build fails on a missing or repeated id, and `astro.config.mjs`
(`rotli-roadmap-guard`) fails it if the built page and the file disagree.
`/roadmap/index.md` is its Markdown twin, linked from `llms.txt`.

The sidecar keeps participation in one SQLite file (`bun:sqlite`, built into
Bun; no ORM, no new service):

- `GET /api/roadmap/votes` → `{ live: true, votes: { [id]: count } }`;
  `POST /api/roadmap/vote` with `{ id }` → `{ ok, counted, count }`, where the id
  must be one of the page's (read from ROADMAP.md at start);
  `POST /api/roadmap/request` with `{ title, description, email? }` (3–120 and
  10–2000 characters, the email optional) → `{ ok }`, or a redirect to
  `/roadmap/#request-sent` for a form posted without JavaScript.
- Kept: a count per item id (no row per vote), and each request's text, time,
  and optional email. Requests are never published by any route.
- Abuse limits, all in memory: one vote per item per browser (the page's
  localStorage marker), one counted vote per item per visitor per UTC day, 30
  votes per 10 minutes and 5 requests per hour per visitor (600 and 100
  overall), a honeypot field, and body size limits. The visitor key is an HMAC
  of the IP address and the UTC day under `ROADMAP_HASH_SALT`: never the raw
  address, never on disk, new every day.
- Off: without `ROADMAP_DB_PATH` (or if the file can't be opened, or
  ROADMAP.md can't be read) every route answers 503 `{ live: false }`; the
  page keeps its "Voting and requests open soon." line, the vote buttons stay
  disabled, and the form says requests open soon. CSP is unchanged
  (`connect-src 'self'`, `form-action 'self'`).
- Tests: `bun run test` (`server/roadmap.test.ts`, `server/roadmap-file.test.ts`)
  and `e2e/site/roadmap.spec.ts` (the API stubbed with Playwright routes).

**Owner setup.**

1. Railway → `rotli-site` → `site` → right-click the service (or Settings) →
   **Attach volume**, mount path `/data`, the smallest size (the file stays in
   the kilobytes for a long time). One volume per environment.
2. Variables: `ROADMAP_DB_PATH=/data/roadmap.sqlite`, and optionally
   `ROADMAP_HASH_SALT` set to a long random string (`openssl rand -hex 32`,
   pasted straight into Railway, never into a file). Redeploy.
   `GET https://rotli.co/api/roadmap/votes` answers `{"live":true,…}`.
3. Read requests (never published; nothing emails them to you):

   ```sh
   railway ssh -s site -e production -- bun /opt/rotli/site/scripts/roadmap-requests.ts
   railway ssh -s site -e production -- bun /opt/rotli/site/scripts/roadmap-requests.ts --all
   railway ssh -s site -e production -- bun /opt/rotli/site/scripts/roadmap-requests.ts votes
   railway ssh -s site -e production -- bun /opt/rotli/site/scripts/roadmap-requests.ts mark 3 read
   railway ssh -s site -e production -- bun /opt/rotli/site/scripts/roadmap-requests.ts delete 3
   ```

   `railway ssh` runs inside the container, where the volume and
   `ROADMAP_DB_PATH` are (`railway shell` runs on your own computer and cannot
   see the file). If the session lacks the service variables, add
   `--db /data/roadmap.sqlite`. Statuses: `new`, `read`, `planned`, `declined`. Locally, the
   same script reads a copy with `--db <file>`. There is deliberately no admin
   endpoint: nothing on the public origin can read requests, so there is no
   token to leak.
4. When an item ships or is dropped, remove it from ROADMAP.md with its id; its
   count stays in the database, unread. Never reuse an id.

### Going live (turning off the holding page)

The holding page is only the production `SITE_MODE=coming-soon` variable. To
launch:

1. Confirm the newest release on `RELEASES_URL` (the `rotli-releases` latest
   page) is the alpha you want people to download; the button links there.
2. In Railway → `rotli-site` → production service, set `SITE_MODE=full`
   (leave `SITE_URL=https://rotli.co`). Redeploy so the Docker build picks up
   the new build arg.
3. Check `https://rotli.co/` renders the landing (the hero film, Download for
   Mac), `/robots.txt` allows indexing, and `/sitemap-index.xml` and `/llms.txt` exist.
4. Roll back by setting `SITE_MODE=coming-soon` again and redeploying.

Both modes are built by `bun run verify` (quality lane) so the flip never
depends on an unbuilt configuration.

Deploy from a checkout when needed (`railway up` uploads the repository root):

```sh
railway up --ci -e production   # holding page
railway up --ci -e dev          # live dev site
```

For local validation (`bun run verify` runs the check and the full and
coming-soon builds):

```sh
cd site
bun ci
bun run check
CI=true bun run build                          # full
CI=true SITE_MODE=coming-soon bun run build    # production holding page
bun run build:modes                            # full, dev, coming-soon → dist/<mode>/ for side-by-side review
docker build -f site/Dockerfile --build-arg SITE_MODE=dev -t rotli-site:dev ..  # from site/
```

## Films

**The hero film** (`public/media/hero/rotli-hero.mp4` and
`rotli-hero-poster.webp`, `hero` in `src/films.ts`) is the product itself: a
real Rotli Web session, under a minute, made by `bun run capture:hero` from a
local `ROTLI_BUILD_CHANNEL=stable bun run dev:web`. It writes a messy note (two
tasks, a dropped image, a `[[link]]`), opens the linked note and the Library,
finds the note with search, asks chat what is still open, and ends on the note
as raw Markdown. Real controls are clicked with a drawn pointer; captions sit
in a 162 px band under the picture, never over the UI, in 80 px type so they
still read (about 15 px) when a phone shows the film 350 px wide. Each caption
is one line (the script refuses one over 1760 px), the last stays on the frame
the player rests on, and the player keeps Watch again and pause above the band
(`captioned` in `src/films.ts`). H.264 1920 × 1080, 30 fps,
`+faststart`, no audio, CRF 18 (about 1.75 MB); the poster is a frame of the
written note. What is fixture, all synthetic:

- **The Library's filed notes** (Travel, People, Home) are planted as files
  carrying the Librarian's own fields (`area`, `summary`, `tags`, `links`,
  `filed_by`). The Librarian runs only in the Mac app, so the film shows what
  it filed, never a live run, and the note written on camera stays a capture.
- **Chat** runs through a fake Rotli Helper on loopback (the
  `e2e/web/rotli-helper.spec.ts` pattern). The app's real agent loop sends
  every prompt and runs the search and both note reads; only the model's text
  is scripted, and it answers from what those reads returned.
- **The clock** starts at the real time (New York time zone) so the app's
  clock and the vault's file times, which the browser stamps itself, agree:
  the note written on camera reads "just now" and the dates are the day it
  was shot.

The script fails if the note written on camera is not Markdown in the vault
or the film is over 6 MB. Look at `_review/hero-video/frame-*.png` and the
poster before committing a new take.

`FilmPlayer.astro` plays it muted, once, as soon as it is on screen, then it
rests on its last frame; it never loops. A silent film (`silent` in
`films.ts`) gets no sound control: a pause button while it plays and "Watch
again" when it ends. A film with a soundtrack gets "Click for sound", which
restarts it from the top with sound and native controls. It pauses when
scrolled away and resumes if it was playing, and the file downloads only once
the player first comes into view. Under reduced motion, Save-Data, or without
script it is a poster with native controls.

The studio's films (`public/media/story/`, `src/films.ts`) come from the
motion room kept on the maintainer's Mac (`rotli-studio/motion/out/video`),
outside this repository, re-encoded for the web: H.264 with `-tune animation`,
`+faststart`, AAC 96 kbps (the story at CRF 28, about 5.7 MB; each episode at
CRF 30, about 2.5 to 3.5 MB). Posters and episode thumbnails are frames of the
films (WebP, via `cwebp`).

- **The story film** (`rotli-story.mp4`, 60 s) played in the hero until the
  product film replaced it; its files stay, and no page plays it now.
- **"Rotli in 30 seconds"** (`epNN-*.mp4`, eight episodes) is no longer
  played by any page (2026-10-05): visitors asked for the real product over
  the story, so `/features/` plays the product film instead. The files stay
  for now. Episode 7's opening card burns in the retired line "AI is invited
  in. It does not own the house." and episode 4 counts six theme families, so
  neither may be shown again without a new cut from the studio.

The earlier launch film still lives in `public/media/` for the holding page:
`PromoFilm.astro` renders it there when `rotli-promo.mp4`, its poster, and its
captions all exist (click-to-play with native controls, `preload="none"`, no
autoplay). Its opening card still reads "Mac beta in preparation" and needs a
new cut before the holding page is used again.

The theme studio previews fourteen environments from `public/themes/` (seven
families × light/dark), one row per family with Light and Dark swatches.

| Artifact | Path |
| --- | --- |
| H.264 MP4, 1920 × 1080 | `public/media/rotli-promo.mp4` |
| Poster JPEG | `public/media/rotli-promo-poster.jpg` |
| WebVTT captions | `public/media/rotli-promo.vtt` |

All required files must be nonempty. Copy reviewed exports from the film
project into `public/media/` and rebuild. The captions track is not switched
on by default because films may carry on-screen captions; viewers enable it
from the native controls. `Caddyfile` serves `/media/*` same-origin
(`media-src 'self'`), with a day-long cache and explicit `video/mp4` and
`text/vtt` content types, because the Caddy image has no MIME table for those
extensions and `nosniff` would otherwise make browsers refuse the captions
track. Do not commit zero-byte placeholders; a slot must stay absent until its
real files are ready.

## Playground and launch assets

The coming-soon page shows the reviewed `public/rotli-playground@3x.png`
capture from a fresh synthetic browser fixture whose Main holds only the
seeded Welcome folder; the launch page names the nine Welcome lessons in its
feature list and closing line instead of a separate section.
With the app browser twin running at localhost:1430, regenerate site media
from the repository root:

```sh
bun scripts/capture-site.mjs http://localhost:1430
bun scripts/build-character-fills.mjs --site
```

It writes `public/rotli-app-warm-light@3x.png` (the social card's workspace)
and `public/rotli-playground@3x.png` (the coming-soon page); the theme studio's
`public/themes/` captures are a separate set it does not touch, and the fill
script makes only the celebrating quokka. The capture script
uses fresh browser contexts and actual theme, Settings, and Playground controls. It waits for fonts, hides hover tooltips, verifies
pixel dimensions, and checks that the tutorial has no files in Main.

[Launch readiness](../docs/architecture/launch-readiness-2026-09-07.md) records
current promotion gates. Keep download availability and feature claims tied to verified
release capabilities. These source changes do not deploy the site.

## Rotli Helper installers

`public/helper/install.sh` and `public/helper/install.ps1` are served as-is
at `rotli.co/helper/…`. They download the prebuilt `rotli-helper` for the
user's OS from the releases repository (tag `helper-v<version>`, published
by the `Rotli Helper release` workflow), verify the checksum, install it to
`~/.rotli/bin`, register it to start at login (LaunchAgent `co.rotli.helper`,
systemd user service `rotli-helper`, or a Windows Startup shortcut), and — with
`--open <Rotli Web>` / `-Open` — open the app with the pairing code in the URL
fragment. `--open` accepts only Rotli's own addresses; `--uninstall` /
`-Uninstall` removes the login item and the binary. Bump the version in both
scripts with the crate version, and publish that `helper-v<version>` release
BEFORE deploying a site whose scripts point at it — Rotli Web needs a helper
with the vault verbs, and an older one reads as "outdated".
