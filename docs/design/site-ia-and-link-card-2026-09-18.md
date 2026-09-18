# rotli.co: link card, web + download, the name, site structure (2026-09-18)

Owner review of the site on 2026-09-18. Four asks, one plan. The site contract
stays `site/README.md`; this records the decisions and their order.

## Decisions

1. **Link card.** One line ("Room to think. Files you keep." — it tracks the
   hero), the wordmark, a real app capture tilted in from the right, and the
   quokka peeking up from the bottom edge. Nothing else. Variants were
   mocked side by side before one replaces `site/public/social-card.svg`.
2. **Download + web, side by side.** Every page's header carries
   `Open in browser` and `Download`. Today Download fetches the Mac DMG
   directly; one knob in `site/src/site.ts` (`DOWNLOAD_HREF`) decides where
   every download button goes, so a future `/download/` page (Mac, Windows,
   Linux) is a one-line switch. Visitors not on a Mac see the browser action
   first and "Mac only for now" on the download. `WEB_APP_ENABLED` goes on
   dev first, then production, after the `#web` copy matches 1.1.0 (real
   folders in Chromium browsers, chat through Rotli Helper).
3. **The name.** rotli is short for Rottnest, the island where quokkas live:
   the workspace is the island, you are the quokka. Quokkas look like they
   cannot stop smiling; the workspace should feel that good. Lives on
   `/about/`; the landing's companion section links to it.
4. **Structure.** Header: `Product · Resources · Blog · About` + the two
   actions; a disclosure menu below 1080px. One nav definition
   (`site/src/nav.ts`). Articles and posts are Markdown in one content
   collection (`site/src/content/writing/`, `section: resource | post`,
   `draft`, `experiment`). Resources is an index of question-titled
   articles; the MCP guide moves to `/resources/mcp/` (still dev-only,
   `/mcp/` redirects). Blog posts are dated; drafts render only on the dev
   site. About stays short and links to the "creation of rotli" post.

## Wording guard

The agent/MCP pitch is "your rotli folder becomes the memory your agents
read and write" — never "rotli is your database" (AGENTS.md: the metadata
layer is not a content store or database; files are the truth).

## Order

1. Download + web actions, the `#web` copy, the knob on dev.
2. Link card (after the owner picks a variant).
3. Nav, mobile menu, Resources, Blog, About, the name, the MCP move.
