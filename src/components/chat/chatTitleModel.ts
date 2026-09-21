export const CHAT_TITLE_MAX_LENGTH = 120;
export const CHAT_TITLE_PLACEHOLDER = "Name this chat (optional) · Enter to skip";

export function normalizeChatTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CHAT_TITLE_MAX_LENGTH);
}

// an attached image is a handle (`[Image #1]`, with its storage target in the
// raw transcript), never words — the title is also the filename and folder name
const IMAGE_HANDLE = /\[Image #\d+\](\([^)]*\))?/gi;

export function deriveChatTitle(message: string): string {
  const prose = message.replace(IMAGE_HANDLE, " ");
  return normalizeChatTitle(prose).split(" ").slice(0, 6).join(" ").slice(0, 60) || "New chat";
}
