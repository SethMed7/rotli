# The empty pane's scenes and the Settings banners

Status: built (2026-09-29). The owner: "add a scene here in the empty state,
different scenes that match the different themes, that has more character and
uses the user's quokka, and somewhere very subtle a link to the repo and a
link to the site, so even the empty state is enjoyable."

When every tab is closed, the lone pane shows a small scene above "All clear"
and its three ways back in (`src/components/paneEmptyState.tsx`).

## One scene per theme family

| Family | Scene | Quokka pose |
|---|---|---|
| Rotli | Rottnest at golden hour, the lighthouse on the far hill | base |
| Paper & Charcoal | A writing desk: ruled lines, a paper stack, a pencil | thoughtful |
| Ocean | Low tide: a sailboat on the horizon, gulls | walking |
| Grove | An afternoon under the gum trees | listening |
| Iris | An iris field at dusk, a crescent moon and fireflies | attention |
| Blossom | A blossom branch, a paper lantern, drifting petals | celebrating |
| Midnight | Stargazing from the hill, the telescope | attention |

The art lives in `src/components/paneEmptyScenes.tsx` as one SVG stage each
(440×200, the ground line at y 170). The person's quokka (their style,
accessory and colors) stands on that line, drawn over the scene. It shows even
when the sidebar companion is off, because the scene is the empty state.

## Rules the scenes keep

- **Only the theme's colors.** The SVG holds classes, never a color. The
  `.sc-*` rules in `styles/app.css` paint with the family's tokens (`--tint`,
  `--surface`, `--surface-2`, `--accent`, `--text-muted`, `--border`), so each
  scene follows light and dark on its own. A unit test fails any hex,
  `rgb()`/`hsl()` or inline `fill`/`stroke` in a scene.
- **Quiet motion.** Stars and fireflies twinkle, petals drift, and the boat
  bobs. It's all slow, CSS-only, and off under reduced motion, and base.css
  pauses it when the window is put away. No timers.
- **Soft edges.** The scene fades out at its sides (a CSS mask), so it sits in
  the pane rather than as a box.
- **Where Rotli lives.** Below the actions, at 11px and 60% opacity, sit
  "rotli.co · source on GitHub" (`SITE_URL`, `ROTLI_REPO_URL`), opened in the
  browser. They are real buttons, so the keyboard reaches them.

## Adding a family

Add its scene to `PANE_SCENES`. The type requires one per `ThemeFamily`, and
the unit test checks that every family has its own. Draw with the existing
`.sc-*` classes, keep the ground at y 170, and leave the middle (x 180–260)
clear for the quokka.

## Settings banners (the same language)

The owner, 2026-09-29: "similar themes that come alive in the settings areas,
including heading banners for the different sections." Every Settings pane
opens on a banner (`src/components/settings/settingsBanner.tsx`) instead of a
bare heading. The banner holds:

- the theme family's backdrop (one of seven);
- the pane's own motif (one of eleven): a signpost for General, keycaps for
  Keybindings, a palette for Appearance, a browser window, books for the
  Librarian, a shield for Security, a chip with sparkles for AI Models, speech
  bubbles for Chat, a folder and a map pin for Location, a plug for
  Connections, and the lighthouse for About;
- the person's quokka at 62%, in that pane's pose;
- the title, a real `h3`, on the calm left.

Art lives in `settingsBannerArt.tsx` (640×120, ground at y 104). It uses the
same `.sc-*` token classes as the scenes, and its unit test enforces the same
no-color rule. The banner is as wide as the Settings rows below it (640px).
Its sky is a 6% breath of the accent over the surface, so the scene's own
surfaces still read.
