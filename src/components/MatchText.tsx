// A one-line text run with the search hit wrapped in <mark> — how the ⌘K
// palette and All notes rows highlight a full-text match. Offsets arrive as
// CHAR (code point) counts from corpus_search / the browser twin, so slicing
// goes through [...spread], never String.slice (UTF-16 would split surrogate
// pairs). Out-of-range offsets degrade to plain text, never a crash.

import type { ReactNode } from "react";

export function MatchText({
  text,
  start,
  len,
}: {
  text: string;
  start: number;
  len: number;
}): ReactNode {
  const chars = [...text];
  if (len <= 0 || start < 0 || start + len > chars.length) return text;
  return (
    <>
      {chars.slice(0, start).join("")}
      <mark className="hitmark">{chars.slice(start, start + len).join("")}</mark>
      {chars.slice(start + len).join("")}
    </>
  );
}
