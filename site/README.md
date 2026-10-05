# Rotli — marketing site

A product-led landing page for Rotli, the local-first Mac workspace where one
ordinary folder remains the durable source of truth. The launch page explains
the Markdown workspace (tasks, links, views), the Playground, optional local or
connected chat, the privacy boundary, theme families, the optional quokka
companion, and local stdio MCP. Features under review (Breve, DOCX and
sheets, boards, Mermaid visual editing, remote agents) appear
only on the dev site under an explicit experiment label.
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

## Production details

- The canonical origin comes from `SITE_URL` (default `https://rotli.co`) in
  `src/site.ts`; the sitemap, robots.txt, and canonical metadata derive from it.
- `SITE_MODE` decides what a build contains (one policy, `src/site.ts`):

  | Mode          | Deployment                    | Pages                    | Downloads | Indexed |
  | ------------- | ----------------------------- | ------------------------ | --------- | ------- |
  | `coming-soon` | holding page                  | holding page + 404       | no        | yes     |
  | `dev`         | live dev site · `dev.rotli.co`| full site + drafts + the full developer reference | no | no |
  | `full`        | production · `rotli.co`       | landing, Features, Privacy, Resources (Guides, Blog, Developers, Changelog), About, 404 | yes | yes |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change — see "Going live" below. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
- **Structure and navigation.** `src/nav.ts` is the one navigation policy.
  The header links real pages, never landing anchors: Features · Privacy ·
  Resources · About. Resources is a dropdown of four pages, each with a
  one-line description: Guides (`/resources/`), Blog (`/blog/`, listed only
  once a post can be read, so an index of nothing but "coming soon" is never
  linked), Developers (`/resources/developers/`, marked "Coming soon" outside
  the dev site), and Changelog (`/changelog/`). The dropdown is a disclosure:
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
  ready." sign-up (see "The coming-soon list" below); its closing row holds
  the maker line and the Launch Llama badge; the quokka scenery runs along its
  bottom edge.
- **The landing page** (`src/components/Landing.astro`) only composes its
  chapters from `src/components/landing/`: Hero (the product film) → Overview (Write. Keep. Ask.: three
  steps with the app's quokkas, then links to the episodes and `/features/`)
  → TwoKinds ("You write for yourself. AI reads differently.": a plain
  HTML mock of one note as typed and as the Librarian files it) → StatBand
  (two sourced figures, footnoted; keep the sources and "never wasted"
  wording) → the dev-only Experiments → PrivacyBrief (the night scene in Ocean
  Dark via `.band-night` in `Base.astro`, three facts, and a link to
  `/privacy/`) → Everywhere (Rotli Web and how Rotli Helper connects it, with
  the copyable install line; only while `WEB_APP_ENABLED`) → Personal (the
  theme studio, with a faint island vignette) → Faq → FinalCta (the closing call; the footer's quokka beach ends the
  page). The landing page carries exactly one video. **`/features/`** has
  one display headline, with "Rotli in 30 seconds" (`EpisodeShelf.astro`: the
  eight episodes in one player, under a quiet heading; two columns of episodes
  below the player on narrow screens) right under it, then the chapters in
  full (Features with every smaller habit, Folder, Personal). Every chapter
  opens with the same section head (one h2 at `--step-h2` and a lede), and the
  chapters alternate plain and warm grounds. The landing page's dev-only
  Experiments chapter is not repeated there. On narrow screens the theme
  studio is a carousel (previous/next and a swipe on the capture).
  Each chapter owns its
  markup, scoped styles, and script. `Base.astro` owns the tokens, the shared
  section grammar (`.wrap`, `.section`, `.section-title`, `.section-lede`,
  `.band-warm`, `.band-deep`, the spacing and type steps), and the one
  scroll-reveal script. Nothing on the page moves on a timer: the theme studio
  changes only when a visitor picks a swatch or steps the
  carousel, and scroll reveals fire once and rest. The one sanctioned
  exception (the owner's call, 2026-10-02) is the quokka scenery under the
  footer, described below: it lives in its own band, below every word, and
  stands still under reduced motion. Two-column rows share a
  top edge so each heading starts level with its picture.
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
  `##` headings). Resource articles end with "More guides". Index lists
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
  blocks are not syntax-highlighted: Shiki writes inline `style=` attributes,
  which the production CSP drops. Keep article images local.
- **`/download/`** is where the header's Download button goes. It leads with
  the visitor's own system (`Base.astro` stamps `data-os`: mac, windows,
  linux, mobile, or other): the Mac download on a Mac; on Windows and Linux,
  "coming soon" with Rotli Web to use in the meantime and Rotli Helper for
  browsers without folder access. Without script the Mac panel shows. Below,
  "Every platform" lists Mac, Windows, Linux, and any browser with their
  status. The hero's Download for Mac still fetches the DMG directly
  (`DOWNLOAD_HREF`). The Helper guide is `/resources/rotli-helper/`; the 404
  page's `/helper` hint links there.
- **The 404 page** (`src/pages/404.astro`) has no header or footer: "This
  note wandered off." in the middle of the window, one "Take me home" button
  with a quiet line of other ways in, and the footer's quokka scenery along
  the bottom edge. The missing path and a hint (`/app`, `/helper`) are chosen
  in the browser.
- **The quokka scenery** (`src/components/QuokkaScene.astro`, under every
  footer, the 404, and `/subscribed/`) is a strip of Rottnest by day in the
  film's palette (sea, the far lighthouse, scrub on the dunes, sand) with a
  pile of leaves, four quokkas (three below 760px), and one that now and then
  strolls along the dunes behind them, pausing to look at the pointer. The
  quokkas are the app's canonical `base.svg` line art, rigged rather than
  redrawn: `src/quokka/art.ts` thins the traced outline at build time and
  takes its outer ring as the body fill (`--cocoa`, the app's Cocoa body);
  `src/quokka/rig.ts` holds the pivots; overlays (eyes, brows, mouths, the
  reaching arm, the leaves) use the art's own 14-unit ink. `src/quokka/scene.ts`
  (one external module, about 7 KB) makes the head tilt and the eyes follow the
  pointer, a paw reach for a pointer that comes close, brows go cross when the
  pointer nears the leaves, faces fall when it is on them, and everyone cheers
  when it leaves; they blink, hop, and nibble now and then, and a tap pokes
  one. It runs one `requestAnimationFrame` loop only while the scene is on
  screen and the tab is visible, uses pointer events only, and writes SVG
  `transform` attributes and one CSSOM transform (never an inline `style`
  attribute, which the CSP would drop). Under reduced motion, or without
  script, nothing runs and the scene stands at rest. The band is decorative
  (`aria-hidden`), has a fixed height (no layout shift), clips its own
  content, and holds no text, so nothing can overlap a word or a link.
- **The motion studio** lives at `studio.rotli.co` (`STUDIO_URL` in
  `src/site.ts`): the footer's Learn column links it whatever the source flag, and the Caddyfile
  sends `/studio` there.
- **Download and the browser.** `SiteActions.astro` renders the two ways in —
  Open in browser and Download — in the hero and the closing invitation (the
  header has only its Download button to `/download/`). `DOWNLOAD_HREF` in
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
  regardless of OS appearance or previously saved site preferences. The
  theme showcase changes its own screenshot and caption; it never recolors
  the site. The site is flat like the app (DESIGN.md "Flat material"): no
  shadows, blur, or glows. The one deliberate exception is the theme studio's
  orb swatches (the owner's call, 2026-09-23):
  each orb is lit with radial gradients and an inset shadow so it reads as the
  environment itself. Keep tokens aligned with `src/brand/`.
  Every text/background pair measures at least WCAG AA (lowest: muted text on
  the warm band, 4.90:1).
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark comes from `src/assets/characters/`. The closing card's
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
- The ways-in chapter (Mac app, Rotli Web, Rotli Helper) is three plain
  columns with no screenshot.
- The hero is the promise, the two ways in, and the product film right under
  them (`FilmPlayer.astro`, see "Films" below), on `public/hero-pattern.svg`
  (the social card's faint note, folder, checklist, and chat icons, masked so
  they fade out behind the headline). The words land in one short CSS
  entrance and the clay line (`.inked`, `public/ink-underline.svg`)
  draws itself under "Files you keep." Apart from the film, the landing page
  shows no capture; the theme studio does. `public/rotli-app-warm-light@3x.png` (the social
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
  - `chat` and `lock-menu`: frames of the Mac launch shoot's raw takes
    (`_review/promo-v5/rec/R5d.mov` at 130.8 s, `R4.mov` at 73.6 s; synthetic
    Notebook vault), cropped with the cursor painted out.
  Re-capture rather than hand-edit them. `--capture-ground` in `Base.astro` is
  the editor paper those captures sit on.
- **The features area** (`landing/Features.astro`, on `/features/` under the
  episode player) is organized as you meet the product:
  RenderShowcase (the same note rendered and as raw Markdown, then tasks,
  choices, diagrams, tables/code/math with their syntax) → ChatFlow (a real
  reply; the four steps: asks, keeps "Conversation notes" after every reply,
  writes notes and files on the Mac, you jump in or Lock it) → Formats
  (Documents on Univer, Sheets coming soon, Boards on Excalidraw, with status
  chips from `featurePolicy.ts`, and where Assets live) → the Librarian and
  the smaller habits → ConnectAI (each provider's own CLI installed in
  Terminal; rotli never signs in, reads login files, or stores credentials;
  Rotli Helper runs the same tools for Rotli Web; the install lines mirror
  `src/ai/connectorGuides.ts`).
- **Scenes from the film**, drawn in inline SVG on the film's palette (the
  `--sea*`, `--sand`, `--olive*`, `--limestone`, `--lake`,
  `--wood*`, and `--lantern` tokens in `Base.astro`) with the app's own
  character art. Each plays once when revealed (`[data-reveal]`) and rests;
  reduced motion shows it at rest. `SecureScene.astro` is the film's "secure
  stays home" night, in Ocean Dark under `public/night-stars-ocean.svg`
  through `.band-night` (the landing privacy band and the night frame on
  `/privacy/`); `IslandScene.astro` is the island by
  day (a faint vignette behind Make it yours, and the framed scene opening
  the `/about/` story, captioned with where the name comes from); the FAQ has the searching quokka among question cards. The
  closing invitation has no scene of its own (2026-10-02): the footer's
  quokka beach right below it is the page's one closing scene. `/privacy/` and
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
segment. The static site cannot hold an API key, so the image runs one more
process: a small Bun sidecar (`server/subscribe.ts`, one file, no
dependencies) on `127.0.0.1:8787`. Caddy proxies `/api/*` to it under the
site's own headers (`Cache-Control: no-store`); `entrypoint.sh` starts it in a
retry loop and then execs Caddy, so Caddy is PID 1 and the sidecar fails soft:
if it is down, `/api/*` answers 503, the footer hides its form, and every page
keeps serving.

- `GET /api/subscribe` → `{ "live": true | false }`. The footer hides the form
  unless it reads `live: true` (so it is also hidden under `astro dev` and
  `astro preview`, which have no sidecar).
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
- Tests: `bun run test` (Resend mocked; part of `bun run verify` and CI).

Set these as **runtime** service variables in Railway (never build args; the
Dockerfile does not declare them, so no secret lands in an image layer):

| Variable            | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `RESEND_API_KEY`    | A Resend API key with full access (contacts need it; a sending-only key is refused). Unset: the list is off. |
| `RESEND_SEGMENT_ID` | The segment new contacts join (Resend → Audience → Segments; the old Audiences API is deprecated). Unset: the list is off. |
| `SUBSCRIBE_PORT`    | Optional. The sidecar's loopback port, read by both Caddy and the sidecar (default `8787`). |

To rehearse it in the prod twin, pass the variables to `docker run`
(`-e RESEND_API_KEY=… -e RESEND_SEGMENT_ID=…`); with a test key, use a test
segment.

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
- **"Rotli in 30 seconds"** (`epNN-*.mp4`, eight episodes) lives in one player
  on `/features/` (`EpisodeShelf.astro`), `preload="none"`: no film downloads
  until an episode is played (the poster and thumbnails do), and choosing one
  plays it with sound. Without
  script each episode is a plain link to its file.

The earlier launch film still lives in `public/media/` for the holding page:
`PromoFilm.astro` renders it there when `rotli-promo.mp4`, its poster, and its
captions all exist (click-to-play with native controls, `preload="none"`, no
autoplay). Its opening card still reads "Mac beta in preparation" and needs a
new cut before the holding page is used again.

The theme studio previews twelve environments from `public/themes/` (six
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
script makes only the closing card's celebrating quokka. The capture script
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
