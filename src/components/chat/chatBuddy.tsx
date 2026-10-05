// The chat buddy: the person's decorated quokka, always present in Chat. One
// buddy per view — the welcome, the empty states, or the thread's live edge —
// never one per message. Its pose follows the chat (chatBuddyModel.ts).

import { useState } from "react";

import { Character } from "../character";
import {
  type ChatBuddyMoment,
  type ChatBuddyRun,
  chatBuddyPose,
  justFinishedAfter,
  nextBuddyRun,
} from "./chatBuddyModel";

export function ChatBuddy({
  moment,
  hour,
  size,
  className,
}: {
  moment: ChatBuddyMoment;
  hour: number;
  size: number;
  className?: string;
}) {
  return (
    <Character
      name={chatBuddyPose(moment, hour)}
      size={size}
      className={className ? `chat-buddy ${className}` : "chat-buddy"}
    />
  );
}

/** True once a reply lands while this chat is on screen, until the next run
 * starts or another chat opens: the buddy is happy about the answer it just
 * watched land, and calm on a thread reopened later or a run stopped before it
 * answered. `lastReply` is the thread position of the last assistant reply. */
export function useJustFinished(working: boolean, chatSlug: string | null, lastReply: number): boolean {
  // a run already under way when this view mounts (a remount mid-reply) marks
  // the reply it found, so its answer still lands as one
  const [seen, setSeen] = useState<ChatBuddyRun>({
    working,
    chatSlug,
    replyMark: working ? lastReply : null,
  });
  if (seen.working !== working || seen.chatSlug !== chatSlug) {
    const next = nextBuddyRun(seen, working, chatSlug, lastReply);
    setSeen(next);
    return justFinishedAfter(next, lastReply);
  }
  return justFinishedAfter(seen, lastReply);
}
