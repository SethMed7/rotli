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
