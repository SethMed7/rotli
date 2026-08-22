# Appearance and personality lab

Status: isolated experiment. Nothing in this folder is imported by the Rotli
application, and no production theme, setting, selected state, character, or
runtime behavior changes until a direction is chosen.

Open `index.html` through the repository's development server to review the
interactive catalog.

Open `quokka-catalog.html` for the expanded character-only catalog. It keeps
three classes of work visually separate:

- **Exact geometry:** eleven 512px fill masks derived deterministically from
  the current SVG library. The browser applies any body color below the
  untouched canonical line drawing, including an arbitrary custom hex.
- **Current emotional library:** the existing ready, welcome, searching,
  reading, thinking, resting, and complete poses mapped to product moments.
- **New concepts:** thoughtful three-quarter, focused side walk, seated
  listening, gentle attention, and four removable accessories. These are
  review images only; approved ideas require a canonical vector redraw before
  production use.

The accessory concepts are round glasses, a bucket hat with ear openings, a
short scarf, and explorer goggles. A production accessory must be an independent
overlay so pose, body color, and accessory color remain separate preferences.

The eight concept PNGs were created with the built-in image generation path
from the canonical Cocoa base, celebrating, and searching references. Each
prompt locked the pear silhouette, face, ears, tuft, paw anatomy, tail, organic
black line, and flat-color language; requested only the named pose/emotion or
accessory; and prohibited text, extra characters, scenery, shadows, gradients,
and logo use. Flat chroma-key sources were converted to transparent PNGs with
the image-generation skill's local matte/despill helper. They remain clearly
labeled as generated hypotheses because their geometry is not source-identical.

## What the references suggest

T3 Code's Appearance surface is strongest when it makes an abstract choice
visible before it is applied:

- System, Light, and Dark are shown as small workspace previews, not just words.
- Named themes show both of their color modes together.
- Scheme, theme, and environment-specific controls are separated.
- The character at the live edge is a full-body companion rather than another
  product mark.

Rotli should borrow that clarity, not T3's glass, gradient-orb, import, or theme
marketplace language. Rotli still owns four flat environments and keeps semantic
contrast, conventional desktop controls, and user content visually primary.

## Catalog decisions

### Theme route

**A · Two families, richer previews** is the conservative route. It preserves
the current model—Paper & Charcoal and Rotli—while replacing the split-color
bars with small workspace previews. Mode and primary color stay separate.

**B · Four environments upfront** is easiest to scan but weakens the idea that
System follows a paired family. It is useful if people think in individual
rooms rather than families.

**C · My system pair** exposes capability already present in Rotli's state:
choose one light environment and one dark environment for macOS System mode.
It is the most personal route without inventing arbitrary user-authored themes
or another token format.

Suggested combination: A as the default Appearance structure, with C revealed
only when System is selected.

### Selected-state route

The reference settings navigation uses a quiet tinted surface, ordinary text,
and an accent-colored glyph. Rotli's bright solid-accent sidebar row inverts the
whole row and competes with the note.

**A · Accent wash** uses roughly a 10% accent mix, normal text, and an accent
glyph. It is the closest match to the requested quieter direction and keeps the
chosen primary color personal.

**B · Neutral lift** uses the environment's second surface and an accent glyph.
It is calmer still, but custom primary color becomes less visible.

**C · Bounded tint** adds a one-pixel selected border. It is clearest on low-
contrast displays but creates more visual boxes in dense trees.

Suggested direction: define selected roles once (`selected background`, `ink`,
`icon`, `border`) and apply A to navigation rows, menus, settings navigation,
and list selections. Primary actions, switches, progress, focus rings, and
destructive states keep their distinct grammar; “active” should not collapse
all interaction semantics into one style.

### End-of-chat character route

The current 20px quokka mark reads as product identity. The reference feels
alive because the live edge belongs to a full body with a grounded pose and
more visual mass.

- **Canonical line:** existing celebrating character at 84px; character, not logo.
- **Cocoa fill:** the exact same paths at 84px with a flat cocoa interior.
- **Green fill:** the exact same paths at 84px with a flat green interior. This
  tests color independently from pose, proportion, face, and silhouette.

Suggested lifecycle: reserve the space only at the final assistant turn, choose
a pose from semantic state (working, complete, needs attention), and use at most
one short entrance transition. No idle loop. Reduced motion is static. The
composer remains stable, and historical turns do not accumulate characters.

The two filled PNGs in `assets/` are deterministic color studies derived from
`src/assets/characters/celebrating.svg`. The build script flood-fills enclosed
transparent regions, then places the untouched canonical line art above the
fill. It introduces no alternate character geometry. Production should keep
the source as SVG and express approved fills through the brand token layer.

## Bun architecture scan

At the time of this experiment, Rotli was pinned to Bun 1.3.14, the latest
stable release then available.

High-value follow-ups:

1. Add `--no-orphans` specifically to `dev:app` after a focused supervisor test.
   Bun 1.3.14 can terminate a Bun process and its descendants when the terminal-
   owned parent dies. This directly reinforces the new Tauri development
   supervisor's reason for existing. Do not apply it globally to Breve or
   production schedulers. [Bun 1.3.14 release notes](https://bun.sh/blog/bun-v1.3.14)
2. Add an opt-in `test:changed` developer command. Bun 1.3.13 can follow the
   import graph from Git changes, which fits Rotli's focused-test workflow while
   preserving `bun run check` as the full gate. Trial `--isolate` separately;
   parallel mode should not become CI policy until shared-state tests prove
   clean. [Bun 1.3.13 release notes](https://bun.sh/blog/bun-v1.3.13)

Hold or reject for now:

- The rewritten `fs.watch()` backend is useful runtime hardening, but Rotli's
  durable vault watching belongs to the Rust host. Do not move that boundary
  into Bun just because the watcher improved.
- `Bun.Image` could replace `sharp` in a few repository checks, but it would not
  remove the transformer stack's transitive image dependency, and changing the
  provider-mark rasterizer would alter a visual regression boundary for little
  architectural gain.
- The isolated global store and HTTP/2/HTTP/3 paths are experimental. They do
  not belong in repository defaults or Rotli's provider transport yet.
- `Bun.WebView` and `Bun.cron()` duplicate responsibilities already owned by
  Tauri and Rotli's scheduler composition. They are not architecture wins here.

## Review questions

1. Theme structure: A alone, A + C, or four individual environments?
2. Selected state: accent wash, neutral lift, or bounded tint?
3. Character: line, cocoa fill, or green fill at the same 84px size?
4. Should the live-edge character appear after every completed answer, or only
   after the newest answer when the chat is idle?
