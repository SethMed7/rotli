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
  change (`SITE_MODE=full`), not a code change. `dev` additionally sets
  `site.showsExperiments`, the switch that renders descriptions of features
  under review. App enforcement is separate: Breve and Mermaid visual editing
  are disabled in stable builds; conventional file adapters remain available
  pending fidelity review. Site labels do not enforce app access.
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
  hero uses Paper. The theme showcase changes its own screenshot and caption;
  it never recolors the site. Keep tokens aligned with `src/brand/`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark comes from `src/assets/characters/`. Site companion art in
  `src/assets/characters/cocoa/` is generated at 1536 × 1536 from those canonical
  SVGs with the existing fill pipeline; app-sized 512px exports stay unchanged.
- `src/components/SiteHeader.astro` and `SiteFooter.astro` are the only header
  and footer; their shared styles live in
  `src/layouts/Base.astro`. Pages own only their sections.
- The hero and theme studio use lossless 3840 × 2400 browser-demo captures
  (1280 × 800 logical viewport at 3× density), never a live vault. The Playground
  uses a 4320 × 2700 capture in Rotli Light. The `@3x.png` filenames replace the
  old 1× URLs so cached blurry images cannot persist. Do not upscale screenshots.
- The Paper hero blends the original user-provided coastline at 10% opacity.
  This decorative image appears only in the landing hero; product captures
  remain fully opaque and sharp. The old grain overlay is not loaded.
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
- `public/social-card.svg` is the editable source for the rendered Open Graph
  image; run `bun run build:social-card` from the repository root to
  render it with the bundled fonts and no external requests. The result is
  `public/social-card.png`; keep its copy and palette aligned with the
  current hero before rendering a new PNG.

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

## Launch film

`src/components/PromoFilm.astro` places the film directly below the landing
hero (before the proof strip) and after the holding page's introduction. It is
click-to-play with the browser's native controls: `preload="none"`,
`playsinline`, a poster, a captions track, and fallback text. There is no
autoplay, no third-party player, and no cookie. The section renders only when
the real artifacts exist at build time, so a build never ships an empty player
over a black frame; the hero and final calls to action switch to "Watch the
film" in the same build. The site references exactly these paths:

| Artifact | Path | Required |
| --- | --- | --- |
| H.264 MP4, 1920 × 1080 | `public/media/rotli-promo.mp4` | yes |
| Poster JPEG | `public/media/rotli-promo-poster.jpg` | yes |
| WebVTT captions | `public/media/rotli-promo.vtt` | yes |

All three files must be nonempty. Copy the reviewed exports from the film project into `public/media/` and
rebuild. The captions track is not switched on by default because the film
carries its own on-screen captions; viewers enable it from the native
controls. `Caddyfile` serves `/media/*` same-origin (`media-src 'self'`), with a
day-long cache and explicit `video/mp4` and `text/vtt` content types, because
the Caddy image has no MIME table for those extensions and `nosniff` would
otherwise make browsers refuse the captions track. Do not commit zero-byte
placeholders; the section must stay absent until the real film is ready.

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
