# Ambient audio and the sidebar player

Status: built 2026-09-28 (branch `feat/ambient-audio`). Owner's words: "if I put
a video in a tab, show an audio indicator on that tab, and right above the
sidebar footer have a little music player: prev, pause, stop, next, open tab";
then "Ambient audio: a setting; if on, the soundtrack is always there to jump
between the ambient sounds we made at studio.rotli.co. A video (or anything)
playing overrides it, and ambient slides to a toggle on the left I can click to
override the video. Pause the video or close its tab and ambient takes over
again. With the setting off, the player shows only while something plays."

## What the person sees

- **A speaker on a browser tab** while its page plays sound, before the close
  button. Clicking it pauses the tab.
- **The player**, right above Files · Librarian · Settings · Feedback
  (`src/components/sidebar/mediaPlayer.tsx`):
  - for a tab with media: its title, Previous, Play/Pause, Stop, Next, and
    Open the tab (its pane shows it, back from Breve or a board);
  - for ambient: "Ambient · Tide", Previous track, Play/Pause, Stop, Next
    track;
  - with Ambient audio on and a tab's media in view, ambient waits as the
    round toggle on the left; clicking it while the tab plays pauses the tab,
    and ambient takes over.
- **Settings → General → Ambient audio**: the switch, and the six tracks to
  pick from. Turning it on starts the track that sounds like the current theme
  family (unless one was picked before).

## The rules (`src/lib/ambient.ts`, `playerView`)

| Ambient audio | Tabs | Player | Ambient sounds |
|---|---|---|---|
| on | none with media | shows ambient | when the person wants it playing |
| on | one playing | shows the tab, ambient docked left | no |
| on | one paused (or suspended) | shows the tab, ambient docked left | when wanted |
| off | none with media | hidden | never |
| off | one playing or paused | shows the tab | never |

- The player follows the tab that is playing; else the one that played last
  while it still has media; else any tab with media.
- Rotli's own audio and video (a file, a Breve episode, a preview) pause
  ambient too, without taking the player: a capturing `play`/`pause` listener
  on the main document.
- "Override the video" is simply pausing it; the rules then resume ambient.
  There is no separate override flag to fall out of step.
- The preference `{enabled, track, playing}` is saved in Rotli's app settings
  on this Mac (`ambient` key). A launch never forces sound: if the webview
  refuses a play without a click, the player reads as paused.

## Knowing what a tab plays (`src-tauri/src/private_browser_media.rs`)

A browser tab's page is an untrusted guest with no channel to Rotli, so the
app asks. Once a second, while browser tabs are open, the main window calls
`private_browser_media_state(tabId)` for each; Rust asks the tab's WKWebView
(`requestMediaPlaybackStateWithCompletionHandler`, which covers iframes such as
video embeds) and answers `none`, `playing`, `paused` or `suspended` within
600 ms, else `none`. The API is macOS 12+; each selector is checked before it is
sent (Rotli still runs on 11, where every tab reads as silent). The state lives
only in memory (`src/state/ambient.ts`) and is dropped when the tab closes.

`private_browser_media(tabId, action)` runs one of five fixed actions, chosen
by a Rust enum; every script evaluated in the page is a literal in that file:

- **Pause**: WebKit's own `pauseAllMediaPlayback` (iframes included).
- **Play**: `play()` on the page's paused media (the main frame; a paused
  embed resumes from its own controls).
- **Stop**: pause, leave picture-in-picture and full screen, rewind.
- **Next**: YouTube's own next button; elsewhere nothing, rather than a guess.
- **Previous**: YouTube's own previous button when it shows, else rewind.

## The ambient tracks

The six tracks of the studio's playlist (studio.rotli.co; composed in code, no
samples, MIT), one per theme family: Linen (warm), Graphite (mono), Tide
(ocean), Canopy (grove), Dusk (iris), Lamplight (midnight). They ship in
`public/ambient/` (about 7.5 MB) so they play offline and nothing is fetched.
They are copied byte for byte from the studio's `sound/web/`; the studio
records the placement in its `publish/placements.json`.

## Known limits

- A browser tab's page is destroyed, not hidden, when its surface unmounts:
  opening Settings, switching to Board or another full view, Breve mode, or
  dragging the tab to another pane. Its sound stops and the player lets it go.
  So "watch a video, then open Settings" ends the video.
- Whether WebKit keeps a hidden (inactive) tab's sound playing is WebKit's
  behavior; Rotli only hides the view.

## Proof

- `src/lib/ambient.test.ts` (the rules table), `src/state/ambient.test.ts`,
  `src/services/ambient.test.ts` (the buttons), the rendered player and the
  settings section, and Rust tests for the state names, the action scripts,
  the YouTube host check and the action names.
- `e2e/ambient-player.spec.ts`: the setting, the player above the footer, and
  skipping tracks.
- Owed to the owner (native, cannot run in the browser build): a YouTube tab
  shows the speaker and takes over from ambient; pause/stop/next/previous and
  Open the tab work from the player; closing the tab brings ambient back; the
  ambient toggle pauses the video.
