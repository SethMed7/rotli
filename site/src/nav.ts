// The site's one navigation policy: which sections the header lists and which
// links the footer carries. Pages pass only which section they belong to.
import { GITHUB_URL, PRIVACY_URL, RELEASES_URL, ROADMAP_URL, WEB_APP_PATH, site } from './site';

export type NavSection = 'product' | 'resources' | 'blog' | 'about';

export interface SiteLink {
  href: string;
  label: string;
}

export const primaryNav: readonly (SiteLink & { section: NavSection })[] = [
  { section: 'product', href: '/', label: 'Product' },
  { section: 'resources', href: '/resources/', label: 'Resources' },
  { section: 'blog', href: '/blog/', label: 'Blog' },
  { section: 'about', href: '/about/', label: 'About' },
];

export function footerLinks(): SiteLink[] {
  return [
    { href: '/resources/', label: 'Resources' },
    { href: '/blog/', label: 'Blog' },
    { href: '/about/', label: 'About' },
    ...(site.webAppEnabled ? [{ href: WEB_APP_PATH, label: 'Rotli Web' }] : []),
    ...(site.downloadsEnabled ? [{ href: RELEASES_URL, label: 'Releases' }] : []),
    ...(site.sourcePublic ? [{ href: GITHUB_URL, label: 'GitHub' }] : []),
    { href: site.sourcePublic ? PRIVACY_URL : '/#privacy', label: 'Privacy' },
    ...(site.sourcePublic ? [{ href: ROADMAP_URL, label: 'Roadmap' }] : []),
  ];
}

export const footerTagline = site.sourcePublic
  ? 'Local-first, free, and open source under the MIT license.'
  : 'Local-first and free. One folder you own, no account required.';
