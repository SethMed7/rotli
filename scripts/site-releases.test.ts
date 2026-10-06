// The roadmap's "Recently shipped" (site/src/releases.ts): which releases it reads from
// CHANGELOG.md, which of their bullets become headline items, and the /changelog/ anchor each
// links to. e2e/site/roadmap.spec.ts proves the page and that every anchor lands. Like
// site-writing.test.ts, the module loads through a computed path so the site's types stay out
// of the root typecheck; only what is tested is typed here.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ShippedRelease {
  version: string;
  date: string;
  label: string;
  anchor: string;
  items: string[];
}
let releases: {
  recentReleases(changelog: string, count?: number, perRelease?: number): ShippedRelease[];
  changelogAnchor(version: string, date: string): string;
};

beforeAll(async () => {
  releases = await import(join(import.meta.dir, "..", "site", "src", "releases.ts"));
});

const FIXTURE = `# Changelog

## [Unreleased]

### Added

- **Not released yet.** Never on the page.

## [2.1.0] - 2026-11-02

### Fixed

- **A fix comes last.** Even when it is listed first.
- a fix without a bold lead is skipped.

### Added

- **Charts in your notes.** Type \`/chart\`.
- **A lead that wraps onto
  the next line.** And then the rest.

### Changed

- **Something changed:** with a colon.

## [2.0.1] - 2026-10-30

### Fixed

- plain fix, no lead.

## [2.0.0] - 2026-10-28

### Added

- **Version two.**

## [1.0.0] - 2026-09-15

- **Outside any kind.** Not a headline.
`;

describe("recentReleases", () => {
  test("reads dated releases newest first and never [Unreleased]", () => {
    const list = releases.recentReleases(FIXTURE, 3);
    expect(list.map((release) => release.version)).toEqual(["2.1.0", "2.0.1", "2.0.0"]);
    expect(list.flatMap((release) => release.items)).not.toContain("Not released yet");
    expect(list[0]!.date).toBe("2026-11-02");
    expect(list[0]!.label).toBe("November 2, 2026");
  });

  test("takes bold leads word for word, Added then Changed then Fixed, capped per release", () => {
    const [latest] = releases.recentReleases(FIXTURE, 1, 5);
    expect(latest!.items).toEqual([
      "Charts in your notes",
      "A lead that wraps onto the next line",
      "Something changed",
      "A fix comes last",
    ]);
    expect(releases.recentReleases(FIXTURE, 1, 2)[0]!.items).toEqual([
      "Charts in your notes",
      "A lead that wraps onto the next line",
    ]);
  });

  test("a release whose bullets have no bold leads has no items, and bullets outside a kind are skipped", () => {
    const list = releases.recentReleases(FIXTURE, 4);
    expect(list[1]!.items).toEqual([]);
    expect(list[3]!.items).toEqual([]);
  });

  test("fails rather than show fewer releases than asked for", () => {
    expect(() => releases.recentReleases(FIXTURE, 5)).toThrow(/asked for 5 releases, found 4/);
  });

  test("links each release to the id Astro gives its changelog heading", () => {
    expect(releases.changelogAnchor("1.7.1", "2026-09-30")).toBe("171---2026-09-30");
    expect(releases.recentReleases(FIXTURE, 1)[0]!.anchor).toBe("210---2026-11-02");
  });

  test("the real CHANGELOG.md gives four releases, each with at least one headline", () => {
    const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
    const list = releases.recentReleases(changelog);
    expect(list).toHaveLength(4);
    for (const release of list) {
      expect(release.items.length).toBeGreaterThan(0);
      for (const item of release.items) expect(changelog).toContain(`- **${item}`);
    }
  });
});
