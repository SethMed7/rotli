// The editor header's live buffer counts, kept as leaves so per-keystroke
// recomputes re-render only these spans, never the editor shell (perf audit
// 2026-07-30, finding 8).
import { useMemo } from "react";

import { useDocumentLines } from "./model";

/** Focus mode's word count, isolated: it is the ONLY consumer of the live
 * buffer at this level, so per-keystroke recomputes stay inside this leaf
 * instead of re-rendering the whole editor shell (finding 8: the shell did
 * join + split + a word-count regex over the full document per keystroke,
 * with the count displayed only in focus mode). */
export function FocusWordCount({ noteId, fallbackBody }: { noteId: string; fallbackBody: string }) {
  const lines = useDocumentLines(noteId);
  const wordCount = useMemo(() => {
    let words = 0;
    for (const line of lines ?? fallbackBody.split("\n")) {
      words += line.split(/\s+/).filter(Boolean).length;
    }
    return words;
  }, [lines, fallbackBody]);
  return (
    <div className="fwc" aria-hidden="true">
      {wordCount.toLocaleString()} words
    </div>
  );
}

/** The header's live char count — the other always-on buffer consumer. Same
 * isolation as FocusWordCount: per-keystroke recomputes re-render this span,
 * not the editor shell. */
export function CharCount({ noteId, fallbackBody }: { noteId: string; fallbackBody: string }) {
  const lines = useDocumentLines(noteId);
  const chars = useMemo(() => {
    if (!lines) return fallbackBody.length;
    let total = lines.length ? lines.length - 1 : 0; // the joining newlines
    for (const line of lines) total += line.length;
    return total;
  }, [lines, fallbackBody]);
  return <>{chars.toLocaleString()} chars</>;
}
