# rotli launch promo — HyperFrames source

A 58-second, 1920×1080, 30 fps H.264 promo for the rotli homepage, authored as
one HyperFrames HTML composition (`index.html`) with a GSAP timeline, brand
fonts, one take cut from the 2026-09-15 native screen recording (`edl.json`),
and original synthesized music — plus a 10.5-second silent hero teaser that
`prepare.mjs` cuts from the same recording.
[`../HYPERFRAMES.md`](../HYPERFRAMES.md) is the creative and audit record.

## Reproduce

Run from this directory with the repository's Bun 1.4 and a local `python3`
with numpy, FFmpeg 8 on `PATH`, and a headless Chrome that HyperFrames can find
(`bun scripts/hyperframes-local.mjs doctor`).

```sh
bun run ci               # frozen, script-free, isolated install (hyperframes 0.8.30, gsap 3.15.0)
bun run build            # assets → audio → captions → stems → lint → render → poster → verify
```

A fresh checkout first needs the source recording: link the 2026-09-15 native
screen recording to `_review/promo-v4/source.mov` at the repository root (it is
private and never committed). FFmpeg is required. `edl.json` lists every range
the build reads, with its crop, speed, optional final-frame hold, and privacy
mask; `prepare.mjs` writes the segment offsets to `assets/takes/full.json`.
After changing the EDL, retime the kickers, headlines, and `shots` table in
`index.html` and `CUTS` in `audio/synth.py` from that file.

All HyperFrames commands below run through `scripts/hyperframes-local.mjs`.
It removes inherited model credentials, forces frame descriptions off, and
disables telemetry, update checks, and auto-install. Do not bypass that wrapper.

| Script | What it does | Output |
|---|---|---|
| `prepare:assets` | copies brand fonts, the canonical compact mark, and pinned GSAP; cuts the EDL's full-promo take and builds the silent teaser | `assets/`, `vendor/`, `renders/rotli-teaser.*` |
| `audio` | synthesizes the 104 BPM energetic bed and effects with numpy, calibrated to −15.5 LUFS with ffmpeg's meter (`--bed calm` still builds the second cut's bed) | `assets/audio/*.wav` |
| `audio:energetic` | the same bed plus a listenable preview | `assets/audio/bed.wav`, `renders/preview/bed-energetic.m4a` |
| `captions` | derives WebVTT and SRT from the caption clips in `index.html` | `renders/*.vtt`, `renders/*.srt` |
| `stems` | mixes music-only and effects-only stems from the same timings | `renders/stems/*.wav` |
| `lint` / `check` | HyperFrames static and browser gates (layout, motion, WCAG contrast) | `snapshots/` |
| `snapshot` | twenty-six review frames, one per beat or seam, with vision description disabled | `snapshots/review/` |
| `render` | the film (`--video-frame-format png` for the UI recording) | `renders/rotli-launch-promo.mp4` |
| `poster` | the end card as a still | `renders/rotli-launch-promo-poster.png` |
| `verify` | ffprobe + EBU R128 evidence against the composition's declared length, fails on mismatch | `renders/verification.md` |
| `bun scripts/audio-levels.mjs` | per-cue SFX lift over the music stem and the tail level | stdout |
| `bun scripts/verify-site-player.mjs <preview-origin>` | proves the website player with the delivered files against a local preview | stdout + screenshot |

Everything under `assets/`, `vendor/`, `renders/`, `snapshots/`, and
`node_modules/` is generated and ignored. The parent copies delivery media
(`renders/rotli-launch-promo.mp4` re-encoded at CRF 22, `-poster.png` as JPEG, `.vtt`, and
`renders/rotli-teaser.mp4` with its poster) to the
site when it is time to publish; nothing here deploys or commits.

## Layout of the source

- `index.html` — the composition: tokens, clips, captions, audio, and the
  GSAP timeline. Captions are the single source for the VTT/SRT export; the
  root `data-duration` is the single source for the film length (the audio
  synth, stems, and verification read it).
- `prepare.mjs` — the only place that reaches outside this directory, and the
  owner of the take build; `edl.json` is the cut list.
- `audio/synth.py` — deterministic (seeded) synthesis and loudness calibration.
- `scripts/` — the credential-filtering wrapper, captions, stems, verification.
- `review/` — the storyboard brief and final-cut brief sent to GPT-6 Astra via
  Codex CLI, the reviews it returned, and the exec logs.

Two renderer rules learned the hard way, both recorded in `index.html` comments:
a timed `<video>` must not sit inside a timed wrapper, and only the first
`<video>` inside the pan container receives injected frames on render (later
ones came out blank while `snapshot` showed them). Hence one derived take.

Keep every beat honest: only real recorded UI, never an unmasked private range,
no invented UI, no downloads, and the status line stays "Mac beta in preparation".
