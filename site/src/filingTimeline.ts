// The before and after plays the Librarian filing a note (landing/Filing.astro, the File step of
// the landing's Overview; the owner,
// 2026-10-05: "make this part more motion and alive like it actually happens"). Once, when the
// comparison comes into view: the note is typed on the left; the same words appear on the
// right; the Librarian's frontmatter lines arrive above them one by one, each pushing the words
// down like a line added in a diff; and it comes to rest with "Your words, unchanged" marked.
// A Replay control plays it again. The page holds the clock while the comparison is off screen
// or the tab is hidden. Without script, or under reduced motion, the finished state is all
// there is: it is the markup.
//
// No DOM here, so the timing can be tested (scripts/site-interactions.test.ts).

/** A beat before the first key, so the play starts after the comparison has arrived. */
export const TYPE_DELAY_MS = 300;
/** One character typed. */
export const CHAR_MS = 20;
/** From the last character to the words appearing on the right. */
export const WORDS_GAP_MS = 450;
/** The right column's words fading in. */
export const WORDS_MS = 360;
/** From the words to the Librarian's first line. */
export const ROWS_GAP_MS = 500;
/** Between one added line and the next. */
export const ROW_EVERY_MS = 300;
/** One added line opening. */
export const ROW_MS = 280;
/** From the last line to the words being marked unchanged. */
export const MARK_GAP_MS = 300;
/** The unchanged mark coming on. */
export const MARK_MS = 480;

export interface Timeline {
  typeEnd: number;
  wordsAt: number;
  rowsAt: readonly number[];
  markAt: number;
  total: number;
}

/** When each part of the play happens, for a note of `chars` characters and `rows` added lines. */
export function timeline(chars: number, rows: number): Timeline {
  const typeEnd = TYPE_DELAY_MS + chars * CHAR_MS;
  const wordsAt = typeEnd + WORDS_GAP_MS;
  const firstRow = wordsAt + WORDS_MS + ROWS_GAP_MS;
  const rowsAt = Array.from({ length: rows }, (_, k) => firstRow + k * ROW_EVERY_MS);
  const lastRowEnd = rows > 0 ? rowsAt[rows - 1] + ROW_MS : firstRow;
  const markAt = lastRowEnd + MARK_GAP_MS;
  return { typeEnd, wordsAt, rowsAt, markAt, total: markAt + MARK_MS };
}

export interface FilingFrame {
  /** Characters of the note typed on the left. */
  typed: number;
  /** Whether the typing caret shows. */
  caret: boolean;
  /** The right column's words, 0 to 1. */
  words: number;
  /** Each added line, 0 (not there) to 1 (in place). */
  rows: number[];
  /** "Your words, unchanged", 0 to 1. */
  mark: number;
  done: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Ease out: quick to start, soft to land. */
export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;

/** The play at `t` ms since it started. Past the end it is the finished state, the same as the
 * markup's. */
export function filingFrame(t: number, chars: number, rows: number): FilingFrame {
  const at = timeline(chars, rows);
  return {
    typed: Math.min(chars, Math.max(0, Math.floor((t - TYPE_DELAY_MS) / CHAR_MS))),
    caret: t >= TYPE_DELAY_MS - 150 && t < at.wordsAt,
    words: easeOut((t - at.wordsAt) / WORDS_MS),
    rows: at.rowsAt.map((start) => easeOut((t - start) / ROW_MS)),
    mark: easeOut((t - at.markAt) / MARK_MS),
    done: t >= at.total,
  };
}

/** How far the words below the added lines sit above their place: the share of each line's
 * height (`heights`, top to bottom) that hasn't opened yet. */
export function wordsLift(rows: readonly number[], heights: readonly number[]): number {
  let lift = 0;
  for (let k = 0; k < heights.length; k++) lift += heights[k] * (1 - (rows[k] ?? 1));
  return lift;
}
