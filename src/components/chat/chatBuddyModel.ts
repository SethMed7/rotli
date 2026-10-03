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

/** What the buddy last saw of the chat's runs. */
export interface ChatBuddyRun {
  working: boolean;
  chatSlug: string | null;
  justFinished: boolean;
}

/** Whether a reply has just landed, given what the buddy saw last. A run that
 * ends counts even when it also named the chat (a first send saves it); a new
 * run, or another chat opened while idle, clears it. */
export function justFinishedAfter(prev: ChatBuddyRun, working: boolean, chatSlug: string | null): boolean {
  if (working) return false;
  if (prev.working) return true;
  if (prev.chatSlug !== chatSlug) return false;
  return prev.justFinished;
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
      return "rest";
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
