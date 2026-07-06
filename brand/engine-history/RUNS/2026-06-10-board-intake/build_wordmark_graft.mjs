#!/usr/bin/env node
// build_wordmark_graft.mjs — rotli wordmark: Baloo 2 @600 "otli" + the TRACED quokka-r grafted
// as the leading glyph (RULES/07: the supplied board is the truth; the r is traced, never re-authored).
//
// Placement is ratio-locked to the 2026-06-10 board crop (source/wordmark-tight.png, measured via
// connected-components, o ink height = 101 board-px):
//   r ink box   96 x 131 board-px, bottom 1px above o bottom (tail sits ON the baseline)
//   r -> o gap  24 board-px
// usage: node build_wordmark_graft.mjs [--nudge-x n] [--nudge-y n] [--gap n] (board-px units)
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFont, outlineWordmark } from '../../../TOOLS/lib/type.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// static instance (fonttools varLib.instancer) — opentype.js's variation.set() is a NO-OP,
// so the variable file always outlines at the 400 default master. Never trust --weight with it.
const FONT = join(HERE, '../../../BRANDS/rotli/font/Baloo2-600.ttf');
const TRACED = join(HERE, 'r-mark.traced.svg');
const COCOA = '#3A3028';

const argv = process.argv.slice(2);
const num = (flag, dflt) => { const i = argv.indexOf(flag); return i === -1 ? dflt : +argv[i + 1]; };
// board-px measurements (o ink height = 101). Nudges iterate the compare, units stay board-px.
const BOARD = {
  oH: 101,
  rH: 131,
  rW: 96,
  gap: num('--gap', 24),
  baselineLift: 1, // r bottom sits 1 board-px above o bottom
  nudgeX: num('--nudge-x', 0),
  nudgeY: num('--nudge-y', 0),
};

const font = loadFont(FONT);
if (font.tables.fvar) font.variation.set({ wght: num('--weight', 600) });
const FS = 100;
const TRACKING = num('--tracking', -0.01);

const otli = outlineWordmark(font, 'otli', FS, TRACKING);
const o = outlineWordmark(font, 'o', FS, 0); // ink box of the o alone -> the board's measuring stick
const oH = o.bb.y2 - o.bb.y1;
const u = oH / BOARD.oH; // svg units per board-px

// traced r: single path in viewBox 0 0 610 828 (ink ~fills the box; compare-iterate any error)
const traced = readFileSync(TRACED, 'utf8');
const vb = traced.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);
const d = traced.match(/ d="([^"]+)"/)[1];
const [vx, vy, vw, vh] = vb;

const s = (BOARD.rH * u) / vh;
const rBottom = o.bb.y2 - BOARD.baselineLift * u + BOARD.nudgeY * u;
const rTop = rBottom - BOARD.rH * u;
const rRight = otli.bb.x1 - BOARD.gap * u + BOARD.nudgeX * u;
const rLeft = rRight - vw * s;
const tx = rLeft - vx * s;
const ty = rTop - vy * s;

const allX1 = rLeft, allY1 = Math.min(rTop, otli.bb.y1);
const allX2 = otli.bb.x2, allY2 = Math.max(rBottom, otli.bb.y2);
const pad = 0.14 * (allY2 - allY1);
const r2 = (n) => +n.toFixed(2);
const vbOut = [allX1 - pad, allY1 - pad, allX2 - allX1 + 2 * pad, allY2 - allY1 + 2 * pad].map(r2).join(' ');

const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbOut}" role="img" aria-label="rotli" fill="${color}">
  <path fill-rule="evenodd" transform="translate(${r2(tx)} ${r2(ty)}) scale(${+s.toFixed(5)})" d="${d}"/>
  <path d="${otli.d}"/>
</svg>
`;

for (const [name, color] of [['wordmark.svg', COCOA], ['wordmark.mono.svg', '#000'], ['wordmark.mono-white.svg', '#fff']])
  writeFileSync(join(HERE, name), svg(color));

// ink-tight twin for svgshot compare (pad would misalign the 50/50 blend vs an ink-tight crop)
const vbTight = [allX1, allY1, allX2 - allX1, allY2 - allY1].map(r2).join(' ');
writeFileSync(join(HERE, 'wordmark.compare.svg'), svg(COCOA).replace(`viewBox="${vbOut}"`, `viewBox="${vbTight}"`));
console.log(`graft → wordmark.svg/.mono/.mono-white  (s=${s.toFixed(4)} gap=${BOARD.gap} nudge=${BOARD.nudgeX},${BOARD.nudgeY})`);
