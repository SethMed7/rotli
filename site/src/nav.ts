// The site's one navigation policy: which sections the header lists and which
// links the footer carries. Pages pass only which section they belong to.
import {
  GITHUB_URL,
  LICENSE_URL,
  ROADMAP_URL,
  STUDIO_URL,
  WEB_APP_PATH,
  site,
} from './site';

export type NavSection =
  | 'product'
  | 'features'
  | 'privacy'
  | 'download'
  | 'resources'
  | 'blog'
  | 'developers'
  | 'changelog'
  | 'about';

export interface SiteLink {
  href: string;
  label: string;
}

export interface NavLink extends SiteLink {
  section: NavSection;
}

/** One entry inside a header dropdown: a page, a line about it, and an optional status. */
export interface NavItem extends NavLink {
  description: string;
  /** A short status shown beside the label, e.g. "Coming soon". */
  status?: string;
}

/** A header dropdown. `href` is where its label goes without script (and the no-JS fallback). */
export interface NavGroup extends NavLink {
  items: NavItem[];
}

export type NavEntry = NavLink | NavGroup;

export const isNavGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

/** True when `current` is the entry's own section or one of its items'. */
export function navEntryHolds(entry: NavEntry, current: NavSection | undefined): boolean {
  if (current === undefined) return false;
  return entry.section === current || (isNavGroup(entry) && entry.items.some((item) => item.section === current));
}

/**
 * Header links: real pages, never landing-page anchors. Download is not
 * listed; it is the header's one button (SiteHeader.astro). Resources is a
 * dropdown (Guides, Blog, Developers, Changelog) whose label links to
 * /resources/ when script is off. Blog appears only once a post can be read,
 * so the header never leads to an index of nothing but "coming soon". The
 * developer reference (MCP and the CLI) is a development-build feature: the
 * launch site labels it coming soon (src/site.ts `showsExperiments`).
 */
export function primaryNav(options: { hasPosts: boolean }): NavEntry[] {
  const resources: NavItem[] = [
    {
      section: 'resources',
      href: '/resources/',
      label: 'Guides',
      description: 'Short answers on how rotli works',
    },
    ...(options.hasPosts
      ? [{ section: 'blog' as const, href: '/blog/', label: 'Blog', description: 'Notes from building rotli' }]
      : []),
    {
      section: 'developers',
      href: '/resources/developers/',
      label: 'Developers',
      description: 'MCP and the command line, for agents',
      ...(site.showsExperiments ? {} : { status: 'Coming soon' }),
    },
    {
      section: 'changelog',
      href: '/changelog/',
      label: 'Changelog',
      description: 'Every release, newest first',
    },
  ];
  return [
    { section: 'features', href: '/features/', label: 'Features' },
    { section: 'privacy', href: '/privacy/', label: 'Privacy' },
    { section: 'resources', href: '/resources/', label: 'Resources', items: resources },
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
        { href: '/changelog/', label: 'Changelog' },
      ],
    },
    {
      title: 'Learn',
      links: [
        { href: '/resources/', label: 'Resources' },
        { href: '/resources/getting-started/', label: 'Getting started' },
        ...(options.hasPosts ? [{ href: '/blog/', label: 'Blog' }] : []),
        { href: '/about/', label: 'About' },
        // The open motion studio; not gated on the source flag, it is its own site.
        { href: STUDIO_URL, label: 'Rotli Studio' },
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
        { href: LICENSE_URL, label: 'MIT license' },
      ],
    });
  }
  return groups;
}

export const footerTagline = site.sourcePublic
  ? 'Local-first, free, and open source under the MIT license.'
  : 'Local-first and free. One folder you own, no account required.';
