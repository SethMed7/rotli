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
