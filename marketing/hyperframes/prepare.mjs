// Copies canonical brand inputs into the ignored assets/ tree so the
// composition never reaches outside marketing/hyperframes at render time.
// Approved inputs only: brand fonts, the synthetic site captures, the canonical
// character drawings, and the pinned GSAP runtime from node_modules.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const repo = join(root, '..', '..');

const copies = [
  // fonts (Fontshare free license for General Sans; Baloo 2 is OFL — see HYPERFRAMES.md)
  ['src/brand/fonts/GeneralSans-Variable.woff2', 'assets/fonts/GeneralSans-Variable.woff2'],
  ['src/brand/fonts/Baloo2-600.ttf', 'assets/fonts/Baloo2-600.ttf'],
  // synthetic app captures (1280x800 logical at 3x; Playground 1440x900 at 3x)
  ['site/public/rotli-app-warm-light@3x.png', 'assets/captures/app-warm-light.png'],
  ['site/public/rotli-app-paper@3x.png', 'assets/captures/app-paper.png'],
  ['site/public/rotli-app-ocean-light@3x.png', 'assets/captures/app-ocean-light.png'],
  ['site/public/rotli-app-grove-dark@3x.png', 'assets/captures/app-grove-dark.png'],
  ['site/public/rotli-app-iris-light@3x.png', 'assets/captures/app-iris-light.png'],
  ['site/public/rotli-app-midnight@3x.png', 'assets/captures/app-midnight.png'],
  ['site/public/rotli-playground@3x.png', 'assets/captures/playground.png'],
  // synthetic interaction recording handed over by the parent
  // (`bun run capture:launch` at the repository root regenerates them; the
  // _review/ folder is ignored by Git, so a fresh checkout must run that first)
  ['_review/launch-captures/playground-interactions.mp4', 'assets/captures/playground-interactions.mp4'],
  // canonical characters
  ['src/assets/characters/_logo.svg', 'assets/characters/logo.svg'],
  // pinned animation runtime, served locally (no CDN fetch during render)
  ['marketing/hyperframes/node_modules/gsap/dist/gsap.min.js', 'vendor/gsap.min.js'],
];

for (const [from, to] of copies) {
  const source = join(repo, from);
  const target = join(root, to);
  await stat(source).catch(() => {
    throw new Error(`Missing approved input ${from}${from.startsWith('_review/') ? ' — run `bun run capture:launch` at the repository root first' : ''}`);
  });
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`${to}  <-  ${from}`);
}

// Recolored copies of the compact mark. Geometry is untouched; only the single
// fill attribute changes so the mark can sit in cocoa on linen and linen on the
// dark end card without inlining the path into the composition.
const markSource = await readFile(join(repo, 'src/assets/characters/_logo.svg'), 'utf8');
if ((markSource.match(/fill="[^"]*"/g) ?? []).length !== 1) throw new Error('Expected exactly one fill on the compact mark.');
for (const [name, color] of [['logo-cocoa.svg', '#3A3028'], ['logo-linen.svg', '#F1E7DA']]) {
  await writeFile(join(root, 'assets/characters', name), markSource.replace(/fill="[^"]*"/, `fill="${color}"`));
  console.log(`assets/characters/${name}  <-  _logo.svg recolored ${color}`);
}

// The HyperFrames renderer injected frames only for the first <video> inside the
// Playground pan; every later <video> (own file, dense keyframes, own data-start)
// rendered blank for its whole slot while `snapshot` showed it correctly. So the
// Playground beat is ONE derived take driving ONE <video>: ffmpeg cuts the approved
// recording at the source times the film needs and bakes each editorial hold in as
// a frozen frame of the recording itself (exact pixels, so the holds are invisible
// continuations). Source event times (frame-differenced): tick 2.43, Raw 4.57,
// back 6.43, save 6.97, Chat 9.17, static afterwards. The film shows the take from
// 12.4 s, so film time = 12.4 + take offset.
const recording = join(root, 'assets/captures/playground-interactions.mp4');
const take = [
  // [kind, sourceSeconds, lengthSeconds]           take offset  → film time / event
  ['freeze', 1.2, 2.0],  // full lesson, before any interaction   0.0–2.0     12.4–14.4
  ['play', 1.2, 5.1],    // tick at +1.23, Raw Markdown at +3.37   2.0–7.1     tick 15.63, Raw 17.77
  ['freeze', 5.5, 1.3],  // Raw Markdown hold                      7.1–8.4
  ['play', 6.3, 0.4],    // toggle back at +0.13                   8.4–8.8     back 20.93
  ['freeze', 6.8, 0.8],  // restored rendered view                 8.8–9.6
  ['play', 6.7, 1.3],    // Save lesson to vault at +0.27          9.6–10.9    save 22.27
  ['freeze', 7.6, 2.1],  // Lesson saved / Your copy is in Main    10.9–13.0
  ['play', 8.6, 2.4],    // Chat at +0.57, then static             13.0–15.4   Chat 25.97
  ['freeze', 10.0, 3.4], // Chat front hold                        15.4–18.8
];
const inputs = [];
const chains = [];
let freezeIndex = 0;
for (const [i, [kind, at, seconds]] of take.entries()) {
  if (kind === 'freeze') {
    const png = join(root, 'assets/captures', `play-freeze-${++freezeIndex}.png`);
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(at), '-i', recording, '-frames:v', '1', png], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`ffmpeg freeze frame failed at ${at}s`);
    inputs.push('-loop', '1', '-t', String(seconds), '-i', png);
    chains.push(`[${inputs.filter((a) => a === '-i').length}:v]fps=30,format=yuv420p,setsar=1[s${i}]`);
  } else {
    chains.push(`[0:v]trim=start=${at}:end=${(at + seconds).toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,setsar=1[s${i}]`);
  }
}
const total = take.reduce((sum, [, , seconds]) => sum + seconds, 0);
const target = join(root, 'assets/captures/play-take.mp4');
const concat = `${chains.join(';')};${take.map((_, i) => `[s${i}]`).join('')}concat=n=${take.length}:v=1:a=0[out]`;
const built = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', recording, ...inputs, '-filter_complex', concat, '-map', '[out]',
  '-r', '30', '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
  '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-map_metadata', '-1', target], { stdio: 'inherit' });
if (built.status !== 0) throw new Error('ffmpeg take build failed');
console.log(`assets/captures/play-take.mp4  <-  playground-interactions.mp4 (${take.length} segments, ${total.toFixed(1)}s, ${freezeIndex} frozen frames)`);
