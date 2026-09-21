import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SettingsFootButton } from "./sidebarFooter";

test("Settings is plain until an update is on the feed", () => {
  const markup = renderToStaticMarkup(<SettingsFootButton updateAvailable={false} />);
  expect(markup).toContain('title="Settings"');
  expect(markup).not.toContain("sb-update-dot");
  expect(markup).not.toContain("aria-label");
});

test("an available update marks Settings with a dot and says so in words", () => {
  const markup = renderToStaticMarkup(<SettingsFootButton updateAvailable />);
  expect(markup).toContain('class="sb-update-dot" aria-hidden="true"');
  expect(markup).toContain('aria-label="Settings — update available"');
  expect(markup).toContain('title="Update available — open Settings"');
});
