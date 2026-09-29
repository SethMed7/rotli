// A chat file's pointers to notes, both in its first frontmatter block (split
// out of contract.ts, 2026-09-29). `attachedTo` is the note the chat belongs
// to. `memoryNote` is the chat's own conversation-notes note, used when the
// attached note is the person's and no AI may write it. Pure.

/** Rewrite (or insert) the `attachedTo:` frontmatter line on an EXISTING chat
 * file — the lazy chat↔note link (the note materializes on first open, then the
 * chat points at its staging stem). Pure; only the FIRST frontmatter block is
 * touched, so a message line that happens to start "attachedTo:" never matches. */
export function setAttachedTo(contents: string, stem: string): string {
  const line = `attachedTo: [[${stem}]]`;
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents; // no frontmatter — leave the file alone
  const block = fm[1];
  const next = /^attachedTo:.*$/m.test(block) ? block.replace(/^attachedTo:.*$/m, line) : `${block}\n${line}`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** Rewrite (or insert) the `memoryNote:` frontmatter line on an EXISTING chat
 * (2026-09-29): the chat-made note that holds this chat's conversation notes
 * when the note it is attached to belongs to the person and no AI may write
 * it. `attachedTo` keeps pointing at the person's note. Same first-block
 * discipline as setAttachedTo. */
export function setChatMemoryNote(contents: string, stem: string): string {
  const line = `memoryNote: [[${stem}]]`;
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  if (!fm || fm[1] === undefined) return contents;
  const block = fm[1];
  const next = /^memoryNote:.*$/m.test(block) ? block.replace(/^memoryNote:.*$/m, line) : `${block}\n${line}`;
  return `${contents.slice(0, fm.index)}---\n${next}\n---${contents.slice(fm.index + fm[0].length)}`;
}

/** The chat's `memoryNote:` stem, or null when it has none. */
export function chatMemoryNote(contents: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(contents);
  const value = fm?.[1] ? /^memoryNote:\s*(.*)$/m.exec(fm[1])?.[1] : undefined;
  const stem = value?.replace(/^\[\[|\]\]$/g, "").trim();
  return stem || null;
}
