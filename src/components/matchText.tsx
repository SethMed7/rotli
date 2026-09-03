// Highlights the matched spans of a search hit. Offsets are CHAR (code point)
// counts from corpus_search / the browser twin, so slicing goes through
// [...spread], never String.slice (UTF-16 would split surrogate pairs).
// Out-of-range or overlapping spans degrade to plain text, never a crash.

import type { ReactNode } from "react";

export function MatchText({
  text,
  start,
  len,
  spans,
}: {
  text: string;
  start: number;
  len: number;
  /** All spans, when the hit carries them; falls back to the single start/len. */
  spans?: readonly (readonly [number, number])[];
}): ReactNode {
  const chars = [...text];
  const list = spans && spans.length > 0 ? spans : [[start, len] as const];
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [s, l] of list) {
    if (l <= 0 || s < at || s + l > chars.length) return text;
    if (s > at) parts.push(chars.slice(at, s).join(""));
    parts.push(
      <mark key={s} className="hitmark">
        {chars.slice(s, s + l).join("")}
      </mark>,
    );
    at = s + l;
  }
  if (at < chars.length) parts.push(chars.slice(at).join(""));
  return <>{parts}</>;
}
