// The blog's illustrated scenes: the film's island by day (site/src/components/ResourceScene.astro
// draws the guides' version in the page), the app's quokka in the middle, and the things a post
// is about on either side. One scene per post (`scene` in site/src/og.ts POST_ART): rendered
// whole and title-free as the post's thumbnail, and its first prop stands beside the quokka on
// the post's link card, so the index, the article, and the preview show the same picture.
//
// Props are drawn in the guides' scene vocabulary (folder, sheets, window, laptop, chip, bubble)
// in local units whose (0, 0) is the middle of the prop's foot; `prop()` places one and returns
// its box as a keep-out for text.
import { beach, C, character, cloud, esc, lighthouse, sea } from "./templates.mjs";

const ink = C.line;
const line = (w = 5) => `stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const paper = `fill="${C.paper}" ${line()}`;
const accentLine = `fill="none" stroke="${C.accent}" stroke-width="5" stroke-linecap="round"`;

/** Each prop: its drawing, and its bounds in local units (foot at y = 0). */
const PROPS = {
  // Three AI helpers idle on a bench, two of them asleep.
  bench: {
    box: { x: -170, y: -196, w: 340, h: 196 },
    svg: () => {
      const bots = [
        { x: -104, fill: C.lantern, asleep: true },
        { x: 0, fill: C.oliveBright, asleep: false },
        { x: 104, fill: C.lake, asleep: true },
      ]
        .map(({ x, fill, asleep }) => {
          const face = asleep
            ? `<path d="M${x - 24} -122q8 7 16 0M${x + 8} -122q8 7 16 0M${x - 9} -100h18" fill="none" ${line(5)}/>`
            : `<circle cx="${x - 16}" cy="-122" r="6" fill="${ink}"/><circle cx="${x + 16}" cy="-122" r="6" fill="${ink}"/><path d="M${x - 9} -100h18" fill="none" ${line(5)}/>`;
          const zz = asleep
            ? `<text x="${x + 30}" y="-160" fill="${ink}" font-family="'General Sans', sans-serif" font-weight="600" font-size="28">z<tspan dx="2" dy="-14" font-size="22">z</tspan></text>`
            : "";
          return `<path d="M${x} -150v-18" fill="none" ${line(5)}/><circle cx="${x}" cy="-172" r="7" fill="${C.accent}" ${line(4)}/>
            <rect x="${x - 40}" y="-152" width="80" height="70" rx="18" fill="${fill}" ${line()}/>${face}${zz}`;
        })
        .join("");
      return `<path d="M-146 -70V0M146 -70V0" fill="none" ${line(7)}/>
        <rect x="-170" y="-84" width="340" height="18" rx="7" fill="${C.wood}" ${line()}/>${bots}`;
    },
  },
  // A month on the calendar with nothing done: the plan that sat unopened.
  calendar: {
    box: { x: -92, y: -200, w: 184, h: 200 },
    svg: () => {
      const days = [];
      for (let row = 0; row < 4; row += 1)
        for (let col = 0; col < 5; col += 1) {
          const x = -66 + col * 28;
          const y = -122 + row * 28;
          days.push(
            `<rect x="${x}" y="${y}" width="18" height="18" rx="3" fill="${C.sand}" stroke="${ink}" stroke-width="2.5"/>`,
          );
        }
      return `<g transform="rotate(4 0 -100)"><rect x="-84" y="-184" width="168" height="180" rx="10" ${paper}/>
        <path d="M-84 -144v-30a10 10 0 0 1 10-10h148a10 10 0 0 1 10 10v30z" fill="${C.accent}" ${line()}/>
        <path d="M-44 -196v22M44 -196v22" fill="none" ${line(7)}/>${days.join("")}</g>`;
    },
  },
  // A folder of notes standing open (the guides' "your folder").
  folder: {
    box: { x: -130, y: -142, w: 260, h: 142 },
    svg: () => `<g transform="translate(-347 -270)">
      <path d="M230 270V160a12 12 0 0 1 12-12h76l16 18h120a12 12 0 0 1 12 12v92z" fill="${C.wood}" ${line()}/>
      <rect x="262" y="134" width="74" height="96" rx="6" transform="rotate(-6 299 182)" ${paper}/>
      <rect x="318" y="128" width="74" height="100" rx="6" ${paper}/>
      <rect x="372" y="136" width="74" height="94" rx="6" transform="rotate(7 409 183)" ${paper}/>
      <path d="M276 156l44-5M278 172l36-4M332 152h44M332 168h34M388 158l40 5M388 174l32 4" ${accentLine}/>
      <path d="M218 270l20-82h238l-14 82z" fill="${C.limestone}" ${line()}/></g>`,
  },
  // A browser window: Rotli Web.
  browser: {
    box: { x: -110, y: -150, w: 220, h: 150 },
    svg: () => `<g transform="translate(-301 -272)">
      <rect x="196" y="128" width="210" height="140" rx="12" ${paper}/>
      <path d="M196 156h210" fill="none" ${line()}/>
      <circle cx="216" cy="142" r="5" fill="${C.accent}"/><circle cx="232" cy="142" r="5" fill="${C.accent}"/><circle cx="248" cy="142" r="5" fill="${C.accent}"/>
      <path d="M222 184h120M222 204h90M222 224h104" ${accentLine}/></g>`,
  },
  // A laptop with Terminal open, and the folder it keeps in front of it.
  terminal: {
    box: { x: -128, y: -146, w: 256, h: 146 },
    svg: () => `<g transform="translate(-300 -274)">
      <rect x="200" y="134" width="200" height="124" rx="10" fill="${C.paper}" ${line()}/>
      <rect x="214" y="148" width="172" height="96" rx="4" fill="${C.text}" ${line(3)}/>
      <path d="M232 172l14 10-14 10M254 194h26" fill="none" stroke="${C.sea}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M232 222h80" fill="none" stroke="${C.sand}" stroke-width="4" stroke-linecap="round" stroke-opacity="0.6"/>
      <path d="M176 258h248l-14 16H190z" fill="${C.limestone}" ${line()}/></g>`,
  },
  // The guides' friendly chip: an AI tool, with a speech bubble over it.
  chip: {
    box: { x: -90, y: -214, w: 180, h: 214 },
    svg: () => `<g transform="translate(-280 -264)">
      <g fill="${ink}"><rect x="246" y="168" width="7" height="14" rx="2"/><rect x="266" y="168" width="7" height="14" rx="2"/><rect x="286" y="168" width="7" height="14" rx="2"/><rect x="306" y="168" width="7" height="14" rx="2"/></g>
      <rect x="232" y="180" width="96" height="84" rx="16" fill="${C.oliveBright}" ${line()}/>
      <circle cx="262" cy="214" r="6" fill="${ink}"/><circle cx="298" cy="214" r="6" fill="${ink}"/>
      <path d="M268 232q12 10 24 0" fill="none" ${line()}/>
      <path d="M200 64h100a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14h-50l-18 16 2-16h-34a14 14 0 0 1-14-14V78a14 14 0 0 1 14-14z" ${paper}/>
      <circle cx="226" cy="93" r="5" fill="${ink}"/><circle cx="250" cy="93" r="5" fill="${ink}"/><circle cx="274" cy="93" r="5" fill="${ink}"/></g>`,
  },
  // Notes joined by links: a memory that holds together.
  linked: {
    box: { x: -132, y: -212, w: 280, h: 212 },
    svg: () => `<path d="M-74 -118L98 -166M-74 -118L62 -40M98 -166L62 -40" fill="none" stroke="${C.seaDeep}" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 13"/>
      <g transform="rotate(-6 -74 -118)"><rect x="-128" y="-170" width="108" height="104" rx="8" ${paper}/><path d="M-110 -142h66M-110 -122h48M-110 -102h58" ${accentLine}/></g>
      <g transform="rotate(5 98 -166)"><rect x="54" y="-206" width="88" height="80" rx="8" ${paper}/><path d="M70 -182h54M70 -162h36" ${accentLine}/></g>
      <g transform="rotate(-3 62 -40)"><rect x="16" y="-76" width="96" height="72" rx="8" ${paper}/><path d="M32 -52h60M32 -32h40" ${accentLine}/></g>`,
  },
  // A page written for yourself: quick lines, a crossed-out word, an arrow.
  scribbled: {
    box: { x: -102, y: -212, w: 204, h: 212 },
    svg: () => `<g transform="rotate(-7 0 -100)"><rect x="-86" y="-200" width="172" height="196" rx="8" ${paper}/>
      <path d="M-62 -168q14-8 28 0t28 0 28 0M-62 -136q20 6 40-2t34 4M-62 -104h44" fill="none" ${line(4)}/>
      <path d="M-8 -108l40 8" fill="none" stroke="${C.accent}" stroke-width="5" stroke-linecap="round"/>
      <path d="M-62 -66q30-26 70-6l-8-14M8 -72l-12 6" fill="none" stroke="${C.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-62 -36q16 8 34 0t30 2" fill="none" ${line(4)}/></g>`,
  },
  // The same page as the Librarian files it: a block of fields on top, the body unchanged.
  filed: {
    box: { x: -104, y: -212, w: 208, h: 212 },
    svg: () => `<g transform="rotate(4 0 -100)"><rect x="-90" y="-204" width="180" height="200" rx="8" ${paper}/>
      <rect x="-90" y="-204" width="180" height="76" rx="8" fill="${C.sea}" fill-opacity="0.35"/>
      <path d="M-90 -128h180" fill="none" ${line(4)}/>
      <path d="M-58 -182h70M-58 -158h48" ${accentLine}/>
      <path d="M-74 -182h8M-70 -186v8M-74 -158h8M-70 -162v8" fill="none" stroke="${C.seaDeep}" stroke-width="4" stroke-linecap="round"/>
      <path d="M-66 -96q14-8 28 0t28 0 28 0M-66 -64q20 6 40-2t34 4M-66 -34h44" fill="none" ${line(4)}/></g>`,
  },
  // Sketches pinned out on the sand: the first drawings of something new.
  sketches: {
    box: { x: -140, y: -170, w: 280, h: 170 },
    svg: () => `<g transform="rotate(-8 -60 -80)"><rect x="-130" y="-150" width="140" height="120" rx="8" ${paper}/>
      <rect x="-112" y="-130" width="44" height="34" rx="5" fill="none" ${line(4)}/><path d="M-56 -124h46M-56 -106h34M-112 -74h96" ${accentLine}/></g>
      <g transform="rotate(6 70 -70)"><rect x="6" y="-136" width="128" height="116" rx="8" ${paper}/>
      <circle cx="44" cy="-96" r="18" fill="none" ${line(4)}/><path d="M62 -96h40M44 -78v24M26 -54h80" fill="none" stroke="${C.seaDeep}" stroke-width="5" stroke-linecap="round"/></g>
      <path d="M-24 -12l70-36 10 12-70 36z" fill="${C.lantern}" ${line(4)}/><path d="M-24 -12l-8 16 18-4" fill="${C.sand}" ${line(4)}/>`,
  },
};

/** One prop at (x, y) (its foot), scaled by s, with its bounds as a keep-out for text. */
export function prop(name, { x, y, s = 1 }) {
  const { svg, box } = PROPS[name];
  return `<g transform="translate(${x} ${y}) scale(${s})">${svg()}</g>
  <rect data-keepout="${name}" x="${x + box.x * s}" y="${y + box.y * s}" width="${box.w * s}" height="${box.h * s}" fill="none"/>`;
}

/** Each post scene: the prop on the quokka's left (also on the link card), the one on its right, and anything in the sky. */
const SCENES = {
  bench: { left: "bench", right: "calendar" },
  helper: { left: "browser", right: "terminal", path: true },
  memory: { left: "chip", right: "linked", path: true },
  "two-notes": { left: "scribbled", right: "filed" },
  making: { left: "sketches", right: null, lighthouse: true, sun: true },
  beach: { left: null, right: null },
};
export const SCENE_NAMES = Object.keys(SCENES);

/**
 * The link card's half of a scene (card()'s `beside`): the scene's first prop, smaller, on the
 * beach to the quokka's left, so the preview shows the same picture as the thumbnail.
 */
export function cardBeside(kind) {
  const name = SCENES[kind]?.left;
  if (!name) return undefined;
  const { box } = PROPS[name];
  return ({ footX, footY, k }) => {
    const s = 0.72 * k;
    const x = footX - 270 * k;
    const y = footY - 2 * k;
    return {
      ground: beach({ x, footY: y + 2 * k, bottom: footY + 64 * k, k }),
      svg: prop(name, { x, y, s }),
      left: x + box.x * s,
    };
  };
}

/**
 * A post's scene, 1200 × 630, with no words: the sky, the bay, the dunes, and the quokka
 * on the sand between the post's two props.
 */
export function scene({ kind, art, label, w = 1200, h = 630 }) {
  const spec = SCENES[kind];
  if (!spec) throw new Error(`Unknown post scene "${kind}" (one of ${SCENE_NAMES.join(", ")})`);
  const seaTop = 330;
  const qSize = 430;
  const qx = 600 - qSize / 2;
  const qy = 598 - art.box.bottom * qSize;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1200 630" role="img" aria-label="${esc(label)}">
  <rect width="1200" height="630" fill="${C.sky}"/>
  ${spec.sun ? `<circle cx="460" cy="96" r="54" fill="${C.cloud}" stroke="${C.accent}" stroke-width="5"/>` : ""}
  ${cloud({ x: 220, y: 96, s: 1.3 })}${cloud({ x: 880, y: 70, s: 0.9 })}
  ${spec.lighthouse ? lighthouse({ x: 1000, y: seaTop + 2, s: 1.05 }) : ""}
  ${sea({ w: 1200, h: 520, top: seaTop, k: 1.2 })}
  <path d="M-10 640V466C120 450 260 448 400 458S700 472 820 462 1060 446 1210 456V640Z" fill="${C.limestone}" stroke="${ink}" stroke-width="4"/>
  <ellipse cx="80" cy="462" rx="56" ry="17" fill="${C.olive}" stroke="${ink}" stroke-width="4"/>
  <ellipse cx="1120" cy="456" rx="50" ry="16" fill="${C.olive}" stroke="${ink}" stroke-width="4"/>
  <path d="M-10 640V552C200 542 420 546 620 552S1000 558 1210 546V640Z" fill="${C.sand}" stroke="${ink}" stroke-width="4"/>
  ${spec.path ? `<path d="M280 330C420 190 780 190 920 330" fill="none" stroke="${C.accent}" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 18"/>` : ""}
  ${spec.left ? prop(spec.left, { x: 245, y: 590, s: 1.4 }) : ""}
  ${spec.right ? prop(spec.right, { x: 960, y: 590, s: 1.4 }) : ""}
  ${character(art, { x: qx, y: qy, size: qSize })}
</svg>`;
}
