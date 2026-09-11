import { expect, test } from "bun:test";

import { privateFileReason, privateTextReasons } from "./repository-privacy.mjs";

test("publication rejects private state and signing files even when nested", () => {
  for (const path of [
    "site/.env.production",
    "vault/.rotli/settings.json",
    "signing/key.p8",
    "x/cert.p12",
    "x/.breve-secrets",
    "x/key.pem",
  ])
    expect(privateFileReason(path)).not.toBeNull();
  for (const path of [
    "src/assets/welcome.json",
    "src-tauri/tauri.conf.json",
    "rotli.app.tar.gz.sig",
    ".carl/carl.json",
  ])
    expect(privateFileReason(path)).toBeNull();
});

test("redacted diagnostics distinguish personal paths from portable documentation", () => {
  expect(privateTextReasons("file /Users/private-person/notes/x.md", "/Users/private-person")).toEqual([
    "personal home path",
  ]);
  expect(privateTextReasons("file /Users/example/notes/x.md", "/Users/private-person")).toEqual([]);
  expect(privateTextReasons(["-----BEGIN PRIVATE KEY-----", "synthetic"].join("\n"), null)).toEqual([
    "private key material",
  ]);
});

test("all deployment contexts explicitly exclude credentials and local vault state", async () => {
  const { readFileSync } = await import("node:fs");
  for (const path of [".dockerignore", ".railwayignore"]) {
    const rules = readFileSync(path, "utf8");
    for (const pattern of [
      "**/.env",
      "**/.env.*",
      "**/*.key",
      "**/*.p12",
      "**/*.p8",
      "**/.rotli",
      "**/.breve-secrets",
      "_review",
    ])
      expect(rules).toContain(pattern);
  }
});
