// The website's interactive rules, without a browser: the privacy passage's trigger and
// crossfade (site/src/passage.ts), the resource reading meter (site/src/reading.ts), the 404 game
// (site/src/runner/game.ts), and the footer scene's play (site/src/quokka/play.ts and the
// traced-pose cleanup in art.ts). The pages wire these to the DOM; e2e/site/ proves the
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
interface Obstacle {
  kind: string;
  x: number;
  w: number;
  h: number;
}
interface Runner {
  y: number;
  vy: number;
  grounded: boolean;
}
interface Game {
  status: "ready" | "running" | "paused" | "over";
  distance: number;
  speed: number;
  runner: Runner;
  obstacles: Obstacle[];
  untilNext: number;
  width: number;
  best: number;
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
  passageFrame(pair: PassagePair, t: number): { text: Rgb; ground: Rgb };
};
let reading: {
  readingProgress(
    article: { top: number; height: number },
    viewport: number,
    header: number,
  ): { fraction: number; percent: number; fits: boolean };
};
let game: {
  WORLD: {
    jumpSpeed: number;
    gravity: number;
    runnerX: number;
    runnerW: number;
    maxSpeed: number;
    unitsPerMetre: number;
  };
  createGame(width: number, best?: number): Game;
  start(g: Game): Game;
  jump(g: Game): Game;
  release(g: Game): Game;
  pause(g: Game): Game;
  resume(g: Game): Game;
  step(g: Game, ms: number, random: () => number): Game;
  collides(runner: Runner, obstacle: Obstacle): boolean;
  nextGap(speed: number, random: () => number): number;
  metres(distance: number): number;
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
let art: {
  tracedPose(svg: string): { line: string; silhouette: string; transform: string; viewBox: number };
};

beforeAll(async () => {
  passage = (await import(site("passage.ts"))) as typeof passage;
  reading = (await import(site("reading.ts"))) as typeof reading;
  game = (await import(site("runner", "game.ts"))) as typeof game;
  play = (await import(site("quokka", "play.ts"))) as typeof play;
  art = (await import(site("quokka", "art.ts"))) as typeof art;
});

describe("the privacy passage", () => {
  const viewport = 800;
  // A band taller than the window, its top edge at `top`.
  const band = (top: number, height = 1200) => ({ top, bottom: top + height });

  test("turns on once the band fills a good share of the window, not only its middle", () => {
    expect(passage.passageActive(band(900), viewport, false)).toBe(false); // still below
    const enter = viewport * (1 - passage.ENTER_SHARE);
    expect(passage.passageActive(band(enter + 1), viewport, false)).toBe(false);
    expect(passage.passageActive(band(enter - 1), viewport, false)).toBe(true);
    // Earlier than the old focal line (the middle of the window, plus a margin).
    expect(enter).toBeGreaterThan(viewport * 0.5);
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

  test("a primary button and its label switch together, so the label never fades through it", () => {
    const css = readFileSync(site("layouts", "Base.astro"), "utf8");
    expect(css).toMatch(/\.button\.primary \{\s*background: var\(--text\);\s*color: var\(--on-text\);/);
    const rgb = (hex: string): Rgb =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
    expect(passage.contrast(rgb("#f8f2e9"), rgb("#3a3028"))).toBeGreaterThan(4.5);
    expect(passage.contrast(rgb("#0e171d"), rgb("#e7f0f4"))).toBeGreaterThan(4.5);
  });

  test("a plain crossfade, text fading with the ground, would vanish halfway", () => {
    const ease = passage.cubicBezier(...passage.GROUND_EASE);
    const mixHex = (pair: readonly [string, string], k: number): Rgb => {
      const [a, b] = pair.map((hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)));
      return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as unknown as Rgb;
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

describe("the 404 game", () => {
  const never = () => 0.99;
  const run = (g: Game, ms: number, random = never) => {
    let next = g;
    for (let t = 0; t < ms; t += 16) next = game.step(next, 16, random);
    return next;
  };

  test("never moves until Play, and a paused run stands still", () => {
    const ready = game.createGame(800);
    expect(game.step(ready, 1000, never)).toBe(ready);
    const running = run(game.start(ready), 500);
    expect(running.distance).toBeGreaterThan(0);
    const paused = game.pause(running);
    expect(game.step(paused, 1000, never).distance).toBe(running.distance);
    expect(game.resume(paused).status).toBe("running");
  });

  test("a jump rises, comes back down onto the sand, and cannot be repeated in the air", () => {
    let g = game.jump(game.start(game.createGame(800)));
    expect(g.runner.grounded).toBe(false);
    const again = game.jump(g);
    expect(again.runner.vy).toBe(g.runner.vy);
    g = run(g, 200);
    expect(g.runner.y).toBeGreaterThan(0);
    g = run(g, 1500);
    expect(g.runner).toEqual({ y: 0, vy: 0, grounded: true });
  });

  test("letting go early makes a lower hop", () => {
    const full = run(game.jump(game.start(game.createGame(800))), 340);
    const short = run(game.release(run(game.jump(game.start(game.createGame(800))), 60)), 280);
    expect(short.runner.y).toBeLessThan(full.runner.y);
  });

  test("running into an obstacle ends the run, keeps the distance, and records the best", () => {
    const g = {
      ...game.start(game.createGame(800, 3)),
      obstacles: [{ kind: "rock", x: game.WORLD.runnerX + 30, w: 44, h: 30 }],
    };
    const over = game.step(g, 16, never);
    expect(over.status).toBe("over");
    expect(over.best).toBe(3); // a short run does not lower the best
    const replay = game.start(over);
    expect(replay.status).toBe("running");
    expect(replay.obstacles).toEqual([]);
    expect(replay.best).toBe(3);
  });

  test("clearing an obstacle in the air is safe", () => {
    const rock = { kind: "rock", x: game.WORLD.runnerX, w: 44, h: 30 };
    expect(game.collides({ y: 0, vy: 0, grounded: true }, rock)).toBe(true);
    expect(game.collides({ y: 40, vy: 0, grounded: false }, rock)).toBe(false);
  });

  test("there is always room to land before the next obstacle, at any speed", () => {
    for (const speed of [330, 500, game.WORLD.maxSpeed]) {
      const airtime = (2 * game.WORLD.jumpSpeed) / game.WORLD.gravity;
      expect(game.nextGap(speed, () => 0)).toBeGreaterThan(speed * airtime);
    }
  });

  test("the score is metres, and a long frame (a hidden tab) never teleports the run", () => {
    expect(game.metres(game.WORLD.unitsPerMetre * 12.9)).toBe(12);
    const g = game.step(game.start(game.createGame(800)), 5000, never);
    expect(g.distance).toBeLessThan(40);
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
