import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(new URL("settingsSurface.tsx", import.meta.url), "utf8");
const browserSource = readFileSync(new URL("browserSurface.tsx", import.meta.url), "utf8");

describe("private browser presentation", () => {
  test("gives browser preferences their own settings pane and explains the narrow private purpose", () => {
    expect(settingsSource).toContain('{ id: "browser", label: "Browser"');
    expect(settingsSource).toContain("Every browser tab is private");
    expect(settingsSource).toMatch(/quick\s+research without leaving Rotli/);
    expect(settingsSource).toMatch(/not a replacement for your everyday browser/);
  });

  test("uses a theme-token start page instead of opening a provider homepage", () => {
    expect(browserSource).toContain('className="browser-start"');
    expect(browserSource).toContain("privateBrowserSearchEngine");
    expect(browserSource).toContain("Search with");
  });

  test("opens popup destinations as sibling private tabs", () => {
    expect(browserSource).toContain("openBrowser(event.url, paneId)");
    expect(browserSource).not.toContain("privateBrowserNavigate(tabId, event.url)");
  });
});

describe("remote agent connection presentation", () => {
  test("requires an explicit connection for each app session", () => {
    expect(settingsSource).toContain("Connect this session");
    expect(settingsSource).toMatch(/starts disconnected after every launch/);
    expect(settingsSource).toMatch(/Rotli must be\s+open and connected for every request/);
  });

  test("shows pairing details only after an explicit create or regenerate action", () => {
    expect(settingsSource).toContain("Create pairing");
    expect(settingsSource).toContain("Regenerate pairing");
    expect(settingsSource).toContain("Paste into Grok Bot");
    expect(settingsSource).toContain("authorizationHeader");
    expect(settingsSource).toContain("cannot reveal this client token after you leave this screen");
  });

  test("confirms token replacement and explains vault-switch disconnection", () => {
    expect(settingsSource).toContain("Replace pairing");
    expect(settingsSource).toMatch(/permanently invalidates the old client token/);
    expect(settingsSource).toMatch(/Switching vaults disconnects/);
  });

  test("can explicitly disconnect and delete the pairing from Keychain", () => {
    expect(settingsSource).toContain("Remove pairing");
    expect(settingsSource).toContain("Confirm removal");
    expect(settingsSource).toContain("remoteAgentUnpair");
    expect(settingsSource).toMatch(/deletes both remote-agent tokens from Keychain/);
  });

  test("persists only the relay endpoint and distinguishes active connection states", () => {
    expect(settingsSource).toContain("remoteAgentRelayUrl");
    expect(settingsSource).toContain("current?.active");
    expect(settingsSource).toContain('"Retrying"');
  });
});
