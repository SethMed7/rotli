# rotli — UI/UX mockups · notes module · round 4 — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only; root pinned `data-theme="light"`)
**Input:** the maintainer's round-3 verdicts (focus mode ✅, ⌘K v2 ✅; footer, rail buttons, light-mode bug, Inbox question).

## The bug that mattered

the maintainer's Mac runs system dark mode. The kit's `tokens/colors.css` contains a `prefers-color-scheme: dark`
auto-switch scoped to `:root:not([data-theme="light"])` — so every gate page (and the "Light" half of the
side-by-side) rendered dark on his machine. **Fix:** all four gates now pin `<html data-theme="light">`;
dark renders only via the explicit `.rotli-dark` class. **Product note for Stage 2:** the app's theme
setting must be explicit (light/dark/system) — "system" is a choice, never a silent default that
overrides a demo or a user's pick.

## Changes in this round

1. **Floating status pill** replaces the attached footer (the maintainer's call): bottom-center, ground surface,
   pill radius, exactly three facts — *where it's saved (on this Mac · ~/rotli/Work) · character count ·
   last updated*. Fades to 40% while typing, returns on pause. Shortcut hints removed from chrome
   entirely (⌘K teaches them — approved r3 pattern).
2. **Visible rail toggles**: two icon buttons (folders / list) grouped after the titlebar identity behind
   a hairline — same actions as ⌘0 / ⌥⌘L, now discoverable. Hover labels per the quokka rule. Off-state
   = the clean single-pane view.
3. **Markdown-first restated in the surface**: active line drops to raw syntax with the markdown
   characters tinted clay-deep (`## `, `**`). Doc-style is a future *view mode* over the same `.md` —
   the file format never changes.
4. **Inbox story** (frame C): Inbox = a calm client for the user's existing email accounts (Gmail/iCloud/
   IMAP). Conversations live on the provider (email's source of truth); rotli keeps a local SQLite cache
   in `.rotli/` for offline read/search and thread-linked notes; replying sends normal email through the
   user's own account; **no rotli server, ever**. Local-first holds — fetching mail was always the one
   stated network exception, opt-in per account. Sequence: **v1 ships Notes only; Inbox is Phase 5.**

## Round-4 calls for the maintainer

1. Status pill: bottom-center (as mocked) or bottom-right? Fade-while-typing OK?
2. Rail toggle buttons: placement + grouping approved?
3. Markdown law locked (raw active line; doc-style later as a mode)?
4. Inbox story settled?

## Verdict (the maintainer, 2026-06-11)

- ❌ **Selection bubble — rejected** ("it is just random"). Replace with a Raycast-Notes-style persistent
  format bar, floating at the bottom, in rotli's theme → r5.
- 🔁 **Status pill** — content approved, position ceded to the format bar; move it elsewhere → r5 (header-inline).
- ✅ **Inbox story — liked**, with a hard requirement: **Proton must be supported and ranked first**
  (Google second) → r5 (Proton via Proton Mail Bridge, localhost IMAP/SMTP, on-device decryption).
- 🔁 **Identity label** — "Notes has no purpose; if it's there I should click it to toggle modules."
  r2's static-label law overruled: the identity IS the module switcher from day one → r5.

Continued in `../2026-06-11-ui-notes-mockups-r5/`.
