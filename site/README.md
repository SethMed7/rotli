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
  | `dev`         | live dev site · `dev.rotli.co`| full site + drafts + `/resources/mcp/` | no | no |
  | `full`        | production · `rotli.co`       | landing, Resources, Blog, About, 404 | yes | yes |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change — see "Going live" below. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
- **Structure and navigation.** `src/nav.ts` is the one navigation policy.
  The header links real pages, never landing anchors: Features · Privacy ·
  Resources · About, plus Blog once a post is published (an empty index is
  never linked). On the right sit the GitHub mark (icon only, while the source
  is public) and one Download button, which opens `/download/`. Download is
  not also a menu item. The footer's link columns (Product · Learn · Open
  source, the last only while the source is public) and tagline default from
  the same file. Pages pass only `current`. The header stays pinned on a solid
  ground (flat: no blur, no shadow); `[id]` targets carry a matching
  `scroll-margin-top`. Below 1080px the pages fold into a Menu disclosure
  (`<details>`; Escape, an outside click, or choosing a link closes it); below
  560px the GitHub mark and Download move into it too. The footer's closing
  row holds the maker line and the two directory badges.
- **The landing page** (`src/components/Landing.astro`) only composes its
  chapters from `src/components/landing/`, bookended like the studio's story
  film: Hero (the story film itself) → Overview (Write. Keep. Ask.: three
  steps with the app's quokkas, then links to the episodes and `/features/`;
  the dev-only Experiments follow) → PrivacyBrief (the night scene, three
  facts, and a link to `/privacy/`) → Everywhere (Rotli Web, only while
  `WEB_APP_ENABLED`) → Personal (themes + companion, with a faint island
  vignette) → Faq → FinalCta (the film's sunset). The landing page carries
  exactly one video. **`/features/`** opens with "Rotli in 30 seconds"
  (`EpisodeShelf.astro`: the eight episodes in one player) and then composes
  the chapters in full (Features with every smaller habit, Folder, Personal)
  under its own page head. Each chapter owns its
  markup, scoped styles, and script. `Base.astro` owns the tokens, the shared
  section grammar (`.wrap`, `.section`, `.section-title`, `.section-lede`,
  `.band-warm`, `.band-deep`, the spacing and type steps), and the one
  scroll-reveal script. Nothing on the page moves on a timer: the theme studio
  and companion change only when a visitor picks a swatch or steps the
  carousel, and scroll reveals fire once and rest. Two-column rows share a
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
  and lede line up with the header's brand, a full-width rule divides the head
  from the body, and long pages pass `toc` for a sticky "On this page" column
  (resource articles build it from their `##` headings). Resource articles end
  with "More resources". Index lists (`WritingList.astro`) are plain entries
  in columns with a hairline above each, never boxes.
- **Writing.** Resources (evergreen, question-titled) and blog posts are
  Markdown in one content collection, `src/content/writing/{resources,posts}/`
  (schema: `src/content.config.ts`). `src/writing.ts` decides what a build
  publishes: nothing in `coming-soon`; `draft: true` and `experiment: true`
  entries only on the dev site. Routes: `/resources/`, `/resources/<file>/`,
  `/blog/`, `/blog/<file>/`, and `/about/` (which holds the name story and
  links the `the-creation-of-rotli` post once it is published). Markdown code
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
- The companion carousel reads `src/assets/characters/showcase/` (renders +
  `showcase.json`), produced by `bun scripts/build-companion-showcase.ts`. That
  script composites body preset, accessory, line color, and pose with the same
  placement rules as `src/components/character.tsx`, so every slide is a
  combination a person can pick in Settings → Companion. Edit `COMBOS` there
  and re-run; never hand-draw a variant the app cannot produce.
- `src/components/SiteHeader.astro` and `SiteFooter.astro` are the only header
  and footer; their shared styles live in
  `src/layouts/Base.astro`. Pages own only their sections.
- The ways-in chapter (Mac app, Rotli Web, Rotli Helper) is three plain
  columns with no screenshot.
- The hero is the promise, the two ways in, and the story film right under
  them (`FilmPlayer.astro`, see "Films" below), on `public/hero-pattern.svg`
  (the social card's faint note, folder, checklist, and chat icons, masked so
  they fade out behind the headline). The words land in one short CSS
  entrance and the film's clay line (`.inked`, `public/ink-underline.svg`)
  draws itself under "Files you keep." The landing page shows no capture;
  the theme studio does. `public/rotli-app-warm-light@3x.png` (the social
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
- **The features area** (`landing/Features.astro`, full on `/features/`,
  `compact` on the landing page) is organized as you meet the product:
  RenderShowcase (the same note rendered and as raw Markdown, then tasks,
  choices, diagrams, tables/code/math with their syntax) → ChatFlow (a real
  reply; the four steps: asks, keeps "Conversation notes" after every reply,
  writes notes and files on the Mac, you jump in or Lock it) → Formats
  (Documents on Univer, Sheets coming soon, Boards on Excalidraw, with status
  chips from `featurePolicy.ts`, and where Assets live) → the Librarian →
  ConnectAI (each provider's own CLI installed in Terminal; rotli never signs in,
  reads login files, or stores credentials; Rotli Helper runs the same tools for
  Rotli Web; the install lines mirror `src/ai/connectorGuides.ts`) → habits.
- **Scenes from the film**, drawn in inline SVG on the film's palette (the
  `--sunset-*`, `--sea*`, `--sand`, `--olive*`, `--limestone`, `--lake`,
  `--wood*`, and `--lantern` tokens in `Base.astro`) with the app's own
  character art. Each plays once when revealed (`[data-reveal]`) and rests;
  reduced motion shows it at rest. `SecureScene.astro` is the film's "secure
  stays home" night (the landing privacy band on `public/night-stars.svg`,
  and the night frame on `/privacy/`); `IslandScene.astro` is the island by
  day (a faint vignette behind Make it yours, and the framed scene opening
  `/about/`); the FAQ has the searching quokka among question cards; the
  closing invitation is the film's sunset in flat bands. `/privacy/` and
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
- `/resources/mcp/` (moved from `/mcp/` on 2026-09-18; the Caddyfile
  redirects the old path) is the connection guide for local stdio clients (Claude Code, Codex,
  Cursor), the workspace policy, and disposable verification. Since 2026-09-11
  the whole guide, the landing page's agent section, and their navigation
  render only on the dev site under the experiment label: MCP and agent
  integrations left production until refined. The remote route (Grok Bot, the
  relay, self-hosting) sits inside that same dev-only guide. Do not publish a hosted relay URL there until that
  deployment has been verified.
- `public/social-card.svg` is the editable source for the link preview: the
  wordmark, the hero line, a faint file-icon pattern that fades out behind
  the headline, the Warm Light app capture tilted in from the right, and the
  line-art quokka waving up from the bottom edge (a ground-colored silhouette
  from `src/assets/characters/masks/` keeps the pattern out of it). Run
  `bun run build:social-card` from the repository root to render it with the
  bundled fonts and every `href="asset:<repo path>"` raster inlined, with no
  external requests. The
  results are `public/social-card.png` (1200×630, what iMessage, Slack,
  LinkedIn, X, and Discord show for a rotli.co link) and
  `public/social-card-github.png` (1280×640, the 2:1 image GitHub wants for
  the repository's Settings → Social preview, which has no API and is uploaded
  by hand). Keep the copy and palette aligned with the current hero before
  rendering. `layouts/Base.astro` publishes the card with explicit
  `og:image:width/height/type` so scrapers render it on the first fetch, and
  ships PNG icons (`favicon-32.png`, `apple-touch-icon.png`, both exported from
  `src-tauri/icons/icon.png`) for the previews that cannot use the SVG favicon.
  LinkedIn and Facebook cache scrapes; re-scrape with their post inspectors
  after a deploy.

## Validate a build under production headers (the prod twin)

`astro dev` and `astro preview` send no security headers, so a page can look
right locally and break on rotli.co, where Caddy serves every response under
`style-src 'self'` (inline `style` attributes and `<style>` blocks are dropped
silently). Two guards and one rehearsal cover this:

- The Astro build fails if any generated page carries an inline style
  (`astro.config.mjs`, `rotli-csp-inline-style-guard`), and stylesheets are
  never inlined (`build.inlineStylesheets: 'never'`). This runs in `bun run
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
The footer's Launch Llama and Founder.best badges are the site's only
third-party images: `img-src` allows only `https://tools.launchllama.co` and
`https://www.founder.best` beyond same-origin and data images,
and `check:security` keeps literal remote `<img>` origins aligned with that
deployed policy so a local-preview success cannot become a blank production
badge.

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

### Going live (turning off the holding page)

The holding page is only the production `SITE_MODE=coming-soon` variable. To
launch:

1. Confirm the newest release on `RELEASES_URL` (the `rotli-releases` latest
   page) is the alpha you want people to download; the button links there.
2. In Railway → `rotli-site` → production service, set `SITE_MODE=full`
   (leave `SITE_URL=https://rotli.co`). Redeploy so the Docker build picks up
   the new build arg.
3. Check `https://rotli.co/` renders the landing (the hero film, Download for
   Mac), `/robots.txt` allows indexing, and `/sitemap-index.xml` exists.
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

The studio's films (`public/media/story/`, `src/films.ts`) come from the
motion room kept on the maintainer's Mac (`rotli-studio/motion/out/video`),
outside this repository, re-encoded for the web: H.264 with `-tune animation`,
`+faststart`, AAC 96 kbps (the story at CRF 28, about 5.7 MB; each episode at
CRF 30, about 2.5 to 3.5 MB). Posters and episode thumbnails are frames of the
films (WebP, via `cwebp`).

- **The story film** (`rotli-story.mp4`, 60 s) plays in the landing hero
  through `FilmPlayer.astro`: muted, once, as soon as it is on screen, then it
  rests on its last frame; it never loops. "Click for sound" restarts it from
  the top with sound and native controls; a pause button is there while it
  plays muted; it pauses when scrolled away. Under reduced motion, Save-Data,
  or without script it is a poster with native controls.
- **"Rotli in 30 seconds"** (`epNN-*.mp4`, eight episodes) lives in one player
  on `/features/` (`EpisodeShelf.astro`), `preload="none"`: nothing downloads
  until an episode is chosen, and choosing one plays it with sound. Without
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

It writes `public/rotli-app-warm-light@3x.png` (the hero and the social card)
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
