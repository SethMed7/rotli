import { describe, expect, test } from "bun:test";

import {
  forgetPrivateBrowserTab,
  normalizePrivateBrowserInput,
  privateBrowserInitialUrl,
  privateBrowserSearchUrl,
  seedPrivateBrowserTab,
} from "./privateBrowser";

describe("normalizePrivateBrowserInput", () => {
  test("keeps ordinary http(s) URLs and upgrades hostnames to https", () => {
    expect(normalizePrivateBrowserInput("https://example.com/docs?q=1")).toBe("https://example.com/docs?q=1");
    expect(normalizePrivateBrowserInput("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizePrivateBrowserInput("localhost:1420")).toBe("http://localhost:1420/");
  });

  test("turns prose into an encoded search and refuses non-web schemes", () => {
    expect(normalizePrivateBrowserInput("quokka hat fitting")).toBe(
      "https://www.google.com/search?q=quokka%20hat%20fitting",
    );
    expect(normalizePrivateBrowserInput("file:///etc/passwd")).toBeNull();
    expect(normalizePrivateBrowserInput("javascript:alert(1)")).toBeNull();
    expect(normalizePrivateBrowserInput("   ")).toBeNull();
  });

  test("routes searches through the user's selected private-browser provider", () => {
    expect(privateBrowserSearchUrl("duckduckgo", "local first notes")).toBe(
      "https://duckduckgo.com/?q=local%20first%20notes",
    );
    expect(privateBrowserSearchUrl("brave", "local first notes")).toBe(
      "https://search.brave.com/search?q=local%20first%20notes",
    );
    expect(privateBrowserSearchUrl("google", "local first notes")).toBe(
      "https://www.google.com/search?q=local%20first%20notes",
    );
    expect(privateBrowserSearchUrl("bing", "local first notes")).toBe(
      "https://www.bing.com/search?q=local%20first%20notes",
    );
    expect(normalizePrivateBrowserInput("quokka research", "duckduckgo")).toBe(
      "https://duckduckgo.com/?q=quokka%20research",
    );
  });

  test("opens fresh tabs on Rotli's themed start page while direct links stay direct", () => {
    seedPrivateBrowserTab("fresh");
    seedPrivateBrowserTab("source", "https://example.com/source");
    expect(privateBrowserInitialUrl("fresh")).toBeNull();
    expect(privateBrowserInitialUrl("source")).toBe("https://example.com/source");
    forgetPrivateBrowserTab("fresh");
    forgetPrivateBrowserTab("source");
  });
});
