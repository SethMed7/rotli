import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChatModelChoices, providerSetupStatus } from "./chatModelChoices";

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
  const html = renderToStaticMarkup(<ChatModelChoices onOpenSettings={() => {}} />);
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
