---
name: keep-docs-fresh
description: Keep Rotli's documentation, changelog, README, and README media in step with the code — find the owning contract, update it in the same change, and regenerate captures from the demo vault. Use when a change alters behavior a document describes, or when README images look out of date.
---

# Keep docs fresh

Every fact has one home. `docs/architecture/ai-context-architecture.md` owns the
surface-by-surface ownership map, and `docs/README.md` routes to each contract.
Call `carl_recall` with the topic to find the owning source before editing.

1. **Update the owner, not a copy.** Change the contract that owns the fact, in
   the same branch as the code. Public orientation (`README.md`, `PRODUCT.md`,
   `ROADMAP.md`) summarizes; it never restates a contract's rules.
2. **Record user-visible changes** under `## [Unreleased]` in `CHANGELOG.md`,
   written for a person using the app.
3. **New package scripts** need a row in `docs/development/testing.md`'s command
   map, or `bun run check:docs` fails.
4. **README media.** The README shows the current app from `docs/media/`:
   - the README's theme images are copies of the site's theme-studio captures
     in `site/public/themes/` (2×, from the in-memory demo vault). No script
     makes those; re-capture an environment from the browser twin by hand.
     `bun run capture:site` makes only the hero and Welcome captures;
   - copy them into `docs/media/` under the README's filenames;
   - look at every image before committing: current UI, demo content only.
   - `site/README.md` owns the capture and visual-review procedure.
5. **Check it:** `bun run check:docs`, then the full `bun run verify`.

Use present-tense, factual copy. Call features that are not in the stable build
"coming soon" rather than describing them as shipped.
