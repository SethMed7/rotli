#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function oneArg(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function manyArgs(argv, flag) {
  return argv.flatMap((value, index) => (value === flag && argv[index + 1] ? [argv[index + 1]] : []));
}

function required(value, label) {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

export function readToolchainPins(root) {
  const bun = readFileSync(join(root, ".bun-version"), "utf8").trim();
  const rustToolchain = readFileSync(join(root, "rust-toolchain.toml"), "utf8");
  const rust = rustToolchain.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
  return { bun: required(bun, ".bun-version value"), rust: required(rust, "rust-toolchain.toml channel") };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildReleaseEvidence({
  root,
  version,
  sourceCommit,
  builtAt,
  macos,
  ciRun,
  ciResult,
  artifactPaths,
}) {
  required(version, "version");
  required(builtAt, "build timestamp");
  required(macos, "macOS build identity");
  required(ciRun, "CI run URL");
  required(ciResult, "CI conclusion");
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error("source commit must be a full lowercase SHA");
  if (!artifactPaths.length) throw new Error("at least one artifact is required");

  const artifactNames = new Set(artifactPaths.map((path) => basename(path)));
  const artifacts = artifactPaths.map((path) => {
    const name = basename(path);
    const signature = `${name}.sig`;
    return {
      name,
      sha256: sha256(path),
      ...(artifactNames.has(signature) ? { signature } : {}),
    };
  });

  return {
    schemaVersion: 1,
    product: "rotli",
    version,
    sourceCommit,
    sourceTag: `v${version}`,
    builtAt,
    toolchain: { ...readToolchainPins(root), macos },
    checks: { ciRun, result: ciResult },
    artifacts,
  };
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const manifest = buildReleaseEvidence({
      root: process.cwd(),
      version: required(oneArg(argv, "--version"), "--version"),
      sourceCommit: required(oneArg(argv, "--source-commit"), "--source-commit"),
      builtAt: required(oneArg(argv, "--built-at"), "--built-at"),
      macos: required(oneArg(argv, "--macos"), "--macos"),
      ciRun: required(oneArg(argv, "--ci-run"), "--ci-run"),
      ciResult: required(oneArg(argv, "--ci-result"), "--ci-result"),
      artifactPaths: manyArgs(argv, "--artifact"),
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    console.error(`make-release-evidence: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
