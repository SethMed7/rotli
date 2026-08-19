# rotli — UI/UX mockups · notes module · round 5 — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only; root pinned light)
**Input:** the maintainer's round-4 verdicts (bubble rejected → Raycast-style bottom bar; status relocated; identity
must have a purpose; Proton first).

## Changes

1. **Format bar** (frame A): the floating selection bubble is dead. One persistent floating bar,
   bottom-center, ground surface, radius 12: H(level menu) | B I U S | code · link · quote | bullet ·
   numbered · checklist. Always in the same place (Raycast Notes pattern), writes real markdown, active
   states on tint. Hides in focus mode; collapses end groups into "⋯" on narrow panes. The Aa panel
   keeps only typography (size · measure) — heading levels moved to the bar.
2. **Status relocated** (frame A): header-inline next to Aa — saved dot · character count · updated ·
   where. The bottom belongs to the format bar now.
3. **Module switcher on the identity** (frame B): "Notes ⌄" opens the popover from day one (r2's
   static-label law overruled by the maintainer). Current module = tint + clay bar + ⌃1; unshipped modules shown
   quiet with phase pills (popover doubles as roadmap) — strict only-what-exists variant offered as the
   alternative. ⌃1–⌃5 jump; everything in ⌘K.
4. **Proton first** (frame D): Proton Mail supported via **Proton Mail Bridge** — runs on the user's Mac,
   decrypts locally, exposes localhost IMAP/SMTP; rotli detects Bridge and guides setup. Provider order:
   Proton → Gmail (REST API, needed for split-brain read state) → any IMAP (iCloud/Fastmail/Outlook).
   Caveats recorded: Bridge requires a paid Proton plan; Proton read-state behaves as standard IMAP.

## Round-5 calls for the maintainer

1. Format bar — approve?
2. Header-inline status — approve, or hover-the-dot-for-details quieter variant?
3. Switcher: phase-pill roadmap version vs strict only-what-exists?
4. Proton-first order + Bridge onboarding — approve?

## Verdict

**APPROVED — the maintainer, 2026-06-11** (format bar ✓ · header-inline status ✓ · phase-pill switcher ✓ · Proton-first ✓).

**Addendum (same day):** the maintainer renamed Wiki → **the Memory** and added the **Chat module** (before the
Memory) — designed in `../2026-06-11-ui-notes-mockups-r6/`.
