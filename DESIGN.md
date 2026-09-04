# Rotli design contract

Rotli is a calm, keyboard-first native desktop workspace. The interface should
feel quiet and durable around the user's content, with clear hierarchy and
little decorative competition. [`src/brand/README.md`](src/brand/README.md) owns
the token implementation; this file owns the product-level design rules.

## Environments and tokens

Rotli ships six complete theme families: Rotli, Paper & Charcoal, Ocean, Grove,
Iris, and Midnight. Each family owns a deliberately tuned light and dark
environment; Midnight's dark environment is the deepest neutral workspace.
Every product surface must work in every supported environment.

Light, Dark, and System are a separate mode choice. System follows the OS within
the selected family: macOS light uses that family's tuned light environment and
macOS dark uses its tuned dark environment. It never owns a second mapping UI.
Primary color starts with the active environment's own accent, then offers the
shared presets and a contrast-managed custom hue without rewriting theme tokens.

Appearance previews must resemble the real workspace—sidebar, content, and
composer—not rely on abstract color bars alone. Full-body companion drawings
offer Line plus Cocoa, Fern, Ocean, Iris, Berry, Amber, and validated custom
body colors. The original poses use exact canonical geometry; approved new
expressions use separately colored body, explicit black-or-white ink, and
preserved-detail layers. Accessories use inset hue-owned fill and ink-owned line
masks: each mask owns only accessory geometry and must never carry the source
pose's face, limbs, expression, or outline into another mood. No source color
may survive those masks, and Line treatment keeps both the body and accessory
monochrome. Worn layers mount to pose-specific face, brow, and crown
landmarks; a moving or angled quokka must carry its accessory with it instead
of reusing the neutral pose's placement. Bucket hats use a compact soft crown
and a downward front brim seated above the eye line. The crown covers the ears,
the visible brim crosses in front of the forehead, and the rear brim stays
occluded behind the crown and head instead of appearing across a front-facing
quokka. Front, three-quarter, and side poses use dedicated hat drawings; angled
characters never receive a rotated front hat. Filled and Line treatments both
occlude the body along the selected brim's curved lower silhouette so no ear,
body ink, or preserved raster detail pokes through; Rotli never paints a guessed
surface color behind the accessory.
The companion itself is optional: when off,
full-body quokkas appear only during onboarding; the compact product mark is
unaffected and always remains the original line art. When on, body hue, ink,
glasses or bucket hat (goggles are parked: stored values still render, pickers
no longer offer them), accessory hue, and a preferred idle mood/pose are
machine-level choices that survive vault switches. Personal idle placements use
the preferred mood. Semantic empty states choose the pose that explains their
state while preserving the user's body, ink, and accessory treatment.

- Consume semantic color, typography, spacing, focus, and state roles exposed by
  the shared foundation. Fixed `--rotli-*` palette values are foundation inputs,
  not component-level tokens.
- Do not add raw colors outside the token-definition layer.
- Do not add a UI framework or a competing token system.
- Use surface contrast, one-pixel borders, spacing, and typography to explain
  hierarchy.

## Flat material

Rotli does not simulate light or depth. Product-owned CSS must not use ambient
glows, halos, `box-shadow`, `text-shadow`, `drop-shadow`, backdrop blur, or
decorative filter effects. This includes tooltips, dialogs, popovers, cards,
drag previews, selected controls, and focus states—there is no "small" shadow
exception.

- Floating surfaces use a solid semantic surface, `--border-strong`, and, when
  needed, the shared flat scrim.
- Selection and keyboard focus use borders or outlines. Hover and press use the
  shared semantic state layers.
- Gradients are allowed only when they communicate a functional transition such
  as loading progress or a scroll edge. They must use semantic tokens and must
  never imitate illumination.
- `check:design-system` enforces the forbidden effect properties and fixed-palette
  boundary; its fixtures prove the guard fails on a regression.

## Interaction language

- Every user action remains keyboard reachable and participates in the shared
  action/keybinding system.
- Compact titlebar, sidebar, tab-strip, and editor-header chrome keeps glyphs
  visually quiet while giving each standalone pointer action at least a 24×24
  CSS-pixel target. Inline text actions and content-native controls preserve
  their line-height grammar. Icon hover labels also appear on keyboard focus;
  expanding a target must not shift adjacent content between states.
- Global search is the real titlebar field: clicking it or invoking ⌘K focuses
  that same field and opens a results list directly beneath it. It is not a
  centered modal. A uniform semantic fade quiets the surrounding workspace
  while the field and results remain crisp; search never blurs the user's
  content. The field is one visual container; its Rotli mark and shortcut hint
  do not add nested badges. Results rank by relevance across their labeled
  sections: exact and prefix title or filename matches lead, while fuzzy title
  and body-only matches follow. A fixed content-type order must never bury the
  strongest result.
- Held-Command badges show the complete live chord. Controls that are meant to
  be invoked directly from that reveal state include Command in their default
  chord, and a badge on the active control uses the calm surface voice instead
  of repeating accent-on-accent. A badge may anchor only to the portion of its
  control that is actually visible through every overflow-clipping ancestor;
  a tab scrolled behind the strip edge must never paint a shortcut over the
  sidebar. The titlebar New and pane-split controls tag the exact registry
  action they run; the visible `+` and ⌘N are one new-item chooser, never two
  creation grammars.
- The sidebar's active-item grammar follows the focused pane across Markdown,
  boards, PDFs, DOCX, sheets, and other surfaced files. Opening a conventional
  file expands its containing folder and highlights the same durable item id;
  only chat and meta surfaces intentionally leave content rows quiet.
- Persistent selected and active rows use `--selected-bg` with ordinary text,
  muted metadata, and an accent identifying detail. Solid accent fills belong
  to primary actions and small status controls, not orientation rows.
- Sidebar context menus keep one label column, reserve a checkmark gutter only
  when the visible menu contains toggles, and scroll within the window when a
  long menu would otherwise hide lifecycle actions. Named views distinguish
  removing a projection from moving durable content to Trash; virtual folders
  require an explicit second-step confirmation before their contents move.
- Native content rows expose Copy File Path beside Show in Finder. Browser-mode
  twins disable both filesystem-only actions instead of pretending they ran.
- Note-to-note wikilinks open with an ordinary click; web links — markdown
  links and bare-URL autolinks alike — keep the deliberate ⌘-click gesture
  inside the editor. A wikilink that resolves to no note renders visibly inert (dimmed,
  dashed underline, honest tooltip) — a dead link must never look like a live
  one. The editor header may
  expose the existing session back/forward trail beside the date, using compact
  adjacent-note labels rather than duplicating the sidebar's folder hierarchy.
- The titlebar Browser control and New-item chooser open a normal pane tab, not
  the system browser. A fresh tab opens on a Rotli-owned start page that uses
  the current environment's semantic light/dark tokens. Settings → Browser
  selects the app-wide default search provider; only that provider ID persists,
  while addresses, queries, and destinations never enter vault files or durable
  pane state. Remote sites still control their own appearance. On desktop every
  page runs in a separate native child webview using a non-persistent data
  store; only HTTP(S) navigation is accepted, and closing the tab discards
  cookies, storage, and history. While a browser tab is active, ⌘T and the pane
  strip's plus create a sibling private-browser tab; popup/new-window links do
  the same in their source pane. Every open browser tab keeps its native session
  until explicit close, and its sanitized page title remains memory-only so the
  strip can distinguish tabs without writing browsing data to viewstate. The
  browser twin renders the themed start page and surrounding toolbar, then an
  honest native-only state instead of pretending an iframe can host arbitrary
  sites. Breve citations use this same private tab.
- The sidebar has one front switcher and one body. A two-segment pill under the
  vault header picks the active front — Home (the notes world: All notes,
  Captures, Tasks, the Main/named-view tree) or Chat (New chat, All chats, chat
  folders, every chat). Neither front collapses and neither is nested inside the
  other: the chosen one owns the whole body and scrolls on its own. The pill is
  an ordered list of fronts, so a Home dashboard block or the parked email Inbox
  joins without another information-architecture change. Breve is a mode, not a
  front — it replaces the switcher rather than nesting one.
- The larger vault header menu names the active vault and keeps every linked
  vault reachable. Each row owns a refresh icon and an overflow menu; Location
  lives in that overflow instead of competing with switching. One **Connect
  vault** action handles an existing Rotli vault or scaffolds a selected empty
  folder. A connection registers a future switch target without mixing its data
  into the active vault. A switch keeps the native shell alive while its vault-owned data and
  services rebind; the outgoing compatible Rotli vault remains in the menu so
  switching is reversible. Every completed switch lands on the Home/Notes
  front rather than inheriting Chat or Breve navigation from either vault. Breve
  changes only the Coffee/Quokka mode control in this row; New, New folder, and
  Collapse all do not move or disappear when the sidebar mode changes.
- Provider/model marks in Chat use one 14px slot and an optically consistent
  visible footprint; source SVG padding and fine linework must not make one
  family read as a smaller icon than its peers.
- Activity dashboards never blend unlike sources. Home's Rotli-activity card
  and dashboard lens report vault notes/chats; Chat's model-usage card and lens
  report aggregate provider session counters. Model tokens are not labeled as
  Rotli usage. Dollar values may use a dated, provider-published standard API
  price snapshot for comparison, but are never labeled as subscription charges
  or invoices; unknown model IDs remain unpriced. Browser mode never pretends
  to inspect native histories.
- Breve's editorial dashboard keeps its headline scale fixed within structural
  breakpoints; a wide window must not inflate type from viewport width, and a
  narrowing left column steps down before its copy crowds the right rail. Every
  top story with cited Markdown links exposes those sources beside the story as
  keyboard-reachable links into the private browser.
- Full Rotli-activity and model-usage dashboards share one 24-hour / 7-day /
  30-day / 90-day range grammar. Dashboard lens and range selection reuse the
  existing Home/Chat solid-accent segmented state; they do not introduce a
  separate underline treatment.
- A first native telemetry read uses a quiet, motion-safe skeleton. Refreshes
  and range changes keep the last complete dashboard readable, label it as
  updating, and never blank the surface while a newer aggregate is prepared.
- Assistant Markdown task lists render as quiet, read-only progress plans with
  pending/current/completed states and a compact completion count. They remain
  transcript projections, not controls for an external provider process.
- When Chat inherits a named view selected on Home, it names that view in a
  quiet inline context row and offers a direct return to all chats. Cross-front
  filtering must never depend on remembering hidden state from another front.
- The Librarian journal keeps a labeled, re-openable explanation of its file
  structure and rationale. It distinguishes physical Library folders from
  reference-only Main/named views and links directly to Librarian and Security
  controls; understanding the automation must not depend on remembering a
  first-run modal or interpreting a bare help glyph.
- Quick Note and Quick capture expose separate destination-vault controls in
  General settings. “Current destination” preserves the default; pinning a
  named writable vault is explicit, and unavailable choices remain visible
  until corrected rather than silently appearing to succeed elsewhere.
- The System zone is always Library · Assets · Archive · Trash. It stays pinned
  below the body and belongs to Home; switching the active vault changes only
  the rows' data and counts, never the zone's structure. Its header is a
  disclosure so the whole zone can be folded away. The sidebar ends in a pinned
  utility footer — Files · Librarian · Settings on one quiet row — which is
  app-level and shows under every front. Section and zone disclosure chevrons
  ride the row's right edge so icons and labels start flush left.
- A reveal must move the sidebar to the front that can render it before it
  reveals: an explicit note reveal lands on Home, and opening a chat, note,
  board, or file pulls the front to match the focused tab. A reveal into a front
  that cannot show the row is a silent failure, not a no-op.
- The System browser is a spatial Finder with four views — Icons, List,
  Columns, Gallery — switched by the standard Finder icons (words live in
  tooltips). Image assets show real thumbnails wherever a tile or filmstrip
  renders them. The folder trail is a bottom path bar (the Finder placement —
  an explicit exception to header-adjacent navigation): every segment
  navigates and the current selection is the leaf. Right-clicking empty space
  offers New folder (where creation is allowed) and Sort by Name / Kind /
  Date modified / Date created; re-picking the active key flips direction. A
  selected item or gathered selection can be dragged onto the System Trash row;
  it uses the same guarded lifecycle operation as `⌘Delete`.
- Main uses the same gathered-selection expectation for destructive row-menu
  actions: ⌘-click gathers rows, right-clicking a gathered member preserves the
  set, and the menu names `Move N items to Trash`. The batch preflights
  conventional files, routes notes/boards/files through their owning lifecycle
  lanes, removes Main references only after success, and reports partial
  progress instead of pretending the group was atomic.
- Every tab is closeable, including the last one: the lone pane rests on the
  quokka empty state with quiet ways back in (new note · search · reopen tab).
  An empty pane is a designed state, not an error.
- A brand-new vault keeps the ordinary titlebar, Home sidebar, tab strip, and
  pane body visible. Rotli seeds and opens one real `Welcome to Rotli.md` note
  at the vault root. It uses the ordinary Markdown editor, stays outside
  Library's `wiki/` projection, and can be edited or trashed like any other
  note. A newly created vault opens
  Home with the sidebar expanded even when the outgoing vault was collapsed or
  showing Chat/Breve.
- The explicit Practice Vault adds `wiki/Playground/`: a versioned, removable
  set of ordinary Markdown lessons for tasks, result buttons, choices, toggles,
  custom colors, and literal backtick examples. The welcome note links into the
  folder. Because the lesson is one self-contained folder with no sidecar
  dependency, a user can copy it into another vault or delete it outright.
- Settings → Location offers **Import playground** for an existing writable
  vault. It creates or reuses the same ordinary lesson notes and adds them to a
  deletable `Playground` named view. Deleting that projection never deletes the
  notes; importing again reuses unchanged lessons rather than overwriting them.
- Tab hover is paint-only: close controls reserve their space, and switching
  hover/active state never moves neighboring tabs. Crowded tab bars follow the
  persisted Scroll or Fit preference. ⌘T appends and activates its tab in the
  originating key event; durable creation and cache refresh continue behind
  that presentation. Completion retargets the exact pending tab
  rather than opening another one, and a pending tab the user already closed
  stays closed. A pending Markdown tab is the full focused editor on its first
  paint, not an empty loading pane; it accepts keystrokes into a session buffer
  and transfers that exact draft to the durable revision before retargeting.
  Plain Markdown remains absent from Main and named views while its body is
  empty; its first successful non-empty save files the correctly titled row in
  the creation context captured at ⌘T. If the pending tab closes before
  creation settles, the still-blank result is discarded after a native
  blankness check and can never arrive later as an orphaned `Untitled` row.
  Populated formats still file after the refreshed identity index so a fresh
  reference can never be mistaken for a stale one. ⌘W likewise removes the tab
  in its frontend key event; large-note save assembly advances only after that
  close reaches a paint boundary, while hide/quit flushes remain authoritative.
  The sidebar, panes, search, and System counts always represent one active
  vault. Connected vaults are reachable only through the explicit switcher;
  they never mix content into the current shell.
- Quick Look is a PEEK, never the workspace: Space (or the row menu's Preview)
  opens a modal preview; formats without a faithful cheap render show an
  honest metadata card, and the Open button is always the escalation to the
  item's real surface. Esc and outside-click close through the transient
  stack.
- Focus is always visible, predictable, and restored after overlays close.
- Destructive actions are explicit and visually distinct without becoming
  alarmist.
- Removing a connected vault is a two-step inline action. It drops only Rotli's
  binding and live access; the folder and every user file remain untouched.
  If the active folder disappears outside Rotli, the first still-available
  connected vault becomes active and opens Home. With no surviving vault, Rotli
  returns to vault activation and never recreates the missing folder.
- Every vault row can reopen and rescan its folder in place without switching;
  ⌘R refreshes the current row. Refresh never reloads the application shell,
  and pending editor work flushes before an active-vault reopen.
- Motion explains state or spatial change, respects reduced-motion preferences,
  and never delays core work.
- Copy is direct, specific, and useful: errors say what failed and what the user
  can do next.
- A PDF keeps its viewer as the primary surface. `Convert to DOCX` is a compact
  adjacent action that creates and opens a separate editable copy; progress,
  disabled state, extraction errors, and the original-file guarantee remain
  visible without replacing the PDF.
- Main's view switcher stays in the existing section header: exact view name,
  standard menu disclosure, inline create/rename, and an explicit delete row
  that states content remains in Main. A named view must not become a second
  sidebar, tab bar, colored workspace, glow, or card stack. Automatic Main and
  named-view tree writes stay visually silent when they succeed; write failures
  remain visible inline so durability problems never masquerade as success.

## Required states

Every changed surface accounts for loading, empty, error, saved, disabled, and
destructive states, plus narrow-window behavior. Long content, missing content,
keyboard-only navigation, and focus recovery are normal cases rather than
polish work.

## Chat artifacts

- Creating an image, board, document, or other artifact leaves the conversation
  in place and returns a normal assistant response. Creation must not force a
  split, focus change, or automatic file open.
- Conventional documents created by a chat remain visible inside the final
  assistant turn as one full-width file button per row. Their format mark and
  label must identify the real file type; selecting one uses the artifact
  policy chosen in Settings:
  reuse one right-side pane (default), create a pane, or open a new tab.
- In a wide chat pane, artifacts use a quiet full-height side rail in otherwise
  unused horizontal space. While it is open, the rail owns the single visible
  artifact close control. The rail shows image thumbnails and conventional
  format marks; selecting a row opens that artifact through the ordinary pane
  system.
- When the chat pane cannot retain a readable conversation beside the rail,
  the rail collapses behind an icon-only, accessibly labeled header control as
  a keyboard-safe popover. Existing artifacts remain reachable at every
  supported pane width.

## Chat welcome and navigation

- Fresh and saved chats share one quiet header breadcrumb: the current view or
  vault context first, then the chat's display name. In Ask-first mode the new
  chat name is a visibly bounded field in that header; “Enter to skip” belongs
  to its placeholder, and Enter moves to the composer even when the field is
  empty. The first sent prompt retires the input immediately into ordinary
  title text. First-message mode omits the field and focuses the composer.
  Saved display names edit in place without changing the durable chat filename.
  The header is always the surface's fixed first row above the conversation;
  content height and fresh-chat layouts must never displace it to the footer.
- A fresh, unsent chat is one centered working composition: time-aware greeting,
  still companion illustration, composer, and three useful prompt starters. A
  machine-level Calm/Lively preference changes the companion
  pose and adds a quiet Morning, Noon, Afternoon, or Evening scene contained
  behind the companion rather than tinting the workspace; sun position, terrain,
  and dusk treatment convey the period without motion. The character follows
  the user's full-body treatment and preferred idle mood/pose; a chosen accessory is
  layered independently, and neither setting creates idle animation.
- Saved-chat headers use the available pane width while transcript and composer
  measures remain independently readable.
- Long-chat prompt markers may be quiet lines, soft dots, a restrained quokka
  paw trail, or little quokka ears. All are the same accessible navigator:
  each marker opens the compact prompt list and previews its matching row. The
  rail stays unboxed; accent and scale identify the active marker, while hover
  preview uses lower opacity only. The list stays beside the rail and inside
  its owning chat pane.
- A settled thread ends with one larger full-body companion on its own row. It
  uses the chosen treatment and optional accessory with at most one restrained
  arrival; the streaming state keeps the compact line mark.

## First-run setup

- First-run setup is one resumable sequence: app preferences, an explicit vault
  decision, then optional model configuration. Skipping app preferences still
  lands on the vault decision; skipping models is allowed. A successful vault
  switch keeps the native shell alive and rebinds vault-owned state in place,
  so the machine-level checkpoint resumes on model configuration instead of
  repeating or silently finishing setup.
- The companion character appears directly on the ground, without a card, on
  every setup and activation state. Its state entrance is short and one-shot.
  First-run Appearance offers the optional companion mode and the same body
  palette and accessory choice as the full Appearance studio. Thoughtful,
  walking, listening, and gentle-attention
  expressions give later steps and empty states semantic variety rather than
  repeating one neutral pose everywhere.
  Welcome may keep two partly hidden edge companions visible while a slow,
  low-opacity pair alternates positions; reduced motion keeps two static.
  Scanning may use a bounded loading indicator while work is active.
- Progress reads as position plus step name. Choice numbers sit beside the
  labels they invoke, radio choices use arrow-key selection, and both number
  and arrow shortcuts work from the quiet setup canvas before a card owns
  focus. Real inputs and controls keep their own keys. The current `⌘Enter`
  binding is rendered inside the primary button it activates.
- Progress uses one six-step count across preferences, vault, and models; a
  component boundary must never restart the denominator. Quiet edge companions
  persist across the complete sequence, alternate in slow overlapping pairs,
  and ease fully in and out instead of snapping at the viewport edge.
- Vault selection is required even in development. A development fallback may
  make a vault available so the shell can boot, but it does not count as the
  user's selection; only the isolated development vault binding does. A
  configured installation can explicitly keep its current vault, create a
  tagged Rotli vault, open an existing folder, or start with a practice vault.
- Vault selection opens Rotli's flat, directory-only navigator at the user's
  Home folder (`~`, with the absolute `/Users/…` path visible). It lists visible
  direct-child directories, supports arrow navigation, Enter, Backspace, Esc,
  refresh, and new-folder creation, and never makes Home itself selectable as a
  vault because Home contains private credential and application state. Desktop
  and ordinary folders beneath Home remain valid. Finder is an explicit reveal
  action; **More locations…** is the deliberate native-picker fallback for
  external volumes and locations outside the contained Home session.
- Model setup distinguishes on-device installs from connected subscription
  CLIs. Installing or connecting is always explicit, connected lanes are named
  as remote, unavailable CLIs show actionable setup guidance, and the user can
  finish with no model because the vault remains useful on its own. Every local
  model already registered on the Mac is reusable without another download;
  the setup surface lists installed models, supports an explicit default,
  confirms removal, and offers the curated install catalog individually.
  Local, installable, and subscription controls use progressive disclosures so
  only one decision set is open at a time. Any clipped model content carries a
  visible scroll cue; long install lists name that they can be scrolled.
  Disclosure controls use the shared chrome chevron, while model rows use the
  approved provider or model-family mark and reserve a neutral fallback only
  for genuinely unknown local families.
- Back is one real, remappable command throughout first run. Every step after
  Welcome renders its current chord, and invoking it returns one logical step:
  model setup to vault, vault substate to its chooser, and the chooser to
  Shortcuts. A decorative arrow must never imply an unregistered shortcut.
- The onboarding frame does not move between steps: progress stays at the top
  and Skip, Back, and Continue/Finish stay in one fixed footer position. A
  content-heavy step scrolls only its middle stage rather than pushing the
  primary action down or moving it relative to the other steps.
- Opening an existing Markdown folder always has a read-only inventory/review
  step before confirmation. Open-in-place adds only hidden Rotli sidecars;
  import-copy requires an empty destination and leaves the source untouched.
- An adopted Obsidian, ZenNotes, or generic Markdown tree becomes the one Main
  reference tree with its nested folders intact. It does not create a parallel
  content store or named views, and scanning does not rewrite note bodies or
  inject visible Rotli folders.

## Diagram interaction

- A rendered Mermaid fence is an entry point to one focused workspace with
  View, Visual, and Code modes. View supports pointer pan,
  wheel/button/keyboard zoom, double-click or `0` to fit, and visible loading,
  empty, and parse-error states.
- Mermaid text in the Markdown fence remains source of truth. Code changes are
  explicit, guard unapplied edits on close, and write back only when the user
  chooses Apply.
- Visual is a Mermaid editor, not an Excalidraw handoff. It first supports the
  lossless flowchart subset: add/delete supported shapes, edit labels and
  direction, connect labeled arrow/line variants, and set portable node fill,
  border, and text colors. Every persistent edit serializes back into readable
  Mermaid source. Unsupported diagram families or advanced flowchart syntax
  keep View and Code fully available and must fail closed with no source rewrite.
- Mermaid does not encode durable freeform positions. Visual may let people
  drag shapes to organize the editing canvas, but must state that Mermaid lays
  out the saved render automatically. It must never imply that absolute canvas
  geometry, exact node sizing, or arbitrary drawing strokes persist in source.
- `Convert copy to Excalidraw…` is a secondary, confirmed action. It creates an
  independent board and leaves the source fence untouched; it is never labeled
  as Mermaid editing. Dirty Mermaid changes must be applied first. Browser mode
  disables conversion with explanatory copy because it has no corpus
  filesystem. The desktop composition root creates the managed board in the
  active Main/view context, opens it, and starts its rename flow.

## Markdown editing

- A bare task token followed by Space becomes a portable Markdown list task:
  `[]`/`[ ]` becomes `- [ ] `, `[/]` becomes `- [/] `, and `[x]` becomes
  `- [x] `. Single-task open, in-progress, and done states use the current
  theme's control vocabulary: in-progress is an accent half-fill and done is
  a solid accent fill without an added glyph. Success green and failure red are
  reserved for result semantics. Task controls expose native checkbox state,
  activate from pointer or keyboard, and retain keyboard focus across their
  source-backed rerender.
  Enter always continues with an unchecked task. Arrow-left from the text edge
  reveals and selects the raw mark, while a one-second hover on an empty box
  exposes a keyboard-reachable **In progress** action.
- `[][]` followed by Space creates a compact check/X result row. The check is
  left and means yes/passed; the X is right, uses the semantic failure red (not
  the theme accent), and means no/failed. Both labeled buttons are mutually
  exclusive, keyboard-activatable, and individually reachable with Tab. Once
  chosen, only the result label becomes bold success/failure; a reason after
  `—` remains quiet body text. The inline `+ reason` action inserts that
  portable suffix and returns the caret to the row. The source remains
  `- [x][ ]` for pass and `- [ ][x]` for fail. Unanswered rows stay neutral,
  and an ambiguous hand-edited pair fails closed as ordinary Markdown.
- Labeled adjacent boxes such as `[True][False]` use the same exclusive result
  model but render as restrained text buttons. A leading `x ` records the
  selected label in portable source. An uncolored two-option result defaults to
  green/red; the semantic suffixes `accent`, `blue`, `green`, `yellow`,
  `purple`, `red`, and `neutral`, plus strict `#RGB`/`#RRGGBB` values, may
  override a button. Runtime
  hex is validated user data, never a new design token. Every option exposes
  pressed state, retains keyboard focus after selection, and remains legible
  without relying on color. Compact `[][]` intentionally keeps its established
  green pass/red failure meaning.
- `()` followed by Space creates a radio-style `- ( )` option. Adjacent options
  at the same indent are one group; selection writes `(x)` to one source row
  and clears its siblings atomically. Blank/prose rows and indentation changes
  are explicit group boundaries. Selected option text is bold accent emphasis,
  never success/failure color. Controls follow Tab order; Tab while the text
  caret owns a row keeps Rotli's existing line-indent behavior.
- `[#]` is the current single-choice source: a circle that writes `[#x]` and
  clears adjacent same-indent `[#]` siblings. `[##]` is the independent
  multi-choice source: a square that toggles only its own `[##x]` state, with
  adjacent rows visually joined into a compact, right-aligned option panel.
  An immediately preceding `[##?]` row is its optional question/prompt. The
  shared panel uses even gutters, aligned control/text centers and columns,
  denser answers beneath the prompt, and quiet row selection so it reads as
  one answer set without overpowering the note.
  Legacy `( )` rows remain supported without migration churn.
- `[True|False]` and compact `[|]` render as switches whose active side is
  always explicit after first creation or activation. The thumb position,
  `role="switch"`, accessible checked state, and active label carry meaning in
  addition to color. Compact defaults are semantic green/on and red/off;
  labeled sides accept the result-control color grammar; `[:blue|:green]`
  supplies color-only sides with accessible On/Off fallback labels.
- Backtick-delimited inline code wins before every control grammar. Its content
  stays literal and selectable while beautified mode hides only the backticks
  and presents the content as ordinary text without an inline-code chip.
  Fenced code blocks remain visually distinct code surfaces.
- A Markdown pane reveals one compact scroll-to-top control after meaningful
  downward scrolling. It floats at the pane's bottom-right, remains a labeled
  keyboard-focusable button, and uses reduced-motion-safe spatial feedback.
  Turning file metadata on returns that pane to the top immediately because
  the metadata banner exists only above the note body.
- Dropping local images into Markdown imports them into the open note's own
  registered vault and inserts portable, root-relative image links at the
  pointer's drop position. Nested rendered content—including an existing image
  under the pointer—resolves back to its editor before routing. Capture that
  document position before asynchronous imports begin so later layout or
  selection changes cannot redirect the insertion. A drop onto an empty bullet,
  numbered item, task, result, or choice fills that item instead of inserting an
  unlisted image below it. Import failures remain visible instead of silently
  discarding the gesture.
- The **Attach image** slash command is discoverable by both `/attatch` and
  `/attach`. It opens the native Finder picker, supports multi-select, and uses
  the same guarded import and portable insertion lane as a drop. Native drop
  hit-testing accepts both physical and logical runtime coordinates; a webview
  `File` drop is the byte-backed fallback when no native path event is exposed.
- A selection that completely contains an image keeps the image rendered and
  visibly selected, including Select All. A caret already inside its source or
  a partial source selection remains an escape hatch for editing the Markdown
  link. Click, double-click, and arrow-key navigation into a rendered standalone
  or list image select and outline it as an object instead of exposing source.
- Beautified tables stay visually tabular during ordinary editing. Clicking or
  keyboard-entering a cell opens one inline cell editor; surrounding cells keep
  rendering, the current column widths and row height remain stable, long cell
  text wraps instead of forcing a single horizontal line, Tab moves in reading
  order, and focus remains visible. Pipe source is an explicit `</>` escape
  hatch, not the default response to a cell click.
- Raw Markdown is a first-class source view. It uses a monospaced editor voice,
  the active Rotli accent for syntax punctuation, and a contrast-safe semantic
  blue for headings and emphasis. These roles are theme tokens in every
  environments. Appearance offers Rotli (default) and Monochrome palettes;
  customization changes palette, never grammar or source.

## Layout and accessibility

- Preserve readable text and clear information hierarchy at supported desktop
  sizes and operating-system text settings.
- Prefer stable work areas over layout shifts. Keep primary actions close to
  the content they affect.
- Use semantic HTML and accessible names before adding test-only attributes.
- Do not rely on color alone for state, selection, validation, or urgency.
- Maintain sufficient contrast across every supported environment.

## Design proof

Automated token, CSS, keyboard, and state checks are necessary but not complete.
UI changes require desktop review across the supported theme families and at a narrow
window. Browser tests prove DOM interaction only; they do not prove native
titlebar, menu, filesystem, Keychain, updater, scheduler, or OS drag behavior.

Use [`docs/development/testing.md`](docs/development/testing.md) for the evidence
ladder and [`SYNTAX.md`](SYNTAX.md) for CSS and component naming.
