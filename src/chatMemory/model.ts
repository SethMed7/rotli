export const CHAT_MEMORY_START = "<!-- rotli:chat-memory:start -->";
export const CHAT_MEMORY_END = "<!-- rotli:chat-memory:end -->";

export interface MemoryTurn {
  speaker: string;
  text: string;
}

const MAX_MEMORY_TURNS = 24;
const MAX_TURN_CHARS = 520;

function compactText(text: string): string {
  const compact = text
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\s+/g, " ")
    .trim();
  return compact.length <= MAX_TURN_CHARS ? compact : `${compact.slice(0, MAX_TURN_CHARS - 1)}…`;
}

export function chatMemoryBlock(turns: readonly MemoryTurn[]): string {
  const recent = turns.slice(-MAX_MEMORY_TURNS);
  const bullets = recent
    .map((turn) => {
      const label = turn.speaker.toLowerCase() === "you" ? "User" : "Rotli";
      return `- **${label}:** ${compactText(turn.text)}`;
    })
    .filter((line) => !line.endsWith(":** "));
  return [
    CHAT_MEMORY_START,
    "## Conversation memory",
    "",
    "_A compact, automatically maintained memory of this chat._",
    "",
    ...(bullets.length ? bullets : ["- No messages yet."]),
    CHAT_MEMORY_END,
  ].join("\n");
}

/** Update only Rotli's managed block. User-authored content elsewhere in the
 * note is preserved byte-for-byte. */
export function mergeChatMemory(
  existingBody: string,
  title: string,
  chatSlug: string,
  turns: readonly MemoryTurn[],
): string {
  const block = chatMemoryBlock(turns);
  const start = existingBody.indexOf(CHAT_MEMORY_START);
  const end = existingBody.indexOf(CHAT_MEMORY_END);
  if (start >= 0 && end >= start) {
    return `${existingBody.slice(0, start)}${block}${existingBody.slice(end + CHAT_MEMORY_END.length)}`;
  }
  const base = existingBody.trimEnd() || `# ${title}\n\n> chat: [[${chatSlug}]]`;
  const withLink = base.includes(`[[${chatSlug}]]`) ? base : `${base}\n\n> chat: [[${chatSlug}]]`;
  return `${withLink}\n\n${block}\n`;
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
