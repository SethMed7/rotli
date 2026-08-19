/** The managed section is a plain HEADING now — HTML comment markers rendered
 * as literal cruft in the editor and the note read like a machine's transcript
 * (the maintainer, 2026-07-29: notes "as if this was a convo and we were taking notes"). */
export const CHAT_NOTES_HEADING = "## Conversation notes";
// legacy pre-0.46 markers — recognized for one-time migration only
export const CHAT_MEMORY_START = "<!-- rotli:chat-memory:start -->";
export const CHAT_MEMORY_END = "<!-- rotli:chat-memory:end -->";

export interface MemoryTurn {
  speaker: string;
  text: string;
}

const MAX_MEMORY_TURNS = 24;
const MAX_TURN_CHARS = 520;
const MAX_NOTES_CHARS = 4000;

function compactText(text: string): string {
  const compact = text
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length <= MAX_TURN_CHARS ? compact : `${compact.slice(0, MAX_TURN_CHARS - 1)}…`;
}

/** Deterministic fallback when no model can write the notes: the topics the
 * user brought up — still notes-shaped, never a speaker-labeled transcript. */
export function fallbackChatNotes(turns: readonly MemoryTurn[]): string {
  const topics = turns
    .slice(-MAX_MEMORY_TURNS)
    .filter((turn) => turn.speaker.toLowerCase() === "you")
    .map((turn) => `- ${compactText(turn.text)}`)
    .filter((line) => line !== "- ");
  return topics.length ? ["### Topics discussed", ...topics].join("\n") : "- Nothing captured yet.";
}

/** The instruction for the model that maintains the notes. Pure so evals can
 * pin it. The notes are DATA about the chat, rewritten whole each turn. */
export function buildChatNotesPrompt(currentNotes: string | null, turns: readonly MemoryTurn[]): string {
  const transcript = turns
    .slice(-MAX_MEMORY_TURNS)
    .map(
      (turn) => `${turn.speaker.toLowerCase() === "you" ? "User" : "Assistant"}: ${compactText(turn.text)}`,
    )
    .join("\n");
  return [
    "You maintain the running notes for a conversation, like a sharp colleague taking notes in a meeting.",
    "Rewrite the FULL notes so they cover the whole conversation so far.",
    "Rules:",
    '- Markdown only: optional short "### " topic headers and "- " bullets.',
    "- Capture what was discussed, decisions made, facts worth keeping, action items, and open questions.",
    "- Never write a transcript and never use speaker labels.",
    "- No preamble, no title, no headings larger than ###. At most about 250 words.",
    "",
    "Current notes:",
    currentNotes?.trim() || "(none yet)",
    "",
    "Conversation so far (newest last):",
    transcript,
    "",
    "Reply with ONLY the new notes markdown.",
  ].join("\n");
}

/** Normalize model-written notes: unwrap a fence, demote big headings so the
 * section can never swallow the rest of the note, cap the size. Returns null
 * when nothing usable came back. */
export function sanitizeChatNotes(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let notes = raw.trim();
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(notes);
  if (fenced?.[1]) notes = fenced[1].trim();
  notes = notes.replace(/^#{1,2}\s+/gm, "### ");
  if (notes.length > MAX_NOTES_CHARS) notes = `${notes.slice(0, MAX_NOTES_CHARS - 1)}…`;
  return notes.length > 0 ? notes : null;
}

/** The managed section's span inside a note body: from the heading to the next
 * H2 (exclusive) or the end of the note. */
function notesSectionSpan(body: string): { start: number; end: number } | null {
  const start = body.indexOf(CHAT_NOTES_HEADING);
  if (start < 0) return null;
  const afterHeading = start + CHAT_NOTES_HEADING.length;
  const nextSection = body.indexOf("\n## ", afterHeading);
  return { start, end: nextSection >= 0 ? nextSection : body.length };
}

/** The current notes text (without the heading), or null when the note has no
 * managed section yet — what the maintaining model receives as context. */
export function extractChatNotes(body: string): string | null {
  const span = notesSectionSpan(body);
  if (!span) return null;
  return body.slice(span.start + CHAT_NOTES_HEADING.length, span.end).trim() || null;
}

/** Update only Rotli's managed notes section. User-authored content elsewhere
 * in the note is preserved byte-for-byte; a pre-0.46 comment-marker block (and
 * its "> chat:" line) migrates to the heading format on first touch. */
export function mergeChatMemory(
  existingBody: string,
  title: string,
  chatSlug: string,
  notes: string,
): string {
  const section = `${CHAT_NOTES_HEADING}\n\n${notes}`;
  // one-time migration: the old managed block becomes the new section, and the
  // old machine-y "> chat:" blockquote becomes a plain sentence
  const legacyStart = existingBody.indexOf(CHAT_MEMORY_START);
  const legacyEnd = existingBody.indexOf(CHAT_MEMORY_END);
  if (legacyStart >= 0 && legacyEnd >= legacyStart) {
    const migrated =
      existingBody.slice(0, legacyStart) + section + existingBody.slice(legacyEnd + CHAT_MEMORY_END.length);
    return migrated.replace(`> chat: [[${chatSlug}]]`, `Notes from [[${chatSlug}]].`);
  }
  const span = notesSectionSpan(existingBody);
  if (span) {
    const tail = existingBody.slice(span.end);
    // a section that runs to EOF keeps the file's trailing newline, so the
    // no-change resync stays byte-identical (idempotence)
    const suffix = tail === "" && existingBody.endsWith("\n") ? "\n" : "";
    return `${existingBody.slice(0, span.start)}${section}${suffix}${tail}`;
  }
  const base = existingBody.trimEnd() || `# ${title}\n\nNotes from [[${chatSlug}]].`;
  const withLink = base.includes(`[[${chatSlug}]]`) ? base : `${base}\n\nNotes from [[${chatSlug}]].`;
  return `${withLink}\n\n${section}\n`;
}

export interface AttachedNoteCandidate {
  id: string;
  aliases?: readonly string[];
}

export function attachedNoteId(stem: string, candidates: Iterable<AttachedNoteCandidate>): string | null {
  const target = stem.trim().toLocaleLowerCase();
  if (!target) return null;
  const available = [...candidates];
  const exact = available.filter((candidate) =>
    candidate.aliases?.some((alias) => alias.trim().toLocaleLowerCase() === target),
  );
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null;

  // Pre-readable-filename chat attachments encoded the note ULID's final six
  // characters in the stem. Keep that fallback until every old attachment has
  // been refreshed through the alias-aware path.
  const tail = stem.slice(-6).toLowerCase();
  if (!tail) return null;
  for (const candidate of available) {
    if (candidate.id.slice(-6).toLowerCase() === tail) return candidate.id;
  }
  return null;
}
