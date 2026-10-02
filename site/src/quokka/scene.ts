// Brings QuokkaScene.astro to life. One requestAnimationFrame loop per scene, running only
// while the scene is on screen, the tab is visible, and the visitor has not asked for
// reduced motion; otherwise nothing runs and the scene stands at rest. Pointer events only:
// a mouse is followed; a tap (touch or click) pokes a quokka or lands on the leaves.
// Everything moves through SVG transform attributes and the walker's CSSOM transform, so
// the page's Content-Security-Policy (style-src 'self') is never asked for an inline style.
import { CENTER_X, EYES, EYE_TRAVEL, HEAD_PIVOT, HEAD_TILT, SHOULDERS, VIEWBOX } from './rig';

type Mood = '' | 'mad' | 'sad' | 'happy';
type Side = 'l' | 'r';
type FoodState = 'calm' | 'near' | 'on';

interface Quokka {
  svg: SVGSVGElement;
  flip: SVGGElement;
  rig: SVGGElement;
  head: SVGGElement;
  blinks: SVGGElement[];
  looks: SVGGElement[];
  arms: Record<Side, SVGGElement>;
  /** Last attribute written per element, so unchanged frames write nothing. */
  written: Map<Element, string>;
  tilt: number;
  dip: number;
  eyeX: number;
  eyeY: number;
  reach: Side | '';
  arm: number;
  mood: Mood;
  moodUntil: number;
  queued: { mood: Mood; at: number } | null;
  hopAt: number;
  blinkAt: number;
  nextBlink: number;
  nibbleAt: number;
  facing: 1 | -1;
}

interface Pointer {
  x: number;
  y: number;
  at: number;
  mouse: boolean;
  /** False for a tap that poked a quokka: that is not a grab at the leaves. */
  food: boolean;
}

const HOP_MS = 460;
const BLINK_MS = 160;
const NIBBLE_MS = 1100;
const HAPPY_MS = 1800;
/** A tap is looked at for this long; a mouse is followed until it leaves the window. */
const TAP_MS = 2600;
const WALK_SPEED = 52; // px per second
const MID = { x: (EYES[0].x + EYES[1].x) / 2, y: EYES[0].y };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const random = (min: number, max: number) => min + Math.random() * (max - min);

function quokka(svg: SVGSVGElement, now: number): Quokka {
  const pick = <T extends Element>(selector: string) => svg.querySelector<T>(selector)!;
  return {
    svg,
    flip: pick<SVGGElement>('[data-flip]'),
    rig: pick<SVGGElement>('[data-rig]'),
    head: pick<SVGGElement>('[data-head]'),
    blinks: [...svg.querySelectorAll<SVGGElement>('[data-eye]')],
    looks: [...svg.querySelectorAll<SVGGElement>('[data-eye-look]')],
    arms: { l: pick<SVGGElement>('[data-arm="l"]'), r: pick<SVGGElement>('[data-arm="r"]') },
    written: new Map(),
    tilt: 0,
    dip: 0,
    eyeX: 0,
    eyeY: 0,
    reach: '',
    arm: 0,
    mood: (svg.dataset.mood as Mood | undefined) ?? '',
    moodUntil: svg.dataset.mood ? now + 2400 : 0,
    queued: null,
    hopAt: -Infinity,
    blinkAt: -Infinity,
    nextBlink: now + random(800, 4000),
    nibbleAt: -Infinity,
    facing: svg.dataset.face === 'left' ? -1 : 1,
  };
}

function write(q: Quokka, element: Element, name: string, value: string | null) {
  const key = `${name}=${value}`;
  if (q.written.get(element) === key) return;
  q.written.set(element, key);
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

/** A screen point in the quokka's own canvas units (its viewBox fills its box exactly). */
function toLocal(q: Quokka, rect: DOMRect, x: number, y: number) {
  const ux = VIEWBOX.x + ((x - rect.left) * VIEWBOX.width) / rect.width;
  const uy = VIEWBOX.y + ((y - rect.top) * VIEWBOX.height) / rect.height;
  return { x: q.facing === 1 ? ux : 2 * CENTER_X - ux, y: uy };
}

function rest(q: Quokka) {
  q.written.clear();
  for (const element of [q.rig, q.head, ...q.blinks, ...q.looks]) element.removeAttribute('transform');
  q.svg.removeAttribute('data-reach');
  if (q.svg.dataset.restMood) q.svg.dataset.mood = q.svg.dataset.restMood;
  else q.svg.removeAttribute('data-mood');
  for (const side of ['l', 'r'] as const) {
    q.arms[side].setAttribute('transform', `translate(${SHOULDERS[side].x} ${SHOULDERS[side].y})`);
  }
}

function animate(scenery: HTMLElement) {
  const foodEl = scenery.querySelector<SVGSVGElement>('[data-food]');
  const walkerEl = scenery.querySelector<SVGSVGElement>('[data-quokka="walker"]');
  const castEls = [...scenery.querySelectorAll<SVGSVGElement>('[data-quokka]:not([data-quokka="walker"])')];
  if (!foodEl || !walkerEl) return;
  for (const svg of [walkerEl, ...castEls]) if (svg.dataset.mood) svg.dataset.restMood = svg.dataset.mood;

  let raf = 0;
  let last = 0;
  let pointer: Pointer | null = null;
  let food: FoodState = 'calm';
  let cast: Quokka[] = [];
  let walker: Quokka;
  let nextHop = 0;
  const walk = { phase: 'waiting' as 'waiting' | 'walking' | 'pausing', x: 0, dir: 1, nextAt: 0, until: 0, pauseX: 0, paused: false, first: true };

  const setMood = (q: Quokka, mood: Mood, at: number) => {
    q.queued = { mood, at };
  };

  function onMove(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    pointer = { x: event.clientX, y: event.clientY, at: performance.now(), mouse: true, food: true };
  }
  function onLeave() {
    pointer = null;
  }
  function onDown(event: PointerEvent) {
    const now = performance.now();
    pointer = { x: event.clientX, y: event.clientY, at: now, mouse: event.pointerType === 'mouse', food: true };
    for (const q of [...cast, walker]) {
      const rect = q.svg.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside && rect.width > 0) {
        pointer.food = false;
        q.hopAt = now;
        if (q.mood !== 'sad') setMood(q, 'happy', now);
        q.moodUntil = now + HAPPY_MS;
      }
    }
  }

  function foodState(now: number): FoodState {
    if (!pointer || !pointer.food || (!pointer.mouse && now - pointer.at > TAP_MS)) return 'calm';
    const rect = foodEl!.getBoundingClientRect();
    const pad = 8;
    if (
      pointer.x >= rect.left - pad &&
      pointer.x <= rect.right + pad &&
      pointer.y >= rect.top - pad * 2 &&
      pointer.y <= rect.bottom + pad
    ) {
      return 'on';
    }
    const near = Math.max(110, scenery.clientHeight * 0.85);
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    return Math.hypot(dx, dy) < near ? 'near' : 'calm';
  }

  function frame(q: Quokka, now: number, dt: number, lookAt: { x: number; y: number } | null, extra: { bob?: number } = {}) {
    const rect = q.svg.getBoundingClientRect();
    if (rect.width === 0) return; // hidden at this width
    const unitsPerPx = VIEWBOX.width / rect.width;

    // Moods: queued changes land after a little stagger; happy wears off.
    if (q.queued && now >= q.queued.at) {
      q.mood = q.queued.mood;
      q.queued = null;
      if (q.mood === 'happy') {
        q.moodUntil = now + HAPPY_MS;
        q.hopAt = now;
      }
    }
    if (q.mood === 'happy' && now > q.moodUntil) q.mood = '';
    write(q, q.svg, 'data-mood', q.mood || null);

    // Where to look: the pointer, else the leaves.
    const target = lookAt ? toLocal(q, rect, lookAt.x, lookAt.y) : null;
    let tiltTarget = 0;
    let eyeX = 0;
    let eyeY = 0;
    if (target) {
      const dx = target.x - MID.x;
      const dy = target.y - MID.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, length / unitsPerPx / 90);
      eyeX = (dx / length) * EYE_TRAVEL * reach;
      eyeY = (dy / length) * EYE_TRAVEL * reach;
      tiltTarget = clamp(((target.x - HEAD_PIVOT.x) / unitsPerPx) / 260, -1, 1) * HEAD_TILT;
    }
    if (q.mood === 'sad') eyeY = EYE_TRAVEL; // eyes down at the leaves

    // Nibbling: a couple of dips toward the leaves.
    let dipTarget = 0;
    const nibble = (now - q.nibbleAt) / NIBBLE_MS;
    if (nibble >= 0 && nibble < 1) {
      dipTarget = 22 * Math.abs(Math.sin(nibble * Math.PI * 2));
      tiltTarget = HEAD_TILT * 1.4;
      eyeY = EYE_TRAVEL;
      eyeX = EYE_TRAVEL * 0.6;
    }

    q.tilt += (tiltTarget - q.tilt) * ease(dt, 140);
    q.dip += (dipTarget - q.dip) * ease(dt, 70);
    q.eyeX += (eyeX - q.eyeX) * ease(dt, 70);
    q.eyeY += (eyeY - q.eyeY) * ease(dt, 70);

    // A paw reaches for a mouse that comes close (not when sad, not while walking).
    let side: Side | '' = '';
    let armTarget = 0;
    if (target && pointer?.mouse && q.mood !== 'sad' && extra.bob === undefined) {
      for (const s of ['l', 'r'] as const) {
        const shoulder = SHOULDERS[s];
        const dx = target.x - shoulder.x;
        const dy = target.y - shoulder.y;
        const outward = s === 'r' ? dx > 0 : dx < 0;
        if (outward && Math.hypot(dx, dy) / unitsPerPx < rect.height * 1.25) {
          side = s;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI - 90;
          const normal = ((angle + 540) % 360) - 180;
          armTarget = s === 'r' ? clamp(normal, -165, -25) : clamp(normal, 25, 165);
        }
      }
    }
    if (side && q.reach !== side) {
      q.reach = side;
      q.arm = 0;
    }
    const lowering = !side && q.reach;
    q.arm += ((side ? armTarget : 0) - q.arm) * ease(dt, 90);
    if (lowering && Math.abs(q.arm) < 6) q.reach = '';
    write(q, q.svg, 'data-reach', q.reach || null);
    if (q.reach) {
      const s = SHOULDERS[q.reach];
      write(q, q.arms[q.reach], 'transform', `translate(${s.x} ${s.y}) rotate(${q.arm.toFixed(1)})`);
    }

    // Blink now and then; hop when poked, pleased, or bored.
    if (now >= q.nextBlink) {
      q.blinkAt = now;
      q.nextBlink = now + random(2400, 6200);
    }
    const blink = (now - q.blinkAt) / BLINK_MS;
    const open = blink >= 0 && blink < 1 ? 1 - 0.9 * Math.sin(blink * Math.PI) : 1;
    const hop = (now - q.hopAt) / HOP_MS;
    const lift = (hop >= 0 && hop < 1 ? -64 * Math.sin(hop * Math.PI) : 0) + (extra.bob ?? 0);

    write(q, q.rig, 'transform', lift ? `translate(0 ${lift.toFixed(1)})` : null);
    write(q, q.head, 'transform', `rotate(${q.tilt.toFixed(2)} ${HEAD_PIVOT.x} ${HEAD_PIVOT.y}) translate(0 ${q.dip.toFixed(1)})`);
    q.blinks.forEach((g, i) => {
      write(q, g, 'transform', open < 1 ? `matrix(1 0 0 ${open.toFixed(3)} 0 ${(EYES[i].y * (1 - open)).toFixed(1)})` : null);
    });
    for (const g of q.looks) write(q, g, 'transform', `translate(${q.eyeX.toFixed(1)} ${q.eyeY.toFixed(1)})`);
  }

  function stepWalker(now: number, dt: number) {
    const width = scenery.clientWidth;
    const size = walkerEl!.getBoundingClientRect().width;
    if (walk.phase === 'waiting') {
      if (now >= walk.nextAt) {
        // The first stroll sets off from where it stands; later ones come in from an edge.
        walk.dir = walk.first ? 1 : Math.random() < 0.5 ? 1 : -1;
        if (!walk.first) walk.x = walk.dir > 0 ? -size : width;
        walk.first = false;
      walk.pauseX = width * random(0.25, 0.7);
      walk.paused = false;
        walk.phase = 'walking';
        walker.facing = walk.dir > 0 ? 1 : -1;
        write(walker, walker.flip, 'transform', walk.dir > 0 ? null : `matrix(-1 0 0 1 ${2 * CENTER_X} 0)`);
      }
    }
    if (walk.phase === 'pausing' && now >= walk.until) walk.phase = 'walking';
    if (walk.phase === 'walking') {
      walk.x += walk.dir * WALK_SPEED * (dt / 1000);
      const centre = walk.x + size / 2;
      const rect = scenery.getBoundingClientRect();
      const pointerClose =
        pointer?.mouse && Math.abs(pointer.x - (rect.left + centre)) < 120 && pointer.y > rect.top - 160 && pointer.y < rect.bottom;
      const crossed = walk.dir > 0 ? centre >= walk.pauseX : centre <= walk.pauseX;
      if (!walk.paused && (crossed || pointerClose)) {
        walk.paused = true;
        walk.phase = 'pausing';
        walk.until = now + 1900;
      }
      if (walk.x > width + size || walk.x < -size * 2) {
        walk.phase = 'waiting';
        walk.nextAt = now + random(16_000, 34_000);
      }
    }
    walkerEl!.style.transform = `translateX(${walk.x.toFixed(1)}px)`;
    const walking = walk.phase === 'walking';
    // A hop for every step while walking; at a pause it turns to the pointer.
    const bob = walking ? -30 * Math.abs(Math.sin(now / 150)) : 0;
    const box = walkerEl!.getBoundingClientRect();
    const ahead = { x: box.left + box.width / 2 + walk.dir * 400, y: box.top + box.height * 0.3 };
    const look = walk.phase === 'pausing' && pointer ? pointer : walking ? ahead : null;
    frame(walker, now, dt, look, { bob });
  }

  function tick(now: number) {
    const dt = Math.min(64, now - last || 16);
    last = now;

    const state = foodState(now);
    if (state !== food) {
      const mood: Mood = state === 'on' ? 'sad' : state === 'near' ? 'mad' : 'happy';
      cast.forEach((q, i) => setMood(q, mood, now + i * 90 + random(0, 80)));
      food = state;
    }

    // Now and then one quokka hops for no reason, or the one by the leaves takes a bite.
    if (now >= nextHop && food === 'calm') {
      const idle = cast.filter((q) => q.mood === '' && q.svg.getBoundingClientRect().width > 0);
      const q = idle[Math.floor(Math.random() * idle.length)];
      if (q) {
        if (q.svg.dataset.quokka === 'q2' || q.svg.dataset.quokka === 'q3') q.nibbleAt = now;
        else q.hopAt = now;
      }
      nextHop = now + random(3800, 8200);
    }

    const live = pointer && (pointer.mouse || now - pointer.at < TAP_MS) ? pointer : null;
    const foodRect = foodEl!.getBoundingClientRect();
    const leaves = { x: foodRect.left + foodRect.width / 2, y: foodRect.top + foodRect.height / 2 };
    for (const q of cast) frame(q, now, dt, live ?? leaves);
    stepWalker(now, dt);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    const now = performance.now();
    cast = castEls.map((svg) => quokka(svg, now));
    walker = quokka(walkerEl!, now);
    walk.phase = 'waiting';
    walk.first = true;
    walk.x = walkerEl!.getBoundingClientRect().left - scenery.getBoundingClientRect().left;
    walk.nextAt = now + random(2500, 5000);
    nextHop = now + random(2000, 4000);
    food = 'calm';
    last = now;
    scenery.classList.add('is-live');
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    scenery.addEventListener('pointerdown', onDown);
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('blur', onLeave);
    scenery.removeEventListener('pointerdown', onDown);
    for (const q of [...cast, walker]) if (q) rest(q);
    walker.flip.removeAttribute('transform');
    walker.facing = 1;
    walkerEl!.style.removeProperty('transform');
    scenery.classList.remove('is-live');
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  const update = () => {
    const run = visible && !reduced.matches && !document.hidden;
    if (run && !raf) start();
    else if (!run && raf) stop();
  };
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    update();
  }).observe(scenery);
  reduced.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
}

document.querySelectorAll<HTMLElement>('[data-scenery]').forEach(animate);
