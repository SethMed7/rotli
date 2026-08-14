export const FIRST_NOTE_TITLE_MAX = 120;

export function normalizeFirstNoteTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, FIRST_NOTE_TITLE_MAX);
}

export function firstNoteBody(value: string): string {
  const title = normalizeFirstNoteTitle(value);
  return title ? `# ${title}\n\n` : "";
}
