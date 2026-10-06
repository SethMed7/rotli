// The link-preview cards (Open Graph and X): one per page, 1200 × 630, in
// public/og/. `bun run build:brand-images` (repository root) renders them from
// this list and from each published post's frontmatter title, so the words on
// a card and its alt text live here once. Every line restates the page's own
// heading or lede; change a page's heading, then re-render.
import { hasPublicFile } from './site';

/** The quokka poses in src/assets/characters/, as alt text describes them. */
export const POSES = {
  ai_chat: 'typing on a laptop beside a chat bubble',
  base: 'standing',
  celebrating: 'celebrating with both arms up',
  excalidraw_board: 'drawing on an easel board',
  inbox: 'holding a letter',
  knowledge_system: 'carrying a folder of linked notes',
  notes: 'writing in a notepad',
  rest: 'resting with its eyes closed',
  searching: 'looking through a magnifying glass',
  stays_local: 'holding a padlock shield',
  waving: 'waving',
} as const;
export type Pose = keyof typeof POSES;

export interface OgCard {
  /** The headline: the page's own heading. */
  title: string;
  /** One short line under it, from the page's lede; posts show their date instead. */
  line: string;
  pose: Pose;
}

export const OG_CARDS = {
  home: {
    title: 'Write like a person. Let AI do the filing.',
    line: 'A free workspace built on plain Markdown files you own.',
    pose: 'waving',
  },
  features: {
    title: 'Everything rotli does, in plain files.',
    line: 'A calm editor, chat that reads your notes, and a Librarian that keeps them filed.',
    pose: 'knowledge_system',
  },
  privacy: {
    title: 'Privacy',
    line: 'rotli is built so there is nothing about you to collect.',
    pose: 'stays_local',
  },
  resources: {
    title: 'Resources',
    line: 'The blog and its guides, the developer reference, the roadmap, and every release.',
    pose: 'searching',
  },
  blog: {
    title: 'Blog',
    line: 'Notes from building rotli: how it works, and why it works that way.',
    pose: 'notes',
  },
  about: {
    title: 'Why I’m building rotli',
    line: 'Notes are where work starts. They should live somewhere that is yours.',
    pose: 'rest',
  },
  download: {
    title: 'Get rotli',
    line: 'Free, with no account. Your notes stay in a folder you choose.',
    pose: 'celebrating',
  },
  developers: {
    title: 'rotli for developers and agents',
    line: 'MCP and a command line for AI agents, under the same rules as the app.',
    pose: 'ai_chat',
  },
} as const satisfies Record<string, OgCard>;
export type OgCardName = keyof typeof OG_CARDS;

/**
 * A post's picture, by slug: the quokka's pose and the scene around it
 * (scripts/brand-images/scenes.mjs). One definition, three renders by
 * `bun run build:brand-images`: the title-free scene is the post's thumbnail
 * (public/thumbs/blog/, on /blog/), the same scene composed wide is its
 * banner (public/banners/blog/, the top of the post's page), and its link
 * card stands the same pose beside the scene's first prop, under the title it
 * reads from the post's frontmatter. Neither stores a title here, so a
 * retitled post needs only a re-render. A post not listed gets the writing
 * quokka on the plain beach.
 */
export interface PostArt {
  pose: Pose;
  scene: 'bench' | 'helper' | 'memory' | 'two-notes' | 'making' | 'beach';
  /** What is drawn around the quokka, for the alt text. */
  around: string;
}

export const POST_ART: Record<string, PostArt> = {
  'the-ai-you-already-pay-for': {
    pose: 'knowledge_system',
    scene: 'bench',
    around: 'between a bench of three idle AI helpers, two of them asleep, and a month on the calendar with nothing done',
  },
  'rotli-web-and-your-mac': {
    pose: 'stays_local',
    scene: 'helper',
    around: 'between a browser window and a laptop open on Terminal, a dotted path joining them',
  },
  'rotli-as-ai-memory': {
    pose: 'ai_chat',
    scene: 'memory',
    around: 'between a small AI chip with a speech bubble and three notes joined by links',
  },
  'two-kinds-of-notes': {
    pose: 'notes',
    scene: 'two-notes',
    around: 'between a scribbled page and the same page filed, with a block of fields on top',
  },
  'the-creation-of-rotli': {
    pose: 'excalidraw_board',
    scene: 'making',
    around: 'beside sketches laid out on the sand, the lighthouse behind',
  },
  // The guides (tagged Guide), moved from /resources/ on 2026-10-06.
  'getting-started': {
    pose: 'notes',
    scene: 'two-notes',
    around: 'between a scribbled page and the same page filed, with a block of fields on top',
  },
  'why-local': {
    pose: 'rest',
    scene: 'beach',
    around: 'on the beach',
  },
  'ai-and-your-notes': {
    pose: 'ai_chat',
    scene: 'memory',
    around: 'between a small AI chip with a speech bubble and three notes joined by links',
  },
  'rotli-helper': {
    pose: 'knowledge_system',
    scene: 'helper',
    around: 'between a browser window and a laptop open on Terminal, a dotted path joining them',
  },
  'web-and-mac': {
    pose: 'waving',
    scene: 'helper',
    around: 'between a browser window and a laptop open on Terminal, a dotted path joining them',
  },
};

const DEFAULT_ART: PostArt = { pose: 'notes', scene: 'beach', around: 'on the beach' };

export function postArt(slug: string): PostArt {
  return POST_ART[slug] ?? DEFAULT_ART;
}

export function postPose(slug: string): Pose {
  return postArt(slug).pose;
}

function alt(title: string, pose: Pose): string {
  return `“${title}” on the rotli card, beside the quokka ${POSES[pose]}`;
}

/** Base.astro's `image` and `imageAlt` for a page's card. */
export function ogImage(name: OgCardName): { image: string; imageAlt: string } {
  const card: OgCard = OG_CARDS[name];
  return { image: `/og/${name}.png`, imageAlt: alt(card.title, card.pose) };
}

/** A post's thumbnail: its scene without words, 1200 × 630 with a 600-wide copy. */
export interface Thumbnail {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
}

export const THUMBNAIL = { width: 1200, height: 630 } as const;

/** Where a post's thumbnail is written (the build script) and served (the pages). */
export function thumbnailPath(slug: string, width: 600 | 1200 = 1200): string {
  return width === 1200 ? `/thumbs/blog/${slug}.webp` : `/thumbs/blog/${slug}-600.webp`;
}

export function thumbnailAlt(slug: string): string {
  const art = postArt(slug);
  return `The rotli quokka ${POSES[art.pose]}, ${art.around}`;
}

/** A post's thumbnail, or undefined until `bun run build:brand-images` has rendered it. */
export function postThumbnail(slug: string): Thumbnail | undefined {
  const src = thumbnailPath(slug);
  if (!hasPublicFile(src)) return undefined;
  return {
    src,
    srcset: `${thumbnailPath(slug, 600)} 600w, ${src} 1200w`,
    ...THUMBNAIL,
    alt: thumbnailAlt(slug),
  };
}

/**
 * A post's banner: the same scene composed wide (2400 × 1000, with a 1200-wide copy), its
 * quokka and props in the right half so the article's title panel rises over open sea and
 * sand on the left, and a phone crop (1300 × 900) of the quokka and its props. The article's
 * head (WritingPage `banner`) shows it full width.
 */
export interface Banner {
  src: string;
  srcset: string;
  mobile: string;
  width: number;
  height: number;
  mobileWidth: number;
  mobileHeight: number;
  alt: string;
}

export const BANNER = { width: 2400, height: 1000, mobileWidth: 1300, mobileHeight: 900 } as const;

/** Where a post's banner is written (the build script) and served (the pages). */
export function bannerPath(slug: string, variant: 'wide' | 'half' | 'mobile' = 'wide'): string {
  const suffix = { wide: '', half: '-1200', mobile: '-mobile' }[variant];
  return `/banners/blog/${slug}${suffix}.webp`;
}

/** A post's banner, or undefined until `bun run build:brand-images` has rendered it. */
export function postBanner(slug: string): Banner | undefined {
  const src = bannerPath(slug);
  if (![src, bannerPath(slug, 'half'), bannerPath(slug, 'mobile')].every(hasPublicFile)) return undefined;
  return {
    src,
    srcset: `${bannerPath(slug, 'half')} 1200w, ${src} 2400w`,
    mobile: bannerPath(slug, 'mobile'),
    ...BANNER,
    alt: thumbnailAlt(slug),
  };
}

/** A post's own card (public/og/blog/<slug>.png), or the blog's until it is rendered. */
export function postOgImage(slug: string, title: string): { image: string; imageAlt: string } {
  const image = `/og/blog/${slug}.png`;
  return hasPublicFile(image) ? { image, imageAlt: alt(title, postPose(slug)) } : ogImage('blog');
}
