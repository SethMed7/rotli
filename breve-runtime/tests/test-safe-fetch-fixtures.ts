import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_FETCH_BYTES, MAX_REDIRECT_HOPS, checkUrl, hostRejection, isPrivateIp, redirectRejection } from "../scripts/safe-fetch";

// Shared adversarial egress fixtures — the SAME file drives the Rust tests in
// src-tauri/src/web.rs (include_str!). Parity by fixture, not shared impl: each
// side implements the block policy independently and must reach the agreed
// verdict. Every case here is decidable WITHOUT network (literal IPs, name-level
// blocks, scheme/credential refusals) so this suite never does live DNS.
type Fixtures = {
  byteCap: number;
  maxRedirectHops: number;
  ips: Array<{ ip: string; private: boolean; why?: string }>;
  hosts: Array<{ host: string; blocked: boolean; why?: string }>;
  urls: Array<{ url: string; rust: "allow" | "block"; ts: "allow" | "block"; why?: string }>;
  redirects: Array<{ from: string; location: string; verdict: "allow" | "block"; why?: string }>;
};
const fixtures: Fixtures = JSON.parse(readFileSync(join(import.meta.dir, "../../scripts/fixtures/egress-fixtures.json"), "utf8"));

describe("egress fixtures — Breve safe-fetch side", () => {
  test("caps match the exported policy constants", () => {
    expect(fixtures.byteCap).toBe(MAX_FETCH_BYTES);
    expect(fixtures.maxRedirectHops).toBe(MAX_REDIRECT_HOPS);
  });

  test("IPs classify private vs public", () => {
    for (const e of fixtures.ips) {
      expect(isPrivateIp(e.ip), `ip: ${e.ip} (${e.why ?? ""})`).toBe(e.private);
    }
  });

  test("name-blocked hosts are refused before DNS", async () => {
    // blocked:false hostname entries would need live DNS here, so only the
    // name-level blocks are asserted on this side; the Rust name-policy test
    // covers both directions with its pure host_name_blocked.
    for (const e of fixtures.hosts) {
      if (!e.blocked) continue;
      expect(await hostRejection(e.host), `host: ${e.host}`).not.toBeNull();
    }
  });

  test("URLs get the ts verdict", async () => {
    for (const e of fixtures.urls) {
      const r = await checkUrl(e.url);
      expect(r.ok, `url: ${e.url} (${e.why ?? ""})`).toBe(e.ts === "allow");
    }
  });

  test("redirect hops get the shared verdict", () => {
    for (const e of fixtures.redirects) {
      const from = new URL(e.from);
      const bad = redirectRejection(from, e.location, from.hostname.toLowerCase());
      expect(bad === null, `location: ${e.location} (${e.why ?? ""}) → ${bad}`).toBe(e.verdict === "allow");
    }
  });
});
