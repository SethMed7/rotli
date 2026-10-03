// The chat buddy: the person's decorated quokka, always present in Chat. One
// buddy per view — the welcome, the empty states, or the thread's live edge —
// never one per message. Its pose follows the chat (chatBuddyModel.ts).

import { useState } from "react";

import { Character } from "../character";
import { type ChatBuddyMoment, type ChatBuddyRun, chatBuddyPose, justFinishedAfter } from "./chatBuddyModel";

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

/** True once a reply finishes while this chat is on screen, until the next
 * run starts or another chat opens: the buddy is happy about the answer it
 * just watched land, and calm on a thread reopened later. */
export function useJustFinished(working: boolean, chatSlug: string | null): boolean {
  const [seen, setSeen] = useState<ChatBuddyRun>({ working, chatSlug, justFinished: false });
  if (seen.working !== working || seen.chatSlug !== chatSlug) {
    const justFinished = justFinishedAfter(seen, working, chatSlug);
    setSeen({ working, chatSlug, justFinished });
    return justFinished;
  }
  return seen.justFinished;
}
