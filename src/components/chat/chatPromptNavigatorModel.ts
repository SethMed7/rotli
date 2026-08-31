export interface PromptLocation {
  messageIndex: number;
  text: string;
}

export interface PromptNavigatorState {
  open: boolean;
  previewMessageIndex: number | null;
}

export type PromptNavigatorAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "preview"; messageIndex: number }
  | { type: "clear-preview" };

/** Hover and keyboard focus preview a landmark without changing the durable
 * active prompt, which remains owned by the chat scroll position. */
export function promptNavigatorTransition(
  state: PromptNavigatorState,
  action: PromptNavigatorAction,
): PromptNavigatorState {
  switch (action.type) {
    case "open":
      return state.open ? state : { ...state, open: true };
    case "close":
      return { open: false, previewMessageIndex: null };
    case "preview":
      return { open: true, previewMessageIndex: action.messageIndex };
    case "clear-preview":
      return state.previewMessageIndex === null ? state : { ...state, previewMessageIndex: null };
  }
}

export function promptStateClassName(
  messageIndex: number,
  activeMessageIndexes: readonly number[],
  previewMessageIndex: number | null,
): string | undefined {
  const classes = [
    activeMessageIndexes.includes(messageIndex) ? "active" : "",
    messageIndex === previewMessageIndex ? "preview" : "",
  ].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

/** User turns are the durable landmarks in a conversation. Assistant replies
 * can be very long, but the prompt that started each turn is what people
 * remember and what the navigator should name. */
export function conversationPrompts(
  messages: readonly { speaker: string; text: string }[],
): PromptLocation[] {
  return messages.flatMap((message, messageIndex) =>
    message.speaker === "you" ? [{ messageIndex, text: message.text }] : [],
  );
}

/** One line for the compact prompt menu. Preserve meaning, collapse Markdown
 * whitespace, and avoid a single long prompt widening the pane. */
export function promptPreview(text: string, maxLength = 72): string {
  const compact = text.replace(/\s+/g, " ").trim() || "Image prompt";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** Keep the menu's top edge aligned with the marker. Only move it when that
 * would paint outside the owning chat pane; a 12px inset keeps the border from
 * reading as part of the pane chrome. */
export function promptMenuOffset({
  triggerTop,
  menuHeight,
  boundaryTop,
  boundaryBottom,
  inset = 12,
}: {
  triggerTop: number;
  menuHeight: number;
  boundaryTop: number;
  boundaryBottom: number;
  inset?: number;
}): number {
  const minimumTop = boundaryTop + inset;
  const maximumTop = boundaryBottom - inset - menuHeight;
  const menuTop =
    maximumTop < minimumTop ? minimumTop : Math.min(Math.max(triggerTop, minimumTop), maximumTop);
  return Math.round(menuTop - triggerTop);
}

export interface PromptBubble {
  messageIndex: number;
  top: number | null;
  bottom: number | null;
}

/** A hairline overlap at the viewport edge should not flicker a paw on. */
const VISIBLE_GRACE = 12;

/** The trail tracks the user's PROMPTS, never the responses: a paw lights
 * only while its prompt bubble is on screen. Reading a long answer with no
 * bubble in view lights nothing. */
export function visiblePromptIndexes(
  bubbles: readonly PromptBubble[],
  viewTop: number,
  viewBottom: number,
): number[] {
  const visible: number[] = [];
  for (const bubble of bubbles) {
    if (bubble.top === null || bubble.bottom === null) continue;
    if (bubble.top < viewBottom - VISIBLE_GRACE && bubble.bottom > viewTop + VISIBLE_GRACE) {
      visible.push(bubble.messageIndex);
    }
  }
  return visible;
}
