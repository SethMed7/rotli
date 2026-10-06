// The landing's two scroll-driven pieces, without a browser: the tour's scroll steps
// (site/src/tourSteps.ts: which part the line picks, where a click scrolls to, and how a click
// holds while the page travels) and the before and after's filing play
// (site/src/filingTimeline.ts: its order, its first and last frames, and how far the words are
// lifted while the added lines open). The page wires these to the DOM;
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
interface FilingFrame {
  typed: number;
  caret: boolean;
  words: number;
  rows: number[];
  mark: number;
  done: boolean;
}
let filing: {
  TYPE_DELAY_MS: number;
  CHAR_MS: number;
  timeline(
    chars: number,
    rows: number,
  ): { typeEnd: number; wordsAt: number; rowsAt: readonly number[]; markAt: number; total: number };
  filingFrame(t: number, chars: number, rows: number): FilingFrame;
  wordsLift(rows: readonly number[], heights: readonly number[]): number;
};

beforeAll(async () => {
  tour = (await import(site("tourSteps.ts"))) as typeof tour;
  filing = (await import(site("filingTimeline.ts"))) as typeof filing;
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

describe("the before and after's filing play", () => {
  const chars = 97;
  const rows = 6;
  const at = () => filing.timeline(chars, rows);

  test("it types, then shows the words, then adds the lines one by one, then marks the words", () => {
    const t = at();
    expect(t.typeEnd).toBe(filing.TYPE_DELAY_MS + chars * filing.CHAR_MS);
    expect(t.wordsAt).toBeGreaterThan(t.typeEnd);
    expect(t.rowsAt[0]!).toBeGreaterThan(t.wordsAt);
    for (let k = 1; k < rows; k++) expect(t.rowsAt[k]!).toBeGreaterThan(t.rowsAt[k - 1]!);
    expect(t.markAt).toBeGreaterThan(t.rowsAt[rows - 1]!);
    expect(t.total).toBeGreaterThan(t.markAt);
    // Long enough to watch, short enough to wait for.
    expect(t.total).toBeGreaterThan(4000);
    expect(t.total).toBeLessThan(8000);
  });

  test("its first frame is an empty page waiting to be typed", () => {
    const f = filing.filingFrame(0, chars, rows);
    expect(f).toMatchObject({ typed: 0, caret: false, words: 0, mark: 0, done: false });
    expect(f.rows).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("mid-typing only the left column moves", () => {
    const f = filing.filingFrame(filing.TYPE_DELAY_MS + 40 * filing.CHAR_MS, chars, rows);
    expect(f.typed).toBe(40);
    expect(f.caret).toBe(true);
    expect(f.words).toBe(0);
    expect(Math.max(...f.rows)).toBe(0);
  });

  test("the added lines arrive in order, each opening before the next starts", () => {
    const t = at();
    const f = filing.filingFrame(t.rowsAt[2]! + 1, chars, rows);
    expect(f.typed).toBe(chars);
    expect(f.caret).toBe(false);
    expect(f.words).toBe(1);
    expect(f.rows[0]).toBe(1);
    expect(f.rows[1]).toBe(1);
    expect(f.rows[2]!).toBeGreaterThan(0);
    expect(f.rows[2]!).toBeLessThan(1);
    expect(f.rows.slice(3)).toEqual([0, 0, 0]);
    expect(f.mark).toBe(0);
  });

  test("it ends at rest in the markup's finished state, and stays there", () => {
    for (const t of [at().total, at().total + 60_000]) {
      const f = filing.filingFrame(t, chars, rows);
      expect(f).toMatchObject({ typed: chars, caret: false, words: 1, mark: 1, done: true });
      expect(f.rows.every((r) => r === 1)).toBe(true);
    }
  });

  test("the words below the added lines are lifted by exactly what hasn't opened", () => {
    const heights = [40, 22, 44, 22, 22, 30];
    expect(filing.wordsLift([0, 0, 0, 0, 0, 0], heights)).toBe(180);
    expect(filing.wordsLift([1, 1, 0.5, 0, 0, 0], heights)).toBe(22 + 22 + 22 + 30);
    expect(filing.wordsLift([1, 1, 1, 1, 1, 1], heights)).toBe(0);
  });
});
