// The studio's films on the site (public/media/story/, encoded for the web from
// rotli-studio/motion/out/video). The story film plays in the landing hero; the
// eight "Rotli in 30 seconds" episodes live in one series player on /features/
// (EpisodeShelf.astro). Posters and thumbnails are frames of the films.
export type Film = { src: string; poster: string; label: string };
export type Episode = Film & { n: number; title: string; thumb: string };

const media = (slug: string) => ({
  src: `/media/story/${slug}.mp4`,
  poster: `/media/story/${slug}-poster.webp`,
});

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
  episode(7, 'ep07-secure', 'AI is invited in. It does not own the house.', 'no account or tracking, AI off or on your Mac or your own tools, secure notes that remote models never see, and locked notes no model can edit.'),
  episode(8, 'ep08-web', 'Your folder, in your browser.', 'Rotli Web opens a folder on your computer in Chrome, Edge, or Arc; Rotli Helper brings Firefox, Zen, and Brave; the Mac app and the browser share the same folder.'),
];
