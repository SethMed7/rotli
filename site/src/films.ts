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

// The `v` query is the cut's date: a new cut gets a new address, so no cache (a browser's, or
// Cloudflare's edge, which held the 404 the old site gave this path when the film first went
// live, 2026-10-10) can serve an old answer for it.
export const hero: Film = {
  src: "/media/hero/rotli-hero.mp4?v=2026-10-09",
  poster: "/media/hero/rotli-hero-poster.webp?v=2026-10-09",
  silent: true,
  captioned: true,
  label:
    "A screen recording of rotli, under a minute, without sound: a quick note about a call with Dana, written in Main; the Vault view showing the same file once, in the vault's inbox folder; on the Mac, the Librarian filing it into Clients while the words stay as typed; the note in its new place and still where it was in Main; and a chat asking what Dana wanted and what is left, answered from that note and the discount policy.",
};

/** The studio's 60-second story film, which the hero played until the product film. */
export const story: Film = {
  ...media("rotli-story"),
  label:
    "The rotli story, a 60-second animated film: a quokka arrives on Rottnest Island, writes a trip plan, keeps it in one folder, lets the Librarian file it, keeps secure notes on the Mac, asks chat about it, and waves at sunset.",
};
