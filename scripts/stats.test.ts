import { expect, test } from "bun:test";

import { checksByVersion, macsFromChecks, type Release, releaseRows, siteCounts } from "./stats";

const asset = (name: string, download_count: number) => ({ name, download_count });

test("each release: DMG downloads (stable + versioned) and installed updates, newest first", () => {
  const releases: Release[] = [
    {
      tag_name: "v1.7.0",
      published_at: "2026-09-30T19:07:50Z",
      assets: [
        asset("Rotli.dmg", 2),
        asset("rotli_1.7.0_aarch64.dmg", 1),
        asset("rotli.app.tar.gz", 5),
        asset("rotli.app.tar.gz.sig", 9),
        asset("latest.json", 40),
      ],
    },
    { tag_name: "v1.7.1", published_at: "2026-10-01T01:00:00Z", assets: [asset("Rotli.dmg", 3)] },
    { tag_name: "helper-v1.2.0", published_at: "2026-09-18T00:00:00Z", assets: [asset("helper.dmg", 7)] },
  ];
  expect(releaseRows(releases)).toEqual([
    { tag: "v1.7.1", date: "2026-10-01", downloads: 3, updates: 0 },
    { tag: "v1.7.0", date: "2026-09-30", downloads: 3, updates: 5 },
  ]);
});

test("update checks are counted by version from rotli.co's paths, nothing else", () => {
  const paths = [
    { path: "/update/1.7.2/darwin/aarch64/latest.json", count: 12 },
    { path: "/update/1.7.3/darwin/aarch64/latest.json", count: 30 },
    { path: "/update/1.7.2/darwin/x86_64/latest.json", count: 2 },
    { path: "/update/1.8.0%2Bbeta/darwin/aarch64/latest.json", count: 1 },
    { path: "/download/", count: 50 },
    { path: "/update/1.7.2/darwin/aarch64/other.json", count: 99 },
  ];
  expect(checksByVersion(paths)).toEqual([
    { version: "1.7.3", checks: 30 },
    { version: "1.7.2", checks: 14 },
    { version: "1.8.0+beta", checks: 1 },
  ]);
});

test("the site's own questions: downloads page, Rotli Web loads", () => {
  const counts = siteCounts([
    { path: "/download/", count: 7 },
    { path: "/app/", count: 4 },
    { path: "/app/index.html", count: 1 },
    { path: "/app/assets/index.js", count: 400 },
    { path: "/privacy/", count: 2 },
  ]);
  expect(counts).toEqual({ download: 7, web: 5, privacy: 2 });
});

test("a day of checks reads as a rough count of Macs", () => {
  expect(macsFromChecks(0)).toBe(0);
  expect(macsFromChecks(1)).toBe(1);
  expect(macsFromChecks(40)).toBe(10);
});
