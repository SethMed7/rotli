// The site's one navigation policy: which sections the header lists and which
// links the footer carries. Pages pass only which section they belong to.
import {
  GITHUB_URL,
  LICENSE_URL,
  RELEASES_URL,
  ROADMAP_URL,
  STUDIO_URL,
  WEB_APP_PATH,
  site,
} from './site';

export type NavSection = 'product' | 'features' | 'privacy' | 'download' | 'resources' | 'blog' | 'about';

export interface SiteLink {
  href: string;
  label: string;
}

export interface NavLink extends SiteLink {
  section: NavSection;
}

/**
 * Header links: real pages, never landing-page anchors. Download is not
 * listed; it is the header's one button (SiteHeader.astro). Blog appears only
 * once a post is published, so the header never leads to an empty index.
 */
export function primaryNav(options: { hasPosts: boolean }): NavLink[] {
  return [
    { section: 'features', href: '/features/', label: 'Features' },
    { section: 'privacy', href: '/privacy/', label: 'Privacy' },
    { section: 'resources', href: '/resources/', label: 'Resources' },
    ...(options.hasPosts ? [{ section: 'blog' as const, href: '/blog/', label: 'Blog' }] : []),
    { section: 'about', href: '/about/', label: 'About' },
  ];
}

export interface FooterGroup {
  title: string;
  links: SiteLink[];
}

/** The footer's link columns. Source-repository links appear only while the source is public. */
export function footerGroups(options: { hasPosts: boolean }): FooterGroup[] {
  const groups: FooterGroup[] = [
    {
      title: 'Product',
      links: [
        { href: '/features/', label: 'Features' },
        { href: '/download/', label: 'Download' },
        ...(site.webAppEnabled ? [{ href: WEB_APP_PATH, label: 'Rotli Web' }] : []),
        ...(site.downloadsEnabled ? [{ href: RELEASES_URL, label: 'Release notes' }] : []),
      ],
    },
    {
      title: 'Learn',
      links: [
        { href: '/resources/', label: 'Resources' },
        { href: '/resources/getting-started/', label: 'Getting started' },
        ...(options.hasPosts ? [{ href: '/blog/', label: 'Blog' }] : []),
        { href: '/about/', label: 'About' },
        { href: '/privacy/', label: 'Privacy' },
      ],
    },
  ];
  if (site.sourcePublic) {
    groups.push({
      title: 'Open source',
      links: [
        { href: GITHUB_URL, label: 'GitHub' },
        { href: ROADMAP_URL, label: 'Roadmap' },
        { href: STUDIO_URL, label: 'Rotli Studio' },
        { href: LICENSE_URL, label: 'MIT license' },
      ],
    });
  }
  return groups;
}

export const footerTagline = site.sourcePublic
  ? 'Local-first, free, and open source under the MIT license.'
  : 'Local-first and free. One folder you own, no account required.';
