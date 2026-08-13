import { describe, expect, test } from "bun:test";

import { chatDaypart, chatGreeting, chatWelcomeCharacter, chatWelcomeSuggestions } from "./chatWelcomeModel";

describe("fresh chat welcome", () => {
  test("uses local time boundaries and the user's first name", () => {
    expect(chatDaypart(11)).toBe("morning");
    expect(chatDaypart(12)).toBe("noon");
    expect(chatDaypart(13)).toBe("noon");
    expect(chatDaypart(14)).toBe("afternoon");
    expect(chatDaypart(17)).toBe("afternoon");
    expect(chatDaypart(18)).toBe("evening");
    expect(chatGreeting(8, "  Seth Medina ")).toBe("Good morning, Seth.");
    expect(chatGreeting(12, "Seth Medina")).toBe("Good afternoon, Seth.");
    expect(chatGreeting(20, "")).toBe("Good evening.");
  });

  test("calm stays visually stable while lively follows the day", () => {
    expect(chatWelcomeCharacter(8, "calm")).toBe("chat");
    expect(chatWelcomeCharacter(20, "calm")).toBe("chat");
    expect(chatWelcomeCharacter(8, "lively")).toBe("waving");
    expect(chatWelcomeCharacter(12, "lively")).toBe("knowledge");
    expect(chatWelcomeCharacter(14, "lively")).toBe("knowledge");
    expect(chatWelcomeCharacter(20, "lively")).toBe("rest");
  });

  test("offers useful prompts without sending them automatically", () => {
    const suggestions = chatWelcomeSuggestions(9);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]?.prompt).toContain("vault");
    expect(suggestions[1]?.label).toBe("Plan what matters today");
  });
});
