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
 * Launch films. The marketing pipeline exports these into `public/media/` once
 * reviewed. The landing hero prefers the full promo; the teaser is a fallback
 * when the full cut is missing. PromoFilm still powers the holding page.
 */
export const TEASER_VIDEO_PATH = '/media/rotli-teaser.mp4';
export const TEASER_POSTER_PATH = '/media/rotli-teaser-poster.jpg';
export const TEASER_CAPTIONS_PATH = '/media/rotli-teaser.vtt';

export const PROMO_VIDEO_PATH = '/media/rotli-promo.mp4';
export const PROMO_POSTER_PATH = '/media/rotli-promo-poster.jpg';
export const PROMO_CAPTIONS_PATH = '/media/rotli-promo.vtt';

export type SiteMode = 'coming-soon' | 'dev' | 'full';

export type FilmArtifacts = {
  enabled: boolean;
  video: string;
  poster: string;
  captions: string | null;
};

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
    console.warn('[site] Could not locate public/; film sections are omitted.');
  }
  return found;
}

function publicFileExists(publicDir: string | null, path: string): boolean {
  if (publicDir === null) return false;
  const file = join(publicDir, path.replace(/^\//, ''));
  return existsSync(file) && statSync(file).isFile() && statSync(file).size > 0;
}

/**
 * A film slot is included only when its real artifacts exist in `public/media/`
 * at build time. Until then the pages omit the player rather than rendering an
 * empty frame. The full film requires video, poster, and captions. The teaser
 * requires video and poster; captions are optional for short clips that carry
 * on-screen text.
 */
function readFilm(options: {
  label: string;
  videoPath: string;
  posterPath: string;
  captionsPath: string;
  captionsRequired: boolean;
}): FilmArtifacts {
  const publicDir = findPublicDir();
  const video = publicFileExists(publicDir, options.videoPath);
  const poster = publicFileExists(publicDir, options.posterPath);
  const captions = publicFileExists(publicDir, options.captionsPath);
  const enabled = video && poster && (options.captionsRequired ? captions : true);
  if (!enabled && (video || poster || captions)) {
    console.warn(
      `[site] ${options.label} artifacts are incomplete (video: ${video}, poster: ${poster}, captions: ${captions}); that player is omitted.`,
    );
  }
  return {
    enabled,
    video: options.videoPath,
    poster: options.posterPath,
    captions: captions ? options.captionsPath : null,
  };
}

function readPromo() {
  const teaser = readFilm({
    label: 'Teaser',
    videoPath: TEASER_VIDEO_PATH,
    posterPath: TEASER_POSTER_PATH,
    captionsPath: TEASER_CAPTIONS_PATH,
    captionsRequired: false,
  });
  const full = readFilm({
    label: 'Full film',
    videoPath: PROMO_VIDEO_PATH,
    posterPath: PROMO_POSTER_PATH,
    captionsPath: PROMO_CAPTIONS_PATH,
    captionsRequired: true,
  });
  return {
    teaser,
    full,
    /** True when the full film section can render (`#film` anchors). */
    enabled: full.enabled,
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
   * the app separately restricts its experiments to dev (src/lib/featurePolicy.ts).
   */
  showsExperiments: mode === 'dev',
  /** Links to the source repository and its documents are rendered. */
  sourcePublic: readSourcePublic(),
  /** Teaser (hero) and full launch film, when their artifacts are present. */
  promo: readPromo(),
} as const;
