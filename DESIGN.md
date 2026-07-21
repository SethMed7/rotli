# Rotli design contract

Rotli is a calm, keyboard-first native desktop workspace. The interface should
feel quiet and durable around the user's content, with clear hierarchy and
little decorative competition. [`src/brand/README.md`](src/brand/README.md) owns
the token implementation; this file owns the product-level design rules.

## Environments and tokens

Rotli ships four complete environments: Warm Light, Warm Dark, Paper, and
Charcoal. Paper and Charcoal are the calm defaults; the warm pair is
intentional. Every product surface must work in all four.

- Consume semantic color, typography, spacing, elevation, focus, and state
  tokens from `src/brand/`.
- Do not add raw colors outside the token-definition layer.
- Do not add a UI framework or a competing token system.
- Use restrained borders and elevation to explain hierarchy, not decoration.

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

