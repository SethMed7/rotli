# Show in Rotli: hiding parts of the chrome

Status: built 2026-09-28 (branch `feat/hide-chrome`). Owner's words: "a place
in settings where you can choose things to hide. For example you don't want
the overview or you don't want the browser button, you should be able to hide
it."

## What it is

Settings → Appearance → **Show in Rotli**: one switch per part of the chrome,
grouped by where it sits, all on by default. **Show everything** brings every
hidden part back. The list is `HIDEABLE` in `src/lib/hideable.ts`:

| Where | Item | Reached without it by |
|---|---|---|
| Title bar | New | ⌘N |
| Title bar | Split buttons | ⌘D, ⌘⇧D |
| Title bar | Browser | ⌘K "Open a private browser", the New chooser |
| Title bar | Theme | ⌘K, Settings → Appearance |
| Title bar | Back and forward | ⌘[, ⌘] |
| Title bar | Search | ⌘K opens it in its place |
| Sidebar | Activity overview (Home's "This week" card, Chat's Model usage card) | ⌘K "Rotli activity dashboard" |
| Sidebar | All notes, Captures, Tasks | ⌘K |
| Sidebar footer | Files, Librarian, Feedback | Finder; Settings → Librarian; ⌘K and Settings → About |
| Tabs | New tab + | ⌘T |

Hiding never removes a feature: every row in the table has another way in,
and each switch's description says which. Settings itself can't be hidden,
because it is where things come back from. The ⌘K entries for the dashboard,
Tasks, All notes and the private browser were added with this (they had no
way in but their buttons).

## Details

- Kept in Rotli's app settings on this Mac (`hidden`: only the hidden names,
  each `true`), read tolerantly: unknown names are dropped. It rides
  `src/state/appExtras.ts` with Ambient audio, the seam for app settings kept
  outside `persist.ts`.
- The keyboard walk over Home's rows skips hidden rows (`shownShortcuts`), so
  the cursor never lands on something invisible.
- The footer's grid gives each shown button an equal column, with no gap
  where a hidden one was.
- With Files, Librarian, and Feedback all hidden, the footer itself goes
  (`footerShown`): Settings alone is already in the titlebar. The tour's
  Settings step then points at the titlebar's Settings (a step's `anchor` may
  list selectors; the first on screen wins).

## Proof

`src/lib/hideable.test.ts`, `src/state/hidden.test.ts` (including the save and
load round trip), `src/components/sidebar/homeShortcuts.test.tsx`,
`src/components/settings/visibilitySettings.test.tsx`, and
`e2e/hide-chrome.spec.ts`: hiding the overview, Tasks, Theme and Feedback
removes them, the footer closes up, Tasks still opens from ⌘K, and Show
everything brings them back. The title bar's Browser button is Mac-only, so
hiding it is proved by the same switch path rather than in the browser build.
`e2e/sidebar-footer.spec.ts` proves the footer goes when only Settings would
be left, and that the tour's Settings step then points at the titlebar.

Breve's entry moved to Settings → Appearance → Sidebar (2026-09-30), where each front turns on and off (docs/design/sidebar-home-chat.md).
