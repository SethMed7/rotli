#!/usr/bin/env node
// build_flow_bottom.mjs — gate round 2 feedback (the maintainer, 2026-06-11): the stem's bottom terminal was a
// flat chord ("the bottom has a flat part — everything should flow"). Surgery, not re-trace: replace
// the flat run (3 trace segments at max-y) with ONE cubic, tangent-matched to both neighbors
// (G1-continuous), dipping ~20 units below the old flat — a flowing round terminal w/ baseline overshoot.
// Reads r-mark.traced.svg in place; rerun build_wordmark_graft.mjs after.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'r-mark.traced.svg');
const svg = readFileSync(FILE, 'utf8');
const d = svg.match(/ d="([^"]+)"/)[1];

// --- parse: M + relative cubics -> absolute segment list
const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
let i = 0, x = 0, y = 0, cmd = '';
const segs = [];
while (i < tokens.length) {
  if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
  if (cmd === 'M') { x = +tokens[i++]; y = +tokens[i++]; segs.push(['M', x, y]); cmd = 'c'; continue; }
  if (cmd === 'c') {
    const s = ['C', x + +tokens[i++], y + +tokens[i++], x + +tokens[i++], y + +tokens[i++], x + +tokens[i++], y + +tokens[i++]];
    segs.push(s); x = s[5]; y = s[6];
  }
}

// --- locate the flat bottom: the maximal run of consecutive segs whose endpoints sit within
// 4 units of the path's max y (the trace's flat chord + its two corner stubs)
const maxY = Math.max(...segs.filter(s => s[0] === 'C').map(s => s[6]));
let runStart = -1, runEnd = -1;
for (let n = 1; n < segs.length; n++) {
  const flat = segs[n][0] === 'C' && segs[n][6] > maxY - 4;
  if (flat && runStart === -1) runStart = n;
  if (flat) runEnd = n;
  if (!flat && runStart !== -1 && runEnd >= runStart) break;
}
// include the corner stub after the flat (the short rise, e.g. ...1612 -> 1609.4)
if (segs[runEnd + 1] && segs[runEnd + 1][6] > maxY - 45) runEnd += 1;
if (runStart === -1) { console.error('no flat bottom found — nothing to do'); process.exit(1); }

const before = segs[runStart - 1]; // tangent donor, left side
const after = segs[runEnd + 1];   // tangent donor, right side
const P0 = [before[5], before[6]];
const P1 = [segs[runEnd][5], segs[runEnd][6]];
const tIn = [P0[0] - before[3], P0[1] - before[4]];   // exit tangent of `before`
const tOut = [after[1] - P1[0], after[2] - P1[1]];    // entry tangent of `after`
const norm = (v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l]; };
const nIn = norm(tIn), nOut = norm(tOut);
const span = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
const h = span * 0.42; // handle length: generous, keeps the bowl full but smooth
const c1 = [P0[0] + nIn[0] * h, P0[1] + nIn[1] * h];
const c2 = [P1[0] - nOut[0] * h, P1[1] - nOut[1] * h];
const flow = ['C', c1[0], c1[1], c2[0], c2[1], P1[0], P1[1]];
console.log(`flat run segs ${runStart}–${runEnd} (y≈${maxY.toFixed(0)}) → one flowing cubic`,
  flow.slice(1).map(v => v.toFixed(1)).join(' '));

const out = [...segs.slice(0, runStart), flow, ...segs.slice(runEnd + 1)];

// --- emit absolute path + grow viewBox if the bowl dips past it
const r2 = (n) => +n.toFixed(2);
const dOut = out.map(s => s[0] === 'M' ? `M${r2(s[1])} ${r2(s[2])}` :
  `C${r2(s[1])} ${r2(s[2])} ${r2(s[3])} ${r2(s[4])} ${r2(s[5])} ${r2(s[6])}`).join('') + 'Z';
const apexY = Math.max(c1[1], c2[1], P1[1]); // hull bound, safe over-estimate
const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
if (apexY > vb[1] + vb[3]) vb[3] = Math.ceil(apexY - vb[1] + 2);
writeFileSync(FILE, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}"><path fill-rule="evenodd" d="${dOut}"/></svg>\n`);
console.log(`→ r-mark.traced.svg (viewBox ${vb.join(' ')})`);
