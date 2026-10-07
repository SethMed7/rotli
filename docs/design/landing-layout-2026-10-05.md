# Landing layout — 2026-10-05

The owner's note: "some parts are messy in the landing page." This is the audit
of the built landing (`SITE_MODE=full WEB_APP_ENABLED=true`, at 1440, 768 and
390) and the order it moves to. Three patterns come from the owner's reference
screenshots of another product's site. rotli takes the patterns, not that
site's look:

1. Three cards, each a small live-looking UI panel over a heading and one
   sentence.
2. An accordion list beside a large preview of the open item.
3. A framed closing banner with a two-tone headline, one line, one button, and
   art coming in from one side.

## What the page is today

| # | Section | Ground | Says | Height 1440 / 390 |
|---|---|---|---|---|
| 1 | Hero + product film | plain | Write like a person. Let AI do the filing. Free, no account, plain Markdown, Docs and Sheets (beta), chat, boards; AI optional | 1300 / 940 |
| 2 | Overview (Write. Keep. Ask.) | plain | "Write it down. rotli puts it away." Three quokkas, three sentences, nine bullet facts, "See every feature" | 930 / 1630 |
| 3 | TwoKinds | warm | The same file as typed and as filed | 1140 / 1400 |
| 4 | StatBand | plain | Half of ChatGPT payers idle; 4 tools; rotli gives that AI work | 940 / 1070 |
| 5 | Experiments (dev only) | plain | Labelled experiments | — |
| 6 | PrivacyBrief | night | Secure and locked notes; no tracking; files on your computer | 930 / 1070 |
| 7 | Everywhere | plain | "On your computer. In your browser." Desktop app, Rotli Web, Rotli Helper, the install line | 970 / 1560 |
| 8 | Personal | warm | Theme studio | 1170 / 630 |
| 9 | FAQ | plain | Eight questions | 860 / 1160 |
| — | Footer | plain | Sign-up, links, quokka beach | — |

## Where it repeats

- **"No account"** is said in the hero lede, the hero meta, the privacy lede,
  the Everywhere lede, the footer tagline, and the FAQ.
- **"A folder you choose"** is in the hero, the Overview lede, the Keep step,
  a privacy fact, the Everywhere lede and both its columns, and the FAQ.
- **"A model on your Mac or the AI tools you already pay for"** is in the
  hero, the Ask step, the StatBand close, and two FAQ answers.
- **The Librarian never rewrites** is in a Keep bullet, the TwoKinds lede, and
  the TwoKinds caption.
- **Secure and Lock** are two Ask bullets and then the whole privacy band.
- **The Overview restates the hero.** Its lede lists Docs, Sheets, chat and
  boards a second time, and its nine bullets are a features page squeezed into
  three columns. The bullets are what make it read as clutter.
- **Everywhere restates the hero's two ways in.** Its "Desktop app" column is
  the hero's Download button in prose. Only the Rotli Web and Helper detail
  is new, and that is a deeper feature, not a chapter of its own. At 390 it is
  the tallest section on the page (1560px).

## Where the rhythm breaks

- **Three plain grounds in a row at the top.** The hero, the film and the
  Overview sit on one ground, so the first chapter boundary doesn't show.
  After that the grounds alternate by accident: Overview and StatBand are
  plain, then night, then Everywhere is plain again.
- **Section heads differ.** Most chapters use a head (headline and lede) over
  the content. TwoKinds' lede runs four sentences. StatBand has a headline
  with no lede. Everywhere's lede repeats the hero.
- **No close.** The FAQ runs straight into the footer. The closing invitation
  was cut on 2026-10-05 because it repeated the hero. A close that doesn't
  repeat the hero is still missing.
- **Nothing shows the product between the film and the theme studio.** The
  Overview is quokkas and bullets. The only product pictures (render, chat,
  board) are on `/features/`.

## Proposed order

| # | Section | Ground | Change |
|---|---|---|---|
| 1 | Hero + film | plain | Kept as decided |
| 2 | What rotli does: three cards | warm | **New** (ref 1). Replaces the Overview trio and its nine bullets. Each card has a small HTML mock (a rendered note, a frontmatter panel the Librarian filled, a chat answer naming its notes), a heading and one sentence. The three quokkas stay, one in each mock's corner |
| 3 | StatBand | plain | Moved up. It explains why the Librarian exists: the AI you already pay for is idle, and rotli gives it the filing |
| 4 | TwoKinds | warm | Moved down one, so it follows the StatBand's "keep your notes in order" with the proof. Lede cut to the head grammar; the caption keeps "exactly what you typed" |
| 5 | A closer look: list + preview | plain | **New** (ref 2; scroll-stepped since the owner's evening review, below). Six items: Notes and Markdown, Docs and Sheets (Beta), Chat with your notes, Boards, the Librarian, and Rotli Web and the Helper. It ends with the one link to `/features/` |
| — | Experiments | plain | Dev only, unchanged, after the tour |
| 6 | Personal (theme studio) | warm | Kept; moved above privacy so the grounds alternate |
| 7 | PrivacyBrief | night | Kept as decided. It now sits just before the FAQ, which answers the trust questions it raises |
| 8 | FAQ | plain | Kept |
| 9 | Closing banner | plain, framed | **New** (ref 3). A two-tone headline, one line, Download (plus Open in your browser while `WEB_APP_ENABLED`), and the writing quokka coming in from the right |
| — | Footer beach | — | Kept |

Grounds then alternate without a break: plain, warm, plain, warm, plain,
warm, night, plain, then the framed banner on plain.

### Everywhere folds into the tour

"On your computer. In your browser." becomes the tour's last item, "Rotli Web
and the Helper". Its preview keeps everything only that section said:
- which browsers open the folder themselves;
- why Firefox, Zen and Brave need the Helper;
- the copyable install line, the Windows guide, and the "why Terminal" post.

The Desktop app column goes, because the hero's Download button says it. The
lede goes too, because the hero says it. Like the section before it, the item
renders only while `WEB_APP_ENABLED`.

### The tour follows the scroll, and never autoplays

The page already has three things that move on their own, each an owner call:
the theme studio, the footer quokkas, and the 404 game after Play. A fourth
would compete with the theme studio two sections later, so the tour never
changes on a timer.

Revised the same evening, from the owner's review ("make this work with the
scroll. I also don't like the cards in cards or the animations"): the tour is
scroll-driven. This overrides the standing no-scroll-scrub preference for
this one section, and it still doesn't scrub. On wide, tall-enough windows
the list and the preview are pinned under the header while a runway of
per-part anchors scrolls behind them. The part whose anchor crosses the middle
of the window is shown, and the preview changes by a calm crossfade between
steps (an instant swap under reduced motion). Nothing moves between steps,
the page scrolls natively, and a part's name scrolls to its step. The rules
are in `site/src/tourSteps.ts`. Phones, short windows, and no script get a
plain sequence of parts, each with its preview under its words. The
accordion, its chevrons, and the framed preview well are gone. Each preview
now sits on the ground: a capture with one hairline, or a drawn panel where a
capture isn't honest or readable at that size (Docs and Sheets, the chat
answer, the Librarian's filing).

### The before and after plays once

Also from that review ("more motion and alive like it actually happens and
maybe shrink a little bit"): when the comparison comes into view the note is
typed, the same words appear on the right, and the Librarian's lines open
above them one by one like a live diff. It ends with the words marked
unchanged. It plays once, holds off screen, and has a quiet Replay. Its
markup is the finished state. It is a reveal that rests, not a fourth thing
that moves on its own. Its type and width shrank so the whole comparison
fits a 1440×900 window. The cards above lost their outer well in the same
round, so each picture is one panel on the band.

### The Librarian appears three times, from three sides

- The Keep card shows *what* it adds: a frontmatter panel with an area pill.
- TwoKinds shows *that your words stay*: the same file before and after.
- The tour item shows *where notes go*: filed into Library areas.

Each one shows a different side of the same feature, so none of them
repeats another's point.

## Closing banner headline

Drafts, in the plain register the owner asked for:

1. **Start with one note.** / *It stays in your folder.*
2. **Your notes, in your folder.** / *Start writing today.* (the owner's
   example of the register)
3. **Write it down now.** / *rotli files it while you work.*

Pick: **1**. It is a first step anyone can take, and the second line is the
product's one promise. Option 3 leans on the hero's "Let AI do the filing", and
option 2 is the owner's own example rather than a line for this page. The
short line under it: "Free, with no account to make."

## Revised 2026-10-06: why before what

The owner's next note, verbatim:

> "I want two things in hero 1. something to point to our privacy promise
> 2. Download free. … Also work on the transition from the hero to below the
> fold I feel it can be a bit smoother. Also this section - The AI you
> already pay for is mostly waiting. - should go before "Write it down. rotli
> puts it away." in my opinion and we could change the text to be more
> numbers backed. Then play with the image to actually use company logos and
> to make sure that this would work on mobile."

### The order now

| # | Section | Ground | Change |
|---|---|---|---|
| 1 | Hero + film | plain | "Download free" (to `/download/`), "No account. Works offline.", and a pointer with a lock to the privacy promise (`/privacy/#promise`) |
| 2 | StatBand | warm | **Moved up from 3.** The reason comes before the product: four sourced figures, then rotli's one sentence. It takes the warm ground |
| 3 | What rotli does: three cards | plain | Moved down one; now on plain so the grounds still alternate |
| 4 | TwoKinds | warm | Unchanged |
| 5 | A closer look | plain | Unchanged |
| — | Experiments | plain | Dev only |
| 6 | Personal | warm | Unchanged |
| 7 | PrivacyBrief | night | Its button reads "Read our privacy promise" and opens `/privacy/#promise` |
| 8 | FAQ | plain | Unchanged |
| 9 | Closing banner | plain, framed | Its button follows the hero's: "Download free" |

Grounds still alternate from the top: plain, warm, plain, warm, plain, warm,
night, plain, then the framed banner.

### The hand-off from the hero

What made it abrupt at 1440: the hero's icon tile was cut by the hero's edge,
the film's frame ended on an empty strip of plain ground, the warm band then
began on a hard line, and the film itself was scroll-linked (half faded and
offset on arrival, settling only as the visitor scrolled).

The film now sits across the boundary. Behind its lower half the page ground
eases into the StatBand's warm ground (one gradient between the two ground
tokens, so the privacy passage recolours it like any band), and the band's top
padding shrinks to 0.85 of a section, so the film's lower edge and the band's
headline keep one section's rhythm. The icon tile fades out over the hero's
last fifth. The film rises in once, last in the arrival sequence, and rests;
nothing is tied to the scroll, and reduced motion shows the finished state.
Other options considered: a soft shadow under the film (rejected: no light
source, and the standards forbid unmotivated shadows), and keeping the strip
but matching spacing (rejected: the hard line stays).

### The figures

Four, from the two surveys the post `the-ai-you-already-pay-for` audits, each
with its population: 50.4% of people paying for ChatGPT hadn't used it in 30
days, and 59.9% of subscribers had a paid subscription of any kind unused each
month, 2.6 on average (Self Financial, March 2026); half of people who pay for
AI don't use it daily (our arithmetic on Menlo's 50%), and the average AI user
uses 3.0 general assistants, up from 2.2 (Menlo Ventures and Morning Consult,
July 2026). Bango stays out of the band: it is context in the post, not
evidence of idle plans. Footnotes are per source.

### The bench

The generic bots became the products' own marks on plain badges, each named:
ChatGPT, Claude, Gemini, and Perplexity (one of the ten tools in the Self
Financial survey). The marks are unmodified files with their sources in
`site/public/logos/SOURCES.md`. Below a 520px scene the badges take the whole
seat and the quokka steps down in front of the legs, so at 390 the marks are
32px or more and the names read at about 11.5px.

### The privacy promise

At the top of `/privacy/`, replacing "The short version", so it is the first
thing under the banner rather than a page of its own: a visitor arriving from
the hero lands on the promise and has the full policy right below it. It
restates the AI visibility matrix and the 2026-09-29 body-edit decision for a
visitor, and it is now the page's one access table.

## Revised 2026-10-06 (later): buttons, the header, and a shorter band

The owner, verbatim:

> "Our privacy policy should be more like a button matching the download and
> the top right button should align with button on hero for consistency then
> up top I want github with star count. then this part - The AI you already
> pay for is mostly waiting. - can be better laid out, a lot of dead space on
> top of the image in right and maybe have the blog thumbnail here and
> instead point to the blog for like a read more type thing to simplify
> things and keep it simple, those who want more will read the blog"

### The hero's two buttons

"Download free" (primary, to `/download/`) and "Our privacy promise"
(outlined, with the lock, to `/privacy/#promise`) sit side by side at one
height, radius, and type size: both are `.button`, the second passed into
`SiteActions`' slot. The one-line pointer is gone. "No account. Works
offline." stays as the quiet line under them: it is short, and it answers
the first question a download button raises. Below 520px the buttons stack
full width, the download first.

### One way in, said the same everywhere

The header's "Try now" becomes "Download free", the hero's button scaled to
the header. The earlier reason to differ (Windows and Linux visitors can't
download) is handled by `/download/`, which offers Rotli Web on those
systems. The label is `WAY_IN` in `site/src/site.ts`, read by the header,
the hero, the closing banner, and the Menu; a build without the Mac
download says "Try now" in all of them. The 404's "Try rotli" stays: it is a
plain link in a list, not a button.

### GitHub with its star count

Beside the button: the GitHub mark, "Star", and the count after a hairline,
an outlined button at the header button's height. The count is read once
while the site is built (`site/src/githubStars.ts`), so the visitor's browser
never calls GitHub, and any failure shows the button without a number. On a
phone the bar stays the brand and Menu: below 560px "Star rotli on GitHub"
with its count and "Download free" wait in Menu, as the actions did before.
Nothing in the bar overlaps from 320 to 1920 (1081 and 1150, the edge where
the page links are still shown, included).

### The band, shorter

Two figures, not four: 50.4% of people paying for ChatGPT hadn't used it in
30 days (Self Financial), and half of people who pay for AI don't use it
every day (Menlo Ventures and Morning Consult), each with its footnote and
population. The 3.0 assistants and the 59.9% move to the post alone. One
sentence closes it: "rotli puts that idle plan to work keeping your notes in
order while you write, with no extra AI plan to buy."

The bench of company logos is replaced by the post's own thumbnail, one
link with "Read the study →". That also retires the open question of
permission to show those logos: the files and their `SOURCES.md` are
deleted, and only "Product names belong to their owners." stays, because
ChatGPT is still named.

The dead space came from a text column far taller than the picture beside
it. Now the picture's top sits on the headline's and "Read the study"
sits level with the close. The picture takes the height the words set,
within a narrow range of its own shape: up to 13% shorter, which crops only
sky, or 8% taller, which crops the margins beside the bench and the
calendar. Below 1180px, where the words would outgrow it, the picture goes
under them at its own shape. Rejected: the headline across the top with the
figures and picture under it, which moved the empty space beside the
headline instead of removing it.

## Revised 2026-10-06 (evening): the view, the vault, and one story

The owner, verbatim:

> "don't put it in a card, just logo and star count, maybe to the left, in
> gold matching GitHub star color. Privacy promise goes on the left. [cards]
> here is where I want to clarify view vs where it actually lives,
> clarifying you write a note and open it in your view, Librarian puts it in
> vault accordingly, later ask AI about it and AI has indexing to get to it
> quick without wasting your tokens. Also have a 'what is an LLM Wiki' with a
> link to a source of what it is."

And, the same evening: "Write it down. rotli puts it away." and "You write
for yourself. AI reads differently." are redundant; make them one section.

### The header's stars

A plain link left of "Download free": the GitHub mark in ink, then a star
and the count in `--github-star`, with no border or fill. GitHub's own star
gold (Primer `base.color.yellow.2`: `#eac54f` by day, `#e3b341` by night) is
1.5:1 on the header's ground, so it fails as text. The day value is that gold
darkened to `#8a5d00`, 5.17:1 on `--ground`. The night value is GitHub's own
`#e3b341`, 9.31:1 on the night ground. Through the privacy passage it switches
with the other inks and leans onto `--text` around the switch, and every
frame is measured (`scripts/site-interactions.test.ts`). Hover underlines the
count, and focus shows the site's ring. On a phone it stays in Menu, because
beside the brand it would crowd the bar at 320.

### The hero's buttons

"Our privacy promise" is on the left and "Download free" on the right. On a
phone they stack in that same order. The page has one order in its markup,
so what is seen first is what the keyboard and a screen reader reach first.
Putting the download on top would need `column-reverse`, which splits those
orders. The download still reads as the main action by its fill.

### One section, three steps

The Overview and TwoKinds are now one section: "Write it down. rotli puts it
away." Each step has its words beside one drawn picture:

| Step | Words | Picture | Contract |
|---|---|---|---|
| 1 Write in your view | "Start a note and keep it open in your view: Main, or a named view for a project. A view is your own arrangement of notes, never a copy of them." | The note in Main under "This week", its one file at `wiki/_inbox/dana-call.md`, joined by a dotted "same file" line | `memex-data-contract.md`, "One physical home, many views": Main and named views store references and never own or copy content; with the Librarian on, a new note starts in the Library intake, `wiki/_inbox/` |
| 2 The Librarian files it | "When it's on, the Librarian later moves the file to its area folder in your vault and adds an area, a summary, tags, and links at the top. It never changes your words, and your view still shows the note where you put it." | The before and after, moved whole from TwoKinds, now with the paths `wiki/_inbox/` → `wiki/Clients/` | "Metadata ownership" (the Librarian owns `area`, `summary`, `tags`, `links`; filing writes every byte after the frontmatter unchanged); `corpus.rs` `file_note` (moves to `wiki/<area>/`); the quiet-window rule ("a note's place in Main never follows its file"); `features.ts` (the Librarian is opt-in and Mac-only, hence "When it's on") |
| 3 Ask, and AI goes straight to it | "Later, ask AI about it. rotli searches your vault on your computer, and the AI reads only the few notes that matter, not the whole vault, so your tokens go to the answer. Secure notes never go to a remote model." | A chat whose dashed middle row says the vault was searched on this computer and names the two notes read | "Master memory retrieval" (a bounded table of contents, then `search_memory` and `read_memory`: "The model does not receive the whole vault"); `docs/design/tantivy-search.md` (the Mac app's derived index in `.rotli/search/`, behind `corpus_search_ai` with the per-hit secure gate); `ai-visibility-matrix.md` |

The copy says "on your computer" and not "the index", because the Tantivy
index is the Mac app's. Rotli Web's AI corpus searches the browser's notes
service, which is also local. The headline stays. The lede is new:
"Where a note shows up and where its file lives are two different things.
You arrange notes in a view. Each file lives once, in your vault: the folder
you chose."

What each old section kept, merged, or dropped:

- **Overview.** Kept: the headline, the three-part shape, the quokkas, and
  the drawn panel language, with no outer cards. Merged: "Write in plain
  Markdown" into step 1, "Keep it in your folder" into step 2, and "Ask your
  notes" into step 3. Dropped: the lede "Everything starts as a Markdown file
  in a folder you choose. Docs and Sheets (beta), chat, and boards open from
  the same folder." The hero lede and the FAQ already say it. Also dropped:
  the rendered Launch week note and the frontmatter-fields panel, whose
  points the filing play now makes.
- **TwoKinds.** Kept: the before and after with its play, its Replay, its
  reduced-motion and no-script end state, and its phone layout. It is now
  step 2's picture, and the comparison alone still fits one 1440×900 window.
  Merged: its caption, which now also says the file moves into Clients.
  Dropped: the headline "You write for yourself. AI reads differently." and
  the lede "An AI finds a note again by its area, tags, and links…". Step 2
  and the LLM wiki aside carry that point. The About page keeps its own
  version.

The Librarian now appears twice on the landing, from two sides: step 2 (your
words stay, the file moves) and the tour's item (filed into Library areas).

### What is an LLM wiki?

This is an aside under the steps, below one hairline, rather than an FAQ
entry. FAQ answers are plain strings that double as the FAQPage JSON-LD, and
this answer needs its source linked:

> Plain Markdown notes, kept organized and linked so an AI can build on what
> you already know instead of starting from scratch on every question. Andrej
> Karpathy described the idea in his LLM Wiki note (April 2026), and your
> rotli vault works the same way: you write, and the Librarian adds the
> areas, summaries, tags, and links. Getting started with your vault →

The source is Karpathy's gist `llm-wiki.md`
(`https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`,
2026-04-04). It describes "a pattern for building personal knowledge bases
using LLMs" where "the LLM incrementally builds and maintains a persistent
wiki — a structured, interlinked collection of markdown files", in contrast
to RAG re-deriving knowledge on every question. In his pattern the LLM
writes the pages. In rotli the person writes, and the Librarian adds only
metadata and links. That is why the aside says "works the same way", not
"is one".

### Grounds after the merge

Taking one section out of an alternating chain flips everything after it, so
two sections were re-grounded rather than reordered:

| # | Section | Ground |
|---|---|---|
| 1 | Hero + film | plain |
| 2 | StatBand | warm |
| 3 | Overview: the three steps | plain |
| 4 | Tour | **warm** (was plain) |
| — | Experiments | plain, dev only |
| 5 | Personal | **plain** (was warm); its arrows' hover moved from `--ground` to `--surface-2` so it still shows |
| 6 | PrivacyBrief | night |
| 7 | FAQ | plain |
| 8 | Closing banner | plain, framed |

Only the dev site, with Experiments, shows two plain grounds in a row.

## Revised 2026-10-06 (night): the tour is removed

The owner: "Maybe remove this part 'A closer look. Pick a part of the
workspace to see what it does.' It may be redundant, especially with features
and the part above it, so I don't think it is necessary, and it is not as
polished." The story section above it already shows notes, the Librarian, and
chat, and `/features/` shows every part with its own picture, so the tour
(`Tour.astro`, its scroll rules `site/src/tourSteps.ts`, their unit tests and
specs) is gone. This supersedes "Everywhere folds into the tour", "The tour
follows the scroll", and the tour row of every table above. The `public/shots/`
captures it showed stay: the feature pages and About use them.

Two things only the tour carried on the landing moved:

- **"See every feature"**, the landing's one link to `/features/`, now ends
  the Overview, under the LLM wiki aside, as the same secondary button.
- **Rotli Web and the Helper** are one FAQ answer, "Can I use rotli in my
  browser?", only while `WEB_APP_ENABLED`, placed just before "What about
  Windows and Linux?" (whose answer sends people to Rotli Web). It says the
  same editor runs in the browser while the notes stay in a folder on your
  computer; Chrome, Edge, and Arc open the folder directly; Firefox, Zen,
  Brave, and chat in any browser need Rotli Helper; Safari and phones aren't
  supported yet. A line under it links the Helper guide
  (`/blog/rotli-helper/`, the guide moved into the blog) and the "why Terminal" post
  (`/blog/rotli-web-and-your-mac/`). The answer stays one plain string,
  because it is also the FAQPage JSON-LD; the links are a separate, optional
  `links` field rendered on its own line. The install line itself lives in
  the guide, the post, and Rotli Web's setup screen.

### Grounds after the removal

Removing a section flips the grounds below it again, so the theme studio is
warm once more, as it was before the merge, and its arrows' hover goes back
to the plain `--ground`, which reads against the band:

| # | Section | Ground |
|---|---|---|
| 1 | Hero + film | plain |
| 2 | StatBand | warm |
| 3 | Overview: the three steps, then the LLM wiki aside | plain |
| — | Experiments | plain, dev only |
| 4 | Personal | **warm** (was plain) |
| 5 | PrivacyBrief | night |
| 6 | FAQ | plain |
| 7 | Closing banner | plain, framed |

Only the dev site, with Experiments, shows two plain grounds in a row.

## 2026-10-07: the three steps, tidied

The owner, on "Write it down. rotli puts it away.": "We dont need the cards
here"; the left words didn't line up with the pictures; "the purpose of the
numbers why even have them?"; the third picture's width "is so off ... that it
feels broken"; the trailing "Getting started with your vault" link was unclear,
and "See every feature" repeats the header.

- **No cards.** Every picture uses the open style the Librarian's before and
  after already had: a label and a line over one hairline, the step's quokka
  standing on it, then the content on the band. The view and vault lists lost
  their panels; the chat lost its panel and its dashed box.
- **One head, one top edge.** `--figure-head` (4rem, on `.steps` in
  `Overview.astro`) is the head height all three pictures read, and the
  step copy no longer has a guessed `padding-top`: the heading's top is the
  picture's top, and the picture's first label starts within 2px of it.
  Measured at 1440 and 1100: heading 0, label 2, hairline 64 in all three.
- **No numbers.** The headings already read in order (Write, the Librarian
  files it, Ask).
- **One width.** The third picture was a 34rem chat (544px against 808px).
  It is now two columns like the second: the chat on the left, and "What it
  read" on the right, the vault it searched with the two notes it read lit
  and the rest left closed. That makes "not the whole vault" visible.
- **No trailing links.** "See every feature" and "Getting started with your
  vault" are gone; the LLM wiki aside ends the section. The vault is
  explained instead by a FAQ answer, "What is a vault, and how do I start
  one?", which links to the getting-started guide (the owner's pick, the same
  day).

Guarded by `e2e/site/landing-layout.spec.ts` ("the three steps line up").
