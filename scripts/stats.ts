// `bun run stats`: how Rotli is doing, from numbers that already exist (the
// owner, 2026-10-01: "basic metrics … nothing that takes user data, just
// enough to see what's working, if people are installing, web users").
// Nothing here adds tracking: it reads
//
// - GitHub: each release's download counts (the DMG is a new download, the
//   .app.tar.gz an installed update) and the repository's 14-day traffic,
//   through the `gh` CLI you're signed in with;
// - Cloudflare: rotli.co's aggregate traffic — visits, the download page,
//   Rotli Web loads, and the Mac app's update checks by version
//   (/update/<version>/…, site/Caddyfile) — with a read-only API token from
//   CLOUDFLARE_API_TOKEN or the Keychain item `rotli-cloudflare-stats`.
//   Without one, that section says how to add it.
//
// Totals only, never per person: Cloudflare and GitHub don't offer more, and
// Rotli sends nothing else.

import { spawnSync } from "node:child_process";

export const RELEASES_REPO = "SethMed7/rotli-releases";
export const SOURCE_REPO = "SethMed7/rotli";
export const ZONE_NAME = "rotli.co";
export const KEYCHAIN_SERVICE = "rotli-cloudflare-stats";
/** The app checks at launch and every 6 hours: about 4 checks a day per Mac left on. */
export const CHECKS_PER_MAC_PER_DAY = 4;

export interface ReleaseAsset {
  name: string;
  download_count: number;
}
export interface Release {
  tag_name: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export interface ReleaseRow {
  tag: string;
  date: string;
  /** DMG downloads: the site's stable Rotli.dmg plus the versioned one. */
  downloads: number;
  /** The update bundle: installs that updated to this version. */
  updates: number;
}

/** One row per release, newest first. */
export function releaseRows(releases: readonly Release[]): ReleaseRow[] {
  return releases
    .filter((release) => release.tag_name.startsWith("v"))
    .map((release) => {
      const count = (test: (name: string) => boolean) =>
        release.assets
          .filter((asset) => test(asset.name))
          .reduce((sum, asset) => sum + asset.download_count, 0);
      return {
        tag: release.tag_name,
        date: release.published_at.slice(0, 10),
        downloads: count((name) => name.endsWith(".dmg")),
        updates: count((name) => name.endsWith(".app.tar.gz")),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface PathCount {
  path: string;
  count: number;
}

const UPDATE_PATH = /^\/update\/([^/]+)\/([^/]+)\/([^/]+)\/latest\.json$/;

/** Update checks by Rotli version, most first, from rotli.co's request paths. */
export function checksByVersion(paths: readonly PathCount[]): { version: string; checks: number }[] {
  const byVersion = new Map<string, number>();
  for (const { path, count } of paths) {
    const match = UPDATE_PATH.exec(path);
    if (!match) continue;
    const version = decodeURIComponent(match[1]!);
    byVersion.set(version, (byVersion.get(version) ?? 0) + count);
  }
  return [...byVersion].map(([version, checks]) => ({ version, checks })).sort((a, b) => b.checks - a.checks);
}

/** The pages that answer "are people coming, downloading, using the web app?". */
export function siteCounts(paths: readonly PathCount[]): { download: number; web: number; privacy: number } {
  const sum = (test: (path: string) => boolean) =>
    paths.filter(({ path }) => test(path)).reduce((total, { count }) => total + count, 0);
  return {
    download: sum((path) => path === "/download/" || path.startsWith("/download/")),
    // the web app's page loads (its assets are separate requests)
    web: sum((path) => path === "/app/" || path === "/app/index.html"),
    privacy: sum((path) => path === "/privacy/"),
  };
}

/** A rough count of Macs from a day of update checks (never below 1 when any came in). */
export function macsFromChecks(checks: number): number {
  return checks === 0 ? 0 : Math.max(1, Math.round(checks / CHECKS_PER_MAC_PER_DAY));
}

// ── the effectful half ──────────────────────────────────────────────────────

function gh<T>(path: string): T | null {
  const result = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) return null;
  return JSON.parse(result.stdout) as T;
}

function cloudflareToken(): string | null {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const result = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

async function cloudflare<T>(token: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Cloudflare answered ${response.status}`);
  return (await response.json()) as T;
}

const DAYS_QUERY = `query ($zone: String!, $since: Date!, $until: Date!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
      dimensions { date } sum { requests pageViews } uniq { uniques }
    }
  } }
}`;

const PATHS_QUERY = `query ($zone: String!, $since: Time!, $until: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(limit: 500, filter: { datetime_geq: $since, datetime_lt: $until }, orderBy: [count_DESC]) {
      count dimensions { clientRequestPath }
    }
  } }
}`;

interface Graph<T> {
  data?: { viewer: { zones: T[] } } | null;
  errors?: { message: string }[] | null;
}

async function cloudflareSection(token: string): Promise<string[]> {
  const zones = await cloudflare<{ result: { id: string }[] }>(token, `/zones?name=${ZONE_NAME}`);
  const zone = zones.result[0]?.id;
  if (!zone) return [`  The token can't see ${ZONE_NAME}.`];
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lines: string[] = [];
  const days = await cloudflare<
    Graph<{
      httpRequests1dGroups: {
        dimensions: { date: string };
        sum: { requests: number; pageViews: number };
        uniq: { uniques: number };
      }[];
    }>
  >(token, "/graphql", {
    query: DAYS_QUERY,
    variables: {
      zone,
      since: new Date(now - 7 * day).toISOString().slice(0, 10),
      until: new Date(now).toISOString().slice(0, 10),
    },
  });
  const daily = days.data?.viewer.zones[0]?.httpRequests1dGroups ?? [];
  lines.push("  rotli.co, last 7 days (visitors are Cloudflare's daily unique IPs):");
  for (const row of daily)
    lines.push(`    ${row.dimensions.date}  ${row.uniq.uniques} visitors · ${row.sum.pageViews} page views`);
  const paths = await cloudflare<
    Graph<{ httpRequestsAdaptiveGroups: { count: number; dimensions: { clientRequestPath: string } }[] }>
  >(token, "/graphql", {
    query: PATHS_QUERY,
    variables: { zone, since: new Date(now - day).toISOString(), until: new Date(now).toISOString() },
  });
  if (paths.errors?.length) {
    lines.push(`  Per-page counts aren't available: ${paths.errors[0]!.message}`);
    return lines;
  }
  const rows = (paths.data?.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? []).map((row) => ({
    path: row.dimensions.clientRequestPath,
    count: row.count,
  }));
  const site = siteCounts(rows);
  lines.push("", "  Last 24 hours (Cloudflare samples busy sites, so these are close, not exact):");
  lines.push(`    Download page views: ${site.download}`);
  lines.push(`    Rotli Web loads:     ${site.web}`);
  const versions = checksByVersion(rows);
  const checks = versions.reduce((sum, row) => sum + row.checks, 0);
  lines.push(
    `    Mac update checks:   ${checks} (about ${macsFromChecks(checks)} Macs; each checks ~${CHECKS_PER_MAC_PER_DAY}× a day)`,
  );
  for (const row of versions) lines.push(`      ${row.version.padEnd(10)} ${row.checks}`);
  if (versions.length === 0)
    lines.push(
      "      (none yet: versions from 1.7.2 on check through rotli.co; older ones ask GitHub directly)",
    );
  return lines;
}

async function main(): Promise<void> {
  const out: string[] = ["Rotli stats", ""];
  const releases = gh<Release[]>(`repos/${RELEASES_REPO}/releases?per_page=100`);
  if (releases) {
    const rows = releaseRows(releases);
    const total = (key: "downloads" | "updates") => rows.reduce((sum, row) => sum + row[key], 0);
    out.push("Downloads (GitHub, all time)", "  release   date        DMG downloads   updates installed");
    for (const row of rows.slice(0, 8))
      out.push(`  ${row.tag.padEnd(9)} ${row.date}  ${String(row.downloads).padStart(13)}   ${row.updates}`);
    out.push(`  total                 ${String(total("downloads")).padStart(13)}   ${total("updates")}`, "");
  } else out.push("Downloads: `gh api` failed (is `gh` installed and signed in? `gh auth status`).", "");

  const views = gh<{ count: number; uniques: number }>(`repos/${SOURCE_REPO}/traffic/views`);
  const repo = gh<{ stargazers_count: number }>(`repos/${SOURCE_REPO}`);
  if (views && repo)
    out.push(
      "Source repository (14 days)",
      `  ${views.count} views from ${views.uniques} people · ${repo.stargazers_count} stars`,
      "",
    );

  out.push("Website and installs (Cloudflare)");
  const token = cloudflareToken();
  if (!token) {
    out.push(
      "  No Cloudflare token. Make a read-only one (Account → API Tokens → Analytics: Read, Zone: Read",
      `  for ${ZONE_NAME}), then either export CLOUDFLARE_API_TOKEN or keep it in the Keychain:`,
      `    security add-generic-password -s ${KEYCHAIN_SERVICE} -a rotli -w`,
    );
  } else {
    try {
      out.push(...(await cloudflareSection(token)));
    } catch (error) {
      out.push(`  Cloudflare didn't answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(out.join("\n"));
}

if (import.meta.main) await main();
