// The person the visitor walks along the footer beach, as drawn (QuokkaScene.astro's
// `[data-person]`, a 100 × 170 drawing facing right, feet at the bottom). This file only
// poses it: where it stands, which way it faces, how its legs and arms swing, the leaf in its
// hand, and the points a ball or a leaf leaves from. Its rules (walking, what it does where it
// stops) are ./human.ts; ./scene.ts decides. SVG attributes and a CSSOM transform only, so the
// page's CSP (style-src 'self') never sees an inline style attribute.
import { limbs, type Walk } from './human';

export interface Point {
  x: number;
  y: number;
}

/** The drawing's landmarks, in its own units. */
const VIEW = { width: 100, height: 170 } as const;
const HIPS = { back: { x: 45, y: 114 }, front: { x: 55, y: 114 } } as const;
const SHOULDER = { x: 50, y: 84 } as const;
/** Where a ball sits held in both hands, and where it is caught, arms up and forward. */
export const PERSON_BALL = { held: { x: 80, y: 90 }, caught: { x: 78, y: 62 } } as const;
/** The leaf in its front hand, as handed over. */
const HAND_LEAF = { x: 63, y: 109 } as const;

export type ArmPose = 'swing' | 'leaf' | 'hold' | 'catch';

/** Arm angles (degrees, about the shoulder; negative swings forward and up) per pose. */
const ARMS: Record<Exclude<ArmPose, 'swing'>, { back: number; front: number }> = {
  leaf: { back: 0, front: -28 },
  hold: { back: -62, front: -78 },
  catch: { back: -104, front: -118 },
};

const written = new WeakMap<Element, Map<string, string | null>>();
function write(element: Element, name: string, value: string | null) {
  let attrs = written.get(element);
  if (!attrs) written.set(element, (attrs = new Map()));
  if (attrs.get(name) === value) return;
  attrs.set(name, value);
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export interface PersonView {
  svg: SVGSVGElement;
  /** Its box on screen this frame (measure() refreshes it). */
  box: DOMRect;
  measure(): void;
  /** Shown or gone (a short fade, from the stylesheet). */
  show(here: boolean): void;
  /** Stand it at `x` (px from the scene's left edge, its centre) in this walk's stride. */
  pose(walk: Walk, x: number, arms: ArmPose, holdingLeaf: boolean): void;
  /** A point of the drawing (its own units), on screen, as it faces now. */
  toScreen(point: Point): Point;
  /** Where a leaf in its hand is, on screen. */
  hand(): Point;
  rest(): void;
}

export function personView(svg: SVGSVGElement): PersonView {
  const pick = (selector: string) => svg.querySelector<SVGGElement>(selector)!;
  const flip = pick('[data-person-flip]');
  const body = pick('[data-person-body]');
  const legs = { back: pick('[data-person-leg="back"]'), front: pick('[data-person-leg="front"]') };
  const arms = { back: pick('[data-person-arm="back"]'), front: pick('[data-person-arm="front"]') };
  const leaf = pick('[data-person-leaf]');
  let facing: 1 | -1 = 1;
  let lastX = Number.NaN;
  const view: PersonView = {
    svg,
    box: svg.getBoundingClientRect(),
    measure() {
      view.box = svg.getBoundingClientRect();
    },
    show(here) {
      svg.classList.toggle('is-here', here);
    },
    pose(walk, x, armPose, holdingLeaf) {
      if (x !== lastX) {
        lastX = x;
        const width = view.box.width || svg.clientWidth;
        svg.style.transform = `translateX(${(x - width / 2).toFixed(1)}px)`;
      }
      facing = walk.facing;
      write(flip, 'transform', facing === 1 ? null : `matrix(-1 0 0 1 ${VIEW.width} 0)`);
      const swing = limbs(walk);
      write(body, 'transform', swing.bob ? `translate(0 ${swing.bob.toFixed(2)})` : null);
      const turn = (g: SVGGElement, angle: number, at: { x: number; y: number }) =>
        write(g, 'transform', angle ? `rotate(${angle.toFixed(1)} ${at.x} ${at.y})` : null);
      turn(legs.back, -swing.leg, HIPS.back);
      turn(legs.front, swing.leg, HIPS.front);
      const set = armPose === 'swing' ? { back: swing.arm, front: -swing.arm } : ARMS[armPose];
      turn(arms.back, set.back, SHOULDER);
      turn(arms.front, set.front, SHOULDER);
      write(leaf, 'visibility', holdingLeaf ? null : 'hidden');
    },
    toScreen(point) {
      const ux = facing === 1 ? point.x : VIEW.width - point.x;
      return {
        x: view.box.left + (ux / VIEW.width) * view.box.width,
        y: view.box.top + (point.y / VIEW.height) * view.box.height,
      };
    },
    hand() {
      return view.toScreen(HAND_LEAF);
    },
    rest() {
      view.show(false);
      svg.style.removeProperty('transform');
      lastX = Number.NaN;
      for (const g of [flip, body, legs.back, legs.front, arms.back, arms.front]) write(g, 'transform', null);
      write(leaf, 'visibility', 'hidden');
    },
  };
  return view;
}
