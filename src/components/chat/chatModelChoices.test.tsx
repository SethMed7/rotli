import { describe, expect, test } from "bun:test";

import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { queryClient } from "../../services/query";
import { ChatModelChoices, localInstallProgressQuery, providerSetupStatus } from "./chatModelChoices";

describe("chat model chooser provider status", () => {
  test("distinguishes detection, installation, sign-in, and readiness", () => {
    expect(providerSetupStatus(undefined)).toBe("Checking…");
    expect(providerSetupStatus({ installed: false, authenticated: false, version: null })).toBe(
      "Not installed",
    );
    expect(providerSetupStatus({ installed: true, authenticated: false, version: "1" })).toBe(
      "Sign in needed",
    );
    expect(providerSetupStatus({ installed: true, authenticated: true, version: "1" })).toBe("Ready");
  });
});

test("chat offers every way in, models on this Mac first, and a door to Settings", () => {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ChatModelChoices onOpenSettings={() => {}} />
    </QueryClientProvider>,
  );
  expect(html).toContain("Choose how chat thinks");
  const local = html.indexOf("On this Mac");
  const install = html.indexOf("Install a model");
  const connect = html.indexOf("Connect Claude, ChatGPT, Cursor, or Gemini");
  expect(local).toBeGreaterThan(-1);
  expect(install).toBeGreaterThan(local);
  expect(connect).toBeGreaterThan(install);
  // models on this Mac open first
  expect(html).toContain('aria-expanded="true" aria-controls="local-model-panel"');
  expect(html).toContain(">More in Settings → AI Models<");
  // the Librarian isn't chosen here: setup has its own screen for it
  expect(html).not.toContain("Who files your notes?");
});

test("install progress rides Settings' shared poll, only while an install runs", () => {
  const idle = localInstallProgressQuery(undefined);
  expect(idle.queryKey).toEqual(["local-install", undefined]);
  expect(idle.enabled).toBe(false);
  const running = localInstallProgressQuery("gemma");
  expect(running.queryKey).toEqual(["local-install", "gemma"]);
  expect(running.enabled).toBe(true);
  expect(running.refetchInterval).toBe(1000);
  // React Query's default: the poll pauses while the window is hidden
  expect("refetchIntervalInBackground" in running).toBe(false);
});
