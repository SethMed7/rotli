# Rotli syntax and naming contract

This file defines the repository's naming and style conventions. Mechanical
rules belong in the formatter, linter, or a `check:*` script; prose explains the
intent and the few measured exceptions.

## Files and folders

| Tree | Files | Folders |
|---|---|---|
| `src/` | camelCase TypeScript/TSX stems | camelCase |
| `scripts/`, `e2e/`, `docs/`, `breve-runtime/` | kebab-case | kebab-case |
| `src-tauri/src/` | snake_case Rust module files | snake_case |

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
- A video file (`mp4`, `mov`, `webm`, `m4v`, `ogv`) dropped on a note or chosen
  through **Attach image** uses the same portable `storage:` image source as
  a picture. Rotli renders it as a playable embed with native
  controls; the `|width` suffix and the resize grip apply. Elsewhere the line
  stays an ordinary Markdown image reference.
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
- A labeled result can add a color after its label: `[True:green]`,
  `[Draw:yellow]`, `[False:red]`, `[Later:accent]`, `[Info:blue]`, or `[Skip:neutral]`.
  `#RGB` and `#RRGGBB` values are also accepted, for example
  `[Draw:#E3B341]`. An uncolored two-option result defaults to green then red;
  other uncolored labeled options use the active theme accent.
  Unknown names, malformed hex values, and multiple selected boxes fail closed
  as ordinary Markdown. Color is presentation only; the label and pressed
  state keep the choice understandable without color.
- The X and check controls, plus the bold failure/success text shown after a
  choice, are render layers. The adjacent boxes remain the only file truth.
  A chosen row may append an ordinary Markdown reason after ` — `; the inline
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
  and are never silently rewritten.
- Typing `[##]` and then Space creates an independent multi-select row. Its
  square control writes `[##x]` when selected, and any number of adjacent
  options may remain selected. Adjacent rows render as one grouped option panel.
- `[True|False]` followed by Space becomes the explicit-off switch
  `- [True|x False] `; `[|]` becomes the compact green/red switch `- [|x] `.
  Switching on writes `[x True|False]` or `[x|]`. Toggle labels accept the same
  semantic and strict hex color suffixes as labeled results. Color-only sides
  use fallback labels, so `[:blue|:green]` renders as an On/Off switch.
- Inline code is opaque to the control grammar. `` `[#]` ``, `` `[##]` ``, and
  `` `[|]` `` render as plain literal text with their brackets intact and no
  code-chip background; only the backticks are hidden in beautified mode.

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
