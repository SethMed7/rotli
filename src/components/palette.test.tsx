import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
const live = { ...(await import("../lib/featurePolicy")) };
await mock.module("../lib/featurePolicy", () => ({
  ...live,
  PLATFORM: "web",
  LAUNCH_FEATURES: live.launchFeatures(false, "web"),
}));
const { registerDefaultActions } = await import("../keys/actions");
const { allActions } = await import("../keys/registry");
const { Palette } = await import("./palette");
afterAll(async () => {
  await mock.module("../lib/featurePolicy", () => live);
});
test("the rendered web palette names no withheld chord", () => {
  registerDefaultActions();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Palette onClose={() => {}} />
    </QueryClientProvider>,
  );
  expect(html).not.toMatch(/[⌘⌃]/);
  expect(html).toContain("navigate");
});

test("web palette excludes actions that require the desktop shell", () => {
  registerDefaultActions();
  const titles = allActions().map((action) => action.title);
  for (const title of [
    "Hide Rotli",
    "Close current view",
    "Open web browser",
    "Open a private browser",
    "Jump into the sidebar",
  ]) {
    expect(titles).not.toContain(title);
  }
});
