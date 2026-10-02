// The footer scenery's quokka rig: where the canonical base pose (src/assets/characters/
// base.svg, 1254-unit canvas) bends. Shared by the markup (QuokkaScene.astro) and the
// script that moves it (scene.ts), so a pivot is defined once. Every overlay drawn on top of
// the canonical art (eyes, brows, mouths, the reaching arm) uses INK_WIDTH, the outline's
// own stroke weight.

/** The part of the canvas a quokka occupies, with room above for a hop and out to the sides
 * for a raised arm. */
export const VIEWBOX = { x: 200, y: -70, width: 850, height: 1250 } as const;
/** The source line art's stroke weight, in canvas units. */
export const INK_WIDTH = 14;
/** The head turns about the neck. */
export const HEAD_PIVOT = { x: 622, y: 520 } as const;
/** The head layer is everything above this line; the torso layer everything below the other
 * (they overlap, so a tilted head never opens a gap at the cheeks). */
export const HEAD_CLIP_BOTTOM = 512;
export const TORSO_CLIP_TOP = 466;
/** The canonical eyes (centres), redrawn on top so they can look, blink, and squint. */
export const EYES = [
  { x: 522, y: 335 },
  { x: 724, y: 335 },
] as const;
/** The shoulders the arms swing from (viewer's left, viewer's right). */
export const SHOULDERS = {
  l: { x: 506, y: 604 },
  r: { x: 738, y: 604 },
} as const;
/** Mirror line for a quokka walking the other way. */
export const CENTER_X = 622;
/** How far an eye may travel inside its patch, and the most the head tilts (degrees). */
export const EYE_TRAVEL = 7;
export const HEAD_TILT = 6;
