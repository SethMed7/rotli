# Rotli Web — experience review (2026-09-27)

A hands-on walk through Rotli Web (`bun run dev:web`, a fresh vault in the
browser's private folder): every sidebar row, the System browsers, the
dashboard, Chat's setup, every Settings pane, the palette, the new-tab chooser,
the vault switcher, a 640 px window, and a dark theme. The walk is now a test,
`e2e/web/rotli-web-tour.spec.ts`: it fails on any console error or warning,
page error, or failed request on the way.

## Fixed in this change

| Found | Cause | Fix and test |
|---|---|---|
| A new vault's Tasks page read "Nothing open (0)"; the Welcome lessons hold 30 open tasks | The Welcome seed refreshed note lists but not the Tasks projection, so it kept the list it made before the lessons existed | `ensureWelcome` also invalidates Tasks · `rotli-web-fresh-vault.spec.ts` |
| The sidebar's This week card flipped between "0 new" and "10 new" | The count dropped notes created after its clock's last tick as "future" | No upper bound on the window · `homeDashboardModel.test.ts`, same spec |
| The dashboard's Recent notes and chats had the same bound | Same | Same fix in `dashboardSurface.tsx` |
| A web note's header said "On this Mac" | Hard-coded label | "In your folder" on the web · `rotli-web-honest-labels.spec.ts` |
| The new-tab chooser offered Browser on the web, which could only fail | The private browser is a native window | Shown disabled, "In the Mac app" · same spec |
| Settings' current pane was marked only by color | No `aria-current` | `aria-current="page"` · the tour spec |

## Checked and fine

- The vault gate's faint text is its entry animation; it settles at full contrast.
- Files on the web hands the open note to the Mac app (tested in
  `rotli-web-folder-vault.spec.ts`); with no note open it opens the Library.
- At 640 px the sidebar stays: one pane still has 400 px, above the 320 px
  pane floor (`refitColumns`).
- No console errors, warnings, or failed requests anywhere on the walk.

## Worth doing next

1. **The web parity list** (ROADMAP §6): every native command marked "works on
   the web", "refused with a notice", or "Mac only", with a check that fails on
   a new command without a decision. Today's Browser card was exactly such a
   silent gap.
2. **The welcome note's "Press ⌥A to open Chat"** assumes the Mac app or a
   paired helper; on the web it could point at Chat's setup instead.
3. **Excalidraw's selection accent** is its own violet, not Rotli's accent;
   `canvas.css` could map it to `--accent` so boards read as part of the app.
