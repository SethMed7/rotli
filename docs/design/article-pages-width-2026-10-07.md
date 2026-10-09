# rotli.co long-form pages: how width works, and one system for it

2026-10-07. An evaluation of the three long-form page types the owner sees as
one family: blog posts (`/blog/<slug>/`), `/privacy/`, and `/roadmap/`.
Sections 1 to 4 describe the layout as it was when measured; "Decision" at the
end records what the owner picked and what was built.

The trigger was the owner's screenshot of `/privacy/`: the heading and its lede
start at one left edge, the matrix "Who may read and change a note you wrote"
starts further left and runs wider, the bullet list's text starts at a third
edge, and the left rail sits far from the words with a large empty gutter.

## The finding in one sentence

At 1024px the article already looks like a left-aligned column beside the rail
(a 44px gap); at 1440px the same column is centred in the room right of the
rail, which adds 113.5px of empty space on each side of it, so the gap grows to
153.5px, and the matrix, which breaks out symmetrically into that space, starts
80px left of the words.

## 1. How width is set today

### The page box, header, and footer

- `--page-max: 76rem` (`site/src/layouts/Base.astro:117`), `--gutter:
  clamp(1.25rem, 4vw, 2.5rem)` (`:431`). `.wrap` is `width: min(100% - 2 *
  var(--gutter), var(--page-max))`, centred (`:440-443`).
- The header and footer use the same expression (`.site-header, .site-footer`,
  `:531-535`), so every page's chrome is one 1216px box from a 1296px window
  up. Every long-form page's `<main>` is a `.wrap` too, so the page box, the
  header, and the footer always share their edges (measured: identical at every
  width below).
- `--copy-max: 68ch` (`Base.astro:118`) exists but only the feature pages use it
  (`FeatureDetail.astro:237`). The long-form pages have their own measure.

### Blog posts and /privacy/: one component, `WritingPage` with `article`

Both pages render through `site/src/components/WritingPage.astro` with the
`article` prop; `/privacy/` (`site/src/pages/privacy/[...slug].astro`) passes its
night scene through the `cover` slot. So these two already share one layout
system, with one exception (the matrix, below).

- **The tracks** (`WritingPage.astro:486-500`). `.writing.is-article` is an
  inline-size container and defines:
  - `--prose-size: 1.125rem` (18px, at every width);
  - `--measure: calc(var(--prose-size) * 38.5)`: 693px, about 66 characters.
    The measure is in rem (a multiple of the type size), not `ch`;
  - `--col-left: clamp(10rem, 35.42cqi - 8.35rem, 16rem)`: the rail, 10rem at
    901px growing to 16rem from about 1180px;
  - `--col-gap: clamp(2rem, 4.53cqi - 0.35rem, 2.5rem)`: the rail's gap;
  - `--article-tracks`, from 901px: `[rail] var(--col-left) [gap]
    var(--col-gap) [main-start] 1fr [text-start] var(--measure) [text-end] 1fr
    [main-end]`. Below 901px the rail track goes and only the middle remains.
- **The body grid** (`:501-523`): `.writing-body.has-rail` uses those tracks; the
  rail sits in `rail`, the prose in `main` (the whole room right of the gap).
- **The reading column** (`site/src/components/blog/article.css:20-26`): `.prose`
  is a container (`article-prose`), and every child gets `max-width:
  var(--measure); margin-inline: auto`, so the column is centred in `main`.
  This centring is the source of the gutter.
- **The rail** (`site/src/components/blog/ArticleRail.astro:324-340`): fills its
  track (16rem at full width), sticky from 901px when it fits the window
  (`src/railPin.ts` otherwise). Below 901px it follows the article (Share only).
- **"More from rotli"** (`WritingPage.astro:525-531`): its own grid on the same
  tracks, placed on `text`.
- **The post head** (`site/src/components/blog/ArticleCover.astro:124-295`):
  below 1000px it uses `--article-tracks` (picture across, words from the
  rail's edge from 901px). From 1000px it switches to an unrelated grid,
  `minmax(0, 1.08fr) minmax(0, 1fr)` with `column-gap: clamp(2rem, 4.5vw,
  4rem)` (`:264-288`): words on the page's left edge, picture on its right
  edge. The title wraps at `max-width: 22em` (`:188`), the lede at the measure
  (`:197`).

### Breakouts: tables, figures, code, images

- `article.css:32-36`: inside `@container article-prose (min-width: 48.5rem)`,
  `.figure`, `table`, and `pre` get `max-width: min(100%, var(--measure) +
  10rem)`. With `margin-inline: auto` that is up to 5rem **each side**,
  symmetric about the column's centre. Below a 48.5rem middle (any window under
  about 1150px) they keep the measure.
- **Figures** (`site/src/figures.ts:231-233`) are `<figure class="figure">`
  holding an SVG at `width="100%"`, so a chart is exactly as wide as the
  breakout.
- **The privacy matrix** is a `<div class="promise-matrix">` around its table,
  so the `table` selector above does not reach it; the privacy page repeats the
  same breakout rule for it (`privacy/[...slug].astro:503-509`). Same policy,
  two homes.
- **Images**: Base's global `img, svg { max-width: 100% }`
  (`Base.astro:356-360`). No post uses a Markdown image today, so there is no
  image breakout rule; an image in a paragraph would keep the measure. The
  privacy page's companion `.spot` floats right and places itself by hand at
  the centred column's right edge, `margin-right: max(0px, (100% -
  var(--measure)) / 2)` (`privacy/[...slug].astro:513-519`), a rule that
  assumes centring.

### List indentation

- `article.css:61-64`: `ul, ol { padding-left: 1.3rem }`, markers outside. The
  list's box keeps the text's left edge; its text starts 20.8px in, with the
  bullet inside that indent.
- `WritingPage.astro:744-748` sets list margins too (the plain, non-article
  layer); `article.css` overrides them.

### Type and table styles: two or three layers

`WritingPage.astro:726-805` styles `.prose` for every subpage (1.06rem body,
h2 1.45rem, tables at 0.98rem). Under `.is-article`, `article.css` overrides it
(1.125rem body, h2 `clamp(1.5rem, 2.2vw, 1.75rem)`, tables at 1rem). On
`/privacy/` the matrix adds a third table style (0.95rem, its own caption,
header, and padding; `privacy/[...slug].astro:356-448`). Nothing is wrong to
the eye, but the article's look is the result of a cascade, not one rule.

### The roadmap: its own page, its own numbers

`site/src/pages/roadmap/[...slug].astro` does not use `WritingPage`. It is a
`.wrap` `<main>` with:

- **The head**, `site/src/components/roadmap/RoadmapHead.astro`: a copy of the
  post head's two-column grid (`:153-159`, the same `1.08fr / 1fr` and column
  gap) and its own `.crumbs` (`:69`), the third copy of the crumbs rules after
  `WritingPage.astro:369` and `ArticleCover.astro:132`.
- **The layout** (`:334-344`): two columns only from **1100px** (posts and
  privacy: 901px), the nav **11.5rem** wide (posts: 16rem), the gap
  `clamp(2.5rem, 4vw, 4rem)`, 57.6px at 1440 (posts: 40px). Between 901 and
  1099px the nav is a full-width block above the groups.
- **No measure.** The body runs to the page's right edge: the size key, the
  "In the work" grid, the Planned and Ideas lists, and Recently shipped are all
  974px wide at 1440. Section notes cap at `40rem` (`:378`), summaries at
  `46rem` (`:485`), neither of which is the posts' 43.3rem measure.
- **Headings**: section h2 at `--step-h3` (`:373`), smaller than a post's h2.
- The nav (`site/src/components/roadmap/RoadmapNav.astro:149-156`) is pinned
  from 1100px, under its own rules rather than `ArticleRail`'s.

## 2. Why it is this way

The rules were written on one day, 2026-10-06, in answer to a run of the
owner's requests. In order (commit, then what it answered):

1. `d86348b3` — posts open on a contained picture with a card, beside a
   reading rail modelled on claude.dev's left rail (the owner's reference).
2. `5fbc820a` — "room on the right for promotions and other posts": a third
   column; the reading column widened to 42rem and the rails slimmed.
3. `9cf1acbb` — "for blogs let's use more width": posts get their own wider page
   (96 to 104rem) with the header and footer following.
4. `4bb439c7` — the owner rejected that header: "only the blog's content
   widens". A header that grew on blog pages moved the logo and buttons about
   160px between pages. Header and footer return to the standard width on
   every page.
5. `d57e31a0` — "now the blog width is too much", and the side panels were
   cramped: posts at a fixed 88rem, type held at 18px everywhere, the rails
   take the room (16.5 to 19.5rem) "so sources and promos wrap on one or two
   lines instead of four or five". Figures break out at most 5rem a side.
6. `bd19c736` — "picture matches header width", "title beside the picture",
   and "remove the part on right and move blog content more right"; also
   "only show the top 4 sources then a load more if more". Posts return to the
   one 76rem page, the right rail goes ("More from rotli" closes the post
   instead), and the reading column is **centred in the room right of the
   rail**. This is the rule that makes the gutter.
7. `44da110b` — "Privacy page design should match blog styles": `/privacy/`
   moves onto `WritingPage`'s article layout, with options rather than copies.

The roadmap (CHANGELOG Unreleased, "rotli.co has a public roadmap you can vote
on") was built after, with "It opens like a blog post" as its brief; it copied
the post head but kept its own body grid.

The tension to name plainly: centring answered "move blog content more right"
when the page had just lost its right column. With three columns the text sat
between two rails; with the right rail gone, left-aligned text would have
hugged the left rail and left the right side empty, so centring moved it right.
At 1440 that overshoots: the "more right" is 113.5px of slack on each side of
the column, and the rail ends up 153.5px from the words. Any option below that
starts the column at the rail moves the text about 114px left of where it is
now, which partly reverses that request. That trade is the owner's to make.

`e2e/site/article-width.spec.ts` encodes the current geometry: it asserts equal
room left and right of the column (`leftRoom ≈ rightRoom`), 62 to 70
characters a line from 1180px, 18px type, the head on the header's edges, and
the rail at least 16rem from 1440. `e2e/site/privacy-promise.spec.ts` asserts the
matrix never crosses the rail.

## 3. Measured

Read with Playwright from a full build (`SITE_MODE=full`) at a 900px-tall
window: the left edge (x) and width of each box, in CSS pixels. 1440 stands for
every width from 1296 up, where the page reaches its 76rem cap and nothing
moves further. "Rail gap" is the space from the rail's right edge to the
words.

### /privacy/

| width | header / page | h1 (head) | rail | h2 = p | matrix | ul / li text | rail gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440 | 112 · 1216 | 112 · 598 | 112 · 256 | 521.5 · 693 | **441.5 · 853** | 521.5 / **542.3** | **153.5** |
| 1280 | 40 · 1200 | 40 · 593 | 40 · 256 | 441.5 · 693 | 361.5 · 853 | 441.5 / 462.3 | 145.5 |
| 1024 | 40 · 944 | 40 · 466 | 40 · 201 | 284.5 · 693 | 284.5 · 693 | 284.5 / 305.3 | 43.7 |
| 390 | 20 · 350 | 20 · 350 | stacked | 20 · 350 | 20 · 350 | 20 / 40.8 | — |

At 1440 the column has **four left edges** (112 the title and rail, 441.5 the
matrix, 521.5 the heading and words, 542.3 the list's text) and **three right
edges** (1214.5 the words, 1294.5 the matrix, 1328 the header and the head's
picture). None of the body's right edges is the page's. The first paragraph
reads 58 characters, not 66, because it is the promise's lede at `--step-lede`,
not body text.

### /blog/the-ai-you-already-pay-for/

| width | h1 (head) | rail | h2 = p | figure (chart) | ul / li text | chars | rail gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1440 | 112 · 598 | 112 · 256 | 521.5 · 693 | **441.5 · 853** | 521.5 / 542.3 | 66 | **153.5** |
| 1280 | 40 · 593 | 40 · 256 | 441.5 · 693 | 361.5 · 853 | 441.5 / 462.3 | 66 | 145.5 |
| 1024 | 40 · 466 | 40 · 201 | 284.5 · 693 | 284.5 · 693 | 284.5 / 305.3 | 66 | 43.7 |
| 390 | 20 · 350 | stacked | 20 · 350 | 20 · 350 | 20 / 40.8 | 33 | — |

Identical geometry to `/privacy/`: same component, same tracks. The post has no
`pre`, blockquote, or image; those would follow the same rules (`pre` breaks out
like a figure; an image keeps the measure).

### /roadmap/

| width | h1 (head) | nav | body (key, grid, lists) | section note | request form | nav gap |
| --- | --- | --- | --- | --- | --- | --- |
| 1440 | 112 · 598 | 112 · **184** | 353.6 · **974** | 353.6 · 640 | 353.6 · 528 | 57.6 |
| 1280 | 40 · 593 | 40 · 184 | 275.2 · 965 | 275.2 · 640 | 275.2 · 525 | 51.2 |
| 1024 | 40 · 466 | **40 · 944 (stacked above)** | 40 · 944 | 40 · 640 | 40 · 519 | — |
| 390 | 20 · 350 | stacked | 20 · 350 | 20 · 350 | 20 · 350 | — |

The roadmap is already left-aligned beside its nav (one left edge for the
body), but on different numbers from the articles: a 184px nav against a 256px
rail, a 57.6px gap against 40px, a 1100px breakpoint against 901px, and no
measure (the size key line runs 114 characters).

### Where the three pages diverge

| | posts | /privacy/ | /roadmap/ |
| --- | --- | --- | --- |
| layout | `WritingPage` article | `WritingPage` article | own page |
| rail / nav width | 16rem | 16rem | 11.5rem |
| rail gap | 2.5rem | 2.5rem | 2.5 to 4rem |
| two columns from | 901px | 901px | 1100px |
| column | measure, centred | measure, centred | no measure, left |
| breakout | symmetric, +10rem | symmetric, +10rem (its own copy) | none (all wide) |
| head | `ArticleCover` | `ArticleCover` (`cover` slot) | `RoadmapHead` (copy) |
| h2 | 1.5 to 1.75rem | 1.5 to 1.75rem | 1.3 to 1.55rem |
| table style | article.css | article.css + its own | none |

## 4. Options

Mocked by injecting CSS into the built pages at 1440 (nothing in the repo
changed); the measured edges under each are below.

### A. One left edge: the column starts at the rail (recommended)

Delete the centring: the `text` track starts where `main` does, so the words,
headings, tables, and figures all share one left edge, a fixed gap from the
rail. Wide blocks break out **to the right only**. Lists hang their markers into
the gap from 901px, so a list's text is on the same edge (below 901px the page
gutter is too narrow to hang into, so lists keep their 1.3rem indent there).

Two choices inside A, for where a wide block ends:

- **A1, the page's right edge.** Tables and figures span from the text edge to
  the header's right edge, the same edge as the head's picture above. One
  stated edge on each side: text-start and page-end. Measured at 1440: words
  408 to 1101, matrix and chart 408 to 1328, list text 408, rail gap 40.
- **A2, the measure plus 10rem.** Today's cap, now one-sided: wide blocks end at
  1261, 67px short of the page edge, an edge nothing else uses.

What A costs: the words move about 114px left of today at 1440 (see "Why",
point 6); right of the words is 227px of open ground at 1440, which is where
wide blocks go. At 1024 nothing visibly changes (the slack there is 6.6px).
The roadmap fits A without a new idea: its nav becomes the article rail (16rem,
from 901px, the same gap), its groups and grids are "wide", its notes and
summaries keep the measure.

### B. Keep the centred column, remove the breakout

Every block keeps the measure: one left edge (521.5 at 1440), one width, and
hanging list markers. Least change to the current look. The rail gap stays
153.5px, which is half of the complaint, and the privacy matrix gets 693px
instead of 853px, so its cells wrap to three lines.

### C. Leave it

Listed for completeness: four left edges and three right edges in one column,
as measured.

### Rejected without mocking

- Centring the rail and the column together as a group: the rail would leave
  the header's and the title's left edge, which `4bb439c7` and `bd19c736` set.
- Larger type (20px) to fill the room: `d57e31a0` held type at 18px everywhere
  because the growth only took room from the rails.

## 5. The shared system, whichever is picked

Wherever it lands, the three pages should read one set of tokens and one
stylesheet, defined once:

- `--measure` (the reading column), `--wide` (the breakout's end), `--rail`,
  `--rail-gap`, and one breakpoint (901px) for rail beside versus rail folded;
- one breakout rule that names its blocks (`table`, `.figure`, `pre`, and a
  `.wide` class the privacy matrix and the roadmap's grids can opt into), in
  place of the privacy page's copy;
- one list rule (hang from 901px, indent below);
- one article type layer: `article.css` alone, with `WritingPage`'s plain
  `.prose` rules no longer underneath it on article pages;
- one head component for posts, privacy, and the roadmap (`ArticleCover`
  taking the roadmap's extras through a slot), and one crumbs rule;
- the roadmap on `WritingPage`'s article layout, or at least on its tracks.

The specs that will change with A: `article-width.spec.ts`'s equal-room
assertion becomes "the column starts one rail gap past the rail, and every
block's left edge is the column's"; the character band, the 18px type, the head
on the header's edges, and the rail width stay as they are.

### The mock

The CSS injected for A1 (A2 swaps `100%` for `min(100%, var(--measure) +
10rem)`), applied with Playwright `addStyleTag` and `bypassCSP`:

```css
@media (min-width: 901px) {
  .writing.is-article {
    --article-tracks: [rail-start] var(--col-left) [rail-end] var(--col-gap)
      [main-start text-start] minmax(0, var(--measure)) [text-end] minmax(0, 1fr) [main-end];
  }
  .writing.is-article .prose > :is(ul, ol):not(.flow) { padding-left: 0; }
  .road-layout { grid-template-columns: 16rem minmax(0, 1fr); column-gap: 2.5rem; }
}
.writing.is-article .prose > :nth-child(n) { margin-inline: 0 auto; }
@container article-prose (min-width: 48.5rem) {
  .writing.is-article .prose > :is(.figure, table, pre, .promise-matrix) { max-width: 100%; }
}
.writing.is-article .prose > .spot { margin-right: max(0px, 100% - var(--measure)); }
```

## Decision

The owner, 2026-10-07, picked all three recommendations: **A1** (the column
starts at the rail; wide blocks run on to the page's right edge) with
**hanging bullets** from 901px. Built the same day:

- `.longform` in `site/src/components/blog/article.css` holds the tokens and
  tracks once: `--measure`, `--col-left`, `--col-gap`, and
  `--article-tracks`, now `[rail] [gap] [main-start text-start] measure
  [text-end] 1fr [main-end]` (below 901px, the same without the rail).
  `WritingPage` adds `longform` to an article's `<main>`; `/roadmap/` adds
  it to its own and imports the stylesheet.
- Every prose block keeps the measure with `margin-inline: 0`; `.figure`,
  `table`, `pre`, and `.wide` take `max-width: 100%` behind the same 48.5rem
  container query. The privacy matrix is `.wide`; its own breakout rule is
  gone, and its companion float's margin is `100% − measure`.
- Top-level lists drop their padding from 901px, so the markers hang in the
  rail's gap. **Superseded the same day:** the owner saw the bullets sit left
  of the column's line ("not having a proper left line that everything
  respects"). Markers are now drawn on the line itself, the words one step
  in, at every width; nothing sits in the gap.
- The roadmap's nav sits in the rail track from 901px (it was 11.5rem from
  1100px), its groups in `main`; section notes and summaries keep the measure.
- Below 901px the "On this page" disclosure spans the page, on the picture's
  edges, rather than ending 13px short of it on the column.

Measured after, at 1440: the rail 112 to 368 on all three pages; every
heading, paragraph, list's words, table, chart, and roadmap group from 408;
words to 1101; wide blocks to 1328, the header's right edge. (After the
lists change: bullets at 408, their words at 428.) At 1024 wide
blocks keep the measure (277.9 to 970.9). `e2e/site/article-width.spec.ts`
now asserts one left edge one rail gap past the rail, the list's words on it,
figures ending on the header's edge when they break out, and the three pages
sharing the rail and the edge at 901, 1024, 1180, 1440, and 1920.

Left for later (section 5): one head component for the roadmap, one crumbs
rule, the roadmap's h2 scale, and folding `WritingPage`'s plain `.prose`
layer out from under article pages.

## 2026-10-09: the banner across the top

The owner, pointing at deno.com/blog: "I like this style one thing straight
across top like an image/banner then the rest under instead of text left
illustration right."

- Posts, `/privacy/`, and `/roadmap/` open on their picture as a band straight
  across the window under the header (`blog/ArticleBanner.astro`; the roadmap's
  `RoadmapScene.astro` with `banner`), rendered before the page's centred
  wrapper so it is the window's width without a negative margin (which would
  scroll sideways wherever scrollbars take room). `clamp(13rem, 36vw, 34rem)`
  tall, square-cornered, a hairline under it; the crop comes off the sky so the
  quokka stays whole. At 700px and under, the phone crop at its own shape.
- The words go under it on the reading column (the `text` track), so the title
  starts where the article's words start, at 408 at 1440 like every block
  below; the left rail's room stays empty beside the head. The hairline under
  the head spans the column, not the page.
- This replaces the 2026-10-06 head (title beside the picture from 1000px,
  stacked below it). The roadmap's drawing is drawn on past its viewBox (sky,
  a cloud each side, sea, dunes, sand) so any band width reads as one shore.
