import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildReleaseEvidence } from "./make-release-evidence.mjs";

test("release evidence reads repository pins and hashes every artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "rotli-release-evidence-"));
  writeFileSync(join(root, ".bun-version"), "1.3.14\n");
  writeFileSync(join(root, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.97.1"\n');
  const archive = join(root, "rotli.app.tar.gz");
  const signature = `${archive}.sig`;
  writeFileSync(archive, "archive bytes");
  writeFileSync(signature, "signature bytes");

  const evidence = buildReleaseEvidence({
    root,
    version: "0.77.0",
    sourceCommit: "a".repeat(40),
    builtAt: "2026-08-05T12:00:00Z",
    macos: "macOS 15.6 arm64",
    ciRun: "https://github.com/SethMed7/rotli/actions/runs/123",
    ciResult: "success",
    artifactPaths: [archive, signature],
  });

  expect(evidence.toolchain).toEqual({ bun: "1.3.14", rust: "1.97.1", macos: "macOS 15.6 arm64" });
  expect(evidence.artifacts[0]).toEqual({
    name: "rotli.app.tar.gz",
    sha256: createHash("sha256").update("archive bytes").digest("hex"),
    signature: "rotli.app.tar.gz.sig",
  });
  expect(evidence.checks).toEqual({
    ciRun: "https://github.com/SethMed7/rotli/actions/runs/123",
    result: "success",
  });
});
