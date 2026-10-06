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

/** The traced poses (waving.svg, celebrating.svg) are drawn on a 1024-unit canvas framed like
 * base.svg's 1254: this scale puts them on the rig's canvas. */
export const TRACED_SCALE = 1254 / 1024;

/** Where the ball sits on the rig's canvas: held at the belly in the base pose, caught between
 * the raised paws in the cheering one. Radius in canvas units. */
export const BALL = { held: { x: 622, y: 660 }, caught: { x: 627, y: 20 }, r: 120 } as const;

/** The leaf a quokka holds when it is handed one (canvas units), in front of the folded paws. */
export const PAWS = { x: 582, y: 590 } as const;

/**
 * The approved layered poses (src/assets/characters/concepts/layers/): white masks on a
 * 512-unit canvas framed like the 1254 one, so one canvas unit here is 1254/512 there. Each
 * names the box a scene shows (`view`, its bottom at the feet), the neck the head turns
 * about, the line between head and body layers (they overlap by `seam` on both sides), the
 * eyes for blinking, and where a held leaf sits.
 */
export interface LayeredPose {
  view: { x: number; y: number; width: number; height: number };
  neck: { x: number; y: number };
  seam: number;
  eyes: readonly { x: number; y: number; r: number }[];
  leaf: { x: number; y: number; angle: number };
}

export const LAYERED_UNIT = 1254 / 512;

export const LAYERED: Record<'listening' | 'thoughtful' | 'walking', LayeredPose> = {
  // Sitting up on its haunches, paws together at the chest: the one eating from its paws.
  listening: {
    view: { x: 72, y: 20, width: 356, height: 456 },
    neck: { x: 288, y: 214 },
    seam: 214,
    eyes: [
      { x: 245, y: 152, r: 15 },
      { x: 321, y: 144, r: 15 },
    ],
    leaf: { x: 268, y: 300, angle: -24 },
  },
  // Standing, one paw raised to the mouth: the one nibbling a leaf it holds up.
  thoughtful: {
    view: { x: 92, y: 14, width: 290, height: 474 },
    neck: { x: 280, y: 214 },
    seam: 208,
    eyes: [
      { x: 233, y: 145, r: 15 },
      { x: 307, y: 128, r: 15 },
    ],
    leaf: { x: 276, y: 202, angle: -58 },
  },
  // In profile, mid-stride, facing right: the stroller on the dunes.
  walking: {
    view: { x: 56, y: 34, width: 372, height: 436 },
    neck: { x: 330, y: 214 },
    seam: 210,
    eyes: [{ x: 348, y: 146, r: 13 }],
    leaf: { x: 360, y: 290, angle: 0 },
  },
};
