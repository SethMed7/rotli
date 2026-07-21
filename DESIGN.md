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
- Focus is always visible, predictable, and restored after overlays close.
- Destructive actions are explicit and visually distinct without becoming
  alarmist.
- Motion explains state or spatial change, respects reduced-motion preferences,
  and never delays core work.
- Copy is direct, specific, and useful: errors say what failed and what the user
  can do next.
- Main's view switcher stays in the existing section header: exact view name,
  standard menu disclosure, inline create/rename, and an explicit delete row
  that states content remains in Main. A named view must not become a second
  sidebar, tab bar, colored workspace, glow, or card stack.

## Required states

Every changed surface accounts for loading, empty, error, saved, disabled, and
destructive states, plus narrow-window behavior. Long content, missing content,
keyboard-only navigation, and focus recovery are normal cases rather than
polish work.

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
