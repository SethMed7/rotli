// Splitting a reply into SPEAKABLE units (voice, 2026-08-04).
//
// This is the piece that decides whether reading aloud feels like a call or a
// form submission: speech must start while the model is still writing, so the
// text arriving token-by-token has to be cut into sentences the moment each one
// is complete — never by waiting for the whole answer
// (docs/design/voice.md, "Making it feel realtime").
//
// It also decides what is NOT spoken. A reply is Markdown: reading "hash hash
// Setup" or a forty-line code fence aloud is noise, so structure is stripped
// and code is skipped rather than pronounced.
//
// Pure: no audio, no DOM, no model.

/** A sentence ready to synthesize. */
export interface Speakable {
  text: string;
}

/** Ends a sentence when followed by whitespace. Kept deliberately small — the
 * cost of an early cut is a slightly short phrase; the cost of a late one is
 * silence while the user waits. */
const SENTENCE_END = /[.!?…]["')\]]*\s/;

/** Abbreviations whose trailing dot must NOT end a sentence. */
const ABBREV = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|fig|no)\.$/i;

/** Strip the Markdown that would be read aloud as gibberish, leaving prose. */
export function speakableText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "") // heading marks — the words still matter
    .replace(/^\s*>\s?/, "") // quote marker
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX/]\]\s+)?/, "") // list bullet / checkbox
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images say nothing aloud
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links: speak the label, not the URL
    .replace(/`([^`]+)`/g, "$1") // inline code: speak the token
    .replace(/(\*\*|__|\*|_|~~|==)/g, "") // emphasis marks
    .replace(/\s+/g, " ")
    .trim();
}

/** True for a line that opens or closes a fenced block. */
const isFence = (line: string): boolean => line.trimStart().startsWith("```");

/**
 * Cut finished sentences out of a growing buffer.
 *
 * Returns the sentences that are COMPLETE plus whatever remains unspoken, so a
 * streaming caller can feed deltas in and play as it goes:
 *
 *     const { speak, rest } = takeSentences(buffer);
 *     buffer = rest;
 *
 * `flush` (the stream ended) emits the remainder even without terminal
 * punctuation — otherwise a reply that stops mid-thought would never be spoken.
 */
export function takeSentences(buffer: string, flush = false): { speak: Speakable[]; rest: string } {
  const speak: Speakable[] = [];
  let rest = buffer;

  for (;;) {
    const match = SENTENCE_END.exec(rest);
    if (!match) break;
    const cut = match.index + match[0].length;
    const candidate = rest.slice(0, cut);
    // don't cut on "Dr. " — keep accumulating instead
    if (ABBREV.test(candidate.trimEnd())) {
      const next = SENTENCE_END.exec(rest.slice(cut));
      if (!next) break;
      const merged = rest.slice(0, cut + next.index + next[0].length);
      const text = renderBlock(merged);
      if (text) speak.push({ text });
      rest = rest.slice(cut + next.index + next[0].length);
      continue;
    }
    const text = renderBlock(candidate);
    if (text) speak.push({ text });
    rest = rest.slice(cut);
  }

  if (flush) {
    const text = renderBlock(rest);
    if (text) speak.push({ text });
    rest = "";
  }
  return { speak, rest };
}

/** Turn one raw chunk into speakable prose: fenced code is skipped entirely,
 * every other line is de-marked. Returns "" when there is nothing to say. */
function renderBlock(chunk: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of chunk.split("\n")) {
    if (isFence(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue; // never read a code block aloud
    const text = speakableText(line);
    if (text) out.push(text);
  }
  return out.join(" ").trim();
}
