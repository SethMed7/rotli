// check:web-privacy — Rotli Web's promise, held mechanically: the app at
// /app/ may load only its own files and may talk only to Rotli Helper on
// 127.0.0.1. Parses the /app/ Content-Security-Policy in site/Caddyfile and
// fails when any directive names another host, when connect-src allows more
// than http://127.0.0.1, or when form submission / framing is opened up.
// The E2E twin (e2e/web/rotli-web-privacy.spec.ts) proves the app never asks.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();

/** The /app/ block's CSP value. */
export function appPolicy(caddyfile) {
  const start = caddyfile.indexOf("handle /app/*");
  if (start < 0) return null;
  const match = caddyfile.slice(start).match(/Content-Security-Policy "([^"]+)"/);
  return match ? match[1] : null;
}

/** Every way the policy could let a note leave the computer. Pure. */
export function privacyViolations(policy) {
  if (!policy) return ["the /app/ block has no Content-Security-Policy"];
  const directives = new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name, sources]),
  );
  const failures = [];
  const connect = directives.get("connect-src") ?? [];
  if (connect.length === 0) failures.push("connect-src is missing (it falls back to default-src)");
  for (const source of connect) {
    if (source !== "http://127.0.0.1:*")
      failures.push(`connect-src allows ${source} — only http://127.0.0.1:* may be reached`);
  }
  for (const [name, sources] of directives) {
    if (name === "connect-src") continue;
    for (const source of sources) {
      const host = /^(https?:|wss?:|\*|[a-z0-9.-]+\.[a-z]{2,})/i.test(source) && !source.startsWith("'");
      if (host) failures.push(`${name} names ${source} — the app loads only its own files`);
    }
  }
  if ((directives.get("default-src") ?? []).join(" ") !== "'self'")
    failures.push("default-src must be 'self'");
  if ((directives.get("form-action") ?? []).join(" ") !== "'none'")
    failures.push("form-action must be 'none'");
  if ((directives.get("frame-ancestors") ?? []).join(" ") !== "'none'")
    failures.push("frame-ancestors must be 'none'");
  return failures;
}

if (import.meta.main) {
  const failures = privacyViolations(appPolicy(readFileSync(join(root, "site/Caddyfile"), "utf8")));
  if (failures.length > 0) {
    console.error("check:web-privacy failed — Rotli Web must not reach beyond this computer:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log("check:web-privacy ok — /app/ loads only its own files and reaches only 127.0.0.1");
}
