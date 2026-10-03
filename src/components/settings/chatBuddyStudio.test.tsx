import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChatBuddyStudio } from "./chatBuddyStudio";

// The live preview follows each pick: e2e/chat-buddy.spec.ts clicks it through.
describe("Settings → Appearance → Chat buddy", () => {
  test("decorates the buddy without a switch or a mood picker", () => {
    const markup = renderToStaticMarkup(<ChatBuddyStudio />);
    expect(markup).toContain("Chat buddy");
    expect(markup).toContain('aria-label="Quokka body color"');
    expect(markup).toContain('aria-label="Quokka line color"');
    expect(markup).toContain('aria-label="Quokka accessory"');
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toContain("mood");
  });

  test("shows the expressions Chat picks, wearing the same decoration", () => {
    const markup = renderToStaticMarkup(<ChatBuddyStudio />);
    for (const pose of ["chat", "waving", "thoughtful", "celebrating", "listening"])
      expect(markup).toContain(`data-pose="${pose}"`);
  });
});
