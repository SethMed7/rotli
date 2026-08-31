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

- The canonical production origin is `https://rotli.app` in
  `astro.config.mjs`; the sitemap and canonical metadata derive from it.
- The download button deliberately opens the newest published release page.
  Do not construct a DMG URL from the app package version: a version bump can
  merge before its signed asset is published.
- Site tokens in `src/layouts/Base.astro` map the app's six theme families and
  twelve tuned environments into the marketing surface. Keep their semantics
  aligned with the source tokens in the repository root's `src/brand/`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- The compact mark and companion art are imported from the canonical assets in
  the repository root so the site does not create a second character system.
- The product illustration is privacy-safe HTML/CSS rather than a screenshot
  of a live vault. Keep it synchronized with the current workspace grammar.
- `/mcp/` is the public connection guide for stdio clients, Grok Bot, the
  remote safety boundary, disposable verification, and relay self-hosting. Do
  not publish a hosted relay URL there until that deployment has been verified.
- `public/social-card.svg` is the editable source for the rendered Open Graph
  image at `public/social-card.png`.

## Cloudflare Workers deployment

The production site is an Astro static build served by **Workers Static
Assets**. It has no Worker script, SSR, Cloudflare Astro adapter, Pages project,
or container. [`wrangler.jsonc`](wrangler.jsonc) owns the asset directory,
custom domain, preview URLs, and 404 behavior. [`public/_headers`](public/_headers)
owns cache and browser-security headers and is copied into `dist/` by Astro.

Workers Builds settings are dashboard configuration, not Wrangler runtime
variables. Connect `SethMed7/rotli` to a Worker with these exact settings:

| Setting                       | Value                    |
| ----------------------------- | ------------------------ |
| Worker name                   | `rotli-site`             |
| Production branch             | `main`                   |
| Root directory                | `site`                   |
| Build command                 | `bun run build`          |
| Deploy command                | `bun run deploy`         |
| Non-production deploy command | `bun run deploy:preview` |
| Non-production branch builds  | Enabled                  |
| Build variable                | `BUN_VERSION=1.4.0`      |

The Worker name must match `wrangler.jsonc`. Production uploads go to the
`rotli.app` Custom Domain; other branches upload versions with public preview
URLs instead of promoting them. Put preview URLs behind Cloudflare Access if
they should not be public.

For local validation:

```sh
cd site
bun ci
bun run check
bun run build
bun run deploy:dry-run
```

The download CTA points to GitHub's latest published release page, so deploying
the site after a version bump cannot advertise an unpublished DMG.
