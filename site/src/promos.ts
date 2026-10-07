// The "From rotli" spots beside a blog post (blog/ArticleAside.astro): rotli's own promotions,
// nothing else (the owner, 2026-10-06: house promos only, no sponsors, no ad network). This list
// is the one place to edit them. Each is a plain first-party link with a quokka from the site's
// own art, so a spot loads no script, frame, pixel, or remote image and the CSP and the privacy
// page stay true (site/README.md, "The blog post": a real ad network would need a CSP change,
// a privacy-page change, and the owner's decision first).
//
// Pure data and a pure picker, without Astro or image imports, so the root tests can read it
// (scripts/site-writing.test.ts). The component resolves `pose` to its picture.
import type { Pose } from './og';
import { STUDIO_URL, WEB_APP_PATH, site } from './site';

export interface Promo {
  /** Stable, for tests and `data-promo`. */
  id: string;
  /** The spot's label, so a promotion is never mistaken for the article. */
  label: string;
  title: string;
  /** One short line. */
  text: string;
  href: string;
  /** The quokka beside it: a pose in src/assets/characters/filled/cocoa/ (src/og.ts POSES). */
  pose: Pose;
  /** Another rotli site (studio.rotli.co): an outward arrow, the same tab, like the footer's link. */
  external?: boolean;
  /** Shown only in builds that offer it: the Mac download, or Rotli Web. */
  needs?: 'downloads' | 'webApp';
}

export const PROMO_LABEL = 'From rotli';

/** In rotation order: each post shows the next few after the post before it (`promosFor`). */
export const PROMOS: readonly Promo[] = [
  {
    id: 'download',
    label: PROMO_LABEL,
    title: 'Download rotli free',
    text: 'A calm Markdown workspace. Your notes stay plain files in your own folder.',
    href: '/download/',
    pose: 'waving',
    needs: 'downloads',
  },
  {
    id: 'roadmap',
    label: PROMO_LABEL,
    title: 'Vote on what’s next',
    text: 'See what we’re building and help choose what comes first.',
    href: '/roadmap/',
    pose: 'searching',
  },
  {
    id: 'newsletter',
    label: PROMO_LABEL,
    title: 'Get the newsletter',
    text: 'Notes from the workshop, now and then. Unsubscribe anytime.',
    // The sign-up at the foot of every page (SiteFooter.astro).
    href: '#newsletter',
    pose: 'inbox',
  },
  {
    id: 'web',
    label: PROMO_LABEL,
    title: 'Try Rotli Web',
    text: 'The same editor in your browser, with your notes in a folder on your computer.',
    href: WEB_APP_PATH,
    pose: 'ai_chat',
    needs: 'webApp',
  },
  {
    id: 'studio',
    label: PROMO_LABEL,
    title: 'Rotli Studio',
    text: 'Wallpapers and films from the quokka’s island.',
    href: STUDIO_URL,
    pose: 'excalidraw_board',
    external: true,
  },
];

/** How many spots a post shows, in "More from rotli" at its end. */
export const RAIL_PROMOS = 2;

/** The promos this build can honestly offer (no Download without a download, and so on). */
export function availablePromos(
  promos: readonly Promo[] = PROMOS,
  offers: { downloads: boolean; webApp: boolean } = { downloads: site.downloadsEnabled, webApp: site.webAppEnabled },
): Promo[] {
  return promos.filter((promo) => promo.needs === undefined || offers[promo.needs]);
}

/**
 * The spots for the post at `index` in the published list (newest first): `count` promos in a row
 * from the list, starting where the post before it stopped, so every promo is shown across the
 * blog and neighbouring posts differ. Deterministic: the same build shows the same spots.
 */
export function promosFor(index: number, count = RAIL_PROMOS, promos: readonly Promo[] = availablePromos()): Promo[] {
  if (promos.length === 0) return [];
  const start = (Math.max(0, index) * count) % promos.length;
  return Array.from({ length: Math.min(count, promos.length) }, (_, offset) => promos[(start + offset) % promos.length]!);
}
