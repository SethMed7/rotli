// The site's films. The landing hero plays the product film
// (public/media/hero/): a one-minute tour of the real Mac app on synthetic notes, recorded
// natively (site/README.md "Films"), silent, its captions in a band under the picture. The
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

// The `v` query is the cut's date; bump it with every new cut (site/README.md "Films"). A new
// address means no cache (a browser's, or Cloudflare's edge, which held the 404 the old site gave
// this path when the film first went live, 2026-10-10) can serve an old answer for it.
export const hero: Film = {
  src: '/media/hero/rotli-hero.mp4?v=2026-10-10',
  poster: '/media/hero/rotli-hero-poster.webp?v=2026-10-10',
  silent: true,
  captioned: true,
  label:
    'A one-minute screen recording of the rotli Mac app on synthetic notes, without sound: a note about a call with Dana written in Markdown, with a checklist and a link to Jo Park; the Librarian, on the Mac, filing it into Clients and setting its summary, tags, and links while the words stay as typed; tasks ticked in a checklist and gathered in the Tasks view; search finding notes and opening a board; a spreadsheet recalculating, a document, and the board; Claude answering what is still open before the pricing review and what is owed to Dana, from those notes; and the seven themes, light and dark.',
};

/** The studio's 60-second story film, which the hero played until the product film. */
export const story: Film = {
  ...media('rotli-story'),
  label:
    'The rotli story, a 60-second animated film: a quokka arrives on Rottnest Island, writes a trip plan, keeps it in one folder, lets the Librarian file it, keeps secure notes on the Mac, asks chat about it, and waves at sunset.',
};
