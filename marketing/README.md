# Rotli launch films

The current homepage promo uses [HyperFrames](HYPERFRAMES.md): a 41.8-second film
with captions, original music, sound effects, and synthetic Playground footage.
The earlier Remotion source below is retained for reference.

Two reusable 18-second, 30fps Remotion compositions for the prelaunch campaign:

| Composition | Output | Use |
|---|---|---|
| `LaunchLandscape` | `out/rotli-launch-landscape.mp4`, 1920×1080 H.264 | Website, YouTube, product announcement |
| `LaunchPortrait` | `out/rotli-launch-portrait.mp4`, 1080×1920 H.264 | Reels, Shorts, vertical social |

The films use actual browser-preview UI, the app's canonical General Sans font,
brand palette, and existing quokka artwork. They are designed for muted playback;
there is no narration or music. Copy says **Mac beta in preparation**, not that a
release or download is available. Review that final card when launch status changes.

## Reproduce

Run from `marketing/` with the repository's Bun version:

```sh
bun ci
bun run check
bun run render
# Optional interactive editing:
bun run studio
```

Dependencies and the lockfile are isolated from the app. `prepare.mjs` copies
canonical assets; it does not invent a second brand system. `public/` and `out/`
are generated and ignored. The committed source capture is
`../site/public/rotli-playground@3x.png`, captured in Rotli Light at 4320 × 2700
by `scripts/capture-site.mjs` and visually reviewed. The quokka comes from the
1536px site export of the canonical SVG. Refresh both using the Bun commands in
`../site/README.md` after a visible product change, then rerender the films.

The storyboard is 0–4 seconds positioning, 4–13 seconds Playground, 13–18 seconds
invitation. Portrait uses a crop of the same real UI. `src/launchFilm.tsx` owns copy,
composition, and timing. See [Remotion render CLI](https://www.remotion.dev/docs/cli/render)
for still frames and alternative export codecs.

## Review evidence

Both compositions typechecked and rendered on 2026-09-07. FFprobe confirmed H.264,
30fps, intended dimensions, and ~18.05s container duration. Representative intro,
product, and closing frames were inspected visually for clipping and legibility.
Generated poster: `out/rotli-launch-poster.png`.

Suggested accompanying copy:

> Room to think. Files you keep. Rotli is a local-first Mac workspace built around
> one ordinary folder. Start in the Playground, try a few ideas, and save only
> what you want to keep. Mac beta in preparation: rotli.co

No assets were posted or published.
