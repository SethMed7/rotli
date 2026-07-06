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
bun run build    # static output → site/dist/
bun run preview  # serve the built dist/ locally
```

## Notes for later

- **Download button** and repo links live in `src/pages/index.astro`.
  Search for `TODO(seth)` — set the real release URL (the notarized DMG on
  rotli-releases / the GitHub `releases/latest` asset) and confirm the public
  repo URL.
- Brand tokens in `src/layouts/Base.astro` mirror
  `src/brand/tokens/colors.json`.
- Fonts (General Sans body, Baloo 2 wordmark) are copied into
  `public/fonts/` from `src/brand/fonts/`.
- Hero screenshot is `public/rotli-warm-light.png`, copied from
  `docs/media/`.
