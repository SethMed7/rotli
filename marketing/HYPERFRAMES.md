# Rotli launch films — creative and audit record

The homepage carries two films cut from a recorded shoot of the native Mac app
(2026-09-15, a fresh synthetic `Notebook` vault): a **79-second full promo**
(`hyperframes/index.html`, HyperFrames) and a **15-second silent teaser** for
the hero (built in `hyperframes/prepare.mjs`). Claude Code (Opus 5) made every
creative decision. GPT-6 Astra (Codex CLI) drove the app through computer use
for the takes, logged each take with timed selects and crops, and flagged
privacy hazards; the director chose and reframed the edit. Records live in the
ignored `_review/promo-v5/`. Backgrounds are plain color only. No voiceover.

## Delivered files

| Website artifact | Generated source |
|---|---|
| `site/public/media/rotli-promo.mp4` | `hyperframes/renders/rotli-launch-promo.mp4`, re-encoded (CRF 22, AAC 128 kbps) |
| `site/public/media/rotli-promo-poster.jpg` | `hyperframes/renders/rotli-launch-promo-poster.png` (the end card) |
| `site/public/media/rotli-promo.vtt` | `hyperframes/renders/rotli-launch-promo.vtt` |
| `site/public/media/rotli-teaser.mp4` | `hyperframes/renders/rotli-teaser.mp4` |
| `site/public/media/rotli-teaser-poster.jpg` | `hyperframes/renders/rotli-teaser-poster.jpg` |

## Story (full promo)

Cold open “One folder. / Your vault. / Room to think.”, then one beat per idea,
each a kicker and headline beside the recorded app:

1. Your vault — Everything lives in one folder of plain files.
2. The Librarian — AI keeps it organized for you. / It files notes. It never rewrites them. (Run now → “Filed … → Projects / Research”.)
3. Your views — Work in views, arranged however you want. / Same files underneath. Nothing moves.
4. Write — Plain Markdown that renders as you type.
5. Secure notes — Mark a note secure. / Cloud AI never sees it. Not even the title. (The note moves to Library › Secure notes.)
6. Chat — Chat with the AI you already pay for. / It answers from your notes. (Claude Code model picker; a real reply grounded in the Q4 note.)
7. Files — Browse your vault like you browse Finder.
8. Your views — Remove a note from a view. / It stays in your vault.
9. Trash — Delete moves it to Trash. / Rotli never erases a file.

Ending: “Built for you. And for your AI.”, then rotli / Room to think. Files you
keep. / Mac beta in preparation / rotli.co. Music: `audio/synth.py --bed energetic`.

## Footage and honesty boundary

`edl.json` names every recording (`sources`), range, crop, speed, and hold;
`scripts/sync-timings.mjs` writes the kickers, headlines, shot push-ins, and
music cues from it. The takes are full-display recordings; every crop sits
below the macOS menu bar. Captions were checked against the code: secure notes
are skipped by the Librarian (not filed by title), and Empty Trash hands files to
the macOS Trash, so “never erases a file” holds. Excluded from the edit: a macOS
Apple Music permission dialog and a Messages code popup (rejected takes), a
chat reply that misread an unselected choice row as a status (the row was
removed from the demo note and the chat re-recorded), the Library › Secure notes
folder showing Empty, a chat save-conflict warning (cropped out), and the
Librarian leaving one note unfiled.

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

- `lint`: 0 errors, 1 advisory warning (dense caption track).
- `verify`: 1920×1080, 30/1, h264 High yuv420p, 79.133 s / 2374 frames, AAC
  48 kHz stereo, −15.6 LUFS integrated, −4.8 dBTP. PASS.
- Blank-frame guard over the product frame: 2206 frames, 0 blank.
- Snapshots at 29 beat times and a 1 fps sheet of the whole product section
  reviewed by eye: no dialogs, notifications, or personal data in frame.
- Site: `SITE_MODE=full` build wires the teaser into the hero and the full film
  with captions into its own section.

No listening review is claimed. No commit, push, or deployment was made for the films.
