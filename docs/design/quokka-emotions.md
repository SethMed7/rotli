# Quokka emotions

Status: **slice 1 shipped on `feat/quokka-moods`; slice 2 proposed, waiting on
the owner's pick and on art.** 2026-09-28.

The quokka has fifteen drawn poses (`QUOKKA_POSES` in `src/brand/quokka.ts`).
Some are *semantic*: empty states and moments choose them to explain what is
happening (`notes`, `inbox`, `board`, `knowledge`, `local`, `chat`,
`attention`). The rest can be *moods*, the "Idle mood & pose" the person picks
in Settings → Appearance (`QUOKKA_IDLE_POSES`), which personal placements
follow.

## Slice 1: more moods from art we already have (shipped)

Before this slice, five moods: Content, Peaceful, Thoughtful, Attentive, and
Cheerful. Three more drawn poses already had fitted accessories for every angle
(`QUOKKA_ACCESSORY_ADJUSTMENTS`), so they became moods with no new art:

| Mood | Pose | Line |
| --- | --- | --- |
| Friendly | `waving` | Always says hello |
| Inquisitive | `searching` | Looking into things |
| Adventurous | `walking` | Off exploring |

`attention` is deliberately left out. It is the worried face that errors use,
and a resting mood never borrows an alarm. A unit test holds that line.

## Slice 2: new emotions (needs art; proposed)

Each of these needs a new drawing. Each has a place in the product already
waiting for it, so it is an expression with a job, not a sticker. Pick the
ones to draw. Four is a good first batch.

| Emotion | Where it would appear | Replaces today |
| --- | --- | --- |
| **Delighted** (paws up, sparkle eyes) | the What's new card after an update | `celebrating` (shared with the thank-you card) |
| **Grateful** (paw on heart) | the thank-you card and banner after setup | `celebrating` |
| **Proud** (chest out, small smile) | Tasks when the last open task is ticked | nothing (Tasks has no finish moment) |
| **Sleepy** (half-lidded, yawn) | the chat welcome late at night, and a mood | `rest` in the evening |
| **Oops** (sheepish, paw behind head) | recoverable errors: a failed save, a missed paste | `attention`, which stays for real warnings |
| **Focused** (reading glasses down, pencil) | Focus mode's empty editor | nothing |
| **Surprised** (round eyes, ears up) | a vault that changed on disk while open | nothing |

The Delighted and Grateful rows also fix a quiet repeat: both new cards
currently show `celebrating`, the same pose as the chat's end mark.

## Adding one (the pipeline that exists)

1. **Art.** A square concept PNG in the house style: flat body fill, uniform
   black line, transparent or plain background, head in the same place as
   `base`. It goes in `src/assets/characters/concepts/source/<name>.png`. The
   existing concepts (`attention`, `listening`, `thoughtful`, `walking`) are the
   reference. The owner approves the drawing before anything else.
2. **Layers.** `bun scripts/build-character-fills.mjs` splits every concept
   into `<name>-body`, `-line`, and `-detail` webp layers in
   `concepts/layers/`.
3. **Register.** Add the name to `QUOKKA_POSES` and `ConceptCharacterName`, and
   its layers to `LAYERED_ART` in `src/components/characterArt.ts`. Then add a
   head mount to `QUOKKA_POSE_MOUNTS` and a bucket-hat entry (plus glasses, if
   the head turns) to `QUOKKA_ACCESSORY_ADJUSTMENTS`. A three-quarter or side
   head also needs `bucketHatAngle` in `src/components/character.tsx`.
4. **Fit.** Use the throwaway harness loop: render the real `Character` at 66,
   152, and 440 px, with every accessory, in a light and a dark theme. Ears
   tuck under the brim, and no hat floats.
5. **Use.** Add the pose to `QUOKKA_IDLE_POSES` only if it is a mood; a moment
   picks it by name. Unit tests: `src/brand/quokka.test.ts` (catalog) and
   `src/components/character.test.ts` (placements). E2E: the picker spec
   `e2e/quokka-moods.spec.ts`, and the banner spec if the thank-you card uses
   it.

The thank-you banner (`components/onboarding/bannerCanvas.ts`) copies whatever
`Character` renders, so a new pose appears there with no extra work.
