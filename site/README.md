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
  | `coming-soon` | production · `rotli.co`       | holding page + 404       | no        | yes     |
  | `dev`         | live dev site · `dev.rotli.co`| landing + `/mcp/` + 404  | no        | no      |
  | `full`        | launch (default for local dev)| landing + 404            | yes       | yes     |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change — see "Going live" below. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
- `WEB_APP_ENABLED` decides whether pages link to **Rotli Web**, the app bundle
  served from `/app/` on this origin. Fails closed: only the exact string
  `"true"` shows the hero action, the navigation entry, and the footer link.
  The bundle is built by the `app` stage of `site/Dockerfile` (repository
  root, `ROTLI_WEB_BASE=/app/ ROTLI_PLATFORM=web bun run build`) and served
  by the `handle /app/*` block in `site/Caddyfile` under its own headers
  (`connect-src 'none'`, inline styles allowed for the editors, `noindex`).
  Design and phases: `docs/design/web-version-and-shell-batch-2026-09-16.md`.
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
  regardless of OS appearance or previously saved site preferences. Only the
  hero uses Paper tokens on a plain solid ground (no photographic backdrop).
  The theme showcase changes its own screenshot and caption; it never recolors
  the site. Keep tokens aligned with `src/brand/`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark comes from `src/assets/characters/`. The privacy quokka in
  `src/assets/characters/cocoa/` is generated at 1536 × 1536 from the canonical
  SVGs with the existing fill pipeline (`bun scripts/build-character-fills.mjs
  --site`); app-sized 512px exports stay unchanged.
- The companion carousel reads `src/assets/characters/showcase/` (renders +
  `showcase.json`), produced by `bun scripts/build-companion-showcase.ts`. That
  script composites body preset, accessory, line color, and pose with the same
  placement rules as `src/components/character.tsx`, so every slide is a
  combination a person can pick in Settings → Companion. Edit `COMBOS` there
  and re-run; never hand-draw a variant the app cannot produce.
- `src/components/SiteHeader.astro` and `SiteFooter.astro` are the only header
  and footer; their shared styles live in
  `src/layouts/Base.astro`. Pages own only their sections.
- The hero and theme studio use lossless 3840 × 2400 browser-demo captures
  (1280 × 800 logical viewport at 3× density), never a live vault. The Playground
  uses a 4320 × 2700 capture in Rotli Light. The `@3x.png` filenames replace the
  old 1× URLs so cached blurry images cannot persist. Do not upscale screenshots.
- The hero uses a plain Paper ground with no photographic backdrop. Product
  captures remain fully opaque and sharp. The old coastline blend and grain
  overlay are not loaded.
- The coming-soon page keeps the same Rotli Light foundation and shows the real
  Playground capture. The introduction begins with the coming-soon label. Its
  one call to action is "Follow development on GitHub" when the source is
  public, "Watch the film" when the film exists, and otherwise nothing. Mobile
  uses one column; the product preview sits beside the copy from 960px.
  It does not expose downloads or the full landing page's navigation.
- `/mcp/` is the connection guide for local stdio clients (Claude Code, Codex,
  Cursor), the workspace policy, and disposable verification. Since 2026-09-11
  the whole guide, the landing page's agent section, and their navigation
  render only on the dev site under the experiment label: MCP and agent
  integrations left production until refined. The remote route (Grok Bot, the
  relay, self-hosting) sits inside that same dev-only guide. Do not publish a hosted relay URL there until that
  deployment has been verified.
- `public/social-card.svg` is the editable source for the link preview; run
  `bun run build:social-card` from the repository root to render it with the
  bundled fonts, the inlined waving quokka, and no external requests. The
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

The Docker build context is the **repository root**, because the pages import
the canonical mark and companion art from `src/assets/characters/`. The
service therefore has no root directory; it points at the Dockerfile with a
variable. Automatic deployments follow `dev` and `main`, respectively; an
explicitly authorized CLI upload can deploy a reviewed local snapshot. The
environments use these variables and domains:

| Railway project `rotli-site`, service `site` | production                   | dev                          |
| -------------------------------------------- | ---------------------------- | ---------------------------- |
| `RAILWAY_DOCKERFILE_PATH`                    | `site/Dockerfile`            | `site/Dockerfile`            |
| `SITE_MODE`                                  | `coming-soon`                | `dev`                        |
| `SITE_URL`                                   | `https://rotli.co`           | `https://dev.rotli.co`       |
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
3. Check `https://rotli.co/` renders the landing (hero film, Download for
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

## Launch films

Two media slots share `public/media/`:

| Slot | Role | When it renders |
| --- | --- | --- |
| Full film | Landing hero (right column); holding page `#film` | `rotli-promo.mp4` + poster + captions exist |
| Teaser | Landing hero fallback only | Full cut missing, and `rotli-teaser.mp4` + poster exist |

The landing hero prefers the full promo and autoplays it muted with a sound
toggle. The same clip is not stacked again below the hero. `PromoFilm.astro`
still owns the click-to-play film block on the holding page.

Players on the holding page are click-to-play with native controls:
`preload="none"`, `playsinline`, a poster, optional captions, and fallback text.
The hero clip autoplays muted with an explicit sound toggle (no third-party
player, no cookie). Reduced-motion visitors keep the poster until they start
playback. A slot renders only when its required artifacts exist at build time.

Theme studio previews twelve environments from `public/themes/` (six families ×
light/dark). Fresh captures live beside the family + Light/Dark controls; the
Organize section tells the Librarian story: work in a view while filing stays
underneath.

| Artifact | Path | Teaser | Full |
| --- | --- | --- | --- |
| H.264 MP4, 1920 × 1080 | `public/media/rotli-teaser.mp4` / `rotli-promo.mp4` | required | required |
| Poster JPEG | `…-poster.jpg` | required | required |
| WebVTT captions | `….vtt` | optional | required |

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

The full/dev landing page includes `PlaygroundStory.astro` and the reviewed
`public/rotli-playground@3x.png` capture from a fresh synthetic browser fixture whose Main holds only the seeded Welcome folder.
With the app browser twin running at localhost:1430, regenerate site media
from the repository root:

```sh
bun scripts/capture-site.mjs http://localhost:1430
bun scripts/build-character-fills.mjs --site
```

The capture script uses fresh browser contexts and actual theme, Settings,
and Playground controls. It waits for fonts, hides hover tooltips, verifies
pixel dimensions, and checks that the tutorial has no files in Main.

[Launch readiness](../docs/architecture/launch-readiness-2026-09-07.md) records
current promotion gates; [marketing](../marketing/README.md) owns the reusable
Remotion films. Keep download availability and feature claims tied to verified
release capabilities. These source changes do not deploy the site.
