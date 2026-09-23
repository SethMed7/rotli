import { expect, test } from "bun:test";

import { appChanged, scopeFor } from "./ci-scope";

test("a website or docs-only change skips the app lanes", () => {
  expect(appChanged(["site/src/components/SiteFooter.astro", "site/Caddyfile", "CHANGELOG.md"])).toBe(false);
  expect(appChanged(["docs/development/ci-runner.md", "README.md"])).toBe(false);
});

test("anything the app is built from runs every lane", () => {
  expect(appChanged(["site/Caddyfile", "src/app.tsx"])).toBe(true);
  expect(appChanged(["src-tauri/src/lib.rs"])).toBe(true);
  // the site image builds Rotli Web from src/, but these lanes test the app itself
  expect(appChanged(["src/assets/characters/base.svg"])).toBe(true);
  // Markdown that tests read is app input, not documentation
  expect(appChanged(["src-tauri/demo-seed/wiki/guides/welcome-to-rotli.md"])).toBe(true);
  expect(appChanged([".github/workflows/regression.yml"])).toBe(true);
  expect(appChanged(["package.json"])).toBe(true);
  // the site's manifest and lockfile are what the dependency audit scans
  expect(appChanged(["site/bun.lock"])).toBe(true);
  expect(appChanged(["site/package.json", "site/src/pages/index.astro"])).toBe(true);
});

test("no changed paths is treated as an app change, never a skip", () => {
  expect(appChanged([])).toBe(true);
});

test("any doubt about the range runs every lane — a broken scope never skips", () => {
  const sha = "a".repeat(40);
  const neverAsked = () => {
    throw new Error("the diff must not run");
  };
  expect(scopeFor("0".repeat(40), sha, neverAsked).app).toBe(true); // a new branch's first push
  expect(scopeFor("", sha, neverAsked).app).toBe(true); // a manual run
  expect(scopeFor("not-a-sha", sha, neverAsked).app).toBe(true);
  expect(scopeFor(sha, "b".repeat(40), () => null).app).toBe(true); // git diff failed
  expect(scopeFor(sha, "b".repeat(40), () => []).app).toBe(true); // nothing listed
  expect(scopeFor(sha, "b".repeat(40), () => ["site/Caddyfile"]).app).toBe(false);
});
