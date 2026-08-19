#!/bin/zsh
# gen_all.sh — rotli brand-world illustration set, 8 sequential agy (Nano Banana Pro) generations.
# agy does NOT support concurrent headless sessions — strictly one at a time (imagegen skill rule).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/gen.log"
: > "$LOG"

SPINE="Style: warm flat-shaded storybook illustration, soft rounded shapes, matte paper-grain feel, lamplit calm mood, generous quiet negative space, minimal detail, premium children's-book-meets-editorial register. STRICT palette, use ONLY these tones: cocoa #3A3028, clay blush #C97E62, peach cream #F2D6C2, linen #F8F2E9, olive moss #8D9A76 (deep warm dark allowed: #241D18). Absolutely no text, no letters, no watermark, no photorealism, no harsh gradients."

gen() {
  local name="$1"; local aspect="$2"; local desc="$3"
  local dest="$DIR/$name"
  if [[ -f "$dest" ]]; then echo "SKIP $name (exists)" >> "$LOG"; return; fi
  echo "=== $(date +%H:%M:%S) generating $name" >> "$LOG"
  agy -p "Use your image generation capability (Nano Banana / Gemini image) to create this image:

$desc

$SPINE

Quality: high. Aspect: $aspect.

Save the final PNG to this exact absolute path:
$dest

Then print ONLY that absolute path as the last line. If you cannot generate images, print exactly NO_IMAGE_CAPABILITY and why." \
    --add-dir "$DIR" \
    --dangerously-skip-permissions \
    --print-timeout 4m >> "$LOG" 2>&1
  if [[ -f "$dest" ]]; then echo "OK  $name" >> "$LOG"; else echo "FAIL $name" >> "$LOG"; fi
}

gen quokka-master.png "square 1024x1024" \
"THE rotli quokka mascot: one small, very round quokka, sitting upright, three-quarter view, calm gentle closed-mouth smile, sleepy-content eyes. Fur in cocoa #3A3028 with a peach cream #F2D6C2 belly and inner ears, tiny clay blush #C97E62 cheek dots. Soft bouba silhouette, stubby paws, small curled tail visible. Centered on a plain flat linen #F8F2E9 background, nothing else in frame, big margins."

gen quokka-poses.png "wide landscape 1536x1024" \
"Character sheet: the SAME small round quokka mascot (cocoa #3A3028 fur, peach cream #F2D6C2 belly and inner ears, clay blush cheek dots, calm smile) drawn 4 times in a single horizontal row on a flat linen #F8F2E9 background, identical character design across all poses: (1) writing in a tiny open notebook with a pencil, (2) sitting with one ear perked up listening, (3) holding up a small blank rounded tag by its string, (4) curled up asleep in a ball. Even spacing, no frames or boxes, no labels."

gen island-wide.png "wide landscape 1536x1024" \
"Very wide, very calm storybook island landscape: low horizon in the bottom third, gentle rolling dunes of linen #F8F2E9 sand, clusters of soft round olive moss #8D9A76 shrubs and a few rounded trees, one small cozy rounded hut with a warm clay blush #C97E62 glow in a window far in the distance, vast quiet peach cream #F2D6C2 sky taking the upper two thirds, a soft cocoa #3A3028 bird silhouette or two. Serene, spacious, hero-image composition with big empty sky for headline type."

gen lamp-nook.png "wide landscape 1536x1024" \
"Cozy night interior vignette: a small wooden desk corner in near-darkness, deep warm cocoa #241D18 surroundings, a little rounded desk lamp casting one soft warm pool of peach cream #F2D6C2 light onto a few sheets of blank linen #F8F2E9 paper and a small clay blush #C97E62 mug, everything outside the lamp pool falling gently into the dark. Quiet, intimate, dark-mode hero composition, most of the frame in calm darkness."

gen island-path.png "wide landscape 1536x1024" \
"Storybook dusk scene: a soft winding sand path in linen #F8F2E9 curving through gentle dune grass in olive moss #8D9A76, leading toward a small distant cozy glow of clay blush #C97E62 warm light near the horizon, sky a deepening peach cream #F2D6C2 fading into warm cocoa #3A3028 at the top. Calm journey feeling, path enters from bottom-left, lots of quiet space."

gen paper-linen.png "wide landscape 1536x1024" \
"Near-flat background texture: warm linen paper surface in #F8F2E9, extremely subtle woven paper grain and a faint soft vignette of peach cream #F2D6C2 warmth, no objects, no scene, just a beautiful quiet matte paper field usable as a website light background."

gen cocoa-night.png "wide landscape 1536x1024" \
"Near-flat background texture: deep warm cocoa-dark field in #241D18, extremely subtle paper tooth grain and the faintest warm clay #C97E62 breath of light in one corner, no objects, no scene, a quiet matte dark field usable as a website dark-mode background."

gen botanical-spots.png "wide landscape 1536x1024" \
"Sparse spot-illustration sheet on a flat linen #F8F2E9 background: a handful of small, well-separated, flat-shaded elements — two olive moss #8D9A76 leafy sprigs, one small branch with round leaves, one smooth cocoa #3A3028 pebble, one tiny clay blush #C97E62 round flower, one peach cream #F2D6C2 shell. Each element isolated with generous space around it so it can be cut out and reused, no overlaps, no frames, no labels."

echo "=== DONE $(date +%H:%M:%S)" >> "$LOG"
