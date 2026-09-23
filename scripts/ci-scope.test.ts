import { expect, test } from "bun:test";

import { appChanged } from "./ci-scope";

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
});

test("no changed paths is treated as an app change, never a skip", () => {
  expect(appChanged([])).toBe(true);
});
