// The website's interactive rules, without a browser: the privacy passage's trigger and
// crossfade (site/src/passage.ts), the theme studio's autoplay (site/src/themeCycle.ts), the
// resource reading meter (site/src/reading.ts), a blog post's rail pinning (site/src/railPin.ts), and the footer scene's play
// (site/src/quokka/play.ts, the person in human.ts, and the traced-pose cleanup in art.ts).
// The 404 game has its own file, site-runner.test.ts. The pages wire these to the DOM; e2e/site/ proves the
// wiring. Like site-agents.test.ts, the site's modules load through a computed path so
// their types stay out of the root typecheck; only the functions under test are typed here.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const site = (...parts: string[]) => join(import.meta.dir, "..", "site", "src", ...parts);

interface Point {
  x: number;
  y: number;
}
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
type Rgb = readonly [number, number, number];
interface PassagePair {
  text: readonly [string, string];
  ground: readonly [string, string];
  main?: readonly [string, string];
}
let passage: {
  passageActive(section: { top: number; bottom: number }, viewport: number, active: boolean): boolean;
  ENTER_SHARE: number;
  LEAVE_SHARE: number;
  PASSAGE_MS: number;
  GROUND_EASE: readonly [number, number, number, number];
  INK_AT: number;
  LEAN_KEYS: readonly (readonly [number, number])[];
  cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number;
  leanAt(t: number): number;
  contrast(a: Rgb, b: Rgb): number;
  rgb(hex: string): Rgb;
  mix(a: Rgb, b: Rgb, k: number): Rgb;
  passageFrame(pair: PassagePair, t: number): { text: Rgb; ground: Rgb };
};
let reading: {
  readingProgress(
    article: { top: number; height: number },
    viewport: number,
    header: number,
  ): { fraction: number; percent: number; fits: boolean };
};
interface RailBounds {
  max: number;
  min: number;
  fits: boolean;
}
let rail: {
  railBounds(room: { headerBottom: number; viewport: number; height: number; margin: number }): RailBounds;
  railTop(previous: number, scrolledBy: number, bounds: RailBounds): number;
};
let play: {
  dropTarget<T extends { box: Box }>(point: Point, residents: readonly T[], reach: number): T | null;
  arc(from: Point, to: Point, t: number, lift: number): Point;
  leafFall(from: Point, ground: number, ms: number): Point & { angle: number; landed: boolean };
  guardMood(state: {
    delivered: boolean;
    dropped: boolean;
    carried: boolean;
    onPile: boolean;
    nearPile: boolean;
  }): string;
};
interface Cycle {
  total: number;
  shown: number;
  mode: "auto" | "held" | "pinned" | "off";
  pinned: number;
  nextAt: number;
}
let story: {
  STEP_RUNWAY: number;
  runwayProgress(pinTop: number, stickAt: number, runway: number): number;
  stepAt(progress: number, steps: number): number;
  progressFor(step: number, steps: number): number;
};
let cycle: {
  CYCLE_MS: number;
  RESUME_MS: number;
  createCycle(total: number, now: number, autoplay: boolean): Cycle;
  tick(c: Cycle, now: number): Cycle;
  hover(c: Cycle, index: number): Cycle;
  leave(c: Cycle, now: number): Cycle;
  pin(c: Cycle, index: number): Cycle;
  resume(c: Cycle, now: number): Cycle;
  wait(c: Cycle, now: number): number | null;
};
interface Walk {
  x: number;
  v: number;
  facing: 1 | -1;
  phase: number;
}
interface Spot {
  pile: boolean;
  quokka: string | null;
  players: boolean;
}
let human: {
  STRIDE: { speed: number; accel: number; near: number; cycle: number };
  createWalk(x: number, facing?: 1 | -1): Walk;
  stepWalk(walk: Walk, target: number, ms: number, teleport?: boolean): Walk;
  arrived(walk: Walk, target: number): boolean;
  limbs(walk: Walk): { leg: number; arm: number; bob: number };
  deed(holding: boolean, spot: Spot): "pick" | "feed" | "join" | null;
  onSand(x: number, width: number, bodyWidth: number): number;
  entrance(target: number, width: number, bodyWidth: number): number;
  command(
    holding: "leaf" | "ball" | null,
    hit: "pile" | "ball" | "quokka" | "sand",
    context: { joined: boolean; player: boolean },
  ): string | null;
};
let art: {
  tracedPose(svg: string): { line: string; silhouette: string; transform: string; viewBox: number };
};

beforeAll(async () => {
  passage = (await import(site("passage.ts"))) as typeof passage;
  reading = (await import(site("reading.ts"))) as typeof reading;
  rail = (await import(site("railPin.ts"))) as typeof rail;
  play = (await import(site("quokka", "play.ts"))) as typeof play;
  art = (await import(site("quokka", "art.ts"))) as typeof art;
  cycle = (await import(site("themeCycle.ts"))) as typeof cycle;
  story = (await import(site("storyScroll.ts"))) as typeof story;
  human = (await import(site("quokka", "human.ts"))) as typeof human;
});

describe("the privacy passage", () => {
  const viewport = 800;
  // A band taller than the window, its top edge at `top`.
  const band = (top: number, height = 1200) => ({ top, bottom: top + height });

  test("turns on once the band fills half the window", () => {
    expect(passage.passageActive(band(900), viewport, false)).toBe(false); // still below
    const enter = viewport * (1 - passage.ENTER_SHARE);
    expect(passage.passageActive(band(enter + 1), viewport, false)).toBe(false);
    expect(passage.passageActive(band(enter - 1), viewport, false)).toBe(true);
    // No later than the middle of the window, so the band never sits half empty.
    expect(enter).toBeGreaterThanOrEqual(viewport * 0.5);
    // The section under it comes back while it still has most of the window.
    expect(passage.LEAVE_SHARE).toBeGreaterThanOrEqual(0.35);
  });

  test("holds near a boundary instead of flickering, then lets go in either direction", () => {
    const enter = viewport * (1 - passage.ENTER_SHARE);
    const leave = viewport * (1 - passage.LEAVE_SHARE);
    // Scrolling back up a little past the switch point keeps it on.
    expect(passage.passageActive(band(enter + 20), viewport, true)).toBe(true);
    // Leaving upward (the band falls back down the window) turns it off.
    expect(passage.passageActive(band(leave + 1), viewport, true)).toBe(false);
    // Leaving downward (the band's end rises up the window) turns it off too.
    const end = (bottom: number) => ({ top: bottom - 1200, bottom });
    expect(passage.passageActive(end(viewport * passage.LEAVE_SHARE + 1), viewport, true)).toBe(true);
    expect(passage.passageActive(end(viewport * passage.LEAVE_SHARE - 1), viewport, true)).toBe(false);
    expect(passage.LEAVE_SHARE).toBeLessThan(passage.ENTER_SHARE);
  });

  test("a band shorter than the window counts its own height", () => {
    // A 300px band wholly in an 800px window fills all of itself.
    expect(passage.passageActive({ top: 200, bottom: 500 }, viewport, false)).toBe(true);
  });

  test("a hidden or empty section never turns it on", () => {
    expect(passage.passageActive({ top: 0, bottom: 0 }, viewport, false)).toBe(false);
    expect(passage.passageActive({ top: 0, bottom: 800 }, 0, true)).toBe(false);
  });
});

describe("the privacy passage's crossfade", () => {
  // Every text/ground pair the page shows, day then night (Base.astro's tokens).
  const text = ["#3a3028", "#e7f0f4"] as const;
  const pairs: Record<string, PassagePair> = {
    "text on the ground": { text, ground: ["#f8f2e9", "#0e171d"] },
    "text on the warm band": { text, ground: ["#f1e7d8", "#1c2d35"] },
    "text on a surface": { text, ground: ["#fbf6ee", "#152229"] },
    "muted text on the ground": { text: ["#6e6155", "#a1b6c0"], ground: ["#f8f2e9", "#0e171d"], main: text },
    "muted text on the warm band": {
      text: ["#6e6155", "#a1b6c0"],
      ground: ["#f1e7d8", "#1c2d35"],
      main: text,
    },
    "accent text on the ground": { text: ["#8f4e37", "#86c2e0"], ground: ["#f8f2e9", "#0e171d"], main: text },
    // The header's star count in GitHub's star gold (--github-star-ink).
    "GitHub's star gold on the header": {
      text: ["#8a5d00", "#e3b341"],
      ground: ["#f8f2e9", "#0e171d"],
      main: text,
    },
  };
  const frames = (pair: PassagePair) =>
    Array.from({ length: passage.PASSAGE_MS + 1 }, (_, ms) => {
      const { text: ink, ground } = passage.passageFrame(pair, ms / passage.PASSAGE_MS);
      return passage.contrast(ink, ground);
    });

  test("every pair stays readable in every frame of the dusk", () => {
    for (const [name, pair] of Object.entries(pairs)) {
      const worst = Math.min(...frames(pair));
      expect({ name, readable: worst >= 3 }).toEqual({ name, readable: true });
    }
  });

  test("text dips under 4.5:1 only for a moment, while the ground crosses mid-tone", () => {
    for (const [name, pair] of Object.entries(pairs)) {
      const dim = frames(pair).filter((ratio) => ratio < 4.5).length;
      expect({ name, quick: dim <= 100 }).toEqual({ name, quick: true });
    }
  });

  test("GitHub's star gold reads as text at rest, by day and by night", () => {
    const css = readFileSync(site("layouts", "Base.astro"), "utf8");
    const day = css.match(/--github-star-ink: (#[0-9a-f]{6});/g)!.map((rule) => rule.slice(-8, -1));
    expect(day).toEqual(["#8a5d00", "#e3b341"]);
    const ratio = (a: string, b: string) => passage.contrast(passage.rgb(a), passage.rgb(b));
    expect(ratio("#8a5d00", "#f8f2e9")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#e3b341", "#0e171d")).toBeGreaterThanOrEqual(4.5);
    // GitHub's own day gold would not: that is why the day value is darkened.
    expect(ratio("#eac54f", "#f8f2e9")).toBeLessThan(3);
  });

  test("a primary button and its label switch together, so the label never fades through it", () => {
    const css = readFileSync(site("layouts", "Base.astro"), "utf8");
    expect(css).toMatch(/\.button\.primary \{\s*background: var\(--text\);\s*color: var\(--on-text\);/);
    const ratio = (a: string, b: string) => passage.contrast(passage.rgb(a), passage.rgb(b));
    expect(ratio("#f8f2e9", "#3a3028")).toBeGreaterThan(4.5);
    expect(ratio("#0e171d", "#e7f0f4")).toBeGreaterThan(4.5);
  });

  test("a plain crossfade, text fading with the ground, would vanish halfway", () => {
    const ease = passage.cubicBezier(...passage.GROUND_EASE);
    const mixHex = (pair: readonly [string, string], k: number): Rgb => {
      const [a, b] = pair.map((hex) => passage.rgb(hex));
      return passage.mix(a!, b!, k);
    };
    const naive = Array.from({ length: 101 }, (_, i) => {
      const k = ease(i / 100);
      return passage.contrast(mixHex(text, k), mixHex(["#f8f2e9", "#0e171d"], k));
    });
    expect(Math.min(...naive)).toBeLessThan(1.5);
  });

  test("the grounds ease out and in, the inks switch about halfway, and the lean returns", () => {
    const ease = passage.cubicBezier(...passage.GROUND_EASE);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 3);
    expect(ease(0.1)).toBeLessThan(0.05); // a slow start
    expect(passage.INK_AT).toBeCloseTo(0.5, 1);
    expect(passage.leanAt(0)).toBe(0);
    expect(passage.leanAt(0.5)).toBe(1);
    expect(passage.leanAt(1)).toBe(0);
  });

  test("the stylesheet runs the same clock", () => {
    const css = readFileSync(site("layouts", "Base.astro"), "utf8");
    const [x1, y1, x2, y2] = passage.GROUND_EASE;
    expect(css).toContain(`--passage-ms: ${passage.PASSAGE_MS}ms;`);
    expect(css).toContain(`--passage-ease: cubic-bezier(${x1}, ${y1}, ${x2}, ${y2});`);
    expect(css).toContain(`--passage-ink-at: ${Math.round(passage.PASSAGE_MS * passage.INK_AT)}ms;`);
    for (const [share, lean] of passage.LEAN_KEYS)
      expect(css).toContain(`${share * 100}% { --passage-lean: ${lean}; }`);
  });
});

describe("the theme studio's autoplay", () => {
  test("steps through every environment at a calm pace, and round again", () => {
    let c = cycle.createCycle(14, 0, true);
    expect(cycle.tick(c, cycle.CYCLE_MS - 1).shown).toBe(0); // not before its time
    expect(cycle.CYCLE_MS).toBeGreaterThanOrEqual(2500);
    for (let i = 1; i <= 14; i++) {
      c = cycle.tick(c, i * cycle.CYCLE_MS);
      expect(c.shown).toBe(i % 14);
    }
    expect(cycle.wait(c, 14 * cycle.CYCLE_MS)).toBe(cycle.CYCLE_MS);
  });

  test("a hover shows that environment at once and holds; leaving goes on from there", () => {
    let c = cycle.hover(cycle.createCycle(14, 0, true), 9);
    expect(c).toMatchObject({ shown: 9, mode: "held" });
    expect(cycle.tick(c, 99_999).shown).toBe(9); // held, however long
    expect(cycle.wait(c, 0)).toBeNull();
    c = cycle.leave(c, 10_000);
    expect(c.mode).toBe("auto");
    expect(cycle.tick(c, 10_000 + cycle.RESUME_MS - 1).shown).toBe(9);
    expect(cycle.tick(c, 10_000 + cycle.RESUME_MS).shown).toBe(10);
  });

  test("a click pins it: the cycle stops, and a hover only previews", () => {
    let c = cycle.pin(cycle.createCycle(14, 0, true), 4);
    expect(cycle.tick(c, 99_999).shown).toBe(4);
    c = cycle.hover(c, 11);
    expect(c).toMatchObject({ shown: 11, mode: "pinned" });
    expect(cycle.leave(c, 0).shown).toBe(4);
    // The carousel's steps pin too, wrapping at either end.
    expect(cycle.pin(c, -1).shown).toBe(13);
    expect(cycle.pin(c, 14).shown).toBe(0);
  });

  test("never plays under reduced motion, but still follows a hover", () => {
    const c = cycle.createCycle(14, 0, false);
    expect(cycle.tick(c, 99_999).shown).toBe(0);
    expect(cycle.wait(c, 0)).toBeNull();
    const hovered = cycle.hover(c, 6);
    expect(hovered).toMatchObject({ shown: 6, mode: "off" });
    expect(cycle.tick(cycle.leave(hovered, 0), 99_999).shown).toBe(6);
  });

  test("coming back on screen waits a full step before moving", () => {
    const c = cycle.resume(cycle.createCycle(14, 0, true), 50_000);
    expect(cycle.tick(c, 50_000 + cycle.CYCLE_MS - 1).shown).toBe(0);
    expect(cycle.tick(c, 50_000 + cycle.CYCLE_MS).shown).toBe(1);
  });
});

describe("the landing's three steps follow the scroll", () => {
  test("the runway's share picks the step, a third each, held at both ends", () => {
    const runway = 1000;
    expect(story.runwayProgress(300, 100, runway)).toBe(0); // not stuck yet
    expect(story.runwayProgress(-400, 100, runway)).toBe(0.5);
    expect(story.runwayProgress(-5000, 100, runway)).toBe(1); // past it
    expect([0, 0.32, 0.34, 0.66, 0.67, 1].map((p) => story.stepAt(p, 3))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  test("a tab lands its step in the middle of its share", () => {
    for (const step of [0, 1, 2]) expect(story.stepAt(story.progressFor(step, 3), 3)).toBe(step);
  });

  test("each step gets a good part of a window's scroll, so none is skipped in a flick", () => {
    expect(story.STEP_RUNWAY).toBeGreaterThanOrEqual(0.5);
  });

  test("no runway or no steps never throws off the page", () => {
    expect(story.runwayProgress(0, 100, 0)).toBe(0);
    expect(story.stepAt(0.5, 0)).toBe(0);
  });
});

describe("the reading meter", () => {
  test("measures the article, from its start to its last line in view", () => {
    const header = 70;
    const article = { height: 3000 };
    expect(reading.readingProgress({ top: 400, ...article }, 900, header)).toEqual({
      fraction: 0,
      percent: 0,
      fits: false,
    });
    const span = 3000 - (900 - header);
    const half = reading.readingProgress({ top: header - span / 2, ...article }, 900, header);
    expect(half.percent).toBe(50);
    // The end of the article reads 100%, and scrolling on into the footer stays there.
    expect(reading.readingProgress({ top: header - span, ...article }, 900, header).percent).toBe(100);
    expect(reading.readingProgress({ top: header - span - 600, ...article }, 900, header).percent).toBe(100);
  });

  test("goes back down when scrolling back up, and a jump lands on the right share", () => {
    const at = (top: number) => reading.readingProgress({ top, height: 2000 }, 1000, 100).percent;
    expect(at(-500)).toBeGreaterThan(at(-200));
    expect(at(100 - 1100 * 0.25)).toBe(25);
  });

  test("an article that fits in the window has nothing to track", () => {
    expect(reading.readingProgress({ top: 300, height: 500 }, 900, 70)).toEqual({
      fraction: 1,
      percent: 100,
      fits: true,
    });
  });
});

describe("a blog post's rail pinning", () => {
  const room = (height: number, viewport = 900) => ({ headerBottom: 69, viewport, height, margin: 24 });
  test("a rail that fits is pinned under the header, and scrolling never moves it", () => {
    const bounds = rail.railBounds(room(700));
    expect(bounds).toEqual({ max: 93, min: 93, fits: true });
    expect(rail.railTop(Number.POSITIVE_INFINITY, 0, bounds)).toBe(93);
    expect(rail.railTop(93, 500, bounds)).toBe(93);
    expect(rail.railTop(93, -500, bounds)).toBe(93);
  });
  test("a taller rail moves with the page, then holds its foot going down and its head going up", () => {
    const bounds = rail.railBounds(room(963));
    expect(bounds.fits).toBe(false);
    // Its foot 24px above the window's bottom: 900 - 963 - 24.
    expect(bounds.min).toBe(-87);
    // Down 100px: it moves up with the page; far down, its foot holds.
    expect(rail.railTop(93, 100, bounds)).toBe(-7);
    expect(rail.railTop(-7, 5000, bounds)).toBe(-87);
    // Back up 50px: it moves down with the page; far up, its head holds under the header.
    expect(rail.railTop(-87, -50, bounds)).toBe(-37);
    expect(rail.railTop(-37, -5000, bounds)).toBe(93);
  });
  test("exactly as tall as the room fits; a pixel more does not", () => {
    expect(rail.railBounds(room(900 - 69 - 48)).fits).toBe(true);
    expect(rail.railBounds(room(900 - 69 - 47)).fits).toBe(false);
  });
});

describe("the person on the footer beach", () => {
  const walkTo = (from: number, target: number, ms = 16, frames = 2000) => {
    let walk = human.createWalk(from);
    const path: Walk[] = [];
    for (let i = 0; i < frames && !human.arrived(walk, target); i++) {
      walk = human.stepWalk(walk, target, ms);
      path.push(walk);
    }
    return path;
  };

  test("walks to where it is sent, easing in and out, and stops exactly there", () => {
    const path = walkTo(100, 900);
    const last = path.at(-1)!;
    expect(last.x).toBe(900);
    expect(last.v).toBe(0);
    expect(human.arrived(last, 900)).toBe(true);
    const speeds = path.map((w) => w.v);
    expect(speeds[0]).toBeLessThan(human.STRIDE.speed / 4); // it sets off gently
    expect(Math.max(...speeds)).toBeCloseTo(human.STRIDE.speed, 5); // a walk, never a run
    expect(speeds.at(-2)!).toBeLessThan(human.STRIDE.speed / 3); // and slows to arrive
    // Never past the spot, never back again.
    path.slice(1).forEach((walk, i) => expect(walk.x).toBeGreaterThanOrEqual(path[i]!.x));
    expect(Math.max(...path.map((w) => w.x))).toBe(900);
  });

  test("faces the way it walks, and keeps facing that way standing still", () => {
    const left = walkTo(500, 200);
    expect(left[5]!.facing).toBe(-1);
    expect(left.at(-1)!.facing).toBe(-1);
    expect(walkTo(200, 500)[5]!.facing).toBe(1);
  });

  test("a long frame (a hidden tab) never teleports it", () => {
    const walk = human.stepWalk({ x: 0, v: human.STRIDE.speed, facing: 1, phase: 0 }, 2000, 5000);
    expect(walk.x).toBeLessThanOrEqual(64 * human.STRIDE.speed + 1);
  });

  test("under reduced motion it is simply there, standing", () => {
    expect(human.stepWalk(human.createWalk(10), 700, 16, true)).toEqual({
      x: 700,
      v: 0,
      facing: 1,
      phase: 0,
    });
  });

  test("legs and arms swing opposite ways while walking, and hang still when standing", () => {
    expect(human.limbs(human.createWalk(0))).toEqual({ leg: 0, arm: 0, bob: 0 });
    const striding = { x: 0, v: human.STRIDE.speed, facing: 1 as const, phase: Math.PI / 2 };
    const swing = human.limbs(striding);
    expect(swing.leg).toBeGreaterThan(15);
    expect(swing.arm).toBeGreaterThan(10);
    expect(human.limbs({ ...striding, phase: (3 * Math.PI) / 2 }).leg).toBeLessThan(-15);
  });

  test("stopping does the one thing that fits: pick, feed, or join", () => {
    const none = { pile: false, quokka: null, players: false };
    expect(human.deed(false, { ...none, pile: true })).toBe("pick");
    expect(human.deed(true, { ...none, pile: true })).toBeNull(); // hands full
    expect(human.deed(true, { ...none, quokka: "sitter" })).toBe("feed");
    expect(human.deed(false, { ...none, quokka: "sitter" })).toBeNull(); // nothing to give
    expect(human.deed(false, { ...none, players: true, quokka: "player-a" })).toBe("join");
    expect(human.deed(true, { ...none, players: true, quokka: "player-a" })).toBe("feed");
    expect(human.deed(false, none)).toBeNull();
  });

  test("sets off briskly: near full speed within a few frames", () => {
    let walk = human.createWalk(0);
    for (let i = 0; i < 7; i++) walk = human.stepWalk(walk, 1000, 16);
    expect(walk.v).toBeGreaterThan(human.STRIDE.speed * 0.9);
  });

  test("a click asks for the one thing that fits what it lands on and what is in hand", () => {
    const loose = { joined: false, player: false };
    // The pile: fetch a leaf with empty hands; with something in hand, just go there.
    expect(human.command(null, "pile", loose)).toBe("fetch");
    expect(human.command("leaf", "pile", loose)).toBe("walk");
    // A quokka: feed it a leaf in hand; throw it the ball in hand (or while in the game).
    expect(human.command("leaf", "quokka", loose)).toBe("feed");
    expect(human.command("ball", "quokka", { joined: true, player: false })).toBe("throw");
    expect(human.command(null, "quokka", { joined: true, player: true })).toBe("throw");
    // Empty hands, out of the game: a player means joining; anyone else, a visit.
    expect(human.command(null, "quokka", { joined: false, player: true })).toBe("join");
    expect(human.command(null, "quokka", loose)).toBe("visit");
    // The ball: join the game; already holding it, nothing; a leaf in hand, just go there.
    expect(human.command(null, "ball", loose)).toBe("join");
    expect(human.command("ball", "ball", loose)).toBeNull();
    expect(human.command("leaf", "ball", loose)).toBe("walk");
    expect(human.command(null, "sand", loose)).toBe("walk");
  });

  test("it stays on the sand, and arrives from the nearer side", () => {
    expect(human.onSand(-50, 1000, 80)).toBe(40);
    expect(human.onSand(990, 1000, 80)).toBe(960);
    expect(human.entrance(300, 1000, 80)).toBeLessThan(300);
    expect(human.entrance(800, 1000, 80)).toBeGreaterThan(800);
  });
});

describe("the footer scene's play", () => {
  const box = (left: number, top: number, w = 60, h = 90): Box => ({
    left,
    top,
    right: left + w,
    bottom: top + h,
  });

  test("a leaf goes to the quokka it is dropped on, the nearest when two are close", () => {
    const sitter = { name: "sitter", box: box(100, 100) };
    const guard = { name: "guard", box: box(150, 100) };
    expect(play.dropTarget({ x: 120, y: 140 }, [sitter, guard], 10)?.name).toBe("sitter");
    expect(play.dropTarget({ x: 200, y: 140 }, [sitter, guard], 10)?.name).toBe("guard");
    expect(play.dropTarget({ x: 400, y: 140 }, [sitter, guard], 10)).toBeNull(); // open sand
  });

  test("a quokka hidden at this width never receives one", () => {
    const hidden = { name: "nibbler", box: { left: 0, top: 0, right: 0, bottom: 0 } };
    expect(play.dropTarget({ x: 0, y: 0 }, [hidden], 30)).toBeNull();
  });

  test("the ball leaves one quokka's paws, rises, and lands in the other's", () => {
    const from = { x: 0, y: 100 };
    const to = { x: 200, y: 60 };
    expect(play.arc(from, to, 0, 80)).toEqual(from);
    expect(play.arc(from, to, 1, 80)).toEqual(to);
    const mid = play.arc(from, to, 0.5, 80);
    expect(mid.y).toBeLessThan(60);
    expect(
      Math.min(...[0.2, 0.4, 0.5, 0.6, 0.8].map((t) => play.arc(from, to, t, 80).y)),
    ).toBeGreaterThanOrEqual(60 - 80 - 0.001);
  });

  test("a dropped leaf drifts down and comes to rest on the sand", () => {
    const start = { x: 100, y: 20 };
    const early = play.leafFall(start, 200, 300);
    expect(early.landed).toBe(false);
    expect(early.y).toBeGreaterThan(20);
    const late = play.leafFall(start, 200, 5000);
    expect(late).toEqual({ x: 100, y: 200, angle: 0, landed: true });
  });

  test("the guard's mood follows the leaves, most pressing first", () => {
    const calm = { delivered: false, dropped: false, carried: false, onPile: false, nearPile: false };
    expect(play.guardMood(calm)).toBe("");
    expect(play.guardMood({ ...calm, nearPile: true })).toBe("mad");
    expect(play.guardMood({ ...calm, onPile: true, nearPile: true })).toBe("sad");
    expect(play.guardMood({ ...calm, carried: true, nearPile: true })).toBe("mad");
    expect(play.guardMood({ ...calm, dropped: true, carried: true })).toBe("sad");
    expect(play.guardMood({ ...calm, delivered: true, dropped: true })).toBe("happy");
  });

  test("the cheering pose loses its confetti but keeps its whole body and face", () => {
    const characters = join(import.meta.dir, "..", "src", "assets", "characters");
    const source = readFileSync(join(characters, "celebrating.svg"), "utf8");
    const rings = (d: string) => (d.match(/[Mm]/g) ?? []).length;
    const pose = art.tracedPose(source);
    const original = source.match(/\sd="([^"]+)"/)?.[1] ?? "";
    expect(rings(pose.line)).toBeLessThan(rings(original));
    expect(rings(pose.line)).toBeGreaterThan(8); // outline, ears, eyes, nose, mouth, paws, tail
    expect(rings(pose.silhouette)).toBe(1);
    expect(pose.viewBox).toBe(1024);
    // The waving pose has no decoration to drop.
    const waving = readFileSync(join(characters, "waving.svg"), "utf8");
    expect(rings(art.tracedPose(waving).line)).toBe(rings(waving.match(/\sd="([^"]+)"/)?.[1] ?? ""));
  });
});
