// Writes every timing that depends on the cut into index.html and audio/synth.py,
// from edl.json (beats, captions, intro, ending) and assets/takes/full.json (the
// segment offsets prepare.mjs measured). Run after `bun prepare.mjs`, before audio.
import { readFile, writeFile } from 'node:fs/promises';

import { root } from './composition.mjs';

const edl = JSON.parse(await readFile(`${root}edl.json`, 'utf8'));
const take = JSON.parse(await readFile(`${root}assets/takes/full.json`, 'utf8'));
const r2 = (v) => Math.round(v * 100) / 100;

const intro = edl.intro;
const productEnd = r2(intro + take.seconds);
const promiseLength = 2.4;
const cardLength = 3.1;
const cardAt = r2(productEnd + promiseLength);
const total = r2(cardAt + cardLength);

const at = new Map(take.segments.map((s) => [s.id, r2(intro + s.at)]));
const beatStart = new Map();
for (const s of take.segments) if (!beatStart.has(s.beat)) beatStart.set(s.beat, r2(intro + s.at));
const order = [...beatStart.keys()];
const beatEnd = (beat) => {
  const next = order[order.indexOf(beat) + 1];
  return next ? beatStart.get(next) : productEnd;
};

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lines = [];
let kick = 0;
let cap = 0;
for (const { beat, kicker, captions } of edl.beats) {
  if (!beatStart.has(beat)) throw new Error(`beat "${beat}" has no segments in the take`);
  const start = beatStart.get(beat);
  const end = beatEnd(beat);
  lines.push(`      <p id="kick-${++kick}" class="kicker clip" data-start="${start}" data-duration="${r2(end - start)}" data-track-index="3">${esc(kicker)}</p>`);
  captions.forEach((c, i) => {
    const from = c.from ? at.get(c.from) : start;
    if (from === undefined) throw new Error(`caption "${c.text}" starts at unknown segment ${c.from}`);
    const next = captions[i + 1];
    const to = next ? at.get(next.from) : end;
    lines.push(`      <p id="cap-${++cap}" class="caption clip" data-start="${from}" data-duration="${r2(to - from)}" data-track-index="4">${esc(c.text)}</p>`);
  });
  lines.push('');
}

let html = await readFile(`${root}index.html`, 'utf8');
const between = (text, open, close, body) => {
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  if (a < 0 || b < a) throw new Error(`index.html: markers ${open} … ${close} not found`);
  return text.slice(0, a + open.length) + body + text.slice(b);
};
html = between(html, '<!-- BEATS:START -->\n', '      <!-- BEATS:END -->', lines.join('\n'));
const shots = take.segments.map((s) => `[${r2(intro + s.at)}, ${r2(s.length)}]`);
const shotRows = [];
for (let i = 0; i < shots.length; i += 6) shotRows.push(`        ${shots.slice(i, i + 6).join(', ')},`);
html = between(html, '// SHOTS:START\n', '        // SHOTS:END', `${shotRows.join('\n')}\n`);

const set = (re, value) => {
  if (!re.test(html)) throw new Error(`index.html: ${re} not found`);
  html = html.replace(re, (_, head) => `${head}${value}`);
};
set(/(<div id="root"[^>]*data-duration=")[\d.]+/, total);
set(/(<audio id="bed"[^>]*data-duration=")[\d.]+/, total);
set(/(<video id="take"[^>]*data-start=")[\d.]+/, intro);
set(/(<video id="take"[^>]*data-duration=")[\d.]+/, take.seconds);
set(/(<section id="both"[^>]*data-start=")[\d.]+/, productEnd);
set(/(<section id="end"[^>]*data-start=")[\d.]+/, cardAt);
set(/(fadeOut\('#product', )[\d.]+/, r2(productEnd - 0.2));
set(/(rise\('#both p:first-child', )[\d.]+/, r2(productEnd + 0.05));
set(/(rise\('#both p:last-child', )[\d.]+/, r2(productEnd + 0.65));
set(/(fadeIn\('#end > \*', )[\d.]+/, cardAt);
await writeFile(`${root}index.html`, html);

let synth = await readFile(`${root}audio/synth.py`, 'utf8');
const cue = (key, value) => {
  const re = new RegExp(`("${key}": )[^,\\n]+(,)`);
  if (!re.test(synth)) throw new Error(`synth.py: CUTS["${key}"] not found`);
  synth = synth.replace(re, `$1${value}$2`);
};
const montage = at.get(edl.music?.montage) ?? beatStart.get(order[1]) ?? intro;
cue('app', intro);
cue('playground', montage);
cue('pulse_end', r2(productEnd - 1.9));
cue('riser', r2(productEnd - 1.6));
cue('resolve', productEnd);
await writeFile(`${root}audio/synth.py`, synth);

console.log(`take ${take.seconds}s · product ${intro}–${productEnd} · film ${total}s · ${kick} kickers, ${cap} captions`);
