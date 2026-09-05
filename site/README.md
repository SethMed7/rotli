# Rotli — marketing site

A product-led landing page for Rotli, the local-first Mac workspace where one
ordinary folder remains the durable source of truth. The page explains the
workspace, editable file surfaces, privacy boundaries, theme families,
optional quokka companion, Breve routines, and local plus opt-in remote MCP integration.
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
  | `full`        | launch (default for local dev)| landing + `/mcp/` + 404  | yes       | yes     |

  An unknown value fails the build. Flipping production to launch is a variable
  change (`SITE_MODE=full`), not a code change.
- The download button, when enabled, deliberately opens the newest published
  release page. Do not construct a DMG URL from the app package version: a
  version bump can merge before its signed asset is published.
- Site tokens in `src/layouts/Base.astro` map the app's six theme families and
  twelve tuned environments into the marketing surface. Keep their semantics
  aligned with the source tokens in the repository root's `src/brand/`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark and companion art are imported from the canonical assets in
  the repository root (`src/assets/characters/`); the site keeps no copies.
- `src/components/SiteHeader.astro` and `SiteFooter.astro` are the only header
  and footer; their styles and the appearance toggle live in
  `src/layouts/Base.astro`. Pages own only their sections.
- The hero and theme studio use browser-demo captures from Rotli's seeded demo
  corpus, never a live vault. Refresh captures at 1280 × 800 through the app's
  browser twin, and keep each filename tied to the environment shown in it.
- `public/coastline.webp` is the optimized, user-provided hero photograph.
  `public/grain.png` is a deterministic raster texture used only as a subtle
  hero overlay; neither asset is fetched from a third party at runtime.
- `/mcp/` is the public connection guide for stdio clients, Grok Bot, the
  remote safety boundary, disposable verification, and relay self-hosting. Do
  not publish a hosted relay URL there until that deployment has been verified.
- `public/social-card.svg` is the editable source for the rendered Open Graph
  image at `public/social-card.png`; keep its copy and palette aligned with the
  current hero before rendering a new PNG.

## Railway deployment

The site is a static Astro build served by Caddy from a pinned two-stage
[`Dockerfile`](Dockerfile). [`Caddyfile`](Caddyfile) is the one home for the
browser-security and cache headers. There is no SSR, adapter, or Worker.

The Docker build context is the **repository root**, because the pages import
the canonical mark and companion art from `src/assets/characters/`. The
service therefore has no root directory; it points at the Dockerfile with a
variable. Both environments deploy the `main` branch and differ only in
variables and domain:

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

For local validation (`bun run verify` runs the check and both builds):

```sh
cd site
bun ci
bun run check
CI=true bun run build                          # full
CI=true SITE_MODE=coming-soon bun run build    # production holding page
docker build -f site/Dockerfile --build-arg SITE_MODE=dev -t rotli-site:dev ..  # from site/
```
