// What the site tells crawlers and AI agents, in one place: the robots.txt
// policy, /llms.txt (also served as /index.md), the Markdown twin of every
// writing page, and the schema.org JSON-LD facts. Like the FAQ, every sentence
// here restates a claim the pages already make; nothing here may promise more.
// site/Caddyfile answers `Accept: text/markdown` with these twins, and the
// build (astro.config.mjs) fails if an llms.txt link points at a missing page.
import { questions } from './faq';
import { DOWNLOAD_URL, GITHUB_URL, LICENSE_URL, site } from './site';
import { slugOf, type Writing } from './writing';

const NAME = 'rotli';
const SUMMARY =
  'rotli is a private workspace for your Mac. Write however you think, in plain Markdown files you own, with no account. The Librarian files, tags, and links them in the background, using AI on your Mac or the AI tools you already use, and never rewrites your words.';

/**
 * AI crawlers named in robots.txt. Each gets its own group so the policy is
 * explicit per agent, not implied by `*`. `allow: false` must match what the
 * edge enforces: a robots.txt that welcomes an agent the CDN then refuses is
 * the worst of both (Cloudflare's AI-bot blocking is a zone setting, outside
 * this repository).
 */
export const AI_AGENTS: { agent: string; allow: boolean }[] = [
  // Training crawlers. The four `false` rows mirror what Cloudflare's AI-bot
  // blocking refuses today (measured 2026-09-24: 403 for each). Turning that
  // zone setting off is the moment to flip them to true, not before.
  { agent: 'GPTBot', allow: false },
  { agent: 'ClaudeBot', allow: false },
  { agent: 'CCBot', allow: false },
  { agent: 'Bytespider', allow: false },
  { agent: 'Meta-ExternalAgent', allow: true },
  { agent: 'Google-Extended', allow: true },
  { agent: 'Applebot-Extended', allow: true },
  // AI search indexers
  { agent: 'OAI-SearchBot', allow: true },
  { agent: 'Claude-SearchBot', allow: true },
  { agent: 'PerplexityBot', allow: true },
  // Assistants fetching a page for a person mid-conversation
  { agent: 'ChatGPT-User', allow: true },
  { agent: 'Claude-User', allow: true },
  { agent: 'Perplexity-User', allow: true },
];

/** /app/ is Rotli Web, an application shell with nothing to read (and noindex). */
const PRIVATE_PATHS = ['/app/'];

export function robotsText(): string {
  if (!site.indexable) return 'User-agent: *\nDisallow: /\n';
  const group = (agent: string, allow: boolean) =>
    [
      `User-agent: ${agent}`,
      allow ? 'Allow: /' : 'Disallow: /',
      ...(allow ? PRIVATE_PATHS.map((path) => `Disallow: ${path}`) : []),
    ].join('\n');
  return (
    [
      `# ${NAME}: a summary for AI systems is at ${site.url}/llms.txt`,
      group('*', true),
      ...AI_AGENTS.map(({ agent, allow }) => group(agent, allow)),
      `Sitemap: ${site.url}/sitemap-index.xml`,
    ].join('\n\n') + '\n'
  );
}

const link = (title: string, path: string, note: string) => `- [${title}](${site.url}${path}): ${note}`;

/** The Markdown twin's address for a writing page at `/<section>/<slug>/`. */
export const twinPath = (pagePath: string) => `${pagePath}index.md`;

export function writingPath(entry: Writing): string {
  return `/${entry.data.section === 'post' ? 'blog' : 'resources'}/${slugOf(entry)}/`;
}

/** /llms.txt (llmstxt.org): a title, a one-paragraph summary, then links. */
export function llmsText(writing: { resources: Writing[]; posts: Writing[] }): string {
  const facts = [
    site.sourcePublic ? 'Free, with no account. The source is open under the MIT license.' : 'Free, with no account.',
    'Notes are plain Markdown files in one folder you choose. A hidden .rotli folder holds settings and search indexes that rotli can rebuild at any time.',
    'Writing, tasks, links, and search work offline. Chat works offline too with an on-device model.',
    'AI is optional: a model on your Mac, or the AI tools you install yourself, like Claude Code and Codex, with Cursor for code chat, which rotli runs without ever holding your keys. Secure notes never reach a remote model, and no AI can edit a locked note.',
    'No analytics, ads, or crash uploads.',
    site.webAppEnabled
      ? 'Platforms: the Mac app, and Rotli Web in the browser. Chrome, Edge, and Arc open your folder directly; Firefox, Zen, and Brave use Rotli Helper. Safari and phones are not supported yet. Native Windows and Linux apps are planned.'
      : 'Platforms: the Mac app. Native Windows and Linux apps are planned.',
  ];
  const lines = [`# ${NAME}`, '', `> ${SUMMARY}`, '', ...facts.map((fact) => `- ${fact}`)];
  if (site.showsFullSite) {
    lines.push(
      '',
      '## Pages',
      '',
      link('Features', '/features/', 'the editor, tasks, links, chat, documents and boards, the Librarian, and themes'),
      link('Privacy', '/privacy/', 'what connects to the internet, what AI can see, and why'),
      link('Download', '/download/', site.webAppEnabled ? 'the Mac app, Rotli Web, and Rotli Helper' : 'the Mac app'),
      link('Changelog', '/changelog/', 'every release, newest first'),
      link('About', '/about/', 'why it is being built, where the name comes from, and who makes it'),
    );
    const section = (title: string, entries: Writing[]) =>
      entries.length > 0
        ? [
            '',
            `## ${title}`,
            '',
            ...entries.map((entry) => link(entry.data.title, twinPath(writingPath(entry)), entry.data.description)),
          ]
        : [];
    lines.push(...section('Resources', writing.resources), ...section('Blog', writing.posts));
  }
  const optional = [
    ...(site.sourcePublic ? [`- [Source code](${GITHUB_URL}): the repository`] : []),
    ...(site.indexable ? [link('Sitemap', '/sitemap-index.xml', 'every page on this site')] : []),
  ];
  if (optional.length > 0) lines.push('', '## Optional', '', ...optional);
  return lines.join('\n') + '\n';
}

/** A writing page as Markdown: its title, summary, and the source body. */
export function writingMarkdown(entry: Writing): string {
  const url = `${site.url}${writingPath(entry)}`;
  return [
    `# ${entry.data.title}`,
    '',
    `> ${entry.data.description}`,
    '',
    (entry.body ?? '').trim(),
    '',
    '---',
    '',
    `Source: ${url}`,
    '',
  ].join('\n');
}

// ─── JSON-LD (schema.org) ────────────────────────────────────────────────

type Ld = Record<string, unknown>;

const organization: Ld = {
  '@type': 'Organization',
  name: NAME,
  url: site.url,
  logo: `${site.url}/apple-touch-icon.png`,
  ...(site.sourcePublic ? { sameAs: [GITHUB_URL] } : {}),
};

/** Serialized for a `<script type="application/ld+json">`; `<` escaped so text cannot close the tag. */
export function jsonLd(graph: Ld[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

export function application(): Ld {
  return {
    '@type': 'SoftwareApplication',
    name: NAME,
    description: SUMMARY,
    url: site.url,
    image: `${site.url}/social-card.png`,
    applicationCategory: 'ProductivityApplication',
    operatingSystem: site.webAppEnabled ? 'macOS, Web browser' : 'macOS',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(site.downloadsEnabled ? { downloadUrl: DOWNLOAD_URL } : {}),
    ...(site.sourcePublic ? { license: LICENSE_URL } : {}),
    publisher: organization,
  };
}

export function landingGraph(): Ld[] {
  return [
    { '@type': 'WebSite', name: NAME, url: site.url, publisher: organization },
    application(),
    {
      '@type': 'FAQPage',
      mainEntity: questions.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
}

export function writingGraph(entry: Writing): Ld[] {
  const path = writingPath(entry);
  const index =
    entry.data.section === 'post' ? { path: '/blog/', name: 'Blog' } : { path: '/resources/', name: 'Resources' };
  return [
    {
      '@type': entry.data.section === 'post' ? 'BlogPosting' : 'Article',
      headline: entry.data.title,
      description: entry.data.description,
      datePublished: entry.data.date.toISOString().slice(0, 10),
      url: `${site.url}${path}`,
      mainEntityOfPage: `${site.url}${path}`,
      image: `${site.url}/social-card.png`,
      author: organization,
      publisher: organization,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: NAME, item: `${site.url}/` },
        { '@type': 'ListItem', position: 2, name: index.name, item: `${site.url}${index.path}` },
        { '@type': 'ListItem', position: 3, name: entry.data.title, item: `${site.url}${path}` },
      ],
    },
  ];
}
