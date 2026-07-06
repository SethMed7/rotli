#!/usr/bin/env node
// build_tiles.mjs — rotli tiles, generated from the APPROVED kit r-mark (gate round 3, 2026-06-11).
// Camino-pattern: each tile is a self-contained SVG with the mark inlined via transform (no <use>/href).
// Emits → kits/rotli/tiles/: favicon.svg · app-icon-512.svg · social-avatar-1024.svg ·
//                            tile-linen.svg · tile-cocoa.svg · tile-clay.svg
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '../../../../kits/rotli');
const OUT = join(KIT, 'tiles');
mkdirSync(OUT, { recursive: true });

const C = { cocoa: '#3A3028', clay: '#C97E62', peach: '#F2D6C2', linen: '#F8F2E9', darkGround: '#241D18' };

const mark = readFileSync(join(KIT, 'logo/r-mark.svg'), 'utf8');
const [vx, vy, vw, vh] = mark.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const d = mark.match(/ d="([^"]+)"/)[1];

// place the r in a square tile: fitH = fraction of tile height the mark ink occupies
const place = (size, fitH) => {
  const s = (size * fitH) / vh;
  const tx = (size - vw * s) / 2 - vx * s;
  const ty = (size - vh * s) / 2 - vy * s;
  return `translate(${+tx.toFixed(2)} ${+ty.toFixed(2)}) scale(${+s.toFixed(6)})`;
};

const tile = ({ size, bg, fg, fitH = 0.66, rx = 0, label }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>
  <g transform="${place(size, fitH)}"><path fill-rule="evenodd" fill="${fg}" d="${d}"/></g>
</svg>
`;

const files = {
  // favicon: linen ground, cocoa r, generous ink (it must read at 16)
  'favicon.svg': tile({ size: 64, bg: C.linen, fg: C.cocoa, fitH: 0.74, label: 'rotli' }),
  // app icon: warm linen field, cocoa r, the OS masks its own corners (rx kept for preview)
  'app-icon-512.svg': tile({ size: 512, bg: C.linen, fg: C.cocoa, fitH: 0.62, rx: 116, label: 'rotli app icon' }),
  // social avatar: dark warm cocoa ground, knockout r — reads in a circle crop
  'social-avatar-1024.svg': tile({ size: 1024, bg: C.darkGround, fg: C.linen, fitH: 0.58, label: 'rotli avatar' }),
  // brand tiles (camino pattern): one per ground the system actually uses
  'tile-linen.svg': tile({ size: 512, bg: C.linen, fg: C.cocoa, label: 'rotli tile linen' }),
  'tile-cocoa.svg': tile({ size: 512, bg: C.darkGround, fg: C.linen, label: 'rotli tile cocoa' }),
  'tile-clay.svg': tile({ size: 512, bg: C.clay, fg: C.linen, label: 'rotli tile clay' }),
};
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
console.log('tiles →', OUT, ':', Object.keys(files).join(' · '));
