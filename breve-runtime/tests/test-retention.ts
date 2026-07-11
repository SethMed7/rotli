#!/usr/bin/env bun
import { shouldPruneBriefFile } from "../scripts/brief-retention";

const keep = new Set(["2026-07-09", "2026-07-10"]);
const checks: Array<[string, boolean]> = [
  ["managed Markdown is durable", !shouldPruneBriefFile("2026-07-08.md", keep, true)],
  ["managed lunch Markdown is durable", !shouldPruneBriefFile("2026-07-08-lunch.md", keep, true)],
  ["managed stale HTML is transient", shouldPruneBriefFile("2026-07-08.html", keep, true)],
  ["managed stale audio script is transient", shouldPruneBriefFile("2026-07-08.audio.txt", keep, true)],
  ["recent companions stay", !shouldPruneBriefFile("2026-07-10.html", keep, true)],
  ["non-dated files stay", !shouldPruneBriefFile("README.md", keep, true)],
  ["legacy mode retains its old cache behavior", shouldPruneBriefFile("2026-07-08.md", keep, false)],
];

for (const [label, pass] of checks) {
  if (!pass) throw new Error(`retention failed: ${label}`);
}
console.log("all brief retention checks pass");
