// The ordered-list marker grammar, defined once: what an ordered marker looks
// like, its value, the marker after it, and how a value is written back. The
// block parser, renumbering, Enter continuation, the numbered toggle, the
// plain-text copy, read-aloud, raw highlighting, and document import all read
// it from here. Task, result, and choice rows keep their own digit markers
// (and their Rust twins), so they are not built from this.

/** A plain ordered marker without its trailing space: `1.`. */
export const ORDERED_MARKER_SOURCE = String.raw`\d+\.`;

export interface OrderedMarker {
  /** The marker as written, dot included (`12.`). */
  marker: string;
  /** Just the ordinal before the dot (`12`). */
  ordinal: string;
  /** Its position in the sequence: 1-based. */
  value: number;
}

const MARKER_AT_START = new RegExp(`^(${ORDERED_MARKER_SOURCE})`);

/** The ordered marker at the start of `text` (after any indent is removed),
 * or null. The trailing space is the caller's business. */
export function parseOrderedMarker(text: string): OrderedMarker | null {
  const match = MARKER_AT_START.exec(text);
  if (!match?.[1]) return null;
  const ordinal = match[1].slice(0, -1);
  return { marker: match[1], ordinal, value: Number(ordinal) };
}

/** Write `value` in the same style as the ordinal `like`. */
export function formatOrdinal(_like: string, value: number): string | null {
  return String(value);
}

/** The marker that follows `marker` (`3.` → `4.`), or null past the end. */
export function nextOrderedMarker(marker: string): string | null {
  const parsed = parseOrderedMarker(marker);
  if (!parsed) return null;
  const ordinal = formatOrdinal(parsed.ordinal, parsed.value + 1);
  return ordinal === null ? null : `${ordinal}.`;
}
