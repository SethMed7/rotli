import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
