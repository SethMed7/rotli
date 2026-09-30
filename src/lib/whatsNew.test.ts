import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  highlightsFor,
  latestHighlights,
  parseWhatsNew,
  platformNote,
  WHATS_NEW,
  whatsNewDecision,
} from "./whatsNew";

const notes = {
  "1.6.0": [{ title: "Hand to AI", body: "A prompt from your note." }],
  "1.5.0": [{ title: "Blossom", body: "A seventh theme.", platform: "mac" as const }],
};

describe("What's new — when it shows", () => {
  test("versions compare by number, not by text", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.6.0", "1.6.0")).toBe(0);
    expect(compareVersions("1.5.0", "1.6.0")).toBeLessThan(0);
  });

  test("once after an update, then never again for that version", () => {
    const base = { current: "1.6.0", onboarded: true, onboardingVersion: "1.2.0", notes };
    expect(whatsNewDecision({ ...base, lastSeen: "1.5.0" })).toEqual({ version: "1.6.0", record: true });
    expect(whatsNewDecision({ ...base, lastSeen: "1.6.0" })).toEqual({ version: null, record: false });
  });

  test("a fresh install records the version quietly; it never opens on first run", () => {
    expect(
      whatsNewDecision({
        current: "1.6.0",
        lastSeen: "",
        onboarded: true,
        onboardingVersion: "1.6.0",
        notes,
      }),
    ).toEqual({ version: null, record: true });
    expect(
      whatsNewDecision({ current: "1.6.0", lastSeen: "", onboarded: false, onboardingVersion: "", notes }),
    ).toEqual({ version: null, record: true });
  });

  test("What's new never follows onboarding: set up on this version, it's recorded, not shown", () => {
    // a re-run of setup on 1.6.0, with an older version last seen
    expect(
      whatsNewDecision({
        current: "1.6.0",
        lastSeen: "1.5.0",
        onboarded: true,
        onboardingVersion: "1.6.0",
        notes,
      }),
    ).toEqual({ version: null, record: true });
  });

  test("someone set up on an older build sees it on their first updated launch", () => {
    expect(
      whatsNewDecision({
        current: "1.6.0",
        lastSeen: "",
        onboarded: true,
        onboardingVersion: "1.5.0",
        notes,
      }),
    ).toEqual({ version: "1.6.0", record: true });
  });

  test("a hotfix after a highlighted release still shows that release's card", () => {
    const base = { onboarded: true, onboardingVersion: "1.2.0", notes };
    expect(whatsNewDecision({ ...base, current: "1.6.1", lastSeen: "1.5.0" })).toEqual({
      version: "1.6.0",
      record: true,
    });
    // already seen at 1.6.0: the hotfix shows nothing new
    expect(whatsNewDecision({ ...base, current: "1.6.1", lastSeen: "1.6.0" }).version).toBeNull();
  });

  test("settings that never kept a version record it quietly (no guessing)", () => {
    expect(
      whatsNewDecision({ current: "1.6.0", lastSeen: "", onboarded: true, onboardingVersion: "", notes }),
    ).toEqual({ version: null, record: true });
  });

  test("a version without highlights never opens, but is still recorded", () => {
    expect(
      whatsNewDecision({
        current: "1.6.1",
        lastSeen: "1.6.0",
        onboarded: true,
        onboardingVersion: "1.2.0",
        notes,
      }),
    ).toEqual({ version: null, record: true });
  });

  test("the highlights for a version, the newest ones, and the platform words", () => {
    expect(highlightsFor(notes, "1.6.0")?.[0]?.title).toBe("Hand to AI");
    expect(highlightsFor(notes, "1.7.0")).toBeNull();
    expect(latestHighlights(notes)?.version).toBe("1.6.0");
    expect(platformNote("mac")).toMatch(/^Mac\b.* only$/);
    expect(platformNote("web")).toMatch(/\bWeb only$/);
    expect(platformNote(undefined)).toBeNull();
  });
});

describe("the bundled highlights", () => {
  // up to twelve (the owner, 2026-09-28: the 1.6.0 card covers the whole
  // Round Three batch); the card's list scrolls, never the card
  test("every release lists three to twelve well-formed changes", () => {
    const releases = Object.entries(WHATS_NEW);
    expect(releases.length).toBeGreaterThan(0);
    for (const [version, items] of releases) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(12);
      expect(new Set(items.map((item) => item.title)).size).toBe(items.length);
    }
  });

  test("a malformed entry is dropped, never shown half-built", () => {
    expect(
      parseWhatsNew({
        "2.0.0": [
          { title: "Kept", body: "ok", platform: "web" },
          { title: "Bad platform", body: "x", platform: "linux" },
          { title: 3 },
        ],
        "2.1.0": "not a list",
      }),
    ).toEqual({ "2.0.0": [{ title: "Kept", body: "ok", platform: "web" }] });
  });
});
