// Separate music and effects stems for a later narration mix. Timings are read
// from the <audio> elements in index.html so the stems always match the film.
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { composition, root } from './composition.mjs';

const { seconds, audio } = await composition();
const stem = async (name, filter) => {
  const parts = audio.filter(filter);
  const inputs = parts.flatMap((c) => ['-i', `${root}${c.src}`]);
  const chains = parts.map((c, i) => `[${i}:a]adelay=${Math.round(c.start * 1000)}|${Math.round(c.start * 1000)},volume=${c.volume}[a${i}]`);
  const mix = `${parts.map((_, i) => `[a${i}]`).join('')}amix=inputs=${parts.length}:normalize=0:duration=longest,apad=whole_dur=${seconds},atrim=0:${seconds}[out]`;
  await mkdir(`${root}renders/stems`, { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', `${chains.join(';')};${mix}`, '-map', '[out]', '-ar', '48000', `${root}renders/stems/${name}.wav`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  console.log(`renders/stems/${name}.wav  (${parts.length} clips, ${seconds}s)`);
};
await stem('music', (c) => c.src.includes('bed'));
await stem('sfx', (c) => c.src.includes('sfx-'));
