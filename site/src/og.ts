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
    line: 'A private workspace for your notes, in plain Markdown files you own.',
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
    title: 'Guides',
    line: 'Short answers to the questions people ask about rotli.',
    pose: 'searching',
  },
  blog: {
    title: 'Blog',
    line: 'Notes from building rotli: how it works, and why it works that way.',
    pose: 'notes',
  },
  about: {
    title: 'About rotli',
    line: 'A calm place to think, built on one folder of ordinary files you keep.',
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

/** A post's card pose, by slug; posts not listed show the writing quokka. */
export const POST_POSES: Record<string, Pose> = {
  'rotli-web-and-your-mac': 'stays_local',
};

export function postPose(slug: string): Pose {
  return POST_POSES[slug] ?? 'notes';
}

function alt(title: string, pose: Pose): string {
  return `“${title}” on the rotli card, beside the quokka ${POSES[pose]}`;
}

/** Base.astro's `image` and `imageAlt` for a page's card. */
export function ogImage(name: OgCardName): { image: string; imageAlt: string } {
  const card: OgCard = OG_CARDS[name];
  return { image: `/og/${name}.png`, imageAlt: alt(card.title, card.pose) };
}

/** A post's own card (public/og/blog/<slug>.png), or the blog's until it is rendered. */
export function postOgImage(slug: string, title: string): { image: string; imageAlt: string } {
  const image = `/og/blog/${slug}.png`;
  return hasPublicFile(image) ? { image, imageAlt: alt(title, postPose(slug)) } : ogImage('blog');
}
