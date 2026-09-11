import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(new URL("settingsSurface.tsx", import.meta.url), "utf8");
const browserSource = readFileSync(new URL("browserSurface.tsx", import.meta.url), "utf8");
// the relay pairing section lives in its own file (development builds only)
const remoteAgentsSource = readFileSync(new URL("remoteAgentsSection.tsx", import.meta.url), "utf8");

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
    expect(remoteAgentsSource).toContain("Connect this session");
    expect(remoteAgentsSource).toMatch(/starts disconnected after every launch/);
    expect(remoteAgentsSource).toMatch(/Rotli must be\s+open and connected for every request/);
  });

  test("shows pairing details only after an explicit create or regenerate action", () => {
    expect(remoteAgentsSource).toContain("Create pairing");
    expect(remoteAgentsSource).toContain("Regenerate pairing");
    expect(remoteAgentsSource).toContain("Paste into Grok Bot");
    expect(remoteAgentsSource).toContain("authorizationHeader");
    expect(remoteAgentsSource).toContain("cannot reveal this client token after you leave this screen");
    expect(remoteAgentsSource).not.toMatch(/setRelayUrl\(event\.target\.value\);\s*setPairing\(null\)/);
  });

  test("confirms token replacement and explains vault-switch disconnection", () => {
    expect(remoteAgentsSource).toContain("Replace pairing");
    expect(remoteAgentsSource).toMatch(/permanently invalidates the old client token/);
    expect(remoteAgentsSource).toMatch(/Switching vaults disconnects/);
    expect(remoteAgentsSource).toMatch(/pairing is bound to the relay URL/);
  });

  test("can explicitly disconnect and delete the pairing from Keychain", () => {
    expect(remoteAgentsSource).toContain("Remove pairing");
    expect(remoteAgentsSource).toContain("Confirm removal");
    expect(remoteAgentsSource).toContain("remoteAgentUnpair");
    expect(remoteAgentsSource).toMatch(/deletes both remote-agent tokens from Keychain/);
  });

  test("persists only the relay endpoint and distinguishes active connection states", () => {
    expect(remoteAgentsSource).toContain("remoteAgentRelayUrl");
    expect(remoteAgentsSource).toContain("current?.active");
    expect(remoteAgentsSource).toContain('"Retrying"');
  });
});
