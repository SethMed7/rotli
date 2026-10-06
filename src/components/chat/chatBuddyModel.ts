// The chat buddy's expression. The buddy is always part of Chat; the person
// decorates it in Settings (body, lines, accessory) but never picks its pose —
// the chat's own state does, so the quokka always says what is happening.

import type { CharacterName } from "../character";
import { chatDaypart } from "./chatWelcomeModel";

/** What the chat is doing, as the buddy sees it. */
export type ChatBuddyMoment =
  /** a fresh, unsent chat */
  | "welcome"
  /** a saved chat with no messages yet */
  | "empty"
  /** chat can't run here (the web build without Rotli Helper) */
  | "unavailable"
  /** no vault connected, so nothing to talk about yet */
  | "no-vault"
  /** waiting its turn for on-device compute */
  | "queued"
  /** working on a reply, before and while it streams in */
  | "thinking"
  /** a reply just landed in this view */
  | "done"
  /** the person spoke last and nothing is running (stopped, or it failed) */
  | "waiting"
  /** a reopened thread whose last word was the assistant's */
  | "settled";

export interface ChatBuddyState {
  working: boolean;
  queued: boolean;
  /** Who spoke last in the visible thread; null when it is empty. */
  lastSpeaker: "you" | "ai" | null;
  /** A reply finished while this chat was on screen. */
  justFinished: boolean;
}

/** The thread's live-edge moment (the welcome and empty states pick theirs
 * where they render). */
export function chatBuddyMoment(state: ChatBuddyState): ChatBuddyMoment {
  if (state.working) return state.queued ? "queued" : "thinking";
  if (state.lastSpeaker === "you") return "waiting";
  return state.justFinished ? "done" : "settled";
}

/** Whether the buddy shows a reply in the works. Its own send (`busy`) and a
 * run another mount started (`foreignRun`) count. The composer's hold after a
 * run settles (`foreignPending`) counts only while the person's message is
 * still the last word — the reply has not been reread yet. Once the answer is
 * on screen, or a Stop took the unanswered message back off, the hold is the
 * composer's business, not the buddy's. */
export function chatBuddyWorking(state: {
  busy: boolean;
  foreignRun: boolean;
  foreignPending: boolean;
  lastSpeaker: ChatBuddyState["lastSpeaker"];
}): boolean {
  return state.busy || state.foreignRun || (state.foreignPending && state.lastSpeaker === "you");
}

/** Where the view's one buddy stands. An empty thread holds it in the welcome
 * (showing the live moment while a run is under way there); a thread with
 * messages holds it at the live edge. Never both. */
export function chatBuddyPlacement(state: {
  hasMessages: boolean;
  working: boolean;
  pristine: boolean;
  live: ChatBuddyMoment;
}): { welcome: ChatBuddyMoment | null; edge: ChatBuddyMoment | null } {
  if (state.hasMessages) return { welcome: null, edge: state.live };
  return { welcome: state.working ? state.live : state.pristine ? "welcome" : "empty", edge: null };
}

/** What the buddy last saw of the chat's runs. `replyMark` is the position of
 * the thread's last assistant reply when the latest run started (null: no run
 * seen in this chat). */
export interface ChatBuddyRun {
  working: boolean;
  chatSlug: string | null;
  replyMark: number | null;
}

/** The run record after the chat moved to (`working`, `chatSlug`), given
 * `lastReply`, the thread position of its last assistant reply (−1: none). A
 * run that starts marks the reply it starts from; another chat opened while
 * idle forgets the mark. A run that ends keeps it, even when the run also
 * named the chat (a first send saves it). */
export function nextBuddyRun(
  prev: ChatBuddyRun,
  working: boolean,
  chatSlug: string | null,
  lastReply: number,
): ChatBuddyRun {
  if (working && !prev.working) return { working, chatSlug, replyMark: lastReply };
  if (!working && !prev.working && prev.chatSlug !== chatSlug) return { working, chatSlug, replyMark: null };
  return { working, chatSlug, replyMark: prev.replyMark };
}

/** The whole-thread position of the last assistant reply (−1: none yet). The
 * view mounts a recent window, so `hidden` earlier messages count too: a new
 * reply always sits further along than the one before it. */
export function lastReplyPosition(messages: readonly { speaker: string }[], hidden: number): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.speaker !== "you") return hidden + i;
  }
  return -1;
}

/** Whether a reply has just landed: the last run is over and a newer reply
 * than the one it started from is in the thread. A Stop that produced nothing
 * leaves the old reply last, so it is no celebration. */
export function justFinishedAfter(run: ChatBuddyRun, lastReply: number): boolean {
  return !run.working && run.replyMark !== null && lastReply > run.replyMark;
}

/** Every moment's pose. The welcome greets by daylight and winds down in the
 * evening; everything else is fixed so the same moment always reads the same. */
export function chatBuddyPose(moment: ChatBuddyMoment, hour: number): CharacterName {
  switch (moment) {
    case "welcome":
      return chatDaypart(hour) === "evening" ? "rest" : "waving";
    case "empty":
      return "chat";
    case "unavailable":
      return "listening";
    case "no-vault":
      return "attention";
    case "queued":
      return "thoughtful";
    case "thinking":
      return "thoughtful";
    case "done":
      return "celebrating";
    case "waiting":
      return "listening";
    case "settled":
      return "rest";
  }
}
