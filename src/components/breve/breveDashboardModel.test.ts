import { describe, expect, test } from "bun:test";

import { briefDashboardDigest } from "./breveDashboardModel";

describe("Breve dashboard projection", () => {
  test("projects headline, actions, news sections, and unique resources", () => {
    const digest = briefDashboardDigest(`---
owner: rotli
---
# Breve

## Headline
[Local models](https://example.com/models) are moving onto the Mac.

## Action Items
- **Review the launch** — compare the new release.
- Save the useful source.

## AI and tools
Two launches landed today. [Read more](https://example.com/news).

## Worth Your Time
- [Same source](https://example.com/news)
`);

    expect(digest.headline).toBe("Local models are moving onto the Mac.");
    expect(digest.actions).toEqual([
      "Review the launch — compare the new release.",
      "Save the useful source.",
    ]);
    expect(digest.stories).toEqual([
      { title: "AI and tools", summary: "Two launches landed today. Read more." },
    ]);
    expect(digest.resources).toEqual([
      { label: "Local models", url: "https://example.com/models" },
      { label: "Read more", url: "https://example.com/news" },
    ]);
  });

  test("returns an honest empty digest for an empty brief", () => {
    expect(briefDashboardDigest("")).toEqual({
      headline: "",
      actions: [],
      stories: [],
      resources: [],
    });
  });
});
