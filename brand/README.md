# brand/ — provenance & history

This folder is the **brand provenance archive**, not the live kit.

- **`engine-history/`** — the raw output of the brand engine that produced rotli's
  identity: `BRANDS/` (brief + source board + wordmark fonts) and `RUNS/` (dated
  design runs, gates, decisions, and rejected drafts). Historical record only —
  nothing here is imported by the app.

The **live, app-embedded brand kit** — the single source of truth that rotli imports
and that `bun run check:hex` enforces — lives at **`../src/brand/`**
(brand.json, kit.json, tokens/, logo/, icons/, tiles/, fonts/, board.html, LICENSES.md).

Migrated in from smLab on 2026-07-06. Edit the kit at `src/brand/`; leave this
archive as-is.
