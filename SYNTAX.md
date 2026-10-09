# Rotli syntax and naming contract

This file defines the repository's naming and style conventions. Mechanical
rules belong in the formatter, linter, or a `check:*` script; prose explains the
intent and the few measured exceptions.

## Files and folders

| Tree                                          | Files                          | Folders    |
| --------------------------------------------- | ------------------------------ | ---------- |
| `src/`                                        | camelCase TypeScript/TSX stems | camelCase  |
| `scripts/`, `e2e/`, `docs/`, `breve-runtime/` | kebab-case                     | kebab-case |
| `src-tauri/src/`                              | snake_case Rust module files   | snake_case |

Conventional host files such as `README.md` and generated declarations may be
explicitly exempted by the owning check. New exemptions require a reason in the
same change.

## TypeScript and React

- Variables, functions, properties, parameters, and hooks use `camelCase`.
- React components, classes, types, interfaces, and enums use `PascalCase`.
- Hooks start with `use`; boolean values read as facts such as `isOpen`,
  `hasFocus`, or `canSave`.
- Stable module constants may use `UPPER_SNAKE_CASE`; local immutable values stay
  `camelCase`.
- Do not prefix interfaces with `I`. Prefer names that describe the role or
  capability.
- Test suites use `test(...)`, not the `it(...)` alias. Test names state the
  observable invariant and expected refusal or recovery behavior.
- Prefer narrow types, discriminated unions, and explicit ports over `any`,
  unchecked casts, or provider-shaped state leaking inward.

Source filenames stay camelCase even when exporting a PascalCase React
component. One module should have one clear responsibility; use an `index.ts`
only when it creates an intentional public boundary rather than hiding a web of
imports.

## Rust and IPC

- Rust modules, functions, variables, and files use `snake_case`; structs,
  traits, and enums use `PascalCase`; constants use `UPPER_SNAKE_CASE`.
- Tauri command names are multi-segment `snake_case` and must match the
  registered Rust handler.
- TypeScript payload objects remain `camelCase` at the application edge; the
  adapter owns any wire translation.
- `cargo clippy --all-targets -- -D warnings` is the Rust style gate. `rustfmt`
  is deliberately not adopted because its measured repository-wide churn would
  obscure behavioral diffs.

## Persistent user-facing names

- A Rotli-authored Markdown note's first H1 is its display title. Its filename is
  the lowercase, hyphen-separated title slug with `.md`; identity remains the
  frontmatter `id`, never a filename suffix.
- Same-title notes in one physical folder use `name.md`, `name (2).md`,
  `name (3).md`, and so on. Existing numbers are never silently renumbered.
- Editing the title or using Rename updates the filename. The prior title and
  useful filename stem join the note's `aliases` list so wikilinks and human
  CLI selectors survive later renames. Ambiguous selectors require the stable
  `id`.
- Named workspace views use their exact display name as the identifier and as
  Markdown's `view_tag`; no hidden UUID or slug is introduced.
- View names are trimmed, 1–64 characters, unique case-insensitively, and use
  letters, numbers, spaces, periods, underscores, or hyphens. `Main` is
  reserved for the global reference view.
- Virtual folder names are one path component and cannot contain `/` or `:`.
  Render-only ids such as `main:<folder>` stay internal and are never written
  as user metadata.

## Markdown authoring grammar

- Typing `/attatch` at the editable start of a Markdown line and confirming the
  matching **Attach image** command opens Finder for one or more images. The
  conventional `/attach` query finds the same command. Selected bytes are
  copied into the note's registered vault and the note receives only portable
  `storage:` image links; absolute source paths never enter Markdown.
- Typing `/template` and confirming **Template** opens a picker of the notes
  in the Templates folder; Enter inserts the chosen note's body where the slash
  was typed. It is two steps, like every slash command that needs a target —
  there is no inline `/template name` form. Into an empty note the template
  comes whole, so its leading `# Heading` names the new note; into a note that
  already has content that leading H1 is left out, because a note's first H1
  is its title. A template is plain Markdown with one placeholder family: a
  date token, `{{today}}` (also `{{date}}`, `{{yesterday}}`, `{{tomorrow}}`,
  any case), becomes that day's date — the day the template is used, not the
  day it was written — when the template is inserted.
- **Today**, **Yesterday**, and **Tomorrow** insert the date as words
  (`September 29, 2026`), in place in a sentence. Typed in a note that lives in
  the Templates folder they insert the `{{today}}`-style token instead, so the
  template fills in its date each time it is used.
- **Link note** also makes the note you type: when no note has that title, the
  picker's last row is **Create "title"**, which makes a note whose first line
  is `# title`, files it beside the note you are writing in Main, and links it.
  Every slash picker closes on Esc, on its ×, or on a click elsewhere, and its
  list scrolls with the arrow keys, as the slash menu's does.
- **Continue a project list** (the Function group) picks a note that holds a
  project's tasks. While any of its tasks is open (`[ ]` or `[/]`) it links that
  note. When every task is done it starts the next note in the series —
  `Bug fixes 3` → `Bug fixes 4`, `Round Four` → `Round Five`, otherwise
  `Title 2` — beginning `Continues [[previous]].` and an empty task, files it
  beside the previous one, and links the new note.
- A video file (`mp4`, `mov`, `webm`, `m4v`, `ogv`) dropped on a note or chosen
  through **Attach image** uses the same portable `storage:` image source as
  a picture. Rotli renders it as a playable embed with native
  controls; the `|width` suffix and the resize grip apply. Elsewhere the line
  stays an ordinary Markdown image reference.
- A slash command is the whole content of a line or list item (`/table`,
  `- [ ] /link`), or a `/command` typed as the last word after text — in a
  paragraph or in any bullet, numbered, or checklist item — so a command can be
  reached without leaving the item. After text, prose keeps its slashes: the
  slash needs a space before it (`and/or`, a URL), at least one letter after it
  (`yes / no`), and a command that matches (`/usr`). A command that belongs in
  a sentence (**Link note**, **Link chat**, **Inline code**) inserts in place;
  any other lands on a continuation line beneath, leaving the text whole.
- **Link chat** lists your chats and inserts an ordinary wikilink
  (`[[Chat title]]`, or its slug when the title is not unique). A chat is a
  transcript file in the vault, so the link resolves like any other; clicking
  it opens the conversation rather than the transcript file.
- Inside a result row's ` — reason`, a `/command` typed as the last word (after
  a space, or as the whole reason) opens the same slash menu. The picked block
  lands on a continuation line beneath the row, the row keeps its label and
  reason, and a reason that was only the slash loses its dangling separator.
- Typing `[]`/`[ ]`, `[/]`, or `[x]` and then Space at the start of a line
  (optionally after `- ` or indentation) expands to ordinary portable task
  source while preserving its state: `- [ ] `, `- [/] `, or `- [x] `.
  Enter after any task always starts the next row as `[ ]`. Arrow-left from the
  start of its text selects the raw state character for replacement; lingering
  over an empty box also reveals an **In progress** action.
- Typing `[][]` and then Space expands to an exclusive two-choice result row:
  `- [ ][ ] ` is unanswered, `- [x][ ] ` is yes/passed, and `- [ ][x] ` is
  no/failed. The check is the left control; the red X is the right control.
  Clicking one side always clears the other. A hand-edited
  `- [x][x] ` is ambiguous, so Rotli fails closed and shows it as ordinary
  Markdown instead of choosing a result.
- Labels inside adjacent boxes render as mutually exclusive text buttons:
  `[True][False]` followed by Space becomes `- [True][False] `. A selection is
  portable source—a leading `x ` inside the chosen box—so selecting False
  writes `[True][x False]`. Two or more options are supported and exactly one
  may be selected.
  Only lowercase `x ` is reserved in labeled options; `X Ray` is literal.
  Escape a literal lowercase prefix as `[\x axis][Other]`; Rotli displays
  `x axis` and preserves the escape when choosing either result or toggle side.
- A labeled result can add a color after its label: `[True:green]`,
  `[Draw:yellow]`, `[False:red]`, `[Later:accent]`, `[Info:blue]`,
  `[Maybe:purple]`, or `[Skip:neutral]`. The full name list, in the picker's
  rainbow order, is red, orange, yellow, green, cyan, blue, purple, pink,
  brown, black, white, neutral, accent. Typing `:` inside a result or toggle
  bracket opens that picker: arrows or typed letters narrow it, Enter, Tab, a
  click, or the keys 1–9 and 0 choose, Escape dismisses it.
  `#RGB` and `#RRGGBB` values are also accepted, for example
  `[Draw:#E3B341]`. An uncolored two-option result defaults to green then red;
  a row of three or more options gives every uncolored option its own color
  from a fixed rotation (blue, purple, orange, cyan, pink, yellow, brown,
  green, red), skipping colors already chosen by hand and repeating only when
  the rotation runs out. A color-only pair such as `[:purple][:accent]` reads
  as Yes and No in those colors, like the compact form; three or more
  color-only boxes fail closed.
  Unknown names, malformed hex values, and multiple selected boxes fail closed
  as ordinary Markdown. Color is presentation only; the label and pressed
  state keep the choice understandable without color.
- The X and check controls, plus the bold failure/success text shown after a
  choice, are render layers. The adjacent boxes remain the only file truth.
  A chosen row may append an ordinary Markdown reason after `—`; the inline
  `+ reason` action inserts that separator and leaves the caret ready to type.
  Result rows do not enter the Tasks projection; ordinary `[ ]`, `[/]`, and
  `[x]` tasks keep their existing behavior.
- Typing `()` and then Space expands to `- ( ) `. Adjacent choice rows at the
  same indent form one exclusive group; selecting one writes `(x)` there and
  clears its siblings to `( )`. A blank, prose row, or different indent ends
  the group. Enter continues with an unselected option. Tab on row text indents
  the row; Tab on a rendered control follows the normal keyboard focus order.
- Typing `[#]` and then Space creates a portable single-choice row. Adjacent
  same-indent rows form one group; the chosen row writes `[#x]` and clears its
  siblings. The render is a circle. Legacy `( )`/`(x)` rows remain supported
  (hash choices also accept uppercase `X` when reading source)
  and are never silently rewritten.
- Typing `[##]` and then Space creates an independent multi-select row. Its
  square control writes `[##x]` when selected, and any number of adjacent
  options may remain selected. An optional `- [##?] Question` row immediately
  before the answers becomes the panel prompt; typing `[##?]` and then Space
  creates that source. Adjacent rows render as one compact, evenly inset
  option panel (never wider than 30rem or 80% of the measure) rather than
  stretching across the whole writing measure. The panel sits at the left
  edge unless the prompt marker carries a placement suffix: `[##?:center]` or
  `[##?:right]` (`[##?:left]` is accepted and means the same as the bare
  marker). The prompt row's Left/Center/Right control rewrites that suffix in
  source; a group without a prompt row keeps the default.
- `[True|False]` followed by Space becomes the explicit-off switch
  `- [True|x False] `; `[|]` becomes the compact green/red switch `- [|x] `.
  Switching on writes `[x True|False]` or `[x|]`. Toggle labels accept the same
  semantic and strict hex color suffixes as labeled results. Color-only sides
  use fallback labels, so `[:blue|:green]` renders as an On/Off switch.
- Wikilinks are `[[title]]`, `[[id]]`, `[[target|shown]]`, or `[[target#heading]]`.
  Typing `[[` opens a picker of matching notes (title prefixes first, then
  aliases and substrings; an empty query offers the newest notes); Enter, Tab,
  or a click writes the closed link, using the id only when titles collide.
  Escape dismisses it and the text stays a plain, still-typed link.
  Resting the pointer on a link that resolves shows a small card with the
  note's title and its first lines as they read (markers, fences, and image
  embeds left out); a click still opens the note. A secure note's card names
  it and shows none of its text, as does a chat's (a conversation is not
  something to flash on an accidental hover), and a link with no target shows
  no card.
- Tab indents the caret's line wherever the caret sits in it, and Shift-Tab
  outdents it. One level is two spaces; a tab character in a pasted note counts
  as one level and Tab or Shift-Tab rewrites it as spaces. A list item,
  checklist item, quote, or empty line nests one level per press, and a nested
  numbered run counts from `1.`. A paragraph takes one level (`  text`) and
  then stops: Rotli shows it indented, with its text lined up with a bullet's
  text, while other Markdown readers drop up to three leading spaces and read
  four or more as an indented code block. A paragraph already written with
  leading spaces shows one indent level per two spaces in Rotli, and a single
  space shows as one level. Tab leaves a heading (including one written one to
  three spaces deep), an aligned paragraph, a divider, and an image line as
  they are, because indenting them would make them plain text. With several
  lines selected, each line follows its own rule and blank lines stay blank.
  Tables (Tab moves between cells) and open pickers keep their own Tab. In
  fenced code, Tab with no selection across lines types two spaces at the
  caret; with several lines selected it indents every non-blank code line by
  one level, with no paragraph limit, and leaves the fence's own ``` lines at
  the left edge so the block stays a fence.
- Ordered lists count with numbers (`1. `) or a single ASCII letter
  (`a. `, `A. `). Rotli keeps each run consecutive in its own style: `a. a.
  d.` reads `a. b. c.`, a nested run starts at `1.` or `a.`, and a run never
  mixes styles (a `3.` after `b.` starts a new run). Enter continues `a.` with
  `b.`; after `z.` it starts a plain line, and letters past `z.` are left as
  written. Only the plain item is lettered: tasks, results, and choices keep
  numbers, so `a. [ ] x` is a lettered item whose text is `[ ] x`. There are no
  roman numerals, and `ab.`, `a.b`, `e.g.`, and a letter without a following
  space stay prose. Any line that starts with one letter, a dot, and a space is
  a list item, including `I. Introduction` or `A. Smith`.
- Typing an opener pairs it: `[` writes `[]`, `(` writes `()`, a backtick
  writes two, and the second character of `**`, `==`, or `~~` writes the
  closing pair, with the caret between. Typing the closer by hand steps over
  the waiting one, so a line typed in full comes out exactly as typed. A
  closer appears only when nothing is glued to the caret's right; a delimiter
  pair glued to a word (`2**3`) does not pair; a third delimiter in an empty
  pair collapses to `***`, `===`, or `~~~`; three backticks stay three. `_`
  and a single `*` never pair. Nothing pairs inside a backtick span or fenced
  code. `[[` becomes `[[]]` and still opens the note picker; choosing a note
  replaces through the closing `]]`. Arriving at an already-closed link with
  the caret does not open the picker.
- Web links are `[text](https://example.com)` or a bare autolink: `http://`
  and `https://` URLs, `www.` hosts, plain email addresses, and bare domains
  such as `sethmedina.com` or `github.com/SethMed7/rotli` with an optional
  path, query, or fragment. A bare domain links only when it ends on a common
  web TLD from the allowlist in `src/editor/inlineLinks.ts` (lowercase `com`,
  `org`, `io`, `co`, `dev`, `ai`, and similar); TLDs that double as file
  extensions are left out, so `node.js`, `file.md`, `install.sh`,
  `Rotli.app`, `v0.95.1`, and `etc.` stay prose. A domain glued to a word,
  path, or `@` on its left stays prose, and a closing sentence period is never
  part of the link. `[](https://example.com)` shows the address as its
  text; an image embed (`!` before the brackets) is always an image, never a link. A scheme-less address opens
  as `https://`, and an email opens as `mailto:`. A link that names no web
  address (a relative path, a `#heading`) shows **Couldn't open this link**
  when it is ⌘-clicked.
- Tables are GFM: a header row, a delimiter row of dashes (any count, with
  optional alignment colons), then body rows. Enter at the end of a typed
  `| a | b |` row that is not yet a table writes the delimiter row and an
  empty first body row, so the delimiter never has to be typed. A line break
  inside a cell is written as `<br>` (Shift+Enter in the cell editor); plain
  readers flatten it to a space.
- Italic is `*text*` or `_text_`; ⌘I writes `*text*`. An underscore only
  opens when no letter, digit, or `_` touches it on the left and only closes
  when none touches it on the right, and the text inside cannot start or end
  with a space, so `snake_case_name`, `file_name.md`, and `__init__` stay
  prose, and a bare link keeps its underscores. `__text__` is not bold; use
  `**text**`.
- Inline code is opaque to the control grammar. Backticked content renders as
  ordinary literal text with no code-chip background; only the backticks are
  hidden in beautified mode. Fenced code blocks retain their code styling.
- A centered or right-aligned paragraph is one line of HTML:
  `<p align="center">text</p>` or `<p align="right">text</p>`, exactly that
  spelling, with the closing tag on the same line. Left is the default and is
  never written; choosing **Align left** removes the tags, and a hand-written
  `<p align="left">` reads as left so it can be removed the same way. The
  **Align left / center / right** commands (palette; no default chord) apply
  to every paragraph line in the selection — headings, list items, quotes,
  image lines, tables, fences, and other HTML are left alone — and choosing
  the alignment a line already has changes nothing. A caret on an empty line,
  `/center`, or `/align right` starts an empty aligned paragraph. Rotli
  renders the line aligned with its inline Markdown (bold, links, wikilinks)
  and hides the tags until the caret is in the line. Enter inside it starts
  the next paragraph with the same alignment; Enter in an empty one ends it.
  Plain-text readers (titles, snippets, link cards) drop the tags and rich
  copy keeps the alignment. Other Markdown renderers that follow CommonMark
  show the alignment but treat the line as an HTML block, so inline Markdown
  inside it appears as literal text there and a line written directly below
  it, with no blank line between, joins that block.
- **Ask AI** (`/ai`, also found by `/ask`) opens a request box at the cursor.
  The Librarian's model writes a passage for that spot: a chart as a `chart`
  fence, a list of sources, or a paragraph. The answer is shown read-only, and
  nothing enters the note until **Insert**, which adds it on its own line where
  the command was typed (indented to the list it sits in). **Discard** and
  **Try again** leave the note as it was. A secure note is never sent to a
  remote model, and a locked note or one with `ai_edit: false` refuses (see
  `docs/design/ai-visibility-matrix.md`). Ask AI runs in the Mac app only.
- A chart is a fenced code block whose language is `chart`. Its body is plain
  text any reader can follow: options first, one `key: value` per line, then a
  blank line, then the data as comma-separated rows. The first data row names
  the columns. The first column holds the labels and every further column is a
  series of numbers:

  ````markdown
  ```chart
  type: bar
  title: Hours this week
  unit: h

  Day, Writing, Reading
  Mon, 4, 1
  Tue, 6, 2
  Wed, 3, 2
  ```
  ````

  `type` is required and is one of `bar`, `horizontal-bar`, `stacked-bar`,
  `line`, `area`, `pie`, `donut`, `scatter`, `radar`, or `heatmap`. `title`
  and `unit` (a suffix for values, such as `h`, `%`, or `kg`) are optional.
  Option names are lowercase. A field holding a comma is quoted as in CSV
  (`"Smith, J."`), a value may be negative or a decimal written with a point
  (`-2.5`), and an empty field is a missing value: a gap in a line, no bar.
  A pie or donut draws only the first series; its values must not be
  negative, and at least one must be above zero. A scatter's first column is
  its x axis, so every label there is a number. A radar needs at least three
  rows (its spokes). A heatmap puts rows down and series across, each cell
  shaded by its value. A chart holds up to 8 series and 200 rows.
  Rotli fails closed. An unknown type or option, a value that isn't a number,
  a row with more fields than the header, a missing header, a chart with no
  data rows, or one past the limits shows the source as code with the reason,
  and the source is never rewritten. **Chart** (`/chart`; typing a kind's name,
  such as `/radar`, finds it too) opens a list of the ten kinds; choosing one
  (arrows and Enter, a click, or its number) inserts that kind's starter chart
  and opens its editor. The rendered chart's **Edit** opens a small form
  (type, title, unit, and a grid of the rows) whose **Apply** replaces only
  the fence's body and rewrites it in this form, one space after each comma.
  Series take the theme's chart colors in order; several series stand side by
  side in a bar or horizontal bar chart, stack in a stacked bar or area chart,
  and draw one line, outline, or set of dots each in a line, radar, or
  scatter chart. A repeated label stays its own bar or slice, counted on the axis
  (`Mon (2)`). Other Markdown readers show the fence as a code block holding
  the same data.

## CSS and design tokens

- Class selectors use kebab-case; BEM-style `--modifier` suffixes are allowed.
- Consume semantic tokens from `src/brand/`. Raw hex, `rgb()`, and `hsl()` values
  are restricted to the token-definition layer.
- Name classes for the component or state they represent, not their current
  color or screen coordinates.

## Formatting and checks

oxfmt is authoritative for TypeScript/TSX under `src/`, E2E TypeScript,
`scripts/` (TS and MJS), `services/`, `playwright.config.ts`, and
`vite.config.ts`, with a 110-column target (`breve-runtime/` stays outside it
by measurement — see CONTRIBUTING). TypeScript strict checking,
oxlint, and `check:naming` enforce semantic and naming rules. `check:structure` enforces per-tree
file and folder naming; `check:design-system`, `check:hex`, and `check:ipc`
enforce CSS and command conventions.

Run the smallest formatter/type/test check while editing, then the full proof
chain from [`docs/development/testing.md`](docs/development/testing.md).
