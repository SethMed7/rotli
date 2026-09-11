// Evidence that the effects are audible in the delivered mix and that the bed
// ends by decaying rather than stopping: compares short-window RMS in the MP4
// against the music-only stem at each SFX cue read from index.html, then
// meters the final half second.
import { spawnSync } from 'node:child_process';

import { composition, root } from './composition.mjs';

const { seconds, audio } = await composition();
const rms = (file, at, len = 0.25) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-ss', String(at), '-t', String(len), '-i', file, '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' });
  return Number((r.stdout + r.stderr).match(/RMS level dB:\s*(-?[\d.]+)/)?.[1]);
};
const mp4 = `${root}renders/rotli-launch-promo.mp4`;
const music = `${root}renders/stems/music.wav`;
console.log('cue          t(s)   mix RMS dB   music-only RMS dB   lift dB');
for (const c of audio.filter((c) => c.src.includes('sfx-'))) {
  const mix = rms(mp4, c.start);
  const bed = rms(music, c.start);
  console.log(`${c.id.padEnd(11)} ${c.start.toFixed(2).padStart(6)}   ${mix.toFixed(1).padStart(8)}   ${bed.toFixed(1).padStart(15)}   ${(mix - bed).toFixed(1).padStart(7)}`);
}
console.log(`\ntail: last 0.5 s RMS ${rms(mp4, seconds - 0.5, 0.5).toFixed(1)} dB · last 0.1 s RMS ${rms(mp4, seconds - 0.1, 0.1).toFixed(1)} dB (mid-film reference ${rms(mp4, seconds / 2, 0.5).toFixed(1)} dB)`);
