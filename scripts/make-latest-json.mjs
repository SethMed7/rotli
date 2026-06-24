#!/usr/bin/env bun
// make-latest-json.mjs — emit the Tauri v2 dynamic update manifest (latest.json)
// the updater feed serves. release.sh uploads this alongside the .app.tar.gz +
// its .sig to the rotli-releases "latest" release; the running app fetches it
// from the endpoint in tauri.conf.json and compares versions.
//
// Inputs (argv first, then env — no hardcoded secrets, nothing read from disk
// except the .sig file you point it at):
//   --version <X.Y.Z>   | env VERSION       the release version
//   --sig <path>        | env SIG_PATH      path to the minisign .sig file
//   --url <url>         | env URL           public download URL of the .tar.gz
//   --notes <text>      | env NOTES         release notes (optional)
//   --pub-date <iso>    | env PUB_DATE      RFC3339 (optional; defaults to now)
//
// The signature in latest.json is the CONTENTS of the .sig file (a base64 blob),
// not a path. Prints the JSON to stdout — pipe it to latest.json.
//
//   bun scripts/make-latest-json.mjs \
//     --version 0.2.0 \
//     --sig src-tauri/target/release/bundle/macos/rotli.app.tar.gz.sig \
//     --url https://github.com/SethMed7/rotli-releases/releases/download/v0.2.0/rotli.app.tar.gz \
//     > latest.json

import { readFileSync } from "node:fs";

function arg(flag, envKey) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  return process.env[envKey];
}

const version = arg("--version", "VERSION");
const sigPath = arg("--sig", "SIG_PATH");
const url = arg("--url", "URL");
const notes = arg("--notes", "NOTES") ?? `rotli ${version ?? ""}`.trim();
const pubDate = arg("--pub-date", "PUB_DATE") ?? new Date().toISOString();

const missing = [];
if (!version) missing.push("--version / VERSION");
if (!sigPath) missing.push("--sig / SIG_PATH");
if (!url) missing.push("--url / URL");
if (missing.length) {
  console.error(`make-latest-json: missing required input(s): ${missing.join(", ")}`);
  process.exit(1);
}

let signature;
try {
  signature = readFileSync(sigPath, "utf8").trim();
} catch (err) {
  console.error(`make-latest-json: could not read .sig file at ${sigPath}: ${err.message}`);
  process.exit(1);
}
if (!signature) {
  console.error(`make-latest-json: the .sig file at ${sigPath} is empty`);
  process.exit(1);
}

// Tauri v2 dynamic manifest. rotli ships Apple-silicon only, so a single
// darwin-aarch64 platform; add darwin-x86_64 here if a universal/Intel build
// is produced later.
const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    "darwin-aarch64": {
      signature,
      url,
    },
  },
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
