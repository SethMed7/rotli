# rotli — UI/UX mockups · notes module · round 2 — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only)
**Input:** the maintainer's round-1 feedback + the `rotli-gate-r1-review` workflow (5 dimension reviewers + synthesis; 47 findings → 10 changes; full output: session task `w0ixi9hkb`).

## What changed from round 1

1. **Module switcher removed.** No switcher ships while only Notes exists — the titlebar carries a quiet
   module-identity label ("Notes": icon 14px + General Sans 13/500, transparent at rest, hover surface-2).
   Titlebar grammar: identity left · center empty · actions right (search magnifier deleted; ⌘K owns search).
2. **Readability pass** (token swaps only): gate gradients deleted (flat surface-2 backdrop); selected-row
   secondary text → full text color; checkbox borders → muted (were ~1.2:1); dark folder-selection gains the
   3px clay bar (one selection grammar); kbd uses tokens; done-check is cocoa-on-olive; flow arrows muted.
3. **Clay budget — one clay element per pane:** caret is cocoa; pin moved from note title to meta line;
   folder-sel icon de-accented; storage selected card flat + clay border + clay check (olive = save/sync only).
4. **Panes + tabs-within-panes** (terminal-style, the maintainer's ask) — see spec below.
5. **Chat-on-note future** structurally locked — see spec below; concept shown as Frame I.
6. Dedup deletions: list header row → filter-on-top; "markdown" footer label gone; raw-line pill gone;
   capture hint line gone (⌘⏎ demoted to palette).
7. Onboarding: one anatomy (128px art band → h4 → sentence → dots); Night swatch moved to Settings until derived.
8. Gate chrome: judge strips under frames; palette rendered over the real (dimmed) window; hover-label demo
   moved to a detail inset.

## The switcher spec (for when module 2 ships — not built in v1)

Identity label gains a 10px chevron at 60% opacity on hover (120ms fade); click opens a 224px popover
(surface, radius 12, shadow 0 12px 32px rgba(58,48,40,.18)): 32px rows icon + label + right-aligned hotkey,
current row tint + 3px clay bar; **unbuilt modules hidden, never greyed** (optional dismissible muted footer
"Inbox · Wiki · Voice · Board — coming"). Module hotkeys ⌃1–5 (⌘ numbers belong to tab-jump), rebindable,
plus "Go to <module>…" verbs in ⌘K.
**Rejected:** left icon rail (resident-app furniture in a visitor window — revivable later as opt-in
"Pin module rail" setting) · bottom bar (mobile idiom, collides with save footer) · detached segmented row
(spends a chrome row on navigation) · hotkey-only (fails quokka discoverability as sole mechanism; kept as a layer).

## The pane/tab law

- Pane tree; every pane owns a tab list; **a pane with exactly one tab renders zero tab chrome** — the
  simple Apple-Notes default is this system at rest.
- Strip: 34px on ground, 1px bottom border. Tabs 96–208px, always-labeled + 14px type glyph; inactive
  transparent/muted, hover surface-2; **active = surface fill merging into the editor** (Safari-style).
  Close × on active/hover only. Labeled + button.
- **Focus = 2px clay top edge on the focused pane's active tab only** (multi-pane only → single clay element
  by construction). No peach on tabs ever — peach is list selection + future drop zones.
- The note list stays singular, window-level; its selected row mirrors the focused pane's active tab.
- Splits duplicate the active tab into the new pane — never an empty pane. 320px min pane width; sidebar
  auto-collapses first, then the list.
- Tabs are created only by explicit gestures (⌘T, ⌘-click row, "Open in new tab", ⌘K); plain click replaces.
- Divider: 1px border, 8px hit zone, 2px cocoa@24% while dragging, never clay.
- Overflow: compress to 96px floor, then horizontal scroll with linen fade masks. No chevron dropdown.
- Tab drag-and-drop between panes (peach drop zones): **spec'd, deferred** — pointer behavior, can't be judged static.

## Keymap (all rebindable, all in ⌘K)

| Scope | Keys |
|---|---|
| Tabs | ⌘T new · ⌘W close · ⌃Tab cycle · ⌘1–8 jump · ⌘9 last |
| Panes | ⌘D split right · ⌘⇧D split down · ⌘⌥arrows focus · ⌘⌥W close pane |
| Chrome | ⌘0 sidebar · ⌥⌘S note list |
| Modules | ⌃1–5 reserved |
| Unchanged | ⌥Space summon · Esc dismiss · ⌘K palette · ⌘N new note |

## Chat-on-note structural locks (cheap now, expensive to retrofit)

1. Tab = `{ surfaceKind: 'note' | 'chat' (future: 'wiki'…), noteId, viewState }` — panes host *surfaces*.
   Round 2 ships only `note`, but renderer/session/actions dispatch on the kind; `note.openAsChat` reserved.
2. Notes gain `id:` (short ulid) in frontmatter on first open/edit; `.rotli/index` maps id↔path.
3. **Transcripts live at `.rotli/chats/<note-id>.jsonl` — the `.md` never carries chat content or a mode flag.**
   The note body IS the living summary; the conversation is scaffolding.
4. One shared document buffer per noteId across all tabs/panes; tabs hold cursor/scroll only; autosave
   (olive dot) hangs off the document.
5. Quiet-AI clause (added to `apps/rotli/DESIGN.md`): sentence/paragraph-level reveals, opacity only,
   respects reduced-motion, never character shimmer; status = one static muted line; zero AI indicators in
   the note list. Freshest AI edit = peach tint fading to ground.

## Round-2 calls for the maintainer

1. Switcher: static identity label in v1, popover spec for later — approve?
2. Tab law (zero-chrome single-tab pane; click replaces / ⌘-click opens; splits duplicate) — approve?
3. Focus grammar: clay tab edge + list mirror — enough?
4. Chat-on-note structural locks — lock?
5. Keymap: ⌘ numbers = tabs, ⌃ numbers = modules — bless?

## Verdict

**PENDING — awaiting the maintainer at the gate.**
