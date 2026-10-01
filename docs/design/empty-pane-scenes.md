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

## First run's scenery (the same language)

The owner, 2026-09-30: "make the onboarding just like we did in the settings —
a full theme, life for the backdrop. The beginning can match our theme and even
preview the island … once they choose their theme everything forward needs to
match what they chose." (`src/components/onboarding/onboardingScenery.tsx`)

- **An island intro.** A fresh first run opens on a 1.7-second scene: Rottnest
  rises out of the sea, the lighthouse turns, the quokka hops onto the sand
  where Welcome's quokka stands, and "Rotli" appears. Its contents fade before
  its background, then setup fades in and its step rises. Any key or click
  skips it, it never takes pointer input, and it doesn't play under Reduce
  motion.
- **The app's opening** (the owner, 2026-09-30: "the animation should be there
  when someone opens the app fresh, even if onboarding is done").
  `onboarding/appOpening.tsx` plays the same kind of opening once per launch of
  the Mac app, in the person's theme: the island for Rotli, the family's empty-
  pane scene otherwise, with their dressed quokka. It never plays right after
  first run's intro, and never with Reduce motion on. It runs at 1.7× first
  run's pace (about 2.9 s; the owner: "happens way too fast"), and it holds
  still (`is-waiting`, animations paused) until the window has focus, since a
  launch can start behind other windows. Launch also brings the main window
  forward once the Dock policy is applied (`persist.ts`
  `applyShellSideEffects`): an Accessory app isn't activated by its own start.
  `?opening` shows it in the browser twin.
- **Welcome is the island** in Rotli Light, the environment every first run
  opens in.
- **After that, the chosen theme.** From Appearance on, the backdrop is the
  chosen family's Settings scenery (Rotli keeps the island). It changes with
  each pick and stays through where notes live and the model step.
- **Ground below the card.** The card stands on a floor, `--onb-floor`, that
  only takes the room the window has spare, so the card is never shorter for
  it. The horizon is drawn below that line; its top 30px, the band the card's
  footer may reach, is clear. No line art ever sits behind text or a button.
- **A living sky, not peeking quokkas** (the owner, 2026-09-30: "remove the
  rotlis popping out of the sides; better scenery like clouds or birds so it's
  fully alive"). `SkyLife` (`onboarding/onboardingSkyLife.tsx`) drifts clouds
  slowly across the page, and something crosses the upper sky: birds, a paper
  plane for Paper & Charcoal, petals for Blossom, twinkling stars for Midnight.
  It is masked to the side margins, so the setup card's column (a clear 1090px)
  never has anything behind its text. With Reduce motion on, each drifter
  stays still in its own spot. Settings shows the same sky in its side margins
  only.
- **The companion wears your choices.** Each step's big quokka keeps its pose
  and takes your chosen colour and accessory.
- **Theme cards are the site's orbs.** Each card holds a number, a name, and a
  lit Light and Dark orb (rotli.co's picker, with Blossom added). The orbs are
  the app's one radial-gradient surface, allowed only in
  `src/styles/theme-orbs.css` (`RADIAL_EXCEPTION` in
  `scripts/design-system-policy.mjs`, with its own test).
- Settings and first run share `SceneryLayers` (`settingsBanner.tsx`). The same
  unit-tested rule applies: no color of its own.

