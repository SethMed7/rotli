/** Session-only bridge from an attached chat slug to the note's stable id. */
const noteIdsByChat = new Map<string, string>();

export function rememberChatNote(chatSlug: string, noteId: string): void {
  if (chatSlug && noteId) noteIdsByChat.set(chatSlug, noteId);
}

export function rememberedChatNote(chatSlug: string | null): string | null {
  return chatSlug ? (noteIdsByChat.get(chatSlug) ?? null) : null;
}
