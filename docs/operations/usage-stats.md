# Usage stats without tracking

The owner, 2026-10-01: "track basic metrics … nothing that takes user data or
privacy, just enough to see what's working, if people are actually
installing, web users". Rotli has no analytics and sends nothing extra for
this. `bun run stats` (`scripts/stats.ts`) reads counts that already exist:

| Question | Source | What it is |
|---|---|---|
| Are people downloading? | GitHub release assets (`gh api`) | DMG downloads per release (the site's stable `Rotli.dmg` plus the versioned one), all time |
| Are installs updating? | The same | `rotli.app.tar.gz` downloads: installs that updated to that version |
| How many Macs run each version? | rotli.co's Cloudflare traffic | update checks to `/update/<version>/<target>/<arch>/latest.json`, last 24 hours; each Mac left on checks about four times a day, so Macs ≈ checks ÷ 4 |
| Is the site reaching people? | rotli.co's Cloudflare traffic | daily unique visitors and page views (7 days), download-page views |
| Do people use Rotli Web? | rotli.co's Cloudflare traffic | `/app/` page loads, last 24 hours |
| Who looks at the source? | GitHub traffic | 14-day views and stars |

All of it is aggregate: neither GitHub nor Cloudflare gives Rotli anything
per person, and the update check carries no identifier, account, vault, or
note data (`PRIVACY.md`). Counts include the maintainer's own Macs and
downloads.

## The update check through rotli.co

Not in 1.8.0: that release ships the app without the site (Seth,
2026-10-09), so 1.8.0 asks the GitHub feed directly and the endpoint and its
route below arrive with the next site release. Until then `bun run stats`
shows no update checks by version.

The updater's first endpoint (`src-tauri/tauri.conf.json`) is
`https://rotli.co/update/{{current_version}}/{{target}}/{{arch}}/latest.json`.
`site/Caddyfile` answers a well-formed path with a 302 to the signed GitHub
feed and anything else with 404; the GitHub feed is the second endpoint, so a
rotli.co outage only costs the count. The trust analysis lives in
`docs/development/security.md` (Updater row): a hostile rotli.co can withhold
an update and can't substitute an unsigned build, but could offer an older
signed one, which makes rotli.co's Railway and Cloudflare accounts
release-critical. Versions before the one that
shipped this ask GitHub directly and don't appear in the per-version count.

## Setting up the Cloudflare half

Make a read-only API token (Cloudflare → My Profile → API Tokens: Zone ·
Analytics · Read and Zone · Zone · Read, for rotli.co), then either export
`CLOUDFLARE_API_TOKEN` or keep it in the Keychain:

```sh
security add-generic-password -s rotli-cloudflare-stats -a rotli -w
```

Cloudflare's per-path counts (`httpRequestsAdaptiveGroups`) are sampled on
busy zones and limited by plan; when they aren't available the command says
so and still prints the daily totals.
