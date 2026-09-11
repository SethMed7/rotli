// Shared reader for the composition's declared timing so no script re-hardcodes
// the film length or the audio cue list. index.html is the single source.
import { readFile } from 'node:fs/promises';

export const root = new URL('..', import.meta.url).pathname;

export async function composition() {
  const html = await readFile(`${root}index.html`, 'utf8');
  const seconds = Number(html.match(/<div id="root"[^>]*data-duration="([\d.]+)"/)?.[1]);
  if (!Number.isFinite(seconds)) throw new Error('index.html: root data-duration not found');
  const audio = [];
  for (const m of html.matchAll(/<audio\b([^>]*)>/g)) {
    const attr = (n) => m[1].match(new RegExp(`${n}="([^"]*)"`))?.[1];
    audio.push({ id: attr('id'), src: attr('src'), start: Number(attr('data-start')), volume: Number(attr('data-volume') ?? 1) });
  }
  return { html, seconds, audio };
}
