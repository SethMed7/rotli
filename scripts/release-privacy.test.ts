import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundlePrivacyFindings } from "./repository-privacy.mjs";

test("release bundle inspection catches ignored secrets and embedded home paths without following external links", () => {
  const root = mkdtempSync(join(tmpdir(), "rotli-bundle-privacy-"));
  const app = join(root, "synthetic.app");
  const personalHome = "/Users/synthetic-owner";
  try {
    mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(app, "Contents", "Resources", ".env"), "EXAMPLE=fixture");
    writeFileSync(join(app, "Contents", "binary"), Buffer.from(`\0compiled:${personalHome}/source.rs\0`));
    symlinkSync("/outside-the-bundle", join(app, "external"));
    symlinkSync("Contents/binary", join(app, "internal"));
    const findings = bundlePrivacyFindings(app, personalHome);
    expect(findings).toContain("Contents/Resources/.env: environment or secret file");
    expect(findings).toContain("Contents/binary: personal home path in artifact");
    expect(findings).toContain("external: link escapes release bundle");
    expect(findings.join("\n")).not.toContain(personalHome);
    expect(findings.join("\n")).not.toContain("EXAMPLE=fixture");
    expect(findings.some((item: string) => item.startsWith("internal:"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the bundle admits declared resources but refuses arbitrary ignored personal notes", () => {
  const root = mkdtempSync(join(tmpdir(), "rotli-bundle-manifest-"));
  const prefix = "Contents/Resources/breve-runtime/";
  try {
    mkdirSync(join(root, prefix), { recursive: true });
    writeFileSync(join(root, prefix, "README.md"), "Public runtime instructions");
    const resources = { prefix, files: new Set([`${prefix}README.md`]) };
    expect(bundlePrivacyFindings(root, null, resources)).toEqual([]);
    writeFileSync(join(root, prefix, "personal-note.md"), "Synthetic ignored note fixture");
    expect(bundlePrivacyFindings(root, null, resources)).toContain(
      `${prefix}personal-note.md: resource is not in the reviewed source manifest`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// `env!("CARGO_MANIFEST_DIR")` bakes the builder's checkout path into the
// binary. A runtime `if cfg!(debug_assertions)` does not keep that literal out
// of a release build; only compile-time `#[cfg(...)]` gating does. 1.9.1's
// first release run was refused for exactly this (routines.rs, 2026-10-20).
test("Rust source never compiles the checkout path into a release binary", () => {
  const sourceRoot = join(import.meta.dir, "..", "src-tauri", "src");
  const offenders: string[] = [];
  for (const file of readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".rs") || file.endsWith("tests.rs")) continue;
    const lines = readFileSync(join(sourceRoot, file), "utf8").split("\n");
    const testModule = lines.findIndex((line) => line.trim() === "#[cfg(test)]");
    lines.forEach((line, index) => {
      if (!line.includes("CARGO_MANIFEST_DIR")) return;
      if (testModule !== -1 && index > testModule) return;
      const gated = lines
        .slice(Math.max(0, index - 3), index)
        .some((l) => l.includes("#[cfg(debug_assertions)]"));
      if (!gated) offenders.push(`${file}:${index + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
