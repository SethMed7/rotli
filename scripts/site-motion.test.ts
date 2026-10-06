// The landing's scroll-driven tour, without a browser: its scroll steps
// (site/src/tourSteps.ts: which part the line picks, where a click scrolls to, and how a click
// holds while the page travels). The page wires these to the DOM;
// e2e/site/landing-layout.spec.ts proves the wiring. Like site-interactions.test.ts, the
// site's modules load through a computed path so their types stay out of the root typecheck;
// only the functions under test are typed here.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const site = (...parts: string[]) => join(import.meta.dir, "..", "site", "src", ...parts);

interface Span {
  top: number;
  bottom: number;
}
interface Follow {
  shown: number;
  intent: number | null;
}
let tour: {
  LINE_SHARE: number;
  INTENT_MS: number;
  stepAt(anchors: readonly Span[], line: number): number;
  stepScrollY(anchor: Span, line: number): number;
  createFollow(): Follow;
  follow(state: Follow, step: number): Follow;
  choose(step: number): Follow;
  settle(step: number): Follow;
};

beforeAll(async () => {
  tour = (await import(site("tourSteps.ts"))) as typeof tour;
});

describe("the tour's scroll steps", () => {
  // Five anchors 300px tall, end to end, starting 1000px down the page.
  const anchors = (scroll: number): Span[] =>
    Array.from({ length: 5 }, (_, i) => ({ top: 1000 + i * 300 - scroll, bottom: 1300 + i * 300 - scroll }));
  const line = 900 * 0.5;

  test("the part shown is the one whose anchor holds the line across the window", () => {
    expect(tour.LINE_SHARE).toBe(0.5);
    expect(tour.stepAt(anchors(1000 - line), line)).toBe(0); // the first anchor's top on the line
    expect(tour.stepAt(anchors(1299 - line), line)).toBe(0);
    expect(tour.stepAt(anchors(1300 - line), line)).toBe(1); // the next anchor takes over at its top
    expect(tour.stepAt(anchors(2400 - line), line)).toBe(4);
  });

  test("before the runway it shows the first part, and past it the last", () => {
    expect(tour.stepAt(anchors(0), line)).toBe(0);
    expect(tour.stepAt(anchors(99_999), line)).toBe(4);
    expect(tour.stepAt([], line)).toBe(0);
  });

  test("a click scrolls to put its anchor's middle on the line, which lands on that part", () => {
    for (let i = 0; i < 5; i++) {
      const page = anchors(0)[i]!;
      const y = tour.stepScrollY(page, line);
      expect(y).toBe(1000 + i * 300 + 150 - line);
      expect(tour.stepAt(anchors(y), line)).toBe(i);
    }
    expect(tour.stepScrollY({ top: 10, bottom: 20 }, line)).toBe(0); // never above the page
  });

  test("the scroll leads until a click; the click's part holds while the page travels to it", () => {
    let s = tour.createFollow();
    s = tour.follow(s, 1);
    expect(s).toEqual({ shown: 1, intent: null });
    s = tour.choose(4);
    expect(s).toEqual({ shown: 4, intent: 4 });
    // On the way down the line passes parts 2 and 3: the preview stays on 4.
    expect(tour.follow(s, 2).shown).toBe(4);
    expect(tour.follow(s, 3).shown).toBe(4);
    s = tour.follow(s, 4);
    expect(s).toEqual({ shown: 4, intent: null });
    expect(tour.follow(s, 3).shown).toBe(3); // the scroll leads again
  });

  test("a scroll stopped short of the click settles on wherever the line is", () => {
    const s = tour.follow(tour.choose(4), 2);
    expect(s.intent).toBe(4);
    expect(tour.settle(2)).toEqual({ shown: 2, intent: null });
    expect(tour.INTENT_MS).toBeGreaterThan(600);
  });
});
