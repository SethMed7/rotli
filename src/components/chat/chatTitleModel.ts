export const CHAT_TITLE_MAX_LENGTH = 120;
export const CHAT_TITLE_PLACEHOLDER = "Name this chat (optional) · Enter to skip";

export function normalizeChatTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CHAT_TITLE_MAX_LENGTH);
}

export function deriveChatTitle(message: string): string {
  return normalizeChatTitle(message).split(" ").slice(0, 6).join(" ").slice(0, 60) || "New chat";
}
