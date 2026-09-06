// Build-time site policy. One place decides what a deployment shows:
//
//   SITE_MODE=coming-soon  production (rotli.co) — the holding page only
//   SITE_MODE=dev          the live dev site (dev.rotli.co) — full page, no
//                          download, not indexed
//   SITE_MODE=full         the launch site — full page with downloads (default
//                          so local `astro dev` shows everything)
//
// SITE_URL is the canonical origin for this deployment; metadata, the sitemap,
// and robots.txt derive from it. Both are read from the process environment
// during the build, so Railway service variables are the only knobs.

export const GITHUB_URL = 'https://github.com/SethMed7/rotli';
export const RELEASES_URL = 'https://github.com/SethMed7/rotli-releases/releases/latest';
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const PRIVACY_URL = `${GITHUB_URL}/blob/main/PRIVACY.md`;
export const ROADMAP_URL = `${GITHUB_URL}/blob/main/ROADMAP.md`;

export type SiteMode = 'coming-soon' | 'dev' | 'full';

const MODES: readonly SiteMode[] = ['coming-soon', 'dev', 'full'];
const DEFAULT_URL = 'https://rotli.co';

function readMode(): SiteMode {
  const raw = process.env.SITE_MODE ?? 'full';
  if (!MODES.includes(raw as SiteMode)) {
    throw new Error(`SITE_MODE must be one of ${MODES.join(', ')}; got "${raw}"`);
  }
  return raw as SiteMode;
}

function readUrl(): string {
  return new URL(process.env.SITE_URL ?? DEFAULT_URL).origin;
}

const mode = readMode();

export const site = {
  mode,
  url: readUrl(),
  /** The landing page, the MCP guide, and their navigation. */
  showsFullSite: mode !== 'coming-soon',
  /** Download CTAs link to the newest published release. */
  downloadsEnabled: mode === 'full',
  /** Search engines may index this deployment (sitemap + robots allow). */
  indexable: mode !== 'dev',
} as const;
