// Reading a chat file's `## Messages` section back into turns. The writer
// (contract.ts composeMessageLines) puts each turn on a `**speaker** · <time>
// — <text>` line and leaves the text raw, so a reply that contains a line of
// that shape is indistinguishable byte for byte from a real turn. This reader
// narrows what counts as a turn header so ordinary reply text can't split a
// reply or invent a turn by "you" (chat audit 2026-11-24, D3/S3):
//
// - the header is a whole line inside the section opened by the `## Messages`
//   heading line;
// - the speaker is a name: lowercase letters, digits, `.`, `_`, `-` (you,
//   rotli, older model speakers such as sonnet), or one of the chat's declared
//   `participants:`;
// - the time is an ISO date or instant;
// - that time falls inside the chat's own lifetime: from a day before the
//   earlier of `created:` and the first turn to a day after `updated:`.
//
// A forged line dated inside the chat's lifetime still reads as a turn. Only a
// format change on the write side closes that; it is a contract change and is
// not made here.

import { frontmatterBlock } from "../lib/frontmatterBlock";

export interface TranscriptTurn {
  speaker: string;
  /** The time stamp exactly as written. */
  at: string;
  text: string;
  /** Offset of the header line's first character in the file. */
  start: number;
  /** Offset just past the turn's last line (the next header, or the end). */
  end: number;
}

const DAY_MS = 86_400_000;
const HEADING = /^## Messages[ \t]*\r?$/m;
const HEADER = /^\*\*([^*\n]+)\*\*[ \t]*·[ \t]*([^—\n]*?)[ \t]*—[ \t]?(.*)$/;
const SPEAKER = /^[a-z][a-z0-9._-]*$/;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;

/** The UTC day a stamp names, as ms at that day's midnight; null if it isn't one. */
function stampDay(stamp: string): number | null {
  const match = STAMP.exec(stamp);
  if (!match || !Number.isFinite(Date.parse(stamp))) return null;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(day) ? day : null;
}

interface Frontmatter {
  end: number;
  fields: Map<string, string>;
}

function frontmatter(contents: string): Frontmatter {
  const fields = new Map<string, string>();
  const block = frontmatterBlock(contents);
  if (!block) return { end: 0, fields };
  for (const line of block.inner.split("\n")) {
    if (/^[ \t]/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon > 0 && !fields.has(line.slice(0, colon).trim())) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return { end: block.end, fields };
}

function participants(value: string | undefined): Set<string> {
  const inner = value?.replace(/^\[|\]$/g, "") ?? "";
  return new Set(
    inner
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

interface Line {
  start: number;
  /** The line without its line break (and without a CR before it). */
  text: string;
  end: number;
}

function linesFrom(contents: string, from: number): Line[] {
  const lines: Line[] = [];
  let start = from;
  while (start < contents.length) {
    const newline = contents.indexOf("\n", start);
    const end = newline < 0 ? contents.length : newline + 1;
    const raw = contents.slice(start, newline < 0 ? contents.length : newline);
    lines.push({ start, text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, end });
    start = end;
  }
  return lines;
}

/** Every turn in the chat file, in file order. */
export function parseTranscriptTurns(contents: string): TranscriptTurn[] {
  const meta = frontmatter(contents);
  const heading = HEADING.exec(contents.slice(meta.end));
  if (!heading) return [];
  const sectionStart = meta.end + heading.index + heading[0].length;
  const declared = participants(meta.fields.get("participants"));
  const created = stampDay(meta.fields.get("created") ?? "");
  const updated = stampDay(meta.fields.get("updated") ?? "");

  const turns: TranscriptTurn[] = [];
  const bodies: string[][] = [];
  let earliest: number | null = null;
  for (const line of linesFrom(contents, sectionStart)) {
    const header = HEADER.exec(line.text);
    const speaker = header?.[1]?.trim() ?? "";
    const at = header?.[2]?.trim() ?? "";
    const day = header && (SPEAKER.test(speaker) || declared.has(speaker)) ? stampDay(at) : null;
    if (day !== null && turns.length === 0) {
      earliest = created === null ? day : Math.min(created, day);
    }
    const inLifetime =
      day !== null &&
      (earliest === null || day >= earliest - DAY_MS) &&
      (updated === null || day <= updated + DAY_MS);
    if (header && inLifetime) {
      turns.push({ speaker, at, text: "", start: line.start, end: line.end });
      bodies.push([header[3] ?? ""]);
      continue;
    }
    const current = turns.at(-1);
    if (!current) continue;
    current.end = line.end;
    bodies.at(-1)!.push(line.text);
  }
  turns.forEach((turn, i) => {
    turn.text = bodies[i]!.join("\n").trim();
  });
  return turns;
}
