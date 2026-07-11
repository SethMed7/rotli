#!/usr/bin/env bun
/**
 * BREVE resources — reads the brain's clients/resources.json (the curated fetch-from registry) and
 * exposes it for the /resources command + on-demand pulls. The brain HOLDS the list; this is where
 * Breve (the connected app) reads it. All actual fetching goes through scripts/safe-fetch.ts and stays
 * on the LOCAL tier; fetched bytes are untrusted. SCHEDULED auto-pull-into-briefs is a deferred phase —
 * this module is on-demand + listing only.
 */
import { loadResources, type Resource } from "./config";

// Entry values win over registry defaults; everything still passes the safe-fetch guard at fetch time.
function withDefaults(r: Resource, defaults: Record<string, any>): Resource {
  return {
    cadence: defaults.cadence ?? "on-demand",
    tier: defaults.tier ?? "local",
    trust: defaults.trust ?? "untrusted",
    favorite: defaults.favorite ?? false,
    enabled: true,
    ...r,
  };
}

/** All enabled resources, favorites first. */
export function listResources(): Resource[] {
  const { defaults, resources } = loadResources();
  return resources
    .map((r) => withDefaults(r, defaults))
    .filter((r) => r.enabled !== false)
    .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
}

/** Resolve a resource by id, then by name/url substring. Null if no match. */
export function resolveResource(idOrQuery: string): Resource | null {
  const all = listResources();
  const q = idOrQuery.toLowerCase().trim().replace(/^https?:\/\//, "");
  return (
    all.find((r) => r.id.toLowerCase() === q) ??
    all.find((r) => r.url.toLowerCase().includes(q) || (r.name?.toLowerCase().includes(q) ?? false)) ??
    null
  );
}

/** Human-readable list for the /resources command (★ = favorite). */
export function renderResourceList(): string {
  const all = listResources();
  if (!all.length) return "No resources yet. Add one: text \"add <url> as a resource\" or drop `resource: <url> — <why>` in the inbox.";
  return all
    .map((r) => `${r.favorite ? "★" : "·"} ${r.name ?? r.id} — ${r.url}${r.lens ? `\n   ${r.lens}` : ""}`)
    .join("\n");
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "list") {
    console.log(renderResourceList());
  } else if (cmd === "resolve") {
    const r = resolveResource(rest.join(" "));
    console.log(r ? JSON.stringify(r, null, 2) : "(no match)");
  } else {
    console.error("usage: resources.ts [list] | resolve <id|name|url>");
  }
}
