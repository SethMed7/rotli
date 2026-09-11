// Derives WebVTT and SRT sidecars from the caption clips in index.html so the
// composition stays the single source of truth for on-screen text and timing.
// A cue is any element with class "caption" (text = its content) or with a
// data-cue attribute (text = the attribute), plus data-start and data-duration.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const html = await readFile(`${root}index.html`, 'utf8');

const cues = [];
const openTag = /<(p|section)\b([^>]*)>/g;
for (const match of html.matchAll(openTag)) {
  const [whole, name, attrs] = match;
  const attr = (n) => attrs.match(new RegExp(`${n}="([^"]*)"`))?.[1];
  const isCaption = /class="[^"]*\bcaption\b/.test(attrs);
  const cue = attr('data-cue');
  if (!isCaption && !cue) continue;
  const after = html.slice(match.index + whole.length);
  const inner = after.slice(0, after.indexOf(`</${name}>`));
  const start = Number(attr('data-cue-start') ?? attr('data-start'));
  const duration = Number(attr('data-cue-duration') ?? attr('data-duration'));
  if (!Number.isFinite(start) || !Number.isFinite(duration)) throw new Error(`Cue without numeric timing: ${attrs}`);
  const text = (cue ?? inner.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();
  cues.push({ start, end: start + duration, text });
}
cues.sort((a, b) => a.start - b.start);
if (cues.length === 0) throw new Error('No caption cues found in index.html');

const pad = (n, w) => String(n).padStart(w, '0');
const stamp = (seconds, sep) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
};

const vtt = ['WEBVTT', '', ...cues.flatMap((c, i) => [`${i + 1}`, `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}`, c.text, ''])].join('\n');
const srt = cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
await mkdir(`${root}renders`, { recursive: true });
await writeFile(`${root}renders/rotli-launch-promo.vtt`, vtt);
await writeFile(`${root}renders/rotli-launch-promo.srt`, srt);
console.log(`${cues.length} cues -> renders/rotli-launch-promo.vtt, renders/rotli-launch-promo.srt`);
for (const c of cues) console.log(`  ${c.start.toFixed(2).padStart(6)}–${c.end.toFixed(2).padStart(6)}  ${c.text.replace(/\n/g, ' / ')}`);
