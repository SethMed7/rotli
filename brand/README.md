# brand/ — provenance & history

This folder is the **brand provenance archive** and the rendered brand images
(`assets/`, below), not the live kit.

- **`engine-history/`** — the raw output of the brand engine that produced rotli's
  identity: `BRANDS/` (brief + source board + wordmark fonts) and `RUNS/` (dated
  design runs, gates, decisions, and rejected drafts). Historical record only —
  nothing here is imported by the app.

The **live, app-embedded brand kit** — the single source of truth that rotli imports
and that `bun run check:hex` enforces — lives at **`../src/brand/`**
(brand.json, kit.json, tokens/, logo/, icons/, tiles/, fonts/, board.html, LICENSES.md).

Migrated in from smLab on 2026-07-06. Edit the kit at `src/brand/`; leave this
archive as-is.

## assets/ — images for profiles and channels

Rendered, never hand-edited: `bun run build:brand-images` (repository root)
writes them from the SVG templates in `scripts/brand-images/`, using the site's
bundled fonts, the quokka line art in `src/assets/characters/` filled with the
app's Cocoa body, and the story film's island palette. The same run renders the
site's per-page link cards (`site/README.md`) and a contact sheet at
`_review/brand-images/contact-sheet.png`. Every text block is checked against
its safe area, the quokka, and 4.5:1 contrast before anything is written.

| File | Size | Use |
| --- | --- | --- |
| `banners/x-header-1500x500.png` | 1500×500 | X profile header. Text stays above the avatar's corner (bottom left). |
| `banners/linkedin-banner-1128x191.png` | 1128×191 | LinkedIn company page. Text starts right of the logo's overlap. |
| `banners/github-social-preview-1280x640.png` | 1280×640 | GitHub Settings → Social preview (uploaded by hand). |
| `banners/youtube-channel-art-2560x1440.png` | 2560×1440 | YouTube banner. Wordmark, headline, and quokka sit inside the 1546×423 safe area every device shows; the bay, clouds, and lighthouse fill the TV area. |
| `pfp/rotli-pfp-{rotli,ocean,grove,midnight}.png` | 1024×1024 | Profile pictures: the face mark on the Rotli, Ocean, Grove, and Midnight grounds, safe for a circular crop. |
| `thumbnails/template.png` | 1280×720 | The blog/YouTube thumbnail with its title slot. |
| `thumbnails/<post slug>.png` | 1280×720 | One per published post, from its frontmatter title. |

A new thumbnail: `bun run build:brand-images --thumbnail "Your title" --pose notes
--out brand/assets/thumbnails/<name>.png` (poses are listed in `site/src/og.ts`).
