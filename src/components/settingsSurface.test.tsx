import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

const policy = { ...(await import("../lib/featurePolicy")) };
const react = { ...(await import("react")) };
let selectedPane: "brain" | "models" = "brain";
await mock.module("../lib/featurePolicy", () => ({
  ...policy,
  PLATFORM: "web",
  LAUNCH_FEATURES: policy.launchFeatures(false, "web"),
}));
// SSR has no navigation effects. Start the actual Settings component at each
// requested section without adding a test-only pane API to production.
await mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => react.useState(initial === "general" ? selectedPane : initial),
}));
const { SettingsSurface } = await import("./settingsSurface");
const { useUiStore } = await import("../state/ui");
afterAll(async () => {
  await mock.module("react", () => react);
  await mock.module("../lib/featurePolicy", () => policy);
});
const render = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSurface />
    </QueryClientProvider>,
  );

test("web Librarian Settings explains the limit without live Run-now controls", () => {
  selectedPane = "brain";
  useUiStore.setState({ brainEnabled: true });
  const html = render();
  expect(html).toContain("The Librarian is available in Rotli for Mac.");
  expect(html).not.toContain("Run now");
  expect(html).not.toContain("Pass queued");
});
test("web model Settings keeps connected CLI configuration without local runtime controls", () => {
  selectedPane = "models";
  const html = render();
  expect(html).toContain("Local models are available in Rotli for Mac.");
  expect(html).not.toContain("Scan my Mac");
  expect(html).not.toMatch(/>\s*(Install|Uninstall|Make default)\s*</);
  expect(html).toContain("Connected models");
});
