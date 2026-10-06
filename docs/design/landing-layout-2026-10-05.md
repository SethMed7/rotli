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
