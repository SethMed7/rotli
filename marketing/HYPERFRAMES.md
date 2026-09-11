# Rotli launch film — creative and audit record

The current homepage film is the 41.8-second HyperFrames composition in
`hyperframes/index.html`. Claude Code Fable 5.1 directed both cuts and consulted
GPT-6 Astra through Codex CLI twice: on the storyboard
(`hyperframes/review/gpt6-astra-review.md`) and on the final cut
(`hyperframes/review/gpt6-astra-final-review.md`, brief in `review/final-brief.md`).
GPT collected the synthetic Playground footage and inspected the real controls
through computer use. Existing Remotion work is preserved.

The film contains **captions, original music, and sound effects only. No voiceover**.

## Delivered files

| Website artifact | Generated source |
|---|---|
| `site/public/media/rotli-promo.mp4` | `hyperframes/renders/rotli-launch-promo.mp4` |
| `site/public/media/rotli-promo-poster.jpg` | `hyperframes/renders/rotli-launch-promo-poster.png`, converted to JPEG |
| `site/public/media/rotli-promo.vtt` | `hyperframes/renders/rotli-launch-promo.vtt` (SRT twin beside it) |

The export is 1920×1080, 30 fps, H.264 High/yuv420p, AAC 48 kHz stereo,
41.800 seconds (1254 frames), 7.09 MB. Captions are burned into the picture;
the VTT/SRT track carries the same 13 cues. The end card is the poster.
Music-only and effects-only stems are in the ignored `hyperframes/renders/stems/`.

## Edit

| Time | Picture and message |
|---|---|
| 0–4.5 | Words first: “One folder.” (0.2) / “Plain files.” (1.4) / “Room to think.” (2.6) accumulate; small wordmark in the corner |
| 4.5–8.5 | The workspace fades into the frame every later shot shares: full synthetic note in Rotli Warm Light. *Plain Markdown files. In a folder you choose.* |
| 8.5–12.4 | One 0.7 s reframe into the writing (heading, paragraph, task list, quote). *Headings, tasks, links. Plain text underneath.* |
| 12.4–14.4 | Hard cut to the full Playground lesson. *Ten lessons to try in the Playground.* |
| 14.4–19.5 | Recording, reframed onto the lesson header, task rows, and first results: the real tick at 15.63 and Raw Markdown at 17.77. *Tick a task. It stays in your note.* / *Raw Markdown is one click away.* |
| 19.5–23.3 | Raw Markdown hold, the real toggle back at 20.93, a short restored hold, the real save at 22.27 (“Lesson saved”, “Your copy is in Main”). *Save your own copy to your vault.* |
| 23.3–31.2 | Saved-state hold, a 0.7 s pull-back to bring the sidebar in, the real Chat press at 25.97, and the Chat front. *Chat is optional. On-device or a connected tool.* / *Connected chat can send the context you select.* |
| 31.2–37.8 | Six aligned theme captures, clean cuts, 1.1 s each, family names above the frame. *Six theme families. Each tuned for light and dark.* |
| 37.8–41.8 | Rotli, “Room to think. Files you keep.”, “Mac beta in preparation”, rotli.co |

General Sans, the Baloo wordmark, the canonical compact quokka mark, and Rotli
color tokens carry the film. Captions occupy a fixed linen band with 44 px
type, one line each. The music is a sparse plucked motif in D major with a
light pad and a resolved chord decaying to the last frame; quiet airs mark the
four hard cuts, a light tick sits on the recorded checkbox, and soft presses sit
on the four recorded button presses. Nothing plays on theme cuts or reframes.
`audio/synth.py` synthesizes all audio locally with seeded NumPy and FFmpeg.
No downloaded music, samples, paid audio service, or narration.

### What changed in the second cut

The first cut (44 s) was a sequence of stills with fades: a static task shot, a
static Chat screenshot, and only two of the five recorded interactions. The
second cut makes the middle one continuous take of the real recording (tick →
Raw Markdown → back → save → Chat) with two purposeful camera moves, cuts the
opening from 5 to 4.5 s, replaces the rise-in entrance with a plain fade,
removes the margin quokka from the Chat beat, keeps the Chat beat to about five
seconds after the press, labels themes by family only, and shortens every
caption to one glance. Astra's final-cut notes that were adopted: the save
separation, the caption rewrites (except the Raw Markdown line, which keeps the
control's real name), the shorter Chat beat, the family-only labels, and the
plain entrance. Not adopted: the 0.2/1.2/2.4 opening (too fast for the third
line) and moving the tick before the reframe settles.

## Capture and privacy boundary

Inputs are the source-controlled demo/Playground, the seven synthetic site
captures, and canonical brand assets. No native app window, live vault,
personal notes, browser profile, or model conversation was captured.

`bun run capture:launch` uses a fresh browser context against a local stable
preview, rejects a native bridge, asserts Home/Chat with no Breve, and blocks
requests outside that origin. It captures actual task/source/save controls,
lossless 2880×1800 frames with real timestamps, and a high-quality 30fps MP4.
Only that MP4 feeds the film. Its visible events, measured by frame
differencing, are at source 2.43 (tick), 4.57 (Raw Markdown), 6.43 (back),
6.97 (save), and 9.17 (Chat), static afterwards; `shots.json` agrees within a
frame. `prepare.mjs` cuts the recording at those times into one derived take
and bakes each editorial hold in as a frozen frame of the recording itself, so
every hold is a pixel-exact continuation (maximum local frame difference at the
seven seams in the delivered MP4: 8–22 on a 0–255 scale, i.e. codec noise; a
real UI change measures 98–187). Recheck the event times
after any fresh capture.

The Chat shot shows navigation, not a model response. The save shows the
Playground's own control and status line in the browser twin, whose saved
copies live in memory; browser capture does not prove native filesystem,
titlebar, Keychain, scheduler, or updater behavior. The caption describes the
product feature, not the footage.

## Toolchain and safeguards

- HyperFrames **0.8.30** and GSAP **3.15.0**, isolated in `hyperframes/` with a
  frozen Bun lockfile, script-free install, and the repository's three-day
  minimum release age. Unchanged in the second cut.
- Every package rendering command uses `scripts/hyperframes-local.mjs`.
  It passes only an explicit environment allowlist, omits inherited model
  credentials, disables telemetry/update checks/auto-install, and forces
  snapshot descriptions off. This controls those CLI paths; it is not an OS
  network sandbox. Render assets and GSAP are local, with no CDN dependency.
- Two renderer rules found while building the take, both now commented in the
  composition: a timed `<video>` may not sit inside a timed wrapper (lint
  error), and only the first `<video>` inside the pan container receives
  injected frames on render — later ones came out blank for their whole slot
  while `snapshot` and `check` showed them correctly. A frame-luminance scan of
  the delivered MP4 is the guard: zero blank frames inside the take.
- FFmpeg 8.0.1 handles local encoding, the derived take, metering, and poster
  conversion. Fonts and artwork retain the repository's existing license records.
- Generated assets, raw frames, renderer output, and local logs are ignored.
  Only the reviewed delivery files go into the website's public directory.

**Recorded incident (first cut):** the initial HyperFrames snapshot command
automatically sent 14 synthetic composition frames to Gemini because it
detected an existing model API key in its inherited environment. Those frames
contained demo content, not personal notes. The descriptions were not used.
The user was informed; all later rendering uses the credential-filtering
wrapper and disables both descriptions and telemetry. The second cut ran only
through the wrapper.

## Verification

- `lint`: 0 errors, 3 advisory warnings (duplicate static media discovery for
  the Warm Light capture used twice, dense tracks 2/3). `check`: runtime,
  layout (19 samples), and motion clean; 7/7 text contrast checks pass WCAG AA.
- Frames of the delivered MP4 were inspected before and after each recorded
  event, at each seam, and at the opening, both reframes, the Playground
  arrival, the saved state, three themes, the fade into the end card, and the
  end card. Visible-change frames in the MP4 by frame differencing: tick 15.60,
  Raw Markdown 17.87, save 22.33, Chat 26.13; the toggle back between 20.85 and
  21.05 by inspection. The effects sit at 15.63, 17.82, 20.93, 22.30, and 26.08,
  so each press leads its visible change by at most two frames.
- `verify`: 1920×1080, 30/1, h264 High yuv420p, 41.800 s / 1254 frames, AAC
  48 kHz stereo, −18.9 LUFS integrated, 5.8 LU range, −3.0 dBTP. PASS.
  Frame-luminance scan of the take: 564 frames, 0 blank.
- `audio-levels`: presses lift the mix over the music stem by 2.0–5.0 dB and
  the tick by 1.6 dB; the last 0.5 s sits at −62.6 dB RMS, so the bed decays
  rather than stops. The airs at 4.3 and 31.0 coincide with accent notes in the
  bed and lift it only 0.2–0.3 dB, so those two transitions are effectively
  carried by the music alone. No listening review is claimed; a human mix pass
  remains useful.
- Website: `scripts/verify-site-player.mjs` against a local static preview
  (fresh browser context, only the preview origin reachable) proved the poster
  (`image/jpeg`, 66,577 bytes), MP4 (`video/mp4`, 7,085,055 bytes), and VTT
  (`text/vtt`, 973 bytes) are served, the real “Watch the film” control starts
  playback (1920×1080, 41.80 s), and the caption track loads 13 cues. Run
  against the full build and the coming-soon build (production's mode).
- Repository `bun run verify` (CI's local twin) passed: secrets, quality, e2e,
  and rust lanes.

Limitation: burned-in captions are 44 px at 1080p, comfortable on a laptop
embed but small on a phone; the VTT track is the phone-size accessibility path.

The film and site are staged locally. No commit, push, deployment, signing,
notarization, installed-app change, or native vault mutation was performed.
