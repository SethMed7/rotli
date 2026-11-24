# Custom themes: seeds in a small versioned file, one gate decides readability

**Date:** 2026-11-24 · **Status:** accepted (engine and file format; applying a
theme is the next change)

## Context

The owner wants people to make their own themes, by hand and later with the
chat. A theme is user-authored and durable, it may later travel inside a
shared vault, and a model may propose one. So the file format is a durable
contract, and the question of what is readable has to be answered by Rotli
rather than by the file, the person, or the model.

The plan and its prototype engine are in
`_review/boards-chats-2026-11-24/themes/` (not shipped). The owner's decisions
of 2026-11-24: seeds rather than every token; built-ins are recorded against
the gate as a baseline that may only shrink; vault themes are offered, never
auto-applied; the chat tool appears only in a theme chat; custom themes stay
out of the titlebar sun's cycle in v1.

## Decision

1. **A theme is up to six colours.** A page colour and an accent for day and
   for night, and an optional ink for each, plus a contrast level (Soft,
   Standard, High) and a base family. Rotli derives every other colour role in
   OKLCH (`src/brand/themeEngine/derive.ts`). Type, density and radius stay
   Rotli's.
2. **One gate, separate from the solver** (`src/brand/themeEngine/gate.ts`).
   It composites every translucent layer it lists over its surface and
   measures the final 8-bit colour: text 4.5:1 on every surface and layered
   state, text on the page 9:1 at Standard, controls and marks 3:1, seams at
   their own floors. Anything that applies a theme goes through it.
3. **The file is JSON, `rotliTheme: 1`,** with `#rrggbb` seeds:

   ```json
   {
     "rotliTheme": 1,
     "id": "forest-paper",
     "name": "Forest Paper",
     "base": "grove",
     "contrast": "standard",
     "seeds": {
       "light": { "page": "#f6f1e7", "accent": "#3f7d51" },
       "dark": { "page": "#101814", "accent": "#82be96" }
     }
   }
   ```

   - `rotliTheme` is the file version and the engine version together. v1 is
     frozen by `goldens.json`: the same seeds give the same tokens, byte for
     byte, so a saved theme never shifts colour after an update.
   - Seeds are the truth. Derived tokens are never stored, so nothing in a file
     can skip the gate. A half the file leaves out is worked out from the other
     and is never written back.
   - `id` is `^[a-z0-9][a-z0-9-]{0,47}$` and is the filename stem. `name` is
     plain text, at most 48 characters, control characters removed. Files over
     64 KB are refused unread.
   - The schema has no field that can hold a URL, an image, a font or free
     CSS. Every colour is parsed to numbers and re-emitted from numbers.
4. **Compatibility.** Reading never throws. Unknown fields at every depth
   survive a save. A newer `rotliTheme` is usable from the seeds this build
   understands but read-only. A file Rotli could not read is never
   overwritten. A save always reads back: pretty-printed when that fits under
   the cap, compact when only that fits, refused otherwise. A half the theme
   doesn't give stays in the file as written; the app never removes one.
5. **The built-ins are measured by the same gate** and their current failures
   are recorded in `builtinBaseline.json`, which may only shrink.
   `check:design-system` and `builtins.test.ts` fail on a new failure and on a
   recorded failure that now passes (which must be deleted from the file).

## Alternatives considered

- **Every token editable.** Most hand-made sets fail the gate, and the editor
  becomes a debugging tool. A whitelisted `overrides` block can come later and
  will go through the same gate.
- **Loosen the gate until the built-ins pass.** Custom themes would then ship
  the same gaps. Rejected by the owner.
- **Store derived tokens in the file.** A file could then carry an unreadable
  set past the gate, and a later engine could not re-tune it.
- **OKLCH strings in the file.** Hex is what every tool reads and a person can
  edit; OKLCH is the maths, not the format.

## Consequences

- Fifteen of the sixteen built-in environments have at least one pair under the
  gate today (only Tesven Light passes). Nine fail on their own token values;
  six fail only on the chat-buddy scene row, because the newer dark families
  inherit the light welcome-scene colours. Tuning them is a separate pass.
- The gate covers the pairs listed in `gate.ts`, written from `base.css`,
  `themes.css` and `canvas.css`. The other stylesheets' `color-mix()` and
  `opacity` layers are not yet modelled. Classing them may tighten the solver;
  that would be engine v2, applied only when a person chooses to re-tune.
- The engine's mirrored inputs (washes, label palette, accent presets, the
  buddy's line) are pinned to the stylesheets by `policy.test.ts`.

## Evidence

- `goldens.json` was generated from the plan's prototype engine before the port;
  `derive.test.ts` matches it byte for byte.
- `sweep.test.ts`: random seeds at every level and both modes, every pair
  passing. Run at 4,000 seed sets (24,000 environments) with
  `ROTLI_THEME_SWEEP_N=4000`: no failure.
- `themeFile.test.ts`: hostile and malformed files, unknown-field round trip,
  newer-version read-only, never overwriting an unreadable file.

## Revisit triggers

- Classing the remaining stylesheet layers changes a derived colour (engine v2).
- A vault-carried theme (an untrusted file) is added: re-read
  `docs/security/threat-model.md` first.
