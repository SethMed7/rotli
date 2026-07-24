# Rotli design contract

Rotli is a calm, keyboard-first native desktop workspace. The interface should
feel quiet and durable around the user's content, with clear hierarchy and
little decorative competition. [`src/brand/README.md`](src/brand/README.md) owns
the token implementation; this file owns the product-level design rules.

## Environments and tokens

Rotli ships four complete environments: Warm Light, Warm Dark, Paper, and
Charcoal. Paper and Charcoal are the calm defaults; the warm pair is
intentional. Every product surface must work in all four.

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
- The sidebar's active-item grammar follows the focused pane across Markdown,
  boards, PDFs, DOCX, sheets, and other surfaced files. Opening a conventional
  file expands its containing folder and highlights the same durable item id;
  only chat and meta surfaces intentionally leave content rows quiet.
- Note-to-note wikilinks open with an ordinary click. The editor header may
  expose the existing session back/forward trail beside the date, using compact
  adjacent-note labels rather than duplicating the sidebar's folder hierarchy.
- Focus is always visible, predictable, and restored after overlays close.
- Destructive actions are explicit and visually distinct without becoming
  alarmist.
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
  sidebar, tab bar, colored workspace, glow, or card stack.

## Required states

Every changed surface accounts for loading, empty, error, saved, disabled, and
destructive states, plus narrow-window behavior. Long content, missing content,
keyboard-only navigation, and focus recovery are normal cases rather than
polish work.

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

- Beautified tables stay visually tabular during ordinary editing. Clicking or
  keyboard-entering a cell opens one inline cell editor; surrounding cells keep
  rendering, the current column widths and row height remain stable, long cell
  text wraps instead of forcing a single horizontal line, Tab moves in reading
  order, and focus remains visible. Pipe source is an explicit `</>` escape
  hatch, not the default response to a cell click.
- Raw Markdown is a first-class source view. It uses a monospaced editor voice,
  the active Rotli accent for syntax punctuation, and a contrast-safe semantic
  blue for headings and emphasis. These roles are theme tokens in all four
  environments. Appearance offers Rotli (default) and Monochrome palettes;
  customization changes palette, never grammar or source.

## Layout and accessibility

- Preserve readable text and clear information hierarchy at supported desktop
  sizes and operating-system text settings.
- Prefer stable work areas over layout shifts. Keep primary actions close to
  the content they affect.
- Use semantic HTML and accessible names before adding test-only attributes.
- Do not rely on color alone for state, selection, validation, or urgency.
- Maintain sufficient contrast across all four environments.

## Design proof

Automated token, CSS, keyboard, and state checks are necessary but not complete.
UI changes require desktop review in all four environments and at a narrow
window. Browser tests prove DOM interaction only; they do not prove native
titlebar, menu, filesystem, Keychain, updater, scheduler, or OS drag behavior.

Use [`docs/development/testing.md`](docs/development/testing.md) for the evidence
ladder and [`SYNTAX.md`](SYNTAX.md) for CSS and component naming.
