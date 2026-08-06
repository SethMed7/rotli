# rotli — marketing site

A single, calm landing page for **rotli** (the warm, local-first Mac menu-bar
notes app). Built with [Astro](https://astro.build). Styled in the rotli brand
palette (linen ground, clay accent), Ollama-minimal in spirit — generous
whitespace, one centered column, light + dark.

## This is a separate sub-project

It has **its own dependencies** and does **not** touch the app's root
`bun.lock` or `package.json`. Install and build from inside `site/` only.

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
- Brand tokens in `src/layouts/Base.astro` mirror
  `src/brand/tokens/colors.json`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- Hero screenshots are the four `public/rotli-app-*.png` files.
