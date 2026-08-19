#!/usr/bin/env bun
import { readFileSync } from "node:fs";
/**
 * Prints the model brief GENERATION should use — the maintainer's config knob.
 * Source of truth: settings.json "briefModel" (default sonnet). The *-brief.sh scripts read
 * this so the brief model is configured in one place, not hardcoded across scripts.
 * Brief generation is an approved Sonnet context — it does NOT go through the chat ask-gate.
 */
import { join } from "node:path";

try {
  const root = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
  const path = process.env.ROTLI_BREVE_CONFIG ?? join(root, "settings.json");
  const s = JSON.parse(readFileSync(path, "utf8"));
  console.log(s.briefModel || "sonnet");
} catch {
  console.log("sonnet");
}
