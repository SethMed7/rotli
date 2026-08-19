import { describe, expect, test } from "bun:test";

import {
  chatDaypart,
  chatGreeting,
  chatWelcomeCharacter,
  chatWelcomeSuggestions,
  chatWorkPrompt,
} from "./chatWelcomeModel";

describe("fresh chat welcome", () => {
  test("uses local time boundaries and the user's first name", () => {
    expect(chatDaypart(11)).toBe("morning");
    expect(chatDaypart(12)).toBe("noon");
    expect(chatDaypart(13)).toBe("noon");
    expect(chatDaypart(14)).toBe("afternoon");
    expect(chatDaypart(17)).toBe("afternoon");
    expect(chatDaypart(18)).toBe("evening");
    expect(chatGreeting(8, "  Avery Reed ")).toBe("Good morning, Avery.");
    expect(chatGreeting(12, "Avery Reed")).toBe("Good afternoon, Avery.");
    expect(chatGreeting(20, "")).toBe("Good evening.");
  });

  test("calm stays visually stable while lively follows the day", () => {
    expect(chatWelcomeCharacter(8, "calm")).toBe("chat");
    expect(chatWelcomeCharacter(20, "calm")).toBe("chat");
    expect(chatWelcomeCharacter(8, "lively")).toBe("waving");
    expect(chatWelcomeCharacter(12, "lively")).toBe("waving");
    expect(chatWelcomeCharacter(14, "lively")).toBe("waving");
    expect(chatWelcomeCharacter(20, "lively")).toBe("rest");
  });

  test("invites work without requiring a profile name", () => {
    expect(chatWorkPrompt("  Avery Reed ")).toBe("What should we work on, Avery?");
    expect(chatWorkPrompt(" ")).toBe("What should we work on?");
  });

  test("offers useful prompts without sending them automatically", () => {
    const suggestions = chatWelcomeSuggestions(9);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.prompt).toContain("vault");
    expect(suggestions[1]?.label).toBe("Plan what matters today");
  });
});
