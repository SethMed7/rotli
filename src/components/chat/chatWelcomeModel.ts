import type { ChatWelcomeStyle } from "../../state/ui";
import type { CharacterName } from "../character";

export type ChatDaypart = "morning" | "noon" | "afternoon" | "evening";
export type ChatWelcomeSuggestionKind = "search" | "write" | "organize";

export interface ChatWelcomeSuggestion {
  kind: ChatWelcomeSuggestionKind;
  label: string;
  prompt: string;
}

export function chatDaypart(hour: number): ChatDaypart {
  if (hour < 12) return "morning";
  if (hour < 14) return "noon";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function chatGreeting(hour: number, userName: string): string {
  const name = userName.trim().split(/\s+/)[0];
  const daypart = chatDaypart(hour);
  const greeting = daypart === "noon" ? "afternoon" : daypart;
  return `Good ${greeting}${name ? `, ${name}` : ""}.`;
}

/** The new-chat prompt reads like an invitation instead of a dashboard
 * salutation. Only the first name is used so a full profile value never turns
 * into a piece of UI chrome. */
export function chatWorkPrompt(userName: string): string {
  const name = userName.trim().split(/\s+/)[0];
  return `What should we work on${name ? `, ${name}` : ""}?`;
}

export function chatWelcomeCharacter(hour: number, style: ChatWelcomeStyle): CharacterName {
  if (style === "calm") return "chat";
  switch (chatDaypart(hour)) {
    case "morning":
      return "waving";
    case "afternoon":
    case "noon":
      return "knowledge";
    case "evening":
      return "rest";
  }
}

export function chatWelcomeSuggestions(hour: number): readonly ChatWelcomeSuggestion[] {
  const daypart = chatDaypart(hour);
  return [
    {
      kind: "search",
      label: "Find something in my vault",
      prompt: "Help me find and connect the most relevant things in my vault about ",
    },
    {
      kind: "write",
      label: daypart === "morning" ? "Plan what matters today" : "Draft something from my notes",
      prompt:
        daypart === "morning"
          ? "Help me plan what matters today using the context in my vault."
          : "Help me draft something using the relevant context in my vault: ",
    },
    {
      kind: "organize",
      label: "Make sense of recent captures",
      prompt: "Review my recent captures with me and suggest the useful connections and next steps.",
    },
  ];
}
