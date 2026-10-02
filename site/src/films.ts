// The site's films. The landing hero plays a product film (public/media/hero/):
// a real Rotli Web session on synthetic notes, recorded by `bun run capture:hero`,
// silent, its captions in a band under the picture. The studio's films
// (public/media/story/, encoded for the web from rotli-studio/motion/out/video)
// are the eight "Rotli in 30 seconds" episodes in one series player on
// /features/ (EpisodeShelf.astro) and the story film, which no page plays now.
// Posters and thumbnails are frames of the films.
export type Film = {
  src: string;
  poster: string;
  label: string;
  /** No soundtrack: the player offers a replay, never sound. */
  silent?: true;
};
export type Episode = Film & { n: number; title: string; thumb: string };

const media = (slug: string) => ({
  src: `/media/story/${slug}.mp4`,
  poster: `/media/story/${slug}-poster.webp`,
});

export const hero: Film = {
  src: '/media/hero/rotli-hero.mp4',
  poster: '/media/hero/rotli-hero-poster.webp',
  silent: true,
  label:
    'A screen recording of rotli, under a minute, without sound: a quick messy note with two tasks, a dropped picture of tiles, and a link to the Lisbon trip note; the Library, where the Librarian files notes into areas such as Travel; a search for "tile" that finds the note again; a chat asking what is still open for Lisbon, answered from those notes; and the same note as plain Markdown.',
};

/** The studio's 60-second story film, which the hero played until the product film. */
export const story: Film = {
  ...media('rotli-story'),
  label:
    'The rotli story, a 60-second animated film: a quokka arrives on Rottnest Island, writes a trip plan, keeps it in one folder, lets the Librarian file it, keeps secure notes on the Mac, asks chat about it, and waves at sunset.',
};

const episode = (n: number, slug: string, title: string, label: string): Episode => ({
  ...media(slug),
  thumb: `/media/story/${slug}-thumb.webp`,
  n,
  title,
  label: `Rotli in 30 seconds, episode ${n}: ${label}`,
});

export const episodes: Episode[] = [
  episode(1, 'ep01-write', 'Write in Markdown. See it rendered.', 'typing Markdown in a trip plan as tasks, choices, and a table render, then Aa shows the raw Markdown underneath.'),
  episode(2, 'ep02-folder', 'One folder. Every way out stays open.', 'the vault is an ordinary folder of Markdown files that opens in other apps, backs up any way you like, and still makes sense without rotli.'),
  episode(3, 'ep03-habits', 'Small habits. Big calm.', 'Option-Space opens rotli from anywhere, Command-K searches the whole vault, wikilinks connect notes, and views arrange the same files without copying them.'),
  episode(4, 'ep04-yours', 'Make it yours.', 'six themes in light and dark, and a companion quokka in seven colors with glasses or a bucket hat, or turned off.'),
  episode(5, 'ep05-librarian', 'A Librarian that files, never rewrites.', 'with the Librarian on, a new note gets tags, a summary, links, and a place in the Library while its words stay unchanged.'),
  episode(6, 'ep06-chat', 'Ask your notes.', 'chat answers from the notes in the vault, keeps Conversation notes after every reply, and files a PDF beside the chat.'),
  episode(7, 'ep07-secure', 'Some notes never leave this Mac.', 'no account or tracking, AI off or on your Mac or your own tools, secure notes that remote models never see, and locked notes no model can edit.'),
  episode(8, 'ep08-web', 'Your folder, in your browser.', 'Rotli Web opens a folder on your computer in Chrome, Edge, or Arc; Rotli Helper brings Firefox, Zen, and Brave; the Mac app and the browser share the same folder.'),
];
