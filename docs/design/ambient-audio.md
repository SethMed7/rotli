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

## Picking the sound, tucking a tab, Claude FM (2026-09-28, later)

The owner: "choose my ambient song in the media player"; "collapse one audio
tab … into the media tab"; "allow Claude FM to be the source … in a private
browser that is collapsed into the media player"; and "all of the audio
playing and pausing is extremely laggy".

- **What's chosen shows.** The player names the sound ("Tide", "Claude
  FM"; the note glyph says it's ambient), and the title only gives way in a
  sidebar under 150px (it used to at 220px, the usual width, so the choice
  was never visible). Claude FM has no Stop (a live stream's stop is Pause)
  and an **Open Claude FM in a tab** button: an ordinary tab on the stream,
  with ambient stepping back so the two never both play.
- **The source menu.** The ambient title in the player is a button that opens
  the sources: the six tracks, then Claude FM (`AMBIENT_SOURCES`), the current
  one highlighted. Choosing one starts it. Settings lists the same. Rotli Web
  hides Claude FM (no private browser there).
- **Claude FM** (`CLAUDE_FM` in `lib/ambient.ts`): Anthropic's 24/7 lo-fi
  stream on YouTube, at the address Claude Code's `/radio` opens. As the
  ambient source it plays in a private browser page with a fixed id
  (`ambient-claude-fm`), 1×1 and hidden, never a tab. The service keeps it
  matching the rules: when ambient should sound and the page isn't playing
  (it may still be loading), it asks the page to play again every 2.5 s, and
  the same for pause. It pauses when a tab plays, like the tracks; switching
  to a track or turning ambient off closes the page. If WebKit won't start it
  without a click, open Claude FM as an ordinary tab once, press play, and
  tuck it in instead.
- **Tucking a tab** (`services/mediaDock.ts`): the player offers "Tuck into
  the player" for the tab it controls. The tab leaves its pane; its page is
  marked retained (`lib/privateBrowser.ts`), so its surface skips the close on
  unmount, and it keeps being asked "are you playing?". "Open the tab" puts
  the same tab id back in the focused pane, whose new surface adopts the
  living page (shows it, no reload). "Close the tab" ends it. One at a time.
- **Responsiveness.** A button's result shows at once (the expected state is
  set before WebKit answers, then two quick polls confirm it); ambient fades
  out over ~0.1 s and starts audible, ramping over ~0.3 s; tabs are asked every
  0.4 s while anything has media (1.5 s otherwise), one round at a time so
  slow answers never pile up; the chosen track loads at launch.

## In setup (2026-09-28, later)

The owner: "have the music part be part of the onboarding for the app
experience." Setup gains a **Sound** step between Window and Shortcuts
(`src/components/onboarding/setupSound.tsx`, now step 4 of 7): Quiet, Studio
music (the chosen theme's track, named on the card), or Claude FM (Mac only).
Picking plays it at once, so the person hears the choice; Back and forth keeps
it. Skip app setup returns ambient to its default, off, like the rest of setup.

## Known limits

- A browser tab's page is destroyed, not hidden, when its surface unmounts:
  opening Settings, switching to Board or another full view, Breve mode, or
  dragging the tab to another pane. Its sound stops and the player lets it go.
  So "watch a video, then open Settings" ends the video — unless it is
  tucked into the player first, which keeps its page alive.
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
