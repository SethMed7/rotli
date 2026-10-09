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
the rules without a browser, `bun test scripts/site-interactions.test.ts`
(the privacy passage's trigger and the contrast of every frame of its
crossfade, the theme studio's autoplay, the reading meter, the footer scene's
play and the visitor's person), `bun test scripts/site-motion.test.ts` (the
before and after's filing play) and
`bun test scripts/site-runner.test.ts` (the 404 game), `bun test scripts/site-writing.test.ts`
(post figures, the blog's arrangement, "New", the article tree, a post's sources, and the From rotli spots), `bun test scripts/site-github.test.ts`
(the header's star count), and `bun run test:e2e:site` (`playwright.site.config.ts`: builds
the site as production does, with `SOURCE_REPOSITORY_PUBLIC=true`, plus
`SITE_GITHUB_STARS=1234` so the build never asks GitHub, serves it with `astro preview` on port 4392, and drives
`e2e/site/`). The unit files run inside `bun run verify`; the site's E2E lane is not yet
wired into `verify` or CI (an owner decision: it would add a site build to
the e2e lane), so run it by hand after changing those pages.

Narrow widths are part of that proof: `e2e/site/narrow-layout.spec.ts`
checks that no page scrolls sideways at 390 and 768, and the landing at 320,
1024, and 1920 too (inline code in the changelog breaks inside the column).
It also checks that the theme studio's island never sits under its lede, that
each step of the Overview puts its words above its picture on a tablet and a phone, and that
the landing's smallest controls (the footnote marks, the 404's other ways in)
answer a 44px touch. Small controls grow their hit area under
`(pointer: coarse)`, never their glyphs. `e2e/site/landing-layout.spec.ts`
holds the landing's order and grounds, the Overview's three steps (pinned, one
step per third of the scroll, stacked on short windows; the view and vault picture's dotted line level with both marked rows from 320 to 1920, the
LLM wiki link under the lede), the before and after's
play (once in view, held off screen, resting marked, Replay, one window at
1440×900, no script, reduced motion), the FAQ's Rotli Web answer when it is
there, and the closing panel, whose art never touches its words from 320 to
1920. `scripts/site-agents.test.ts` proves that answer under both values of
`WEB_APP_ENABLED`, since the E2E build leaves it off.

## Production details

- The canonical origin comes from `SITE_URL` (default `https://rotli.co`) in
  `src/site.ts`; the sitemap, robots.txt, and canonical metadata derive from it.
- `SITE_MODE` decides what a build contains (one policy, `src/site.ts`):

  | Mode          | Deployment                    | Pages                    | Downloads | Indexed |
  | ------------- | ----------------------------- | ------------------------ | --------- | ------- |
  | `coming-soon` | holding page                  | holding page + 404       | no        | yes     |
  | `dev`         | live dev site · `dev.rotli.co`| full site + drafts + the full developer reference | no | no |
  | `full`        | production · `rotli.co`       | landing, Features (a catalog and a page per feature), Privacy, Resources (Blog with its guides, Developers, Changelog, Roadmap), About, 404 | yes | yes |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change — see "Going live" below. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
- **Structure and navigation.** `src/nav.ts` is the one navigation policy.
  The header links real pages, never landing anchors: Features · Privacy ·
  Resources · About. Resources is a dropdown (`resourceItems`), each entry with a
  one-line description: Blog (`/blog/`, the one writing section, guides
  included since 2026-10-06; listed only once a post can be read, so an index
  of nothing but "coming soon" is never linked), Developers (`/resources/developers/`, marked "Coming soon" outside
  the dev site), Changelog (`/changelog/`), Roadmap (`/roadmap/`, see "The
  roadmap: votes and requests" below), and Rotli Studio (studio.rotli.co, the
  motion studio's own site: an `external` entry drawn with a muted ↗ and
  opened in the same tab, exactly like the footer's link to it). The dropdown is a disclosure:
  a button with `aria-expanded` (Enter/Space/click toggles; ArrowDown opens
  into the list; ArrowUp/ArrowDown, Home, End move; Escape closes and returns
  focus; tabbing away or an outside click closes). Without script the button
  is hidden and "Resources" is a plain link to `/resources/`, a slim page that
  lists the same entries. On the right sit
  GitHub with its star count (while the source is public; see "The GitHub
  star count" below), a plain link left of the button, and the way in, "Download free" (`WAY_IN` in
  `src/site.ts`), the hero's own label and button scaled to the header (the
  owner, 2026-10-06: "the top right button should align with button on hero
  for consistency"). It opens `/download/`, which offers Rotli Web on systems
  with no download yet, so the label holds there too. That page is not also a
  menu item. The
  footer's link columns (Product · Learn · Open source, the last only while
  the source is public) and tagline default from the same file. Pages pass
  only `current` (a dropdown's label is marked current when any of its pages
  is). The header stays pinned on a solid ground (flat: no blur, no shadow);
  `[id]` targets carry a matching `scroll-margin-top`. Below 1080px the pages
  fold into a Menu disclosure (`<details>`; Escape, an outside click, or
  choosing a link closes it), where the dropdown's pages are listed under its
  name; below 560px the star link ("Star rotli on GitHub" and the count) and
  "Download free" move into it too. The
  footer's lead column holds the brand, the tagline, and the "Hear when it's
  ready." sign-up, always shown (see "The coming-soon list" below): one field
  with an arrow inside it that sends, named "Keep me posted"; its
  closing row holds the maker line, with a drawn X mark (not the platform's
  artwork) linking to `https://x.com/iamsethmedina`, `rel="me"`, in a 44px
  target, and the Launch Llama badge; the quokka scenery runs along its bottom
  edge.
- **The landing page** (`src/components/Landing.astro`) only composes its
  chapters from `src/components/landing/`, in the order set out in
  `docs/design/landing-layout-2026-10-05.md` (each thing said once; grounds
  alternate plain and warm):
  1. Hero (the product film; plain): two buttons side by side at one height,
     radius, and type size (the owner, 2026-10-06: "our privacy policy should
     be more like a button matching the download"): "Our privacy promise"
     (outlined, with a lock, to `/privacy/#promise`, passed into
     `SiteActions`' `before` slot) on the left and "Download free"
     (`SiteActions`, primary) on the right (the owner, the same day:
     "Privacy promise goes on the left"). Below 520px they stack full width
     in that same order: one order for sight, the keyboard, and screen
     readers (no `order` or `column-reverse`), and the download still reads
     as the main action by its fill. "No account. Works
     offline." stays one quiet line under them. The film sits across the boundary into the next
     band: behind its lower half the page ground eases into the warm one
     (`.below-fold`, one gradient between the two ground tokens), so there is
     no strip or hard line between them, and the band's top padding shrinks
     to match. The film rises in once on arrival; nothing is scroll-linked.
  2. StatBand (warm; the owner, 2026-10-06, moved it up so the reason comes
     before the product; then, the same day, "keep it simple, those who want
     more will read the blog"): the headline, two sourced figures, each
     footnoted with its exact population (50.4% from Self Financial; "Half"
     from Menlo Ventures and Morning Consult), and one sentence on rotli
     putting that idle plan to work. Beside them is the post's own thumbnail
     (`postThumbnail`), one link with "Read the study →" to
     `the-ai-you-already-pay-for`, which sets out both surveys and the other
     figures in full. The picture's top sits on the headline's and the call
     to action's bottom on the close's: the picture takes the height the
     words set, within 13% shorter (cropping sky) to 8% taller (cropping the
     side margins) than its own shape, so the bench and the quokka stay
     whole. Below 1180px the picture goes under the words at its own shape.
     Never write "wasted"; Bango stays in the post as context. "Product names
     belong to their owners." stays while ChatGPT is named. It is the one
     chapter whose headline has no lede: its figures are the lede.
  3. Overview ("Write it down. rotli puts it away."; plain): what rotli does,
     as one story in three steps (the owner, 2026-10-06: "clarify view vs
     where it actually lives"). It absorbed the former TwoKinds section ("You
     write for yourself. AI reads differently.") the same day, because the
     two said the same thing. One step shows at a time, following the scroll
     (the owner, 2026-10-08: the three in one scroll felt "dead and
     overwhelming"; then "make the switches of what I am looking at happen
     with scroll not manually"). On a window at least 1081 wide and 800 tall
     the story pins in the middle of the window under the header while the
     page scrolls a runway below it (half a window per step after the
     first, `src/storyScroll.ts`); each third of the runway is one step. The
     steps are listed on the left, each a heading, the open one with its one
     sentence on a highlight in the frame's colour that glides between them
     and joins the frame with two concave corners; the pictures slide through
     one framed stage on the right (a warm bezel round a lighter panel, after
     a reference the owner shared, 2026-10-08), each centred in it, the stage
     keeping the tallest one's height. Along the stage's floor runs a slim,
     faint stretch of the island's shore (`StageScenery.astro`: the sea's
     line, a sail, dunes and grass, no clouds behind the words), wider than
     the stage, panning a little as the pictures slide so the steps read as a
     walk along the shore; the pictures keep `--shore` of room above it.
     Stacked, each picture sits in its own matching frame, without the shore. A step switches whole (nothing is scrubbed
     with the scroll), and a step's name scrolls the page to it. Only the open
     picture is focusable (the others are `inert`). Narrow or short windows,
     and no script, stack the three, each heading and sentence over its
     picture. Reduced motion: the steps switch without the slide. Each picture
     is drawn in HTML on the site's tokens, with the app's quokka standing on
     it (it hops as its picture opens) and no outer card (the owner,
     2026-10-05: no card in a card):
     1. Write in your view (`ViewAndVault.astro`): the note in Main under a
        folder, and its one file in the vault at `wiki/_inbox/dana-call.md`,
        the two marked rows joined by a dotted "same file" line. Both panels
        share one row height, so the line sits level with both rows at every
        width; below 600px the panels stack and the line runs down between
        them.
     2. The Librarian files it (`Filing.astro`, the former TwoKinds before
        and after, moved whole): the same file as typed in the intake and as
        filed into `wiki/Clients/`, in two open columns with no card around
        either, so the comparison alone fits one 1440×900 window. The added
        frontmatter lines carry a "+" and a tint, the body is marked
        unchanged in ink (a tick and a rule, not a second fill), and `area`
        is a flat area, as the memex contract requires. It plays the filing
        once when it comes into view (`src/filingTimeline.ts`; the owner,
        2026-10-05): the note is typed, the same words appear on the right,
        the added lines open above them one by one like a live diff, and it
        rests marked. One frame loop, held off screen and in a hidden tab; a
        quiet Replay (44px) plays it again. Both bodies keep their full text
        at every moment, and the markup is the finished state, so without
        script or under reduced motion nothing moves.
     3. Ask, and AI goes straight to it (`AskIndex.astro`): a chat whose
        middle row, drawn dashed as a step and not as a control, says the
        vault was searched on this computer and names the two notes read.
        The app has no "sources" control, so none is drawn.
     Every claim is a contract's; `docs/design/landing-layout-2026-10-05.md`
     ("Revised 2026-10-06 (evening)") lists the source of each. Under the
     lede, "What is an LLM wiki? ↗" is one link to Andrej Karpathy's "LLM
     Wiki" gist (2026-04-04), the term's source; it replaced a two-sentence
     aside under the steps (the owner, 2026-10-08). The story is the
     section's last word: no "See every feature" (Features is in the
     header). The
     "more than notes" message the old lede carried stays in the hero lede
     and the FAQ.
  4. The dev-only Experiments (plain; between the plain Overview and the
     warm theme studio, so only the dev site shows two plain grounds in a
     row).
  5. Personal (the theme studio; warm, as before 2026-10-06, once the tour
     above it was removed; its arrows' hover takes the plain `--ground`,
     which reads against the band), with a faint island vignette from
     1180px up. Narrower, its left edge would reach into the lede, so it steps
     out.
  6. PrivacyBrief: the night scene in Ocean Dark via `.band-night` in
     `Base.astro`, three facts, and "Read our privacy promise", to
     `/privacy/#promise`. While it is the
     focal passage the whole page steps into its night (see "The privacy
     passage").
  7. Faq (plain): two entries carry the owner's item 2 message. Notes are the
     foundation of a workspace, and rotli charges nothing for AI. While
     `WEB_APP_ENABLED`, "Can I use rotli in my browser?" is the landing's one
     word on Rotli Web and the Helper (since the tour's last part went,
     2026-10-06): which browsers open the folder, that Firefox, Zen, Brave,
     and chat go through Rotli Helper, and that Safari and phones aren't
     supported yet, then a line of links to the Helper guide and the "why
     Terminal" post. An answer stays one plain string (it is also the FAQPage
     JSON-LD); an entry's optional `links` render as their own line under
     it.
  8. Closing (plain, one framed panel on the warm colour). The two-tone
      headline "Start with one note." / "It stays in your folder." has its
      first line in full ink and the second muted. Under it are "Free, with
      no account to make." and the hero's one way in, "Download free"
      (`SiteActions`). The writing
      quokka comes in from the right, cut off by the frame. Under 900px it
      steps below the words, never onto them. It asks for a first step rather
      than repeating the hero (the earlier invitation was cut for that). Right
      under it is the footer's quokka beach.

  The landing page carries exactly one video. On narrow screens the theme
  studio is a carousel (previous/next and a swipe on the capture).
  Each chapter owns its
  markup, scoped styles, and script. `Base.astro` owns the tokens, the shared
  section grammar (`.wrap`, `.section`, `.section-title`, `.section-lede`,
  `.band-warm`, `.band-deep`, the spacing and type steps), and the one
  scroll-reveal script. Scroll reveals (the drawn scenes included) fire once
  and rest; the before and after's filing play is one of those (once in view,
  then at rest, Replay on request). Three things move on their own, each the owner's call: the theme
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
- **The GitHub star count** (`src/githubStars.ts`; the owner, 2026-10-06:
  "up top I want github with star count"). The visitor's browser never calls
  GitHub: the build asks `https://api.github.com/repos/SethMed7/rotli` once
  (a module-level promise shared by every page; nothing is written to the
  repository), with a 3 s timeout and no token. If `GITHUB_TOKEN` is in the
  build's environment it is sent for the higher rate limit and never logged.
  Any failure (no network, a timeout, a non-200 such as a rate limit, an
  unexpected body) logs one warning and renders the link without a number;
  the build never fails on it. Only a build with `SOURCE_REPOSITORY_PUBLIC`
  and the full site asks. `SITE_GITHUB_STARS` overrides the request: a whole
  number is used as the count (the E2E build sets 1234), `off` shows none.
  Counts read short (5, 999, 1.2k, 12k, 123k, 1.3m). The link is a plain
  `<a>` to `GITHUB_URL` with no script, frame, or image from GitHub, and no
  border or fill (the owner, 2026-10-06: "don't put it in a card, just logo
  and star count … in gold matching GitHub star color"): the GitHub mark in
  ink, then a star and the count in `--github-star` (Base.astro). GitHub's own
  star gold (Primer `base.color.yellow.2`, `#eac54f`) is 1.5:1 on the
  header's ground, so the day value is that gold darkened to `#8a5d00`
  (5.17:1 on `--ground`); in the privacy passage it is GitHub's dark-mode
  star, `#e3b341` (9.31:1 on the night ground). It leans onto `--text`
  around the passage's ink switch like accent text, and
  `scripts/site-interactions.test.ts` measures it in every frame. Hover
  underlines the count; focus shows the site's ring. The mark and the star
  are Primer Octicons' `mark-github` and `star-fill` (MIT), inline. Its name
  is "Star rotli on GitHub, 1.2k stars" (hidden words around the count). On a
  phone (below 560px) it stays in Menu: beside the brand it would crowd the
  bar at 320. The Docker build stage has the
  network (it already runs `bun ci`); `GITHUB_TOKEN` is deliberately not a
  build arg, since a build arg lands in an image layer.
  `scripts/site-github.test.ts` holds the request, the fallbacks, and the
  formatting; `e2e/site/landing.spec.ts` the link, its name, its place, no
  GitHub request from the page, and no overlap in the header from 320 to 1920.
- **`/privacy/`** is the full privacy policy in plain language. It opens on
  the privacy promise (`#promise`, the owner, 2026-10-06; the hero and the
  landing's night band link there): a lead line, a matrix of who may read and
  change a note you wrote (on-device model, connected AI, the Librarian) for
  an everyday, a secure, and a locked note, which becomes one block per note
  on a phone, then five points (secure, locked, "Let AI edit the text", the
  Librarian, everything else). It restates `docs/design/ai-visibility-matrix.md`
  and the 2026-09-29 body-edit decision word for word in meaning, and it is
  the page's one access table. Then where notes live, every network connection
  and when it happens, AI and your notes, Rotli Web and Rotli Helper,
  this website (no cookies, analytics, or third-party scripts; the two footer
  badges load from their own hosts), retention, and changes, each with the
  reason it works that way. `PRIVACY.md` at the repository root stays the
  product's source of truth: change this page in the same change as
  `PRIVACY.md` whenever a data class, destination, retention rule, or control
  changes. Features that are off in released builds (Breve, remote agents)
  are described as off, not as available.
  It reads like a blog post (the owner, 2026-10-06: "Privacy page design
  should match blog styles"): `WritingPage`'s `article` layout, so the head,
  the rail, the reading column, and the end are a post's (see "The blog
  post" below). The head is a post's: "Privacy", the lede, the byline with
  "Updated …" and the reading time, and topics, beside a drawn banner (see
  "The privacy head" below). The rail has the tree from its
  `##` headings, the meter as a percent, no Sources, and Share as **Copy
  link** alone (a policy is pointed to, not posted, and it has no Markdown
  twin; the whole Share block waits for script and a clipboard, so it is
  never an empty label). The promise's matrix is a wide block (`.wide`): it
  starts on the words' edge and runs on to the page's right edge like a
  post's table where there is room (the same `article-prose` container
  query, 48.5rem), and the section companions float on the column's right
  edge, not the main track's. "More from rotli" closes it:
  the published posts tagged **Privacy** (`morePostCard` in `src/writing.ts`,
  shared with the blog) and the Download and Rotli Web spots, each only in
  builds that offer it. `e2e/site/privacy-page.spec.ts` holds the head from
  320 to 2560, the rail, the phone's disclosure, slim bar, and Copy link,
  the end, `#promise` landing just under the header from 320 to 1920, and no
  sideways scroll from 320 to 2560; `privacy-promise.spec.ts` the matrix,
  one block per note on a phone, from 320 to 2560.
- **Subpages** (`WritingPage.astro`) sit on the site grid: breadcrumb, title,
  lede, and an optional metadata line (`meta`: a date, "Updated …", a reading
  time) line up with the header's brand, and a full-width rule divides the
  head from the body. Long pages pass `toc` and read as an article: a sticky
  "On this page" tree beside a reading column of about 70 characters, the
  section in view highlighted and a slim rail filling as you read (one
  bundled script; without it the tree is plain links). Below 900px the tree
  becomes an "On this page" disclosure above the text (Developers uses it).
  Blog posts and `/privacy/` pass `article` instead (see "The blog post"
  below), so every article on the site reads the same way (the owner's item 16: the flow
  of the claude.dev mods post, with the footer's strolling quokka as its
  walking character).
- **The reading meter** (`progress`): a bar and "N% through" pinned under the
  header at every width, measured over the article alone
  (`src/reading.ts`, the same measure that fills the tree's rail), so the end
  of the article reads 100% and the footer never counts. It follows scrolling
  either way and jumps through the tree, re-measures when the article changes
  height, and hides when the whole article fits in the window. It is a
  position, not proof of reading: nothing is recorded or sent. Blog posts
  and `/privacy/` (`article`) carry the same measure in their rail and,
  under 900px, as a slim bar. The
  meter has a fixed height, and everything under it clears header plus meter
  (`--pinned` in `WritingPage.astro`): the sticky "On this page" tree sits
  1.5rem below the meter, and every heading and `[id]` lands below it when
  jumped to (`e2e/site/reading-meter.spec.ts`).
- **The guides** were `/resources/<slug>/` with their own scenes until
  2026-10-06 (the owner: "guides move into the blog; the Blog is the only
  writing section"). They are blog posts tagged **Guide** now
  (`src/content/writing/posts/`, `POST_ART` art like every post): Getting
  started, Why local?, What does AI see in rotli?, What is Rotli Helper?, and
  rotli in the browser and on the Mac. A guide never leads `/blog/` on its date
  alone (`arrangeBlog`: the featured story is a marked post, else the newest
  post that is not a guide); `/blog/` offers a Guide filter, and `llms.txt`
  lists them under "Guides". Every old address redirects: `MOVED_GUIDES` in
  `astro.config.mjs` writes a refresh page at each `/resources/<slug>/` (any
  host, `astro preview`), and in production the Caddyfile's `movedGuide`
  matcher answers the page, the bare path, and the Markdown twin
  (`/resources/<slug>/index.md`) with a permanent redirect first.
  `scripts/site-agents.test.ts` holds both lists against the guides on disk;
  `e2e/site/guides-moved.spec.ts` the redirects, the menu, the filter, and
  that no page links an old address. `/resources/` stays as a slim page
  listing the Resources menu (`WritingList.astro`: plain entries in columns
  with a hairline above each, never boxes), and `/resources/developers/` stays
  where it is: it is a page with its own layout, not a piece of writing.
- **The blog index** (`components/blog/BlogIndex.astro`, after
  anthropic.com/news, the owner's 2026-10-06 "better layout and clarity,
  especially for what is new/big"; `src/blog.ts` arranges it): one featured
  story, the newest published post or the newest marked `featured: true` in
  its frontmatter, its thumbnail large (about five eighths of the row) beside
  its date, reading time, title, summary, and topics (stacked when the index
  is under 52rem wide); then the next posts, up to four (`SECONDARY`), in a
  row of smaller pictures that takes as many columns as fit at 16rem or more,
  at most four and never more than it has posts, so it fills its width at
  every count with no breakpoints (a lone one lies on its side from 52rem,
  and takes half the row below that); then "All posts", every published post
  newest first, one row each (date, its first tag as the topic, title,
  one-line summary) between hairlines, never boxes, the title and summary
  held to 46rem so a row never becomes one long line on a wide screen. The
  index sits on the site's standard 76rem page (only a post has the wider
  one; the owner, 2026-10-06: "I meant the page where we read the blog, not
  the catalog page"), where four posts in the row are about 17.5rem each,
  and lays itself out by its own width (a container, `blog-index`), not the
  window's. Topic filters over the list are buttons with
  `aria-pressed` that appear only with script (without it the whole list
  shows); a choice narrows the rows, says how many in a status line, and is
  kept in the address as `?topic=`. Announced (`coming-soon`) posts sit apart
  under "Coming soon", smaller, never links, and never in the featured area.
  A post wears "New" for 14 days after its date, computed when the site is
  built (`isNew`), so it ages out on the next deploy. Every picture is a real
  `<img>` at the thumbnails' one shape (1200 × 630, with a 600-wide copy in
  `srcset`), with its size and alt text; the feature loads first and the rest
  lazily. `e2e/site/blog-index.spec.ts` holds the order, the pictures, the
  list's order and rules, the filters with and without script, and "New" at
  1920, 1440, 768, and 390; `article-width.spec.ts` sweeps it from 320 to 2560
  (no sideways scroll, the feature beside or above its words, the list's
  measure, the index never wider than 76rem, the row's column rule at one to
  four posts).
- **The blog post** (`WritingPage`'s `article`; the owner's 2026-10-06 "fix the
  top of blogs", then "clean up left screen ... sources on the left side";
  then "for blogs let's use more width"; then "now the blog width is too
  much"; then "picture matches header width", "title beside the picture",
  and, of a Sources list cut off mid-title, "only show the top 4 sources then
  a load more if more. Remove the part on right and move blog content more
  right. Stuff on right can go at end of blog in replace of sources since
  sources is already on left side").
  - **The page and the grid** (`WritingPage.astro`). A post is on the site's
    one page width, `--page-max` (76rem) in `Base.astro`, the header's, so its
    head has the header's edges (the logo's left, Download's right) at every
    width; there is no wider post page any more. The grid is named tracks,
    `--article-tracks`, shared by the head and the body: `rail`, a gap, and
    `main` (the room right of the gap), which starts with `text`, the reading
    column; the rest of `main` is room for wide blocks. There is no right
    rail. The tracks and tokens are `.longform` in `blog/article.css`, the
    one definition the posts, `/privacy/`, and `/roadmap/` share (the owner,
    2026-10-07; the measured evaluation and the options are
    `docs/design/article-pages-width-2026-10-07.md`).
    The reading column is a measure, `--measure`: 18px type × 38.5, about 66
    characters, at every width. The rail and the gap are fluid in the
    article's own width (`cqi`; the article is the container). By window
    width:

    | Window      | Page             | Left rail              | Gap        | Main (column, then wide room)          | Line        |
    | ----------- | ---------------- | ---------------------- | ---------- | -------------------------------------- | ----------- |
    | to 900      | window − gutters | (disclosure)           | none       | the page; the column on its left edge  | to 66 chars |
    | 901 – 1179  | window − gutters | 10rem → 16rem by ~1180 | 2 → 2.5rem | the rest                               | 61 – 66     |
    | 1180 – 1295 | window − gutters | 16rem                  | 2.5rem     | the rest                               | 66          |
    | 1296 and up | 76rem            | 16rem                  | 2.5rem     | 57.5rem: the column, then 14.2rem      | 66          |

    Every block starts on the column's left edge, one rail gap past the rail;
    nothing is centred in the room, so the gap is the gap and no more (the
    owner, 2026-10-07, after the centred column of "move blog content more
    right" left 153px between the rail and the words at 1440). Below 901px
    the rail folds (its tree the disclosure, a bar across the page on the
    picture's edges; its meter the slim bar; its Share after the article)
    and the column starts on the page's left edge. `/privacy/` uses the
    same layout (see "The privacy head" below), and `/roadmap/` the same
    tracks.
  - **What breaks out.** Every block of the post keeps the measure; figures,
    tables, code blocks, and anything marked `.wide` start on the words'
    edge and run on to the page's right edge (the header's, and the head
    picture's), but only when `main` is at least 48.5rem (a container query
    on the prose), so a wide block is never a sliver wider than the text.
    On a narrower `main` (about 901 to 1150px) they keep the measure.
    Nothing reaches into the rail.
  - **Lists.** A top-level list respects the column's one left line (the
    owner, 2026-10-07): its bullet or number is drawn (`::before`, not
    `::marker`, whose place the browser decides) exactly on the edge the
    words and tables start on, and its words start one step in (1.25rem for
    bullets, 1.75rem for numbers), at every width. Nothing hangs into the
    rail's gap. Nested lists indent from their item; the Sources list and
    footnotes draw their numbers on the same line.
  - **The head** (`blog/ArticleCover.astro`) spans the page, the header's
    edges. From 1000px it is two columns, centred on each other so neither
    leaves an empty band: on the left "Blog /" small and quiet, the title
    (wrapping at about 22em), the summary, one meta line (the face mark as
    avatar, the author, date, reading time), and the `tags` as light outlined
    labels; on the right the post's picture, whole, rounded, in a hairline
    frame. The picture beside the title is the banner's quokka crop
    (`postBanner(slug).mobile`, 1300 × 900) at its own shape (`object-fit:
    contain`), so no ears or feet are ever cut; the words get a little more
    room (`1.08fr` to `1fr`). Below 1000px it stacks, as on a phone: the
    wide scene across the page (`clamp(12rem, min(30cqi, 44svh), 27rem)`
    tall, `object-position: 100% 70%`), then the words (on the page's left
    edge from 901px, on the reading column's below); under 700px the picture
    is the quokka crop again. A hairline closes the head. Nothing overlaps
    the picture, nothing is pinned, and the title is in the first window at
    1280 × 800 and 1440 × 900. A post without art gets the same head without
    the picture.
  - **The left rail** (`blog/ArticleRail.astro`) reads, top to bottom: the
    short title (`railTitle`: a title's first sentence), "On this page" as a
    tree (`###` under `##`, `tocTree`), the reading meter as a bar and a
    percent (`src/reading.ts`; no meter is pinned over the text),
    **Sources**, and **Share** at the foot. Sources are parsed at build time
    from the post's own `## Sources` list (`src/sources.ts`): one entry per
    list item, numbered as in the article, the text before the first link as
    the publisher (an author list shortens to "First et al."), the link text
    without its quotes as the title (a long one keeps its main title before
    a colon), each opening in a new tab with `rel="noopener noreferrer"`. No
    `## Sources`, no block. Every entry is whole: no inner scroll, no fade,
    no line clamp. With script the first four show and a "Show all N sources"
    button (`aria-expanded`, `aria-controls` the list; "Show fewer sources"
    once open) opens the rest in place, keeping the button where it was;
    without script every source shows. On a wide screen this is the post's
    one Sources list: the tree leaves out the article's "Sources" heading,
    and the article's own list is hidden on screens from 901px when the rail
    has the sources (`.has-rail-sources`; print, phones, tablets, and the
    Markdown twin keep the full citations). Nothing in the rail clips. It is
    sticky at a `top` that `src/railPin.ts` picks (unit-tested in
    `scripts/site-interactions.test.ts`): 1.5rem under the header when all of
    it fits the window (it does at 1440 × 900 with four sources); when it does
    not (a short window, or every source open), it moves with the page until
    its foot is in view scrolling down, or its head scrolling up, and holds,
    so every part of it is a small scroll away and Share stays in view while
    reading. Without script it is not sticky and scrolls with the page. It
    stops at the article's end: "More from rotli" is outside its grid, so it
    never reaches that section or the footer. Share is X, LinkedIn, and
    Email as plain links carrying the canonical address and title (no
    third-party script, image, or request), and Copy link and Copy Markdown
    (the post's same-origin twin, `connect-src 'self'`), shown only where the
    clipboard can be written; each has an inline SVG icon on `currentColor`,
    in a two-column grid (one column in the narrowest rail), Copy Markdown
    taking its whole row. There are no J/K section jumps (removed 2026-10-06
    at the owner's request). Under 901px the tree is the "On this page"
    disclosure, the meter a 3px bar under the header, the sources the
    article's own list, and Share follows the article.
  - **More from rotli** (`blog/ArticleAside.astro`) closes every post, on the
    reading column's edges at every width, in the place the article's Sources
    list had on a wide screen: "More posts" (up to three, `morePosts` in
    `src/blog.ts`: the newest other published posts, never the post itself;
    announced posts fill in only when too few are published, marked "Coming
    soon" and not linked) as small cards, a thumbnail over the title and
    date (three in a row, one a row with the picture beside on a phone), and
    two **From rotli** spots side by side where there is room. On a phone it
    follows the article's Sources and Share.
  - **From rotli spots** are `src/promos.ts`, the one file to edit: `id`,
    `label` ("From rotli"), `title`, `text`, `href`, `pose` (a quokka from
    `src/assets/characters/filled/cocoa/`, the site's own art), `external`,
    and `needs` (`downloads` or `webApp`, so a build never offers what it
    doesn't have). They are rotli's own promotions only: Download, the
    roadmap, the newsletter (`#newsletter`, the footer's sign-up), Rotli
    Web, and Rotli Studio (studio.rotli.co, rotli's own site, with the ↗ the
    menu and footer use). Posts rotate through them two at a time by their place in the blog
    (`promosFor`), so every spot is seen. They are plain links with local
    pictures: no script, frame, pixel, or remote image, so the CSP and the
    privacy page stay true. A real advertiser or ad network would need a CSP
    change, a `/privacy/` and `PRIVACY.md` change, and the owner's decision
    first; none is planned (the owner, 2026-10-06: house promos only).
  - **The reading column** (`blog/article.css`, global under
    `.writing.is-article`) is `--prose-size` (18px) at `--measure`:
    60 to 80ch (the width of that many zeros) at every width from 768px and
    62 to 70 from 1180px, about 66 characters of running text a line, with
    h2/h3 spacing, pull quotes, a numbered Sources list (`## Sources` then a
    list), footnotes, and the figures' styles; long words and bare addresses
    break instead of widening a phone's page.
  - Specs: `e2e/site/article-banner.spec.ts` (the head at 2560 to 390: the
    words beside the picture from 1000px and centred on it, the picture whole
    at its own shape, stacked below; its order, alignment to the header,
    first-window title, and measured contrast), `article-rail.spec.ts` (the
    rail's order, nothing in it clipping, four sources then "Show all"
    opening all nine whole in the window at 1440 × 900, 1440 × 700, 1280 ×
    800, and 1024 × 640, the button from the keyboard, all sources without
    script, pinned when it fits and its foot held when not, stopping clear of
    "More from rotli" and the footer, the article's own list on phones with
    and without script and in print and the twin, Share, copying, J and K
    doing nothing, jumps, the narrow layout), `article-aside.spec.ts` ("More
    from rotli" after the article on the text's edges at 2560 to 390 with no
    right rail, both spots, in place of the article's Sources from 901px and
    after them below, no overlap or overflow from 320 to 2560 with the
    footer), and `article-width.spec.ts` (the sweep at 320, 390, 600, 768,
    900, 1024, 1180, 1280, 1359, 1360, 1440, 1680, 1920, and 2560: no
    sideways scroll, the rail and figures never over the text, 60 to 80
    characters a line from 768px and 62 to 70 from 1180px, 18px type, the
    head and picture on the header's edges ±1.5px from 1024 to 2560, the
    column one rail gap past the rail with a list's words on its edge,
    figures on the words' edge ending on the page's right edge when they
    break out, and posts, `/privacy/`, and `/roadmap/` sharing the rail and
    the edge from 901px; the rail 16rem from 1440, a post's page and the index's
    both 76rem, a live resize matching a fresh load); `scripts/site-writing.test.ts`
    holds `sourcesOf` against the published post, `railTitle`, `morePosts`,
    and the promos' data and rotation.
- **The privacy head** (`blog/ArticleCover.astro`; the owner, 2026-10-06, and
  2026-10-09: "compare to this blog [The AI you already pay for] … and then
  try to match it"). `/privacy/` opens exactly like a post: the title, the
  lede, a byline (the author's mark and name, "Updated …", and the reading
  time, `READ_MINUTES`, counted the way a post's is and rechecked against the
  page's words by `privacy-page.spec.ts`), the topic chips (Privacy, AI,
  Security), and a banner drawn like a post's: `PAGE_ART.privacy` in
  `src/og.ts`, rendered by `bun run build:brand-images` into
  `public/banners/privacy*.webp` (the island by day, the quokka with its
  padlock shield, a locked note in front, the friendly on-device chip up the
  beach). It replaced the Ocean Dark night with its caption that stood in the
  picture's place (2026-10-06 to 2026-10-09); the night stays on the landing's
  privacy band. Share stays Copy link alone: a policy is pointed to, not
  posted.
- **Writing.** Blog posts, the guides among them (tagged Guide), are Markdown
  in one content collection, `src/content/writing/posts/` (schema:
  `src/content.config.ts`; posts may add `tags`, up to four short topics shown
  on their card and filtering /blog/, and `featured: true`). `src/writing.ts` decides what a build
  publishes: nothing in `coming-soon`; `draft: true` and `experiment: true`
  entries only on the dev site. `status: coming-soon` announces a piece: it is
  listed on its index with a "Coming soon" label and no link, and has no
  page, Markdown twin, sitemap entry, or llms.txt line until the field comes
  off (`publishedWriting` vs `upcomingWriting`). Routes: `/blog/` and
  `/blog/<file>/` (`/about/` has its own layout, below). Markdown code
  blocks wrap long lines at their spaces inside the box (the Helper's install
  line included) and are not syntax-highlighted: Shiki writes inline `style=` attributes,
  which the production CSP drops. Keep article images local.
- **Figures in posts** (`src/figures.ts`): a ```` ```figure ```` fence is a chart
  or a diagram drawn at build time, so a page carries no chart library, no
  script, and no inline style. `kind: bar` is an SVG whose bars are sized by
  percentage attributes (it reflows with the column and its text never
  shrinks), named by its visible title (`aria-labelledby`) and described by
  its values (`<desc>`), with a caption citing its `source:` and the numbers as
  a table behind "The numbers as a table". `kind: flow` is an ordered list of
  steps, a step's `- ` lines its alternatives. Values are copied exactly as
  written; colours come from classes on the tokens (SVG attributes cannot
  read `var()`). The Markdown twin gets each figure as a Markdown table or
  numbered list (`figuresToMarkdown` in `writingMarkdown`). A spec that does
  not parse fails the build. Astro 7's Sätteri processor takes the plugin
  through an integration in `astro.config.mjs` (`figures()`), not a new
  dependency. The fence's grammar is at the top of `src/figures.ts`;
  `scripts/site-writing.test.ts` holds the parser and the published posts'
  figures against their own text, and `e2e/site/article-figures.spec.ts` the
  names, tables, and phone fit.
- **`/about/`** (the owner's item 18 and his 2026-10-05 "use more width and
  redo it now that our message is better") is the maker's first-person story
  on its own wide layout, not `WritingPage`'s reading column: a head with the
  title beside the lede, the story film's island (`IslandScene`), then rows
  across the full page grid that alternate words and a picture (one column,
  words first, below 960px): notes first beside the app window
  (`public/themes/`), people and AI read notes differently beside a filed
  note drawn in HTML (the added lines tinted with a "+", the words under
  "Your words, unchanged"), yours and private beside the plain Markdown
  (`shots/render-raw.webp`) with the "stays local" quokka at its foot, no
  extra AI fee beside the chat capture (it links the post
  `the-ai-you-already-pay-for`), and the name beside the celebrating quokka.
  Two pull quotes are lines from the story itself. "How it got here" is a
  short timeline on the warm band: the words for each release are
  `src/milestones.ts`, every date is read from `CHANGELOG.md` and a missing
  version fails the build, and it ends on what's next (`/roadmap/`). "Who
  makes it" closes with the X link (`rel="me"`), the GitHub link while the
  source is public, and the `the-creation-of-rotli` post once it is
  published. The `[[OWNER: …]]` comments at the top mark where a personal
  "why I started" moment and the name's real reason can go. Rows rise in
  once; reduced motion and no script show them at rest.
  `e2e/site/about.spec.ts` holds the order, the links, the dates against
  the changelog, and that words and pictures never overlap from 320 to 1920.
- **`/download/`** is where every way in goes ("Download free" in the
  header, the hero, and the closing panel; the 404's "Try
  rotli" and the About page's too). It has its
  own wide layout. The head sets the title, the lede, and the way in for the
  visitor's own system (`Base.astro` stamps `data-os`: mac, windows, linux,
  mobile, or other) beside the dock scene (`DownloadScene.astro`: a laptop on
  a crate and a waving quokka on the dock, a boat whose sail is a browser
  window with a second quokka in it, the lighthouse between; no product
  logos). The scene plays once as it comes into view (the boat sails in, the
  quokkas hop up, both screens write their lines) and rests; reduced motion
  and no script show it still. On a Mac, and without script, the head offers
  the DMG ("Apple silicon · macOS 11 or later", the DMG's build target and
  minimum); on Windows and Linux it says "rotli for Windows is coming soon"
  and offers Open Rotli Web ("Use Rotli Web in the meantime"), or the
  roadmap while Rotli Web is off; on a phone it says rotli runs on a
  computer. "Two ways in" are two panels, rotli for Mac (what it includes,
  signed and notarized by Apple, Download .dmg and the release notes) and
  Rotli Web (which browsers open the folder, which need Rotli Helper, which
  aren't supported yet, and what stays in the Mac app); the one for this
  computer comes first, marked, and on Windows and Linux the Mac's button
  steps back to a quiet one. Then Windows and Linux, each "Coming soon"
  (`PLATFORMS.soon`) with Rotli Web for the meantime and links to the
  roadmap and the footer's sign-up; what you get (four plain columns on the
  warm band); the first five minutes (four numbered steps); and a short FAQ
  that reuses `src/faq.ts` where it can, with no second FAQPage JSON-LD.
  This is the only page that links the DMG (`DOWNLOAD_URL`). The version
  and the DMG's size are not shown: no site constant holds them for the
  published release. `e2e/site/download.spec.ts` holds the lead for each
  system and without script, the coming-soon entries, the scene's motion,
  and that nothing overlaps from 320 to 1920; its Rotli Web checks run only
  when the build offers Rotli Web.
- **Where rotli runs** (the owner, 2026-10-05). The promise is a free
  workspace, not a Mac app. The landing page says what it is and what it
  costs (the hero's "Download free" and "No account. Works offline." under it) and
  never where it runs: that line was clutter (the owner's second call that
  day, "clean up some clutter on the website and improve readability").
  Availability is `/download/`'s, the FAQ's, the meta description's, and
  `llms.txt`'s to say, all from `PLATFORMS` in `src/site.ts`
  (`availability` for one-sentence summaries, `soon` for the status label,
  `meantime` for where Windows and Linux visitors go). Never imply the Mac is
  the only platform rotli will have, or that Windows or Linux apps exist
  today.
- **Docs and Sheets** (Word `.docx` and Excel `.xlsx`, edited with Univer in
  the Mac app) are named as beta (the owner, 2026-10-05; Sheets leaves
  development builds in the same release). The word comes from
  `DOCS_AND_SHEETS` in `src/site.ts` (`status` for a label, `inline` inside a
  sentence); never write "Beta" by hand, and say no more about them than that
  they open and edit. The hero, the feature catalog, the FAQ,
  and `llms.txt` use it.
  Sentences about what the Mac app does today (the on-device model, the
  Keychain) stay about the Mac. The Helper guide is `/blog/rotli-helper/`; the 404
  page's `/helper` hint links there.
- **The 404 page** (`src/pages/404.astro`) has no header or footer, and few
  words (the owner, 2026-10-05: "simplify the text, remove the mac"): "This
  note wandered off." in the middle of the window, one "Take me home" button,
  and a quiet "Try rotli · Resources" (to `/download/` and `/resources/`; no
  Mac-specific link). A line under the headline appears only for `/app`
  (Rotli Web is not switched on here) and `/helper` (a link to the Helper
  guide), chosen in the browser from the path. Along the bottom edge is a
  small game on the footer's beach (`src/runner/`: `game.ts` is the game
  without a screen, `stage.ts` draws it on a canvas). The quokka (the walking
  pose) runs; Space, ↑, W, a click, or a tap jumps (letting go early makes a
  short hop); ↓ or S, a press on the sand (the stage's lower third), or a
  swipe down ducks while held: it slides low along the sand, or tucks and
  drops fast in the air. Rocks, bushes, logs, and sandcastles come along the
  sand; after the first 30 m gulls and low branches come over it, reaching
  past the top of any jump, so they can only be ducked under. Generation
  always leaves a whole jump's length plus the quokka and a moment to react
  between one thing and the next, so a run never asks for a jump and a duck
  at once (`scripts/site-runner.test.ts` proves it with a seeded player that
  survives every run to the top speed). It gets faster a level at a time: a
  new level every 75 m, each 38 units a second quicker, up to level 10; the
  level shows beside the score and lights up for a moment when it goes up.
  The stage is taller than before (`min(clamp(300px, 50svh, 460px), 86vw)`,
  300 world units of mostly sky), and still fits a laptop's window under the
  words. The score is metres; it shows (with the level and the best run)
  only during a run, and a fall shows the distance and "Play again". It
  never starts by itself: Play starts a run and moves focus to the stage,
  which alone reads the keys, so Space or ↓ on "Take me home" or anywhere else
  is never taken; during a run a swipe on the stage is the game's, not a
  scroll. Escape or P pauses; so does leaving the stage (a Tab, a click
  elsewhere), hiding the tab, or scrolling it out of view, and a pause lets go
  of a duck. Paused or over, the sky behind the overlay is washed back so
  nothing passing behind it crosses its words. The frame loop runs only
  during a run. Reduced motion keeps the game playable (the visitor chose to
  start it) but stills the decorative layers (drifting clouds, the run's bob,
  kicked-up sand, the gull's wings). The best run lasts as long as the page:
  no score is stored. Without script the footer's quokka scenery stands there
  instead.
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
  (the cheering pose) as it arrives. Everyone blinks.
  **The person** (the owner, 2026-10-05: "when I am hovering over it with my
  mouse it inserts a human I am controlling. I can walk my human all the way
  to the food and feed the quokkas. I can also go play with the quokkas with
  the ball"; and later that day: "when my mouse is there let me use arrows to
  move ... I can click what quokka to throw the ball to or give feed to"). A
  small person drawn in code in the scene's ink and tokens (a round face, a
  bucket hat, a shirt in `--lantern`, trousers in `--wood-dark`, outlines at
  about the art's weight; nobody in particular) appears when the mouse comes
  onto the sand, a short walk in from the nearer side to the pointer, and
  then stays put: it no longer chases the pointer, which let the arrow keys
  and clicks steer it without fighting the mouse. It walks with a brisk start
  and a soft arrival (it never overshoots), legs and arms swinging, facing the
  way it goes, on the sand line and behind the residents. What a click (a tap
  on a touch screen) asks of it is `command` in `src/quokka/human.ts`:
  - the leaf pile: walk there and pick a leaf up (the pile gives a little and
    the leaf flies up into its hand);
  - a quokka, with a leaf in hand: walk beside it (never in front) and hand
    it over, through the same feed and guard-mood rules as the drag; a small
    heart rises over the quokka;
  - a quokka, with the ball in hand or while in the game: throw it the ball in
    an arc (at once, or on its next catch). Any resident catches it (the
    guard and the players reach up in the cheering pose; the sitter and the
    nibbler take it in their paws), hops, and throws it back to the person;
  - the ball, or a player with empty hands: walk to the two with the ball and
    join their catch, which then goes player, person, other player until it
    walks away (and it hands the ball back if it leaves holding it);
  - any other quokka with empty hands: walk over to it; open sand: walk there.
  Under the mouse, whatever a click would act on (a quokka, the pile, the
  ball) shows a pointer and a small ring on the sand at its feet. The arrow
  keys walk it whenever the pointer is over the beach (`:hover`, so a page
  scrolled under a still mouse counts right) or focus is on its buttons:
  held, it walks, and let go near the pile or a quokka it stops at it. They
  are never taken from a form field or with a modifier held, and ↑ and ↓ stay
  the page's, so scrolling works. From the keyboard alone, "Walk on the
  beach", a button before the band (visible on focus, with a described
  instruction), brings it in and takes ← and →. It wanders off seven seconds
  after the visitor stops playing and the pointer leaves the beach. Its rules
  without the DOM (the walk, the swing, what a click asks, what it does where
  it stops) are `src/quokka/human.ts`; `src/quokka/person.ts` poses the
  drawing.
  **The drag** (the decision, 2026-10-05) stays alongside as the second way to
  play: the visitor can press on the pile and carry a leaf (mouse, pen, or
  touch; `touch-action: none` only on the pile). The residents watch it, a
  hungry eater perks up as it comes near, and letting go over a quokka hands
  it over (it eats, the others hop, the guard is pleased); letting go over
  open sand wastes it (it drifts down, rests, fades, and the guard is sad). A
  click or tap on the pile without dragging sends the person to pick a leaf
  up. The leaves are their lunch, so both give the visitor a part in the
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
- **The way in.** `WAY_IN` in `src/site.ts` is the one call to action,
  "Download free" (the owner, 2026-10-06), to `/download/`: `SiteActions.astro`
  renders it in the hero and the closing panel, and the header renders the
  same label. A build with Rotli Web but no Mac download says "Try now"
  everywhere instead, so it never promises a download that isn't there. The
  hero passes its secondary button, "Our privacy promise", into
  `SiteActions`' slot. The earlier pair (Open in browser and Download for Mac, reordered by
  platform) is gone: the download page makes that choice with the visitor's
  system in view, so the hero keeps one primary button. A
  deployment that offers neither the Mac download nor Rotli Web shows "Mac
  alpha coming soon" in its place.
- `WEB_APP_ENABLED` decides whether pages link to **Rotli Web**, the app bundle
  served from `/app/` on this origin. Fails closed: only the exact string
  `"true"` shows the download page's Rotli Web options, the navigation entry,
  and the footer link.
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
  repository (GitHub header/footer links and the build's one star-count
  request, "Explore the source", LICENSE,
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
  paints the app's Ocean Dark itself, with its stars, and grows out of the
  page (the owner's pick, 2026-10-08, from the patterns premium product pages
  use): with script it comes up the window as a rounded card set inside the
  day page, widens to the full width with square corners over 0.7 of a window
  as it arrives, and narrows back into a card as it leaves. `passageGrow`
  sets `--grow` (0 to 1, eased in and out) and only the band's `clip-path`
  changes, so nothing reflows. While the band is full width under the header,
  the header with its navigation, dropdown, and Menu takes the Ocean Dark
  tokens (`:root[data-passage='ocean-dark'] .site-header-bar`, values from
  `src/styles/themes.css`), as do `color-scheme` there and the `theme-color`
  meta, in a 240 ms flip on its own registered tokens (the inks switch whole
  at 122 ms; `scripts/site-interactions.test.ts` measures every frame).
  Nothing else on the page changes colour. How it got here: from 2026-10-05
  the whole page crossfaded into the night, and each version left something
  wrong at the switch (a neighbour recoloured, or hidden and blank); a curtain
  lock followed, then this. Reduced motion, and no script, keep the band full
  width (feathered, without script). It is a passage, not a preference:
  nothing is stored. Lowest night pair:
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
- Rotli Web and Rotli Helper are one FAQ answer on the landing page (only
  while `WEB_APP_ENABLED`), linking the Helper guide and the "why Terminal"
  post; the install line lives in the guide and the post (`/download/` links
  the guide), and Rotli Web's own setup screen gives it.
- The hero is the promise (a private workspace for your notes), one way in
  ("Download free"), what it costs, the pointer to the privacy promise, and
  the product film right under them
  (`FilmPlayer.astro`, see "Films" below), on `public/hero-pattern.svg`
  (the social card's faint note, folder, checklist, and chat icons, masked so
  they fade out behind the headline). The words land in one short CSS
  entrance and the clay line (`.inked`, `public/ink-underline.svg`)
  draws itself under "the filing." Besides the film, the landing page shows
  captures in one place: the theme studio. `public/rotli-app-warm-light@3x.png` (the social
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
- **`/features/` is a catalog** (the owner, 2026-10-05: "more like a
  catalog, and you click on it to see more details"). `src/features.ts` is
  its one source: every capability with its area, one sentence, status,
  where it runs, icon, and its page's contents. The catalog, each
  `/features/<id>/` page, the Markdown twin `/features/index.md`, and the
  Features lines in `/llms.txt` all read `visibleFeatures()`, so they cannot
  disagree, and the build's llms.txt guard proves every link. The page keeps
  its headline (the link card in `src/og.ts` restates it) and a one-line
  legend (Beta and Coming soon explained), with a picture beside it
  (`FeaturesScene.astro`, the owner, 2026-10-06: "put some imagery at the top
  of features page"): the `ai_chat` quokka at a drawn desk among three
  windows in the panel language below, a note with its tasks and a chat
  answering from it (drawn in HTML from the synthetic launch vault, so their
  words stay legible at any size) and the real `public/shots/board.webp`
  board. It is sized in container units so it scales as one picture, sits
  beside the headline from 960px and under it below that, drops the board
  on a phone, and is `aria-hidden` (the headline says it in words); no
  script, no motion, no inline style. Under it the tiles
  (`components/features/FeatureTile.astro`) sit in six areas, Writing,
  Organizing, AI and chat, Files, Privacy and control, and Rotli Web and
  agents, each headed by its quokka (the app's filled art, `areaArt.ts`). A
  tile is one link with a bare stroke icon in the ink, level with the name's
  first line (no square around it), the name, one sentence, and one plain
  availability line; a hairline above it, never a box, and hover only
  underlines the name (the owner, 2026-10-06: "remove cards around all of the
  icons and the dot by shipped"). The availability line is
  `availabilityOf()` in `src/features.ts`, one function over the entry's
  status and `runs`: Shipped "Available on Mac and Web" / "Available on Mac"
  / "Available on Web", Beta "Beta on Mac", Coming soon "Coming soon to Mac",
  In development just that. Platforms join as "Mac, Windows and Web" (no
  serial comma) in a fixed order; Web is named only while `WEB_APP_ENABLED`,
  and Windows and Linux never, since no rotli app runs there yet. The tile,
  the page, the Markdown twin, and `llms.txt` all say it the same way. With script, a search box and area chips
  (toggle buttons, `aria-pressed`) filter in place by toggling `hidden`, the
  count is announced, an emptied area steps out, nothing matching says so
  with "Show every feature", and the filter lives in the address
  (`?area=ai&q=chat`) so Back from a feature returns to it. Without script
  the tools stay hidden and the areas are jump links over the complete list.
  Three columns, two under 1080px, one on a phone; nothing animates.
  A feature's page (`FeatureDetail.astro`) has a breadcrumb back to the
  catalog and its area, the name and its availability line beside the
  area's quokka, a picture (`FeatureArt.astro`: a `public/shots/` or
  `public/themes/` capture at no more than its logical size, or a drawing in
  one panel language (a surface, a hairline, a file name on top): tasks, a
  link and its preview, the Librarian's
  filing, the note menu, the vault folder, a document, a workbook, the AI
  tools' terminal lines from `src/ai/connectorGuides.ts`), then What it
  does, How to use it (keys and commands as written), Limits, Read more, the
  sections it took in, and the rest of its area as compact tiles.
  **The list was condensed on 2026-10-06** (the owner: "condense the list, I
  feel some things can be combined"), from 32 entries to 20 with Rotli Web
  (19 without, plus four dev-only): Markdown took in tables, code, and math
  and Mermaid diagrams; Search took in links; Templates took in slash
  commands; "Make it yours" took in themes and panes and keys; the Librarian
  took in Talk to the Librarian; "Your choice of AI" (`connected-ai`) took in
  AI on your Mac; Word and Excel files (`docs`) took in Excel workbooks;
  Boards and pictures took in pictures and files; One folder you own took in
  Bring the folder you have; "You decide what AI sees and changes"
  (`secure-notes`) took in What AI may change; Rotli Web took in Rotli Helper.
  Each one taken in is a `sections` entry on the surviving page (its words,
  picture, and keys), its old id the section's anchor; its basis quotes and
  limits moved with it, and a Mac-only part of an entry that is "both" says
  so in Limits. Themes' words lead "Make it yours", so it is `formerly`
  there. `movedFrom()` turns sections and `formerly` into the map of old
  addresses: `astro.config.mjs` writes a refresh page for each whose target
  this build has (`movedFeatures()`), and the Caddyfile's `fold*` matchers
  answer the same paths with a permanent redirect in production
  (`scripts/site-features.test.ts` holds the two against one list;
  `e2e/site/features-catalog.spec.ts` follows each redirect to its section).
  **Honesty** is a test, `scripts/site-features.test.ts`: a Shipped entry
  quotes README.md or a released CHANGELOG.md section (never Unreleased);
  Docs and Sheets take `DOCS_AND_SHEETS.status`; anything else names its
  ROADMAP.md "In the work" item, and only the next release's items (`/chart`,
  `/ai`, chat attachments) say Coming soon. "In development" entries show
  only on the dev site (`showsExperiments`); the public catalog ends on a
  link to `/roadmap/` instead. Rotli Web and the Helper appear only while
  `WEB_APP_ENABLED`, and `runs` names Rotli Web only where a release says the
  web has it; otherwise a feature reads "Available on Mac". There is no separate
  "features doc" in Resources: the catalog is the one home for what rotli
  can do. `e2e/site/features-catalog.spec.ts` holds the filters, deep links,
  keys, the no-script list, and the phone column.
- **Scenes from the film**, drawn in inline SVG on the film's palette (the
  `--sea*`, `--sand`, `--olive*`, `--limestone`, `--lake`,
  `--wood*`, and `--lantern` tokens in `Base.astro`) with the app's own
  character art. Each plays once when revealed (`[data-reveal]`) and rests;
  reduced motion shows it at rest. `SecureScene.astro` is the film's "secure
  stays home" night, in Ocean Dark under `public/night-stars-ocean.svg`
  through `.band-night` (the landing privacy band); `IslandScene.astro` is the island by
  day (a faint vignette behind Make it yours, and the framed scene opening
  the `/about/` story, captioned with where the name comes from); the FAQ has the searching
  quokka among question cards; the closing panel has the writing quokka.
  The footer's quokka beach, right below that panel, is the page's one
  closing scene. `/privacy/` opens on a drawn banner like a post's (see "The
  privacy head"); `/about/` places its scene through
  the `scene` slot and uses the centered layout (`center`).
- The landing privacy band is brief and points to `/privacy/#promise`: the
  promise and three facts on the left, the night scene on the right.
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
  preview: home, Features, Privacy, Resources, Blog, each
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
  palette-compresses the PNGs (about 35 KB each).
- **Post thumbnails** (`public/thumbs/blog/<slug>.webp` and `<slug>-600.webp`,
  about 10 to 35 KB each) and **banners** (`public/banners/blog/<slug>.webp`,
  2400 × 1000, with `-1200.webp` and the 1300 × 900 phone crop
  `-mobile.webp`, about 20 to 45 KB each, published posts only) come from the
  same run and the same definition as the post's card: `POST_ART` in
  `src/og.ts` gives each post a quokka pose and a scene
  (`scripts/brand-images/scenes.mjs`: the island by day with the post's
  subject around the quokka). Each
  scene is art-directed twice: `thumb` puts the main prop on the left third,
  the quokka on the right third, and the second prop up the beach; `wide`
  gathers them right of centre and keeps the lower left open for the
  banner's panel. The quokka is the app's canonical line art filled at its own
  resolution (`scripts/brand-images/quokka.mjs`), with what it holds painted
  like the props (`POSE_PAINT`: seeded regions; a seed off its region fails
  the run), and every prop line is the quokka's own weight at the size it is
  drawn (`ART_LINE`), so nothing reads heavier or lighter than the
  character. Colours are read from `Base.astro`'s tokens (the sky is
  `--surface-2`, the ink `--ink`), never restated. The thumbnail is the whole
  scene with no words; the link card stands the same pose beside the scene's
  first prop under the post's title.
  Every post gets one, coming-soon posts included, and titles are read from
  frontmatter when the run renders, never stored with the art, so a retitled
  post needs only a re-run. `postThumbnail(slug)` hands pages the image, its
  `srcset`, size, and alt text (describing the scene), or nothing until it is
  rendered; a new post without a `POST_ART` entry gets the writing quokka on
  the plain beach. The same run writes the
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
  refuses (403) a post whose `Origin`, or `Referer` without one, names
  another site, so no other page can sign someone up in their name, refuses
  (413) a body past 4 KB as it is read (a missing or understated
  `Content-Length` changes nothing), limits each visitor to 5 tries per 10
  minutes (keyed on `CF-Connecting-IP`, then `X-Real-IP`; 120 per 10 minutes
  overall), then calls Resend's
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
  Unsubscribing is Resend's own Broadcast link, or the one-click Unsubscribe
  button mail apps draw from the List-Unsubscribe headers Resend adds to every
  Broadcast. Double opt-in is not built: it needs a verified sending domain
  and a confirmation email (an owner decision).
- Unsubscribing erases (the owner, 2026-10-07). Resend keeps an unsubscribed
  contact, marked; the sidecar's sweep (`server/unsubscribed.ts`) deletes
  every unsubscribed contact in the segment a minute after start and then
  daily (`GET /contacts?segment_id=…`, then `DELETE /contacts/{id}`, spaced
  to stay under Resend's rate limit; resend.com/docs, checked 2026-10-07).
  It logs counts only, never an address. Contacts are global in Resend, so a
  deleted address is gone from every segment, and a later signup starts
  fresh. It runs whenever the list is on; there is no separate switch.
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
4. Optional, to get an email for each signup: set `SUBSCRIBE_ALERT_TO` to
   your inbox and `SUBSCRIBE_ALERT_FROM` to a sender on a verified domain,
   then redeploy. The sidecar's start line says `alerts on`. Each new
   address (or one rejoining after leaving the segment) sends one email with
   the address; a repeat signup sends nothing, and a failed alert never fails
   the signup.
5. To send an update: Resend → Broadcasts → Create, choose the segment, write
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
| `SUBSCRIBE_ALERT_TO` | Optional. The address that gets an email each time someone newly joins the list (the owner's inbox). Set only here, never in the repo. Unset or not an address: no alerts. |
| `SUBSCRIBE_ALERT_FROM` | Optional, needed with `SUBSCRIBE_ALERT_TO`. The sender, on a domain verified in the same Resend account, e.g. `rotli <alerts@your-verified-domain>`. |
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
It shows the three public sections and leaves the rest of the file (known
bugs, web parity, platforms, later) in the repository. Each item carries a
stable id (`<!-- id: … -->` after its title; the convention is at the top of
ROADMAP.md), and votes attach to ids, so a retitle keeps its votes. The build
fails on a missing or repeated id, and `astro.config.mjs`
(`rotli-roadmap-guard`) fails it if the built page's `data-roadmap-item`s and
the file disagree. `/roadmap/index.md` is its Markdown twin, linked from
`llms.txt`.

The page (`src/pages/roadmap/[...slug].astro`, its parts in
`src/components/roadmap/`), top to bottom:

- **Head** (`RoadmapHead.astro`), laid out like a blog post's: from 1000px the
  words on the left (Resources /, the title, a lede on what the roadmap is and
  how to take part, "Direction, not a promise · No dates", the voting state,
  See what's in the work and Ask for something, and "Roadmap source" to
  ROADMAP.md on GitHub while the source is public) and the picture on the
  right; narrower, the words first. The picture (`RoadmapScene.astro`) is
  drawn in SVG at a cover's 1300 × 900 with the site's tokens and the quokka's
  own art (`searching`): a map whose route runs through a done, a current, and
  an open stop, and a signpost pointing three ways. Decorative, so
  `aria-hidden`; nothing is fetched.
- **On this page** (`RoadmapNav.astro`): a link per group with its item count.
  From 901px a column in a post's rail (the `.longform` tracks,
  `blog/article.css`), pinned under the header beside the groups, marking the
  group being read (`aria-current`, a bar and weight); narrower, a wrapping
  row of chips in the flow. The groups start on a post's column edge, one
  rail gap past it: section notes and summaries keep the reading measure,
  and the grids and lists run on to the page's right edge.
- **In the work**: each item under its drawing (`RoadmapMock.astro`, the
  item's one frame; the words sit on the page, never in a card around both;
  an id with no drawing yet gets a plain note, so a new In the work item
  should get one). Graph and Canvas (`canvas`) draws both halves: the graph,
  its hovered note lit and a secure note a hollow ring, beside a canvas's
  cards, lines, and group.
  **Planned** and **Ideas**: a calm list on hairlines. Every item shows its
  title, summary, status (In the work, Planned, Idea), size, and vote
  (`VoteButton.astro`).
- **Recently shipped** (`RecentlyShipped.astro`): the newest four releases in
  CHANGELOG.md (`src/releases.ts`), each with its version, date, and the bold
  leads of its first three items (Added, then Changed, then Fixed) word for
  word, linked to its heading on `/changelog/` (the anchor Astro gives
  `## [x.y.z] - date`). A missing release fails the build; nothing is written
  by hand.
- **Ask for something** (`RequestForm.astro`): title, description, and an
  optional email ("Not needed"), beside "What happens to a request", the
  privacy page's "This website" account in short (what's kept, the in-memory
  spam key, Railway, never published, how to delete), linked to
  `/privacy/#website`, and a consent line by the button.

States: votes are off until the probe answers `{ live: true }` (disabled
dashed pills, "Voting and requests open soon.", every form field disabled,
"Requests open soon."). Live, a vote is optimistic: pressed, counted, and
saved in localStorage at once, then the sidecar's count replaces the guess; a
refusal takes all three back and says why under the item (and to screen
readers). Voted shows a tick, "Voted", and the accent tint, never colour
alone. Ideas get "Roadmap order / Most votes" (ties keep the file's order;
the list moves only when asked). The form checks each field before sending
(focus on the first to fix, the message beside it, cleared as it's fixed),
waits with "Sending…", then gives way to a focused thank-you block with Send
another; a sidecar refusal marks the field it names. Without script the form
posts and lands on `#request-sent`, the same block.

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
  overall), a honeypot field, body size limits counted as the body is read,
  and a 403 for a vote or request posted from another site's page (its
  `Origin`, or `Referer` without one, names another host). The visitor key is an HMAC
  of the IP address and the UTC day under `ROADMAP_HASH_SALT`: never the raw
  address, never on disk, new every day.
- Off: without `ROADMAP_DB_PATH` (or if the file can't be opened, or
  ROADMAP.md can't be read) every route answers 503 `{ live: false }`; the
  page keeps its "Voting and requests open soon." line, the vote buttons stay
  disabled, and the form says requests open soon. CSP is unchanged
  (`connect-src 'self'`, `form-action 'self'`).
- Tests: `bun run test` (`server/roadmap.test.ts`, `server/roadmap-file.test.ts`),
  `scripts/site-releases.test.ts` (Recently shipped's parsing), and
  `e2e/site/roadmap.spec.ts` (the API stubbed with Playwright routes: the head,
  Recently shipped against CHANGELOG.md and its anchors, votes off and live,
  the form, the nav, and no sideways scroll from 320 to 2560 px).

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
  the story, so the hero plays the product film instead. The files stay
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
