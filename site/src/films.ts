// The site's films. The landing hero plays the product film
// (public/media/hero/): a real Rotli Web session on synthetic notes, recorded by
// `bun run capture:hero`, silent, its captions in a band under the picture. The
// studio's illustrated films (public/media/story/, encoded for the web from
// rotli-studio/motion/out/video) are no longer played by any page: visitors asked
// for the real product over the story (2026-10-05). Posters are frames of the films.
export type Film = {
  src: string;
  poster: string;
  label: string;
  /** No soundtrack: the player offers a replay, never sound. */
  silent?: true;
  /** Captions burned into a band along the bottom (the player keeps its controls above it). */
  captioned?: true;
};

const media = (slug: string) => ({
  src: `/media/story/${slug}.mp4`,
  poster: `/media/story/${slug}-poster.webp`,
});

export const hero: Film = {
  src: '/media/hero/rotli-hero.mp4',
  poster: '/media/hero/rotli-hero-poster.webp',
  silent: true,
  captioned: true,
  label:
    'A screen recording of rotli, under a minute, without sound: a quick messy note with two tasks, a dropped picture of tiles, and a link to the Lisbon trip note; the Library, where the Librarian files notes into areas such as Travel; a search for "tile" that finds the note again; a chat asking what is still open for Lisbon, answered from those notes; and the same note as plain Markdown.',
};

/** The studio's 60-second story film, which the hero played until the product film. */
export const story: Film = {
  ...media('rotli-story'),
  label:
    'The rotli story, a 60-second animated film: a quokka arrives on Rottnest Island, writes a trip plan, keeps it in one folder, lets the Librarian file it, keeps secure notes on the Mac, asks chat about it, and waves at sunset.',
};
