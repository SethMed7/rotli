// Brings QuokkaScene.astro to life. One requestAnimationFrame loop per scene, running only
// while the scene is on screen and the tab is visible. Pointer events only: a mouse brings the
// visitor's person onto the beach and it walks to the pointer (a tap does the same on a touch
// screen, the arrow keys from "Walk on the beach"); stopped at the pile it picks a leaf up, at
// a quokka it hands it over, by the players it joins their catch (./human.ts, ./person.ts). A
// press-and-drag on the leaf pile still carries a leaf by hand (mouse, pen, or touch) to a
// quokka or onto the sand; a tap pokes a quokka or throws the ball.
//
// Under reduced motion nothing moves on its own (no stroll, no game of catch, no blinks or
// bites, no hops, no heads following the pointer), and the loop runs only while the visitor
// plays: the person steps straight to where it is sent, and leaves and balls arrive at once. Everything moves through SVG attributes and CSSOM transforms, so the page's
// Content-Security-Policy (style-src 'self') is never asked for an inline style attribute.
// The rules that do not need the DOM (who gets a leaf, the ball's arc, a falling leaf, the
// guard's mood) live in ./play.ts.
import { arrived, createWalk, deed, entrance, onSand, stepWalk, type Spot, type Walk } from './human';
import { PERSON_BALL, personView, type ArmPose, type PersonView } from './person';
import { arc, dropTarget, guardMood, leafFall, type Box, type Mood, type Point } from './play';
import { BALL, CENTER_X, EYES, EYE_TRAVEL, HEAD_PIVOT, HEAD_TILT, LAYERED, PAWS, VIEWBOX, type LayeredPose } from './rig';

type Role = 'sitter' | 'nibbler' | 'guard' | 'player-a' | 'player-b' | 'walker';

interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Quokka {
  role: Role;
  svg: SVGSVGElement;
  flip: SVGGElement;
  rig: SVGGElement;
  head: SVGGElement;
  layered: LayeredPose | null;
  view: View;
  pivot: Point;
  mirrorX: number;
  blinks: SVGGElement[];
  looks: SVGGElement[];
  poses: Map<string, SVGGElement>;
  lids: SVGGElement | null;
  held: SVGGElement | null;
  box: DOMRect;
  facing: 1 | -1;
  restFacing: 1 | -1;
  tilt: number;
  dip: number;
  eyeX: number;
  eyeY: number;
  lift: number;
  pose: string;
  poseUntil: number;
  mood: Mood;
  moodUntil: number;
  queued: { mood: Mood; at: number } | null;
  hopAt: number;
  hopHeight: number;
  blinkAt: number;
  nextBlink: number;
  /** Eating: bites left in the leaf it holds (0: it would like another), and when to bite. */
  bites: number;
  biteAt: number;
  nextBite: number;
  hungrySince: number;
  /** The guard holds a handed leaf this long. */
  holdUntil: number;
}

interface PointerState extends Point {
  at: number;
  mouse: boolean;
}

interface Flight {
  from: Point;
  to: () => Point;
  at: number;
  ms: number;
  lift: number;
  onLand: (now: number) => void;
}

interface Fallen {
  el: SVGSVGElement;
  from: Point;
  at: number;
  landedAt: number;
}

/** The visitor's person: its drawing, its walk, and what it carries. */
interface Person {
  role: 'person';
  view: PersonView;
  walk: Walk;
  target: number;
  here: boolean;
  holding: boolean;
  joined: boolean;
  /** The player who last threw it the ball (it throws to the other). */
  lastFrom: Quokka | null;
  /** Arms stay up in a catch until then. */
  catchUntil: number;
  /** The quokka the visitor sent it to: it stands beside it, not in front of it. */
  aim: string | null;
  /** When the visitor last did anything with it; it wanders off a while after. */
  seenAt: number;
  /** It has acted on this stop already. */
  settled: boolean;
  keyDir: -1 | 0 | 1;
  focused: boolean;
}

/** Whoever can hold the ball: a quokka or the visitor's person. */
type Catcher = Quokka | Person;
const isPerson = (c: Catcher): c is Person => c.role === 'person';

type BallState =
  | { phase: 'held'; by: Catcher; since: number; wait: number }
  | { phase: 'flying'; from: Point; to: Catcher; at: number; ms: number; lift: number; high: boolean }
  | { phase: 'caught'; by: Catcher; at: number };

const HOP_MS = 460;
const BLINK_MS = 160;
const HAPPY_MS = 1800;
const BITE_MS = 760;
const CHEW_MS = 1000;
/** A tap is looked at for this long; a mouse is followed until it leaves the window. */
const TAP_MS = 2600;
const WALK_SPEED = 52; // px per second
/** The person wanders off this long after the visitor last played with it. */
const LINGER_MS = 7000;
/** Under reduced motion the loop keeps running this long after the last input. */
const CALM_MS = 3000;
const MID = { x: (EYES[0].x + EYES[1].x) / 2, y: EYES[0].y };
const FULL: Record<Role, number> = { sitter: 6, nibbler: 8, guard: 0, 'player-a': 0, 'player-b': 0, walker: 0 };
const NAMES: Record<Role, string> = {
  sitter: 'The quokka sitting by the pile',
  nibbler: 'The quokka nibbling beside it',
  guard: 'The quokka minding the pile',
  'player-a': 'One of the quokkas playing catch',
  'player-b': 'One of the quokkas playing catch',
  walker: 'The quokka out for a walk',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const random = (min: number, max: number) => min + Math.random() * (max - min);
const boxOf = (rect: DOMRect): Box => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
const near = (p: Point, rect: DOMRect, pad: number) =>
  p.x >= rect.left - pad && p.x <= rect.right + pad && p.y >= rect.top - pad && p.y <= rect.bottom + pad;

/** Attribute writes that skip unchanged values, so a still frame writes nothing. */
const written = new WeakMap<Element, Map<string, string | null>>();
function write(element: Element, name: string, value: string | null) {
  let attrs = written.get(element);
  if (!attrs) written.set(element, (attrs = new Map()));
  if (attrs.get(name) === value) return;
  attrs.set(name, value);
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function quokka(svg: SVGSVGElement, now: number, ambient: boolean): Quokka {
  const pick = <T extends Element>(selector: string) => svg.querySelector<T>(selector)!;
  const kind = svg.dataset.poseKind as keyof typeof LAYERED | undefined;
  const layered = kind ? LAYERED[kind] : null;
  const view = layered ? layered.view : VIEWBOX;
  const role = svg.dataset.quokka as Role;
  const facing = svg.dataset.face === 'left' ? -1 : 1;
  return {
    role,
    svg,
    flip: pick<SVGGElement>('[data-flip]'),
    rig: pick<SVGGElement>('[data-rig]'),
    head: pick<SVGGElement>('[data-head]'),
    layered,
    view,
    pivot: layered ? layered.neck : HEAD_PIVOT,
    mirrorX: layered ? view.x + view.width / 2 : CENTER_X,
    blinks: [...svg.querySelectorAll<SVGGElement>('[data-eye]')],
    looks: [...svg.querySelectorAll<SVGGElement>('[data-eye-look]')],
    poses: new Map([...svg.querySelectorAll<SVGGElement>('[data-pose]')].map((g) => [g.dataset.pose ?? '', g])),
    lids: svg.querySelector<SVGGElement>('[data-lids]'),
    held: svg.querySelector<SVGGElement>('[data-held]'),
    box: svg.getBoundingClientRect(),
    facing,
    restFacing: facing,
    tilt: 0,
    dip: 0,
    eyeX: 0,
    eyeY: 0,
    lift: 0,
    pose: 'base',
    poseUntil: 0,
    mood: (svg.dataset.mood as Mood | undefined) ?? '',
    moodUntil: svg.dataset.mood ? now + 2400 : 0,
    queued: null,
    hopAt: -Infinity,
    hopHeight: 1,
    blinkAt: -Infinity,
    nextBlink: ambient ? now + random(800, 4000) : Infinity,
    bites: FULL[role],
    biteAt: -Infinity,
    nextBite: ambient ? now + random(1200, 3200) : Infinity,
    hungrySince: 0,
    holdUntil: 0,
  };
}

/** A screen point in the quokka's own canvas units (its viewBox fills its box exactly). */
function toLocal(q: Quokka, x: number, y: number): Point {
  const ux = q.view.x + ((x - q.box.left) * q.view.width) / q.box.width;
  const uy = q.view.y + ((y - q.box.top) * q.view.height) / q.box.height;
  return { x: q.facing === 1 ? ux : 2 * q.mirrorX - ux, y: uy };
}

/** A point in the quokka's canvas units, on screen; it rides along with a hop. */
function toScreen(q: Quokka, point: Point): Point {
  const ux = q.facing === 1 ? point.x : 2 * q.mirrorX - point.x;
  return {
    x: q.box.left + ((ux - q.view.x) * q.box.width) / q.view.width,
    y: q.box.top + ((point.y + q.lift - q.view.y) * q.box.height) / q.view.height,
  };
}

const visible = (q: Quokka) => q.box.width > 0;
const heldPoint = (q: Quokka): Point => (q.layered ? q.layered.leaf : PAWS);

function setPose(q: Quokka, pose: string) {
  if (q.pose === pose || !q.poses.has(pose)) return;
  q.pose = pose;
  for (const [name, g] of q.poses) write(g, 'visibility', name === pose ? null : 'hidden');
}

function rest(q: Quokka) {
  for (const element of [q.rig, q.head, ...q.blinks, ...q.looks]) write(element, 'transform', null);
  q.pose = '';
  setPose(q, 'base');
  if (q.lids) write(q.lids, 'visibility', 'hidden');
  if (q.held) {
    write(q.held, 'transform', null);
    write(q.held, 'visibility', FULL[q.role] > 0 ? null : 'hidden');
  }
  write(q.svg, 'data-mood', q.svg.dataset.restMood ?? null);
}

function animate(scenery: HTMLElement) {
  const wrap = scenery.parentElement;
  const button = wrap?.querySelector<HTMLButtonElement>('[data-feed]') ?? null;
  const walkButton = wrap?.querySelector<HTMLButtonElement>('[data-walk]') ?? null;
  const personEl = scenery.querySelector<SVGSVGElement>('[data-person]');
  const status = wrap?.querySelector<HTMLElement>('[data-feed-status]') ?? null;
  const foodEl = scenery.querySelector<SVGSVGElement>('[data-food]');
  const ballEl = scenery.querySelector<SVGSVGElement>('[data-ball]');
  const carriedEl = scenery.querySelector<SVGSVGElement>('[data-carried]');
  const svgs = [...scenery.querySelectorAll<SVGSVGElement>('[data-quokka]')];
  if (!foodEl || !ballEl || !carriedEl || !personEl || svgs.length === 0) return;
  for (const svg of svgs) if (svg.dataset.mood) svg.dataset.restMood = svg.dataset.mood;

  let raf = 0;
  let last = 0;
  /** Listening for the visitor (the scene is on screen in a visible tab). */
  let running = false;
  /** Motion allowed: the scene lives on its own. Off, it moves only while the visitor plays. */
  let ambient = true;
  let calmUntil = 0;
  const person: Person = {
    role: 'person',
    view: personView(personEl),
    walk: createWalk(0),
    target: 0,
    here: false,
    holding: false,
    joined: false,
    lastFrom: null,
    aim: null,
    catchUntil: 0,
    seenAt: 0,
    settled: true,
    keyDir: 0,
    focused: false,
  };
  let cast: Quokka[] = [];
  let by: Partial<Record<Role, Quokka>> = {};
  let pointer: PointerState | null = null;
  let carry: (Point & { id: number; fromX: number; fromY: number; mouse: boolean }) | null = null;
  let flight: Flight | null = null;
  let fallen: Fallen[] = [];
  let deliveredUntil = 0;
  let droppedUntil = 0;
  let awayAt = -Infinity;
  let inScene = false;
  let ball: BallState | null = null;
  let sceneRect = scenery.getBoundingClientRect();
  let foodRect = foodEl.getBoundingClientRect();
  let ballRect = ballEl.getBoundingClientRect();
  const walk = { phase: 'waiting' as 'waiting' | 'walking' | 'pausing', x: 0, dir: 1, nextAt: 0, until: 0, pauseX: 0, paused: false, first: true };

  const setMood = (q: Quokka, mood: Mood, at: number) => {
    if (q.mood !== mood && q.queued?.mood !== mood) q.queued = { mood, at };
  };
  const hop = (q: Quokka, now: number, height = 1) => {
    if (!ambient || now - q.hopAt < HOP_MS) return;
    q.hopAt = now;
    q.hopHeight = height;
  };
  const say = (text: string) => {
    if (status) status.textContent = text;
  };
  const pileCentre = (): Point => ({ x: foodRect.left + foodRect.width / 2, y: foodRect.top + foodRect.height * 0.45 });

  // ——— Leaves: carried, handed over, or dropped ———

  function receive(q: Quokka, now: number) {
    deliveredUntil = now + HAPPY_MS;
    calmUntil = Math.max(calmUntil, now + HAPPY_MS + 400);
    hop(q, now, 1.2);
    if (q.held) write(q.held, 'visibility', null);
    if (FULL[q.role] > 0) {
      q.bites = FULL[q.role];
      q.hungrySince = 0;
      q.nextBite = now + 500;
    } else {
      q.holdUntil = now + 2600;
      q.biteAt = now + 300;
    }
    cast.forEach((other, i) => {
      if (other !== q && other.role !== 'walker') setTimeout(() => hop(other, performance.now(), 0.6), 120 + i * 90);
    });
    say(`${NAMES[q.role]} took the leaf.`);
  }

  function handTo(q: Quokka, from: Point, now: number, ms: number, lift: number) {
    flight = {
      from,
      to: () => toScreen(q, heldPoint(q)),
      at: now,
      ms: ambient ? ms : 1,
      lift: ambient ? lift : 0,
      onLand: (at) => receive(q, at),
    };
    wake();
  }

  function release(now: number) {
    if (!carry) return;
    const point = { x: carry.x, y: carry.y };
    const moved = Math.hypot(carry.x - carry.fromX, carry.y - carry.fromY);
    const mouse = carry.mouse;
    carry = null;
    scenery.classList.remove('is-carrying');
    // A tap on the pile, not a drag: nothing is carried off. On a touch screen it sends the
    // person there instead (a mouse already brought it).
    if (moved < 8) {
      say('');
      if (!mouse) sendPerson(point.x, now);
      return;
    }
    const target = dropTarget(
      point,
      cast.filter(visible).map((q) => ({ q, box: boxOf(q.box) })),
      18,
    );
    if (target) {
      handTo(target.q, point, now, 240, 12);
      return;
    }
    // Over open sand: it drifts down and lies there a moment, and the guard is sad (at once,
    // under reduced motion, and it is gone).
    say('The leaf fell on the sand.');
    if (!ambient) {
      droppedUntil = now + 2400;
      calmUntil = Math.max(calmUntil, droppedUntil + 200);
      return;
    }
    const el = carriedEl!.cloneNode(true) as SVGSVGElement;
    el.removeAttribute('data-carried');
    scenery.append(el);
    fallen.push({ el, from: point, at: now, landedAt: 0 });
    if (fallen.length > 3) fallen.shift()?.el.remove();
  }

  /** The keyboard's way: a leaf from the pile to whoever wants one most. */
  function feed() {
    const now = performance.now();
    if (!running || flight) return;
    const shown = cast.filter((q) => visible(q) && q.role !== 'walker');
    const target =
      shown.find((q) => FULL[q.role] > 0 && q.bites === 0) ??
      shown.find((q) => q.role === 'guard') ??
      shown[0];
    if (target) handTo(target, pileCentre(), now, 700, 70);
  }

  function placeLeaf(el: SVGSVGElement, p: Point, angle: number) {
    const w = el.getBoundingClientRect().width || 48;
    el.style.transform = `translate(${(p.x - sceneRect.left - w / 2).toFixed(1)}px, ${(p.y - sceneRect.top - w / 3).toFixed(1)}px) rotate(${angle.toFixed(1)}deg)`;
  }

  // ——— Pointer ———

  function onMove(event: PointerEvent) {
    const now = performance.now();
    if (carry && event.pointerId === carry.id) {
      carry.x = clamp(event.clientX, sceneRect.left + 8, sceneRect.right - 8);
      carry.y = clamp(event.clientY, sceneRect.top + 8, sceneRect.bottom - 6);
      wake();
    }
    if (event.pointerType !== 'mouse') return;
    pointer = { x: event.clientX, y: event.clientY, at: now, mouse: true };
    // The person comes onto the beach with the mouse and walks to it.
    sceneRect = scenery.getBoundingClientRect();
    if (near(pointer, sceneRect, 0)) sendPerson(event.clientX, now);
  }
  function onLeave() {
    pointer = null;
  }
  function onDown(event: PointerEvent) {
    const now = performance.now();
    const at = { x: event.clientX, y: event.clientY };
    pointer = { ...at, at: now, mouse: event.pointerType === 'mouse' };
    wake();
    if (near(at, foodRect, 6) && !flight) {
      event.preventDefault();
      carry = { ...at, id: event.pointerId, fromX: at.x, fromY: at.y, mouse: event.pointerType === 'mouse' };
      try {
        scenery.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the window's listeners still follow it.
      }
      scenery.classList.add('is-carrying');
      say('You picked up a leaf.');
      return;
    }
    if (near(at, ballRect, 10) && ball?.phase === 'held') {
      throwBall(now, true);
      return;
    }
    let poked = false;
    for (const q of cast) {
      if (!visible(q) || !near(at, q.box, 0)) continue;
      poked = true;
      hop(q, now);
      if (q.mood !== 'sad') setMood(q, 'happy', now);
      q.moodUntil = now + HAPPY_MS;
      if (q.role.startsWith('player') && ball?.phase === 'held') throwBall(now, true);
    }
    // A tap on the sand (or on a quokka) sends the person there; a mouse already brought it.
    if (event.pointerType !== 'mouse' || (poked && !person.here)) sendPerson(at.x, now);
  }
  function onUp(event: PointerEvent) {
    if (carry && event.pointerId === carry.id) release(performance.now());
  }

  // ——— The ball: two quokkas in the corner playing catch, and the person if it joins ———

  const holdAt = (c: Catcher): Point => (isPerson(c) ? c.view.toScreen(PERSON_BALL.held) : toScreen(c, BALL.held));
  const catchAt = (c: Catcher): Point =>
    isPerson(c) ? c.view.toScreen(PERSON_BALL.caught) : toScreen(c, BALL.caught);
  const hopCatcher = (c: Catcher, now: number, height: number) => {
    if (!isPerson(c)) hop(c, now, height);
  };
  const reachUp = (c: Catcher, now: number, ms: number) => {
    if (isPerson(c)) c.catchUntil = now + ms;
    else {
      setPose(c, 'cheer');
      c.poseUntil = now + ms;
    }
  };
  const lower = (c: Catcher) => {
    if (isPerson(c)) c.catchUntil = 0;
    else setPose(c, 'base');
  };

  const toPersonSoon = () => person.here && person.joined;

  /** Who the ball goes to next: between the players, by way of the person when it plays. */
  function nextCatcher(thrower: Catcher): Catcher | undefined {
    const a = by['player-a'];
    const b = by['player-b'];
    if (isPerson(thrower)) {
      if (thrower.joined && thrower.lastFrom) return thrower.lastFrom === a ? b : a;
      // Leaving the game (or the beach) with the ball: it goes to the nearer player.
      const x = thrower.view.box.left + thrower.view.box.width / 2;
      const gap = (q: Quokka | undefined) => (q ? Math.abs(q.box.left + q.box.width / 2 - x) : Infinity);
      return gap(a) <= gap(b) ? a : b;
    }
    if (person.here && person.joined) {
      person.lastFrom = thrower;
      return person;
    }
    return thrower === a ? b : a;
  }

  function throwBall(now: number, high: boolean) {
    if (ball?.phase !== 'held') return;
    const thrower = ball.by;
    const catcher = nextCatcher(thrower);
    if (!catcher || (!isPerson(catcher) && !visible(catcher))) return;
    hopCatcher(thrower, now, 0.7);
    if (isPerson(thrower)) thrower.catchUntil = 0;
    const lift = high ? sceneRect.height * 0.62 : sceneRect.height * 0.32;
    ball = {
      phase: 'flying',
      from: holdAt(thrower),
      to: catcher,
      at: now,
      ms: ambient ? (high ? 1250 : 950) : 1,
      lift: ambient ? lift : 0,
      high,
    };
    if (high) for (const c of [thrower, catcher]) if (!isPerson(c)) setMood(c, 'happy', now + 200);
    wake();
  }

  function stepBall(now: number): Point | null {
    if (!ball) return null;
    if (ball.phase === 'held') {
      const holder = ball.by;
      if (isPerson(holder)) {
        // The person keeps playing while it stands with them; leaving, it hands the ball back.
        if (!holder.here || !holder.joined) throwBall(now, false);
        else if (ambient && now - ball.since > ball.wait) throwBall(now, false);
      } else {
        const pointerNear = pointer?.mouse && near(pointer, holder.box, 140) && !person.joined;
        if (pointerNear) ball.since = now; // they stop to watch you
        // On their own they play only while motion is allowed; with the person, they throw to it.
        const toPerson = person.here && person.joined;
        if ((ambient || toPerson) && now - ball.since > ball.wait) throwBall(now, false);
      }
      if (ball.phase === 'held') return holdAt(ball.by);
    }
    if (ball.phase === 'flying') {
      const t = (now - ball.at) / ball.ms;
      const to = catchAt(ball.to);
      if (t > 0.45) reachUp(ball.to, now, 400);
      if (t >= 1) {
        ball = { phase: 'caught', by: ball.to, at: now };
        if (isPerson(ball.by)) say('You caught the ball.');
        return to;
      }
      return arc(ball.from, to, t, ball.lift);
    }
    if (ball.phase === 'caught') {
      const t = ambient ? (now - ball.at) / 420 : 1;
      const top = catchAt(ball.by);
      if (t < 0.55) return top;
      if (t >= 1) {
        const holder = ball.by;
        const wait = isPerson(holder) ? random(900, 1500) : toPersonSoon() ? random(500, 900) : random(1400, 3200);
        ball = { phase: 'held', by: holder, since: now, wait };
        lower(holder);
        return holdAt(holder);
      }
      lower(ball.by);
      const bottom = holdAt(ball.by);
      const k = (t - 0.55) / 0.45;
      return { x: top.x + (bottom.x - top.x) * k, y: top.y + (bottom.y - top.y) * k };
    }
    return null;
  }

  // ——— One quokka, one frame ———

  function frame(q: Quokka, now: number, dt: number, look: Point | null, opts: { bob?: number; chew?: boolean } = {}) {
    if (!visible(q)) return;
    const layered = q.layered !== null;
    const unitsPerPx = q.view.width / q.box.width;

    if (q.queued && now >= q.queued.at) {
      q.mood = q.queued.mood;
      q.queued = null;
      if (q.mood === 'happy') {
        q.moodUntil = Math.max(q.moodUntil, now + HAPPY_MS);
        hop(q, now);
      }
    }
    if (q.mood === 'happy' && now > q.moodUntil) q.mood = '';
    if (!layered) write(q.svg, 'data-mood', q.mood || null);
    // A leaf handed to a quokka that is not one of the eaters stays in its paws a while.
    if (q.held && FULL[q.role] === 0) write(q.held, 'visibility', now < q.holdUntil ? null : 'hidden');
    if (q.poseUntil && now > q.poseUntil) {
      q.poseUntil = 0;
      setPose(q, 'base');
    }

    // Where to look: the head turns toward it, and (on the rigged pose) the eyes follow. Under
    // reduced motion heads stay still.
    const target = look && ambient ? toLocal(q, look.x, look.y) : null;
    let tiltTarget = 0;
    let eyeX = 0;
    let eyeY = 0;
    const tiltMax = layered ? 7 : HEAD_TILT;
    if (target) {
      const dx = target.x - MID.x;
      const dy = target.y - MID.y;
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, length / unitsPerPx / 90);
      eyeX = (dx / length) * EYE_TRAVEL * reach;
      eyeY = (dy / length) * EYE_TRAVEL * reach;
      tiltTarget = clamp((target.x - q.pivot.x) / unitsPerPx / 260, -1, 1) * tiltMax;
    }
    if (q.mood === 'sad') eyeY = EYE_TRAVEL; // eyes down at the leaves

    // A bite (the head dips to the leaf it holds) or a chew (small quick nods).
    let dipTarget = 0;
    const bite = (now - q.biteAt) / (opts.chew ? CHEW_MS : BITE_MS);
    if (bite >= 0 && bite < 1) {
      if (opts.chew) {
        dipTarget = (layered ? 3 : 8) * Math.abs(Math.sin(bite * Math.PI * 5));
      } else {
        dipTarget = (layered ? 9 : 22) * Math.sin(bite * Math.PI);
        tiltTarget = tiltMax * (layered ? -0.6 : 1.4);
      }
      eyeY = EYE_TRAVEL;
    }

    const k = (tau: number) => (ambient ? ease(dt, tau) : 1);
    q.tilt += (tiltTarget - q.tilt) * k(140);
    q.dip += (dipTarget - q.dip) * k(60);
    q.eyeX += (eyeX - q.eyeX) * k(70);
    q.eyeY += (eyeY - q.eyeY) * k(70);

    if (now >= q.nextBlink) {
      q.blinkAt = now;
      q.nextBlink = now + random(2400, 6200);
    }
    const blink = (now - q.blinkAt) / BLINK_MS;
    const open = blink >= 0 && blink < 1 ? 1 - 0.9 * Math.sin(blink * Math.PI) : 1;
    const hopT = (now - q.hopAt) / HOP_MS;
    const hopUnits = (layered ? 26 : 64) * q.hopHeight;
    q.lift = (hopT >= 0 && hopT < 1 ? -hopUnits * Math.sin(hopT * Math.PI) : 0) + (opts.bob ?? 0);

    write(q.rig, 'transform', q.lift ? `translate(0 ${q.lift.toFixed(1)})` : null);
    write(q.head, 'transform', `rotate(${q.tilt.toFixed(2)} ${q.pivot.x} ${q.pivot.y}) translate(0 ${q.dip.toFixed(1)})`);
    if (q.lids) write(q.lids, 'visibility', open < 0.5 ? null : 'hidden');
    q.blinks.forEach((g, i) => {
      write(g, 'transform', open < 1 ? `matrix(1 0 0 ${open.toFixed(3)} 0 ${((EYES[i]?.y ?? 0) * (1 - open)).toFixed(1)})` : null);
    });
    for (const g of q.looks) write(g, 'transform', `translate(${q.eyeX.toFixed(1)} ${q.eyeY.toFixed(1)})`);
  }

  // ——— The eaters: a leaf in their paws, a bite now and then, and hope for another ———

  function eat(q: Quokka, now: number, dt: number, look: Point | null, chew: boolean) {
    const watching = pointer?.mouse && near(pointer, q.box, 120);
    if (watching || carry) q.nextBite = Math.max(q.nextBite, now + 600); // they stop to look at you
    if (ambient && q.bites > 0 && now >= q.nextBite) {
      q.biteAt = now;
      q.bites -= 1;
      q.nextBite = now + random(chew ? 1800 : 1300, chew ? 3600 : 2800);
      if (q.bites === 0) q.hungrySince = now + (chew ? CHEW_MS : BITE_MS);
    }
    if (q.held && q.layered) {
      const left = q.bites / FULL[q.role];
      const shown = q.bites > 0 || now < q.hungrySince;
      const { x, y } = q.layered.leaf;
      const s = 0.45 + 0.55 * left;
      write(q.held, 'visibility', shown ? null : 'hidden');
      write(q.held, 'transform', s < 1 ? `translate(${x} ${y}) scale(${s.toFixed(2)}) translate(${-x} ${-y})` : null);
    }
    // Out of leaf: it looks to the pile (or the leaf you carry), and before long fetches one.
    let target = look;
    if (q.bites === 0 && now > q.hungrySince) {
      const lure = carry ?? personLeaf();
      target = lure ?? (watching ? look : pileCentre());
      if (lure && near(lure, q.box, 160)) hop(q, now, 0.35);
      if (ambient && now - q.hungrySince > 15_000) {
        q.bites = FULL[q.role];
        hop(q, now, 0.8);
      }
    }
    frame(q, now, dt, target, { chew });
  }

  // ——— The guard ———

  function guard(q: Quokka, now: number, dt: number, look: Point | null) {
    const onPile = !!pointer && !carry && near(pointer, foodRect, 8) && (pointer.mouse || now - pointer.at < TAP_MS);
    const nearPile =
      !!pointer &&
      (pointer.mouse || now - pointer.at < TAP_MS) &&
      Math.hypot(pointer.x - pileCentre().x, pointer.y - pileCentre().y) < Math.max(110, sceneRect.height * 0.85);
    const mood = guardMood({
      delivered: now < deliveredUntil,
      dropped: now < droppedUntil,
      carried: !!carry || (person.here && person.holding),
      onPile,
      nearPile,
    });
    if (mood !== q.mood && !(q.mood === 'happy' && now < q.moodUntil)) setMood(q, mood, now + random(0, 80));
    if (mood === 'happy') q.moodUntil = Math.max(q.moodUntil, deliveredUntil);
    // A wave when you arrive, unless it is busy being cross or sad.
    if (ambient && inScene && now - awayAt > 9000 && q.mood === '' && q.pose === 'base') {
      setPose(q, 'wave');
      q.poseUntil = now + 1500;
      awayAt = Infinity;
    }
    if (now < q.holdUntil && now > q.biteAt + BITE_MS + 500) q.biteAt = now;
    frame(q, now, dt, look);
  }

  // ——— The stroller on the dunes ———

  function stepWalker(q: Quokka, now: number, dt: number) {
    const width = scenery.clientWidth;
    const size = q.box.width;
    if (!ambient) {
      // Under reduced motion the stroller stays where it stands.
      q.svg.style.transform = `translateX(${walk.x.toFixed(1)}px)`;
      frame(q, now, dt, null);
      return;
    }
    if (walk.phase === 'waiting' && now >= walk.nextAt) {
      // The first stroll sets off from where it stands; later ones come in from an edge.
      walk.dir = walk.first ? 1 : Math.random() < 0.5 ? 1 : -1;
      if (!walk.first) walk.x = walk.dir > 0 ? -size : width;
      walk.first = false;
      walk.pauseX = width * random(0.25, 0.7);
      walk.paused = false;
      walk.phase = 'walking';
    }
    if (walk.phase === 'pausing' && now >= walk.until) walk.phase = 'walking';
    let facing: 1 | -1 = walk.dir > 0 ? 1 : -1;
    if (walk.phase === 'walking') {
      walk.x += walk.dir * WALK_SPEED * (dt / 1000);
      const centre = walk.x + size / 2;
      const pointerClose = pointer?.mouse && Math.abs(pointer.x - (sceneRect.left + centre)) < 120 && pointer.y > sceneRect.top - 160 && pointer.y < sceneRect.bottom;
      const crossed = walk.dir > 0 ? centre >= walk.pauseX : centre <= walk.pauseX;
      if (!walk.paused && (crossed || pointerClose)) {
        walk.paused = true;
        walk.phase = 'pausing';
        walk.until = now + 2200;
      }
      if (walk.x > width + size || walk.x < -size * 2) {
        walk.phase = 'waiting';
        walk.nextAt = now + random(16_000, 34_000);
      }
    }
    // At a pause it turns to face you, if you are there.
    if (walk.phase === 'pausing' && pointer) facing = pointer.x < q.box.left + q.box.width / 2 ? -1 : 1;
    if (facing !== q.facing) {
      q.facing = facing;
      write(q.flip, 'transform', facing === 1 ? null : `matrix(-1 0 0 1 ${2 * q.mirrorX} 0)`);
    }
    q.svg.style.transform = `translateX(${walk.x.toFixed(1)}px)`;
    const walking = walk.phase === 'walking';
    const bob = walking ? -9 * Math.abs(Math.sin(now / 170)) : 0;
    const look = walk.phase === 'pausing' && pointer ? pointer : null;
    frame(q, now, dt, look, { bob });
  }

  // ——— The visitor's person ———

  const bodyWidth = () => person.view.box.width || sceneRect.height * 0.5;
  const personLeaf = (): Point | null => (person.here && person.holding ? person.view.hand() : null);

  /** The resident under a point of the beach (screen x), if any. */
  function quokkaAt(at: number): Quokka | null {
    let found: Quokka | null = null;
    let best = Infinity;
    for (const q of cast) {
      if (q.role === 'walker' || !visible(q)) continue;
      if (at < q.box.left - 6 || at > q.box.right + 6) continue;
      const gap = Math.abs(at - (q.box.left + q.box.right) / 2);
      if (gap < best) {
        best = gap;
        found = q;
      }
    }
    return found;
  }

  /** Bring the person onto the beach if it is not there, and send it to `clientX`. Sent to a
   * quokka, it stops beside it (on the side it comes from), so the quokka stays in view. */
  function sendPerson(clientX: number, now: number, stepDir: -1 | 0 | 1 = 0) {
    if (!running) return;
    const width = sceneRect.width;
    const q = quokkaAt(clientX);
    person.aim = q?.role ?? null;
    let x = clientX - sceneRect.left;
    if (q) {
      const centre = (q.box.left + q.box.right) / 2 - sceneRect.left;
      const from = person.here ? person.walk.x : x;
      const side = from <= centre ? -1 : 1;
      x = centre + side * (q.box.width / 2 + bodyWidth() * 0.12);
      // No room on that side (the beach's edge): the other side.
      if (x - bodyWidth() / 2 < 0 || x + bodyWidth() / 2 > width) x = centre - side * (q.box.width / 2 + bodyWidth() * 0.12);
      // A keyboard step from beside it goes on past it, to its far side.
      if (stepDir && Math.abs(x - person.walk.x) < 2) x = centre + stepDir * (q.box.width / 2 + bodyWidth() * 0.12);
    }
    const target = onSand(x, width, bodyWidth());
    if (!person.here) {
      person.here = true;
      person.walk = createWalk(ambient ? entrance(target, width, bodyWidth()) : target, target < width / 2 ? 1 : -1);
      person.view.show(true);
      say('');
    }
    if (Math.abs(target - person.target) > 1) person.settled = false;
    person.target = target;
    person.seenAt = now;
    calmUntil = now + CALM_MS;
    wake();
  }

  /** What stands where the person stopped: the pile and the players by where it is, the
   * quokka by where the visitor sent it. */
  function spotAt(x: number): Spot {
    const at = sceneRect.left + x;
    const pile = at >= foodRect.left - 6 && at <= foodRect.right + 6;
    const aimed = person.aim ? cast.find((q) => q.role === person.aim && visible(q)) : undefined;
    const a = by['player-a'];
    const b = by['player-b'];
    const reach = bodyWidth() * 0.7;
    const players = !!a && !!b && visible(a) && at >= a.box.left - reach && at <= b.box.right + reach;
    return { pile, quokka: aimed?.role ?? null, players };
  }

  function stepPerson(now: number, dt: number) {
    if (!person.here) return;
    const width = sceneRect.width;
    // Arrow keys: held, it keeps walking; under reduced motion each press is one step.
    if (person.keyDir !== 0 && ambient) {
      person.target = onSand(person.walk.x + person.keyDir * 90, width, bodyWidth());
      person.settled = false;
      person.seenAt = now;
    }
    person.walk = stepWalk(person.walk, person.target, dt, !ambient);
    const stopped = arrived(person.walk, person.target);
    const spot = spotAt(person.walk.x);
    if (person.joined && !spot.players) {
      person.joined = false;
      say('You left the game of catch.');
    }
    if (stopped && !person.settled && !carry) {
      person.settled = true;
      const act = deed(person.holding, spot);
      if (act === 'pick') {
        person.holding = true;
        say('You picked up a leaf.');
      } else if (act === 'feed') {
        const q = cast.find((candidate) => candidate.role === spot.quokka);
        if (q) {
          person.holding = false;
          handTo(q, person.view.hand(), now, 380, 26);
        }
      } else if (act === 'join') {
        person.joined = true;
        person.lastFrom = null;
        say('You joined the game of catch.');
        if (ball?.phase === 'held' && !isPerson(ball.by)) ball.since = -Infinity; // thrown to you now
      }
    }
    // It wanders off a while after the visitor last played, unless the keyboard holds it.
    const away = !inScene && !person.focused && now - person.seenAt > LINGER_MS;
    if (away) {
      person.here = false;
      person.holding = false;
      person.joined = false;
      person.view.show(false);
      return;
    }
    const holdingBall = ball && ball.phase !== 'flying' && ball.by === person;
    const arms: ArmPose = now < person.catchUntil ? 'catch' : holdingBall ? 'hold' : person.holding ? 'leaf' : 'swing';
    person.view.pose(person.walk, person.walk.x, arms, person.holding);
  }

  function onWalkKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const now = performance.now();
    const dir = event.key === 'ArrowLeft' ? -1 : 1;
    if (!person.here) summon(now);
    if (ambient) {
      person.keyDir = dir;
      person.aim = null;
    } else if (event.type === 'keydown') {
      sendPerson(sceneRect.left + person.walk.x + dir * Math.max(48, sceneRect.width * 0.06), now, dir);
    }
    calmUntil = now + CALM_MS;
    wake();
  }
  function onWalkKeyUp(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    person.keyDir = 0;
    // Ease to a stop just ahead rather than halting mid-stride, and if that is close to the
    // pile or a quokka, stop at it: the keyboard has no pointer to aim with.
    const { x, v } = person.walk;
    const stop = sceneRect.left + x + Math.sign(v) * Math.min(40, (v * v) / (2 * 0.0011));
    const spots = [pileCentre().x, ...cast.filter((q) => q.role !== 'walker' && visible(q)).map((q) => (q.box.left + q.box.right) / 2)];
    const nearest = spots.reduce((best, at) => (Math.abs(at - stop) < Math.abs(best - stop) ? at : best), Infinity);
    sendPerson(Math.abs(nearest - stop) < bodyWidth() * 0.9 ? nearest : stop, performance.now());
  }
  /** The keyboard's way in: the person appears in the middle of the beach. */
  function summon(now: number) {
    sceneRect = scenery.getBoundingClientRect();
    sendPerson(sceneRect.left + (person.here ? person.walk.x : sceneRect.width * 0.42), now);
  }

  // ——— The loop ———

  function tick(now: number) {
    const dt = Math.min(64, now - last || 16);
    last = now;
    sceneRect = scenery.getBoundingClientRect();
    foodRect = foodEl!.getBoundingClientRect();
    ballRect = ballEl!.getBoundingClientRect();
    for (const q of cast) q.box = q.svg.getBoundingClientRect();
    person.view.measure();

    const wasIn = inScene;
    inScene = !!pointer?.mouse && near(pointer, sceneRect, 0);
    if (wasIn && !inScene) awayAt = now;

    // The leaf in flight to a quokka, the one in your hand, and any on the sand.
    let carriedAt: (Point & { angle: number }) | null = carry ? { ...carry, angle: -12 } : null;
    if (flight) {
      const t = (now - flight.at) / flight.ms;
      if (t >= 1) {
        const done = flight;
        flight = null;
        done.onLand(now);
      } else {
        carriedAt = { ...arc(flight.from, flight.to(), t, flight.lift), angle: -12 + t * 40 };
      }
    }
    write(carriedEl!, 'visibility', carriedAt ? null : 'hidden');
    if (carriedAt) placeLeaf(carriedEl!, carriedAt, carriedAt.angle);
    const ground = sceneRect.bottom - 14;
    fallen = fallen.filter((leaf) => {
      const at = leafFall(leaf.from, ground, now - leaf.at);
      if (at.landed && !leaf.landedAt) {
        leaf.landedAt = now;
        droppedUntil = now + 2400;
      }
      placeLeaf(leaf.el, at, at.angle);
      const fade = leaf.landedAt ? 1 - clamp((now - leaf.landedAt - 1600) / 500, 0, 1) : 1;
      leaf.el.style.opacity = fade.toFixed(2);
      if (fade <= 0) leaf.el.remove();
      return fade > 0;
    });

    const live = pointer && (pointer.mouse || now - pointer.at < TAP_MS) ? pointer : null;
    stepPerson(now, dt);
    const ballAt = stepBall(now);
    if (ballAt) {
      const size = ballRect.width;
      const spin = ball?.phase === 'flying' ? ((now - ball.at) / 2.4) % 360 : 0;
      ballEl!.style.transform = `translate(${(ballAt.x - sceneRect.left - size / 2).toFixed(1)}px, ${(ballAt.y - sceneRect.top - size / 2).toFixed(1)}px) rotate(${spin.toFixed(0)}deg)`;
    }
    const leaf = carriedAt ?? personLeaf();
    const pile = pileCentre();

    for (const q of cast) {
      if (q.role === 'walker') stepWalker(q, now, dt);
      else if (q.role === 'sitter') eat(q, now, dt, leaf ?? live, false);
      else if (q.role === 'nibbler') eat(q, now, dt, leaf ?? live, true);
      else if (q.role === 'guard') guard(q, now, dt, leaf ?? live ?? (ball?.phase === 'flying' ? ballAt : null) ?? pile);
      else {
        // The players watch the ball, unless you come close while it rests.
        const watchYou = ball?.phase === 'held' && live && near(live, q.box, 140);
        frame(q, now, dt, leaf ?? (watchYou ? live : ballAt));
      }
    }
    // Under reduced motion the loop rests as soon as nothing is left to settle.
    const busy =
      person.here || !!carry || !!flight || fallen.length > 0 || ball?.phase !== 'held' || now < calmUntil;
    raf = ambient || busy ? requestAnimationFrame(tick) : 0;
  }

  /** Start the loop if it is resting (it always runs while motion is allowed). */
  function wake() {
    if (!running || raf) return;
    last = performance.now();
    scenery.classList.add('is-live');
    raf = requestAnimationFrame(tick);
  }

  function start() {
    const now = performance.now();
    ambient = !reduced.matches;
    cast = svgs.map((svg) => quokka(svg, now, ambient));
    by = Object.fromEntries(cast.map((q) => [q.role, q]));
    const walker = by.walker;
    walk.phase = 'waiting';
    walk.first = true;
    walk.x = walker ? walker.box.left - scenery.getBoundingClientRect().left : 0;
    walk.nextAt = now + random(2500, 5000);
    const first = by['player-a'];
    ball = first ? { phase: 'held', by: first, since: now, wait: random(1200, 2400) } : null;
    awayAt = -Infinity;
    last = now;
    running = true;
    person.view.measure();
    if (button) button.hidden = false;
    if (walkButton) walkButton.hidden = false;
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    scenery.addEventListener('pointerdown', onDown);
    // Under reduced motion it waits for the visitor; otherwise it lives on its own.
    if (ambient) wake();
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    running = false;
    Object.assign(person, { here: false, holding: false, joined: false, keyDir: 0, lastFrom: null, catchUntil: 0 });
    person.view.rest();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('blur', onLeave);
    scenery.removeEventListener('pointerdown', onDown);
    carry = null;
    flight = null;
    for (const leaf of fallen) leaf.el.remove();
    fallen = [];
    scenery.classList.remove('is-live', 'is-carrying');
    write(carriedEl!, 'visibility', 'hidden');
    carriedEl!.style.removeProperty('transform');
    ballEl!.style.removeProperty('transform');
    for (const q of cast) {
      rest(q);
      q.svg.style.removeProperty('transform');
      write(q.flip, 'transform', q.restFacing === 1 ? null : `matrix(-1 0 0 1 ${2 * q.mirrorX} 0)`);
    }
    if (button) button.hidden = true;
    if (walkButton) walkButton.hidden = true;
  }

  button?.addEventListener('click', feed);
  walkButton?.addEventListener('click', () => summon(performance.now()));
  walkButton?.addEventListener('focus', () => {
    person.focused = true;
    summon(performance.now());
  });
  walkButton?.addEventListener('blur', () => {
    person.focused = false;
    person.keyDir = 0;
    person.seenAt = performance.now();
  });
  walkButton?.addEventListener('keydown', onWalkKey);
  walkButton?.addEventListener('keyup', onWalkKeyUp);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let onScreen = false;
  const update = () => {
    const run = onScreen && !document.hidden;
    if (run && !running) start();
    else if (!run && running) stop();
  };
  const restart = () => {
    if (running) stop();
    update();
  };
  new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    update();
  }).observe(scenery);
  reduced.addEventListener('change', restart);
  document.addEventListener('visibilitychange', update);
}

document.querySelectorAll<HTMLElement>('[data-scenery]').forEach(animate);
