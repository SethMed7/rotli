// The blog's illustrated scenes: the film's island by day (site/src/components/ResourceScene.astro
// draws the guides' version in the page), the app's quokka, and the things a post is about.
// One scene per post (`scene` in site/src/og.ts POST_ART), drawn in two compositions:
//   thumb  1200 × 630   the post's thumbnail (the blog index and the link card's prop): the
//                       quokka on the right third, the post's main prop on the left third, the
//                       second prop further up the beach
//   wide   2400 × 1000  the post's banner: the same quokka and props gathered in the right half,
//                       so the left and the bottom stay open sea and sand where the article's
//                       title panel rises over the picture; `mobile` is its right half
// Every line is the quokka's own ink at the quokka's own weight (ART_LINE, scaled to the size it
// is drawn at), so a prop never reads heavier or lighter than the character beside it, and the
// colours are the site's tokens (templates.mjs reads them from Base.astro).
//
// Props are drawn in local units whose (0, 0) is the middle of the prop's foot; `prop()` places
// one and returns its box as a keep-out for text.
import { ART, ART_LINE } from "./quokka.mjs";
import { beach, C, character, cloud, esc, lighthouse, sea } from "./templates.mjs";

const ink = C.ink;
const stroke = (w) => `stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Each prop: its drawing at stroke width `sw` (local units), and its bounds (foot at y = 0). */
const PROPS = {
  // Three AI helpers idle on a bench, two of them asleep.
  bench: {
    box: { x: -170, y: -196, w: 340, h: 196 },
    svg: (sw) => {
      const bots = [
        { x: -104, fill: C.lantern, asleep: true },
        { x: 0, fill: C.oliveBright, asleep: false },
        { x: 104, fill: C.lake, asleep: true },
      ]
        .map(({ x, fill, asleep }) => {
          const face = asleep
            ? `<path d="M${x - 24} -122q8 7 16 0M${x + 8} -122q8 7 16 0M${x - 9} -100h18" fill="none" ${stroke(sw * 0.85)}/>`
            : `<circle cx="${x - 16}" cy="-122" r="6" fill="${ink}"/><circle cx="${x + 16}" cy="-122" r="6" fill="${ink}"/><path d="M${x - 9} -100h18" fill="none" ${stroke(sw * 0.85)}/>`;
          const zz = asleep
            ? `<path d="M${x + 30} -186h14l-14 16h14M${x + 50} -204h10l-10 12h10" fill="none" ${stroke(sw * 0.7)}/>`
            : "";
          return `<path d="M${x} -150v-16" fill="none" ${stroke(sw)}/><circle cx="${x}" cy="-172" r="7" fill="${C.accent}" ${stroke(sw * 0.8)}/>
            <rect x="${x - 40}" y="-152" width="80" height="70" rx="18" fill="${fill}" ${stroke(sw)}/>${face}${zz}`;
        })
        .join("");
      return `<path d="M-146 -70V-2M146 -70V-2" fill="none" ${stroke(sw * 1.4)}/>
        <rect x="-170" y="-84" width="340" height="18" rx="7" fill="${C.wood}" ${stroke(sw)}/>${bots}`;
    },
  },
  // A month on the calendar with nothing done: the plan that sat unopened.
  calendar: {
    box: { x: -92, y: -200, w: 184, h: 200 },
    svg: (sw) => {
      const days = [];
      for (let row = 0; row < 4; row += 1)
        for (let col = 0; col < 5; col += 1)
          days.push(
            `<rect x="${-66 + col * 28}" y="${-122 + row * 28}" width="18" height="18" rx="4" fill="${C.sand}" ${stroke(sw * 0.5)}/>`,
          );
      return `<g transform="rotate(4 0 -100)"><rect x="-84" y="-184" width="168" height="180" rx="12" fill="${C.paper}" ${stroke(sw)}/>
        <path d="M-84 -144v-28a12 12 0 0 1 12-12h144a12 12 0 0 1 12 12v28z" fill="${C.accent}" ${stroke(sw)}/>
        <path d="M-44 -198v24M44 -198v24" fill="none" ${stroke(sw * 1.3)}/>${days.join("")}</g>`;
    },
  },
  // A browser window: Rotli Web.
  browser: {
    box: { x: -110, y: -150, w: 220, h: 150 },
    svg: (sw) => `<g transform="translate(-301 -272)">
      <rect x="196" y="128" width="210" height="140" rx="14" fill="${C.paper}" ${stroke(sw)}/>
      <path d="M196 158h210" fill="none" ${stroke(sw)}/>
      <circle cx="218" cy="143" r="5.5" fill="${C.accent}"/><circle cx="235" cy="143" r="5.5" fill="${C.sand}" ${stroke(sw * 0.4)}/><circle cx="252" cy="143" r="5.5" fill="${C.sand}" ${stroke(sw * 0.4)}/>
      <path d="M222 188h112M222 208h84M222 228h98" fill="none" stroke="${C.accent}" stroke-width="${sw}" stroke-linecap="round"/></g>`,
  },
  // A laptop with Terminal open.
  terminal: {
    box: { x: -128, y: -146, w: 256, h: 146 },
    svg: (sw) => `<g transform="translate(-300 -274)">
      <rect x="200" y="134" width="200" height="126" rx="12" fill="${C.paper}" ${stroke(sw)}/>
      <rect x="216" y="150" width="168" height="94" rx="5" fill="${C.ink}"/>
      <path d="M234 174l14 10-14 10M256 196h26" fill="none" stroke="${C.sea}" stroke-width="${sw * 0.9}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M234 224h76" fill="none" stroke="${C.sand}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-opacity="0.55"/>
      <path d="M176 260h248l-14 14H190z" fill="${C.limestone}" ${stroke(sw)}/></g>`,
  },
  // The guides' friendly chip: an AI tool, with a speech bubble over it.
  chip: {
    box: { x: -90, y: -214, w: 180, h: 214 },
    svg: (sw) => `<g transform="translate(-280 -264)">
      <path d="M249 168v12M269 168v12M289 168v12M309 168v12" fill="none" ${stroke(sw * 1.1)}/>
      <rect x="232" y="180" width="96" height="84" rx="18" fill="${C.oliveBright}" ${stroke(sw)}/>
      <circle cx="262" cy="214" r="6.5" fill="${ink}"/><circle cx="298" cy="214" r="6.5" fill="${ink}"/>
      <path d="M268 233q12 10 24 0" fill="none" ${stroke(sw * 0.85)}/>
      <path d="M200 64h100a16 16 0 0 1 16 16v28a16 16 0 0 1-16 16h-48l-20 16 2-16h-34a16 16 0 0 1-16-16V80a16 16 0 0 1 16-16z" fill="${C.paper}" ${stroke(sw)}/>
      <circle cx="226" cy="94" r="5.5" fill="${ink}"/><circle cx="250" cy="94" r="5.5" fill="${ink}"/><circle cx="274" cy="94" r="5.5" fill="${ink}"/></g>`,
  },
  // Notes joined by links: a memory that holds together.
  linked: {
    box: { x: -132, y: -212, w: 280, h: 212 },
    svg: (
      sw,
    ) => `<path d="M-74 -118L98 -166M-74 -118L62 -40M98 -166L62 -40" fill="none" stroke="${C.seaDeep}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="0.1 ${sw * 2.6}"/>
      <g transform="rotate(-6 -74 -118)"><rect x="-128" y="-170" width="108" height="104" rx="10" fill="${C.paper}" ${stroke(sw)}/><path d="M-108 -142h66M-108 -122h48M-108 -102h58" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/></g>
      <g transform="rotate(5 98 -166)"><rect x="54" y="-206" width="88" height="80" rx="10" fill="${C.paper}" ${stroke(sw)}/><path d="M72 -182h52M72 -162h34" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/></g>
      <g transform="rotate(-3 62 -40)"><rect x="16" y="-76" width="96" height="72" rx="10" fill="${C.paper}" ${stroke(sw)}/><path d="M34 -52h58M34 -32h38" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/></g>`,
  },
  // A page written for yourself: quick lines, a crossed-out word, an arrow.
  scribbled: {
    box: { x: -102, y: -212, w: 204, h: 212 },
    svg: (
      sw,
    ) => `<g transform="rotate(-7 0 -100)"><rect x="-86" y="-200" width="172" height="196" rx="10" fill="${C.paper}" ${stroke(sw)}/>
      <path d="M-60 -166q14-8 28 0t28 0 28 0M-60 -134q20 6 40-2t34 4M-60 -102h44" fill="none" ${stroke(sw * 0.75)}/>
      <path d="M-8 -106l40 8" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/>
      <path d="M-60 -64q30-26 70-6l-8-14M10 -70l-12 6" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-60 -34q16 8 34 0t30 2" fill="none" ${stroke(sw * 0.75)}/></g>`,
  },
  // The same page as the Librarian files it: a block of fields on top, the body unchanged.
  filed: {
    box: { x: -104, y: -212, w: 208, h: 212 },
    svg: (
      sw,
    ) => `<g transform="rotate(4 0 -100)"><rect x="-90" y="-204" width="180" height="200" rx="10" fill="${C.paper}" ${stroke(sw)}/>
      <path d="M-80 -204h160a10 10 0 0 1 10 10v66h-180v-66a10 10 0 0 1 10-10z" fill="${C.sea}" fill-opacity="0.4"/>
      <path d="M-90 -128h180" fill="none" ${stroke(sw * 0.8)}/>
      <path d="M-56 -180h70M-56 -156h48" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/>
      <path d="M-74 -180h10M-69 -185v10M-74 -156h10M-69 -161v10" fill="none" stroke="${C.seaDeep}" stroke-width="${sw * 0.7}" stroke-linecap="round"/>
      <path d="M-64 -96q14-8 28 0t28 0 28 0M-64 -64q20 6 40-2t34 4M-64 -34h44" fill="none" ${stroke(sw * 0.75)}/></g>`,
  },
  // Sketches pinned out on the sand: the first drawings of something new.
  sketches: {
    box: { x: -140, y: -170, w: 280, h: 170 },
    svg: (
      sw,
    ) => `<g transform="rotate(-8 -60 -80)"><rect x="-130" y="-150" width="140" height="120" rx="10" fill="${C.paper}" ${stroke(sw)}/>
      <rect x="-112" y="-130" width="44" height="34" rx="6" fill="${C.sand}" ${stroke(sw * 0.75)}/><path d="M-54 -124h42M-54 -106h30M-112 -72h92" fill="none" stroke="${C.accent}" stroke-width="${sw * 0.9}" stroke-linecap="round"/></g>
      <g transform="rotate(6 70 -70)"><rect x="6" y="-136" width="128" height="116" rx="10" fill="${C.paper}" ${stroke(sw)}/>
      <circle cx="44" cy="-96" r="18" fill="${C.lantern}" ${stroke(sw * 0.75)}/><path d="M64 -96h38M44 -76v22M26 -52h80" fill="none" stroke="${C.seaDeep}" stroke-width="${sw * 0.9}" stroke-linecap="round"/></g>
      <path d="M-22 -10l68-34 10 14-68 34z" fill="${C.lantern}" ${stroke(sw * 0.8)}/><path d="M-22 -10l-10 18 22-4" fill="${C.sand}" ${stroke(sw * 0.8)}/>`,
  },
};

/** One prop at (x, y) (its foot), scaled by s, at line weight `lw` px, with its bounds as a keep-out. */
export function prop(name, { x, y, s = 1, lw }) {
  const { svg, box } = PROPS[name];
  return `<g transform="translate(${x} ${y}) scale(${s})">${svg(lw / s)}</g>
  <rect data-keepout="${name}" x="${x + box.x * s}" y="${y + box.y * s}" width="${box.w * s}" height="${box.h * s}" fill="none"/>`;
}

/** The ink line of a quokka drawn `size` px square, which every prop beside it matches. */
export const lineFor = (size) => (ART_LINE / ART) * size;

/**
 * Each post scene, per composition: where the quokka stands (centre x, foot y, square size),
 * each prop (`at`: foot x, y, scale; the nearer first), a dotted path between two points, and
 * the scenery. Feet sit on the sand, a prop further up the beach is smaller (it is further
 * away), and nothing touches the frame or another shape's edge.
 */
const SCENES = {
  bench: {
    props: ["bench", "calendar"],
    thumb: {
      quokka: [820, 604, 560],
      at: [
        [330, 596, 1.45],
        [1080, 520, 0.95],
      ],
    },
    wide: {
      quokka: [1520, 958, 820],
      at: [
        [2010, 950, 1.3],
        [2300, 800, 0.7],
      ],
    },
  },
  helper: {
    props: ["browser", "terminal"],
    path: true,
    thumb: {
      quokka: [800, 604, 560],
      at: [
        [330, 590, 1.55],
        [1075, 520, 1.0],
      ],
      path: [[330, 330], [1075, 400], 230],
    },
    wide: {
      quokka: [1540, 958, 820],
      at: [
        [1980, 950, 1.5],
        [2280, 790, 0.95],
      ],
      path: [[1900, 712], [2290, 630], 210],
    },
  },
  memory: {
    props: ["chip", "linked"],
    thumb: {
      quokka: [790, 604, 560],
      at: [
        [300, 594, 1.35],
        [1050, 520, 0.88],
      ],
    },
    wide: {
      quokka: [1540, 958, 820],
      at: [
        [1980, 950, 1.5],
        [2240, 820, 0.9],
      ],
    },
  },
  "two-notes": {
    props: ["scribbled", "filed"],
    thumb: {
      quokka: [800, 604, 560],
      at: [
        [330, 596, 1.35],
        [1075, 528, 0.95],
      ],
    },
    wide: {
      quokka: [1540, 958, 820],
      at: [
        [2010, 950, 1.55],
        [2285, 800, 0.9],
      ],
    },
  },
  making: {
    props: ["sketches"],
    lighthouse: true,
    sun: true,
    thumb: { quokka: [650, 604, 600], at: [[230, 600, 1.3]], lighthouse: [1080, 0.9], sun: [880, 104] },
    wide: { quokka: [1590, 958, 860], at: [[2200, 950, 1.3]], lighthouse: [2250, 1.2], sun: [1960, 170] },
  },
  beach: {
    props: [],
    lighthouse: true,
    thumb: { quokka: [760, 604, 600], at: [], lighthouse: [1060, 0.95] },
    wide: { quokka: [1560, 958, 860], at: [], lighthouse: [2120, 1.2] },
  },
};
export const SCENE_NAMES = Object.keys(SCENES);

/** The canvas of each composition: its size, the horizon, and where the dunes and the sand begin. */
const CANVAS = {
  thumb: {
    w: 1200,
    h: 630,
    horizon: 316,
    dune: 470,
    sand: 548,
    clouds: [
      [200, 92, 1.3],
      [640, 60, 0.85],
    ],
  },
  wide: {
    w: 2400,
    h: 1000,
    horizon: 560,
    dune: 760,
    sand: 868,
    clouds: [
      [330, 170, 1.9],
      [1000, 110, 1.2],
      [2180, 150, 1],
    ],
    isle: 700,
  },
};

/** A far islet on the horizon: the open half of a wide scene has somewhere for the eye to rest. */
function isle({ x, y, k, lw }) {
  return `<path d="M${x - 170 * k} ${y}C${x - 110 * k} ${y - 30 * k} ${x - 40 * k} ${y - 46 * k} ${x + 20 * k} ${y - 44 * k}S${x + 120 * k} ${y - 22 * k} ${x + 170 * k} ${y}Z" fill="${C.limestone}" stroke="${ink}" stroke-width="${lw}" stroke-linejoin="round"/>
  <ellipse cx="${x - 30 * k}" cy="${y - 30 * k}" rx="${26 * k}" ry="${8 * k}" fill="${C.olive}"/><ellipse cx="${x + 40 * k}" cy="${y - 28 * k}" rx="${20 * k}" ry="${7 * k}" fill="${C.oliveBright}"/>`;
}

/** The bay, the limestone dunes with their scrub, and the sand: the floor every scene stands on. */
function shore({ w, h, horizon, dune, sand, k, lw }) {
  const line = `stroke="${ink}" stroke-width="${lw}" stroke-linejoin="round"`;
  const wave = (x) => Math.sin(x / 173) * 6 * k + Math.sin(x / 61) * 3 * k;
  const ridge = (y) => {
    let d = `M-20 ${h + 20}V${y + wave(0)}`;
    for (let x = 0; x <= w + 40; x += 40 * k) d += `L${x.toFixed(1)} ${(y + wave(x + y)).toFixed(1)}`;
    return `${d}V${h + 20}Z`;
  };
  const scrub = [
    [0.07, dune - 4 * k, 52],
    [0.47, dune + 2 * k, 44],
    [0.93, dune - 6 * k, 46],
  ]
    .map(
      ([fx, y, r]) =>
        `<ellipse cx="${fx * w}" cy="${y}" rx="${r * k}" ry="${r * 0.32 * k}" fill="${C.olive}" ${line}/>`,
    )
    .join("");
  return `${sea({ w, h, top: horizon, k })}
  <path d="${ridge(dune)}" fill="${C.limestone}" ${line}/>${scrub}
  <path d="${ridge(sand)}" fill="${C.sand}" ${line}/>`;
}

/**
 * A post's scene, with no words. `layout` is `thumb` (1200 × 630) or `wide` (2400 × 1000);
 * `crop` ([x, y, w, h] in canvas units) cuts a part of it (the banner's phone crop), drawn at
 * `w` × `h` pixels.
 */
export function scene({ kind, art, label, layout = "thumb", crop, w, h }) {
  const spec = SCENES[kind];
  if (!spec) throw new Error(`Unknown post scene "${kind}" (one of ${SCENE_NAMES.join(", ")})`);
  const canvas = CANVAS[layout];
  const place = spec[layout];
  const k = canvas.h / 630;
  const [qx, footY, qSize] = place.quokka;
  const lw = lineFor(qSize);
  const view = crop ?? [0, 0, canvas.w, canvas.h];
  const props = place.at
    .map(([x, y, s], index) => prop(spec.props[index], { x, y, s, lw: lw * (y < footY - 40 * k ? 0.85 : 1) }))
    .reverse()
    .join("");
  const path = place.path
    ? (() => {
        const [[x0, y0], [x1, y1], lift] = place.path;
        const dx = (x1 - x0) * 0.25;
        return `<path d="M${x0} ${y0}C${x0 + dx} ${y0 - lift} ${x1 - dx} ${y1 - lift} ${x1} ${y1}" fill="none" stroke="${C.accent}" stroke-width="${lw}" stroke-linecap="round" stroke-dasharray="0.1 ${lw * 3}"/>`;
      })()
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w ?? view[2]}" height="${h ?? view[3]}" viewBox="${view.join(" ")}" role="img" aria-label="${esc(label)}">
  <rect width="${canvas.w}" height="${canvas.h}" fill="${C.sky}"/>
  ${place.sun ? `<circle cx="${place.sun[0]}" cy="${place.sun[1]}" r="${52 * k}" fill="${C.cloud}" stroke="${C.accent}" stroke-width="${lw * 0.8}"/>` : ""}
  ${canvas.clouds.map(([x, y, s]) => cloud({ x, y, s: s * (layout === "wide" ? 1 : 1) })).join("")}
  ${canvas.isle ? isle({ x: canvas.isle, y: canvas.horizon, k, lw: lw * 0.5 }) : ""}
  ${place.lighthouse ? lighthouse({ x: place.lighthouse[0], y: canvas.horizon + 2 * k, s: place.lighthouse[1] * k }) : ""}
  ${shore({ ...canvas, k, lw: lw * 0.6 })}
  ${path}
  ${props}
  ${character(art, { x: qx - qSize / 2, y: footY - art.box.bottom * qSize, size: qSize })}
</svg>`;
}

/**
 * The link card's half of a scene (card()'s `beside`): the scene's main prop, smaller, on the
 * beach to the quokka's left, at the quokka's line weight, so the preview shows the same picture
 * as the thumbnail.
 */
export function cardBeside(kind) {
  const name = SCENES[kind]?.props[0];
  if (!name) return undefined;
  const { box } = PROPS[name];
  return ({ footX, footY, k, qSize }) => {
    const s = 0.72 * k;
    const x = footX - 300 * k;
    const y = footY - 2 * k;
    return {
      ground: beach({ x, footY: y + 2 * k, bottom: footY + 64 * k, k }),
      svg: prop(name, { x, y, s, lw: lineFor(qSize) }),
      left: x + box.x * s,
    };
  };
}

/** The banner's phone crop of the wide composition (x, y, w, h): the quokka and its props, less sky. */
export const MOBILE_CROP = [1100, 100, 1300, 900];

/** The square size the quokka is drawn at in a composition, so the build renders it pixel for pixel. */
export function quokkaSize(kind, layout) {
  const spec = SCENES[kind];
  if (!spec) throw new Error(`Unknown post scene "${kind}" (one of ${SCENE_NAMES.join(", ")})`);
  return spec[layout].quokka[2];
}
