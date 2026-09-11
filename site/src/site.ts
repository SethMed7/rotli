// Build-time site policy. One place decides what a deployment shows:
//
//   SITE_MODE=coming-soon  production (rotli.co) — the holding page only
//   SITE_MODE=dev          the live dev site (dev.rotli.co) — full page, no
//                          download, not indexed, labeled experiments visible
//   SITE_MODE=full         the launch site — full page with downloads (default
//                          so local `astro dev` shows everything)
//
// SITE_URL is the canonical origin for this deployment; metadata, the sitemap,
// and robots.txt derive from it.
//
// SOURCE_REPOSITORY_PUBLIC decides whether pages may link to the source
// repository (GitHub, LICENSE, PRIVACY.md, ROADMAP.md, contract documents).
// The repository is private today, so those links would 404 for visitors. The
// toggle fails closed: only the exact string "true" enables the links; unset,
// empty, "1", "yes", or anything else keeps them hidden and the pages use local
// anchors instead. Nothing in the site may claim the source is public unless
// this is true.
//
// All three are read from the process environment during the build, so Railway
// service variables (forwarded as Docker build args) are the only knobs.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GITHUB_URL = 'https://github.com/SethMed7/rotli';
export const RELEASES_URL = 'https://github.com/SethMed7/rotli-releases/releases/latest';
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
export const PRIVACY_URL = `${GITHUB_URL}/blob/main/PRIVACY.md`;
export const ROADMAP_URL = `${GITHUB_URL}/blob/main/ROADMAP.md`;

/**
 * The launch film. The marketing film pipeline produces these three artifacts
 * and a maintainer copies them into `public/media/` once they are reviewed.
 * These are the only file references the site uses; keep them in sync with the
 * film project's export names.
 */
export const PROMO_VIDEO_PATH = '/media/rotli-promo.mp4';
export const PROMO_POSTER_PATH = '/media/rotli-promo-poster.jpg';
export const PROMO_CAPTIONS_PATH = '/media/rotli-promo.vtt';

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

/** Fail closed: anything other than the exact string "true" means private. */
function readSourcePublic(): boolean {
  return (process.env.SOURCE_REPOSITORY_PUBLIC ?? '').trim() === 'true';
}

/**
 * `public/` of this site project. Vite bundles this module for the page
 * build, so `import.meta.url` may point at a chunk rather than `src/site.ts`;
 * the working directory is checked as well (`site/` for local builds and the
 * Dockerfile, the repository root for `bun run verify`). The favicon is the
 * sentinel that proves a candidate really is the site's public directory.
 */
function findPublicDir(): string | null {
  const candidates = [
    fileURLToPath(new URL('../public', import.meta.url)),
    join(process.cwd(), 'public'),
    join(process.cwd(), 'site', 'public'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'favicon.svg'))) ?? null;
  if (found === null) {
    console.warn('[site] Could not locate public/; the film section is omitted.');
  }
  return found;
}

/**
 * The film is included only when its real artifacts exist in `public/media/`
 * at build time. Until then the pages omit the section entirely rather than
 * rendering an empty player over a black frame. All three artifacts must be
 * nonempty files; placeholder files never enable the player.
 */
function readPromo() {
  const publicDir = findPublicDir();
  const exists = (path: string) => {
    if (publicDir === null) return false;
    const file = join(publicDir, path);
    return existsSync(file) && statSync(file).isFile() && statSync(file).size > 0;
  };
  const video = exists(PROMO_VIDEO_PATH);
  const poster = exists(PROMO_POSTER_PATH);
  const captions = exists(PROMO_CAPTIONS_PATH);
  const enabled = video && poster && captions;
  if (!enabled && (video || poster || captions)) {
    console.warn(
      `[site] Film artifacts are incomplete (video: ${video}, poster: ${poster}, captions: ${captions}); the film section is omitted.`,
    );
  }
  return {
    enabled,
    video: PROMO_VIDEO_PATH,
    poster: PROMO_POSTER_PATH,
    captions: captions ? PROMO_CAPTIONS_PATH : null,
  } as const;
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
  /**
   * Capabilities under review may be described on the dev site under an
   * experiment label. This is a marketing policy, not an app feature gate;
   * the app separately restricts Breve and Mermaid visual editing to dev.
   */
  showsExperiments: mode === 'dev',
  /** Links to the source repository and its documents are rendered. */
  sourcePublic: readSourcePublic(),
  /** The launch film, when its artifacts are present. */
  promo: readPromo(),
} as const;
