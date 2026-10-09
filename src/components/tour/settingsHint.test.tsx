import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SettingsHintCard } from "./settingsHint";

test("the note at Settings says what else is there, and offers to open it", () => {
  const html = renderToStaticMarkup(<SettingsHintCard />);
  expect(html).toContain('aria-label="More in Settings"');
  expect(html).toContain("Your quokka, music, how the window lives, chat models");
  expect(html).toContain(">Open Settings<");
  expect(html).toContain(">Got it<");
});
