// Builds every generated input for the promo from approved sources only: brand
// fonts, the canonical compact mark, pinned GSAP, and the native screen
// recordings named in edl.json `sources` (kept outside Git under _review/ —
// they can contain private frames, so only the ranges in edl.json are read).
//
// The HyperFrames renderer injects frames only for the first <video> in a
// composition's pan (later ones render blank), so the whole product section is
// ONE derived take: each EDL segment is cut, retimed, reframed to one 16:10
// frame, and concatenated here. Privacy-masked segments keep only their crop,
// set on the film's plain linen, so no framing slip in the composition can
// reveal the rest of those frames.
//
// Outputs: assets/takes/full.mp4 + full.json (segment offsets for index.html),
// renders/rotli-teaser.{mp4,webm} + poster (the silent hero loop, cross-faded
// here because it has no text or audio to compose).
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const repo = join(root, '..', '..');

const copies = [
  ['src/brand/fonts/GeneralSans-Variable.woff2', 'assets/fonts/GeneralSans-Variable.woff2'],
  ['src/brand/fonts/Baloo2-600.ttf', 'assets/fonts/Baloo2-600.ttf'],
  ['src/assets/characters/_logo.svg', 'assets/characters/logo.svg'],
  ['marketing/hyperframes/node_modules/gsap/dist/gsap.min.js', 'vendor/gsap.min.js'],
];
for (const [from, to] of copies) {
  const source = join(repo, from);
  await stat(source).catch(() => { throw new Error(`Missing approved input ${from}`); });
  await mkdir(dirname(join(root, to)), { recursive: true });
  await copyFile(source, join(root, to));
  console.log(`${to}  <-  ${from}`);
}

// Recolored copies of the compact mark (one fill attribute swapped).
const markSource = await readFile(join(repo, 'src/assets/characters/_logo.svg'), 'utf8');
if ((markSource.match(/fill="[^"]*"/g) ?? []).length !== 1) throw new Error('Expected exactly one fill on the compact mark.');
for (const [name, color] of [['logo-cocoa.svg', '#3A3028'], ['logo-linen.svg', '#F1E7DA']]) {
  await writeFile(join(root, 'assets/characters', name), markSource.replace(/fill="[^"]*"/, `fill="${color}"`));
}

const ASPECT = 1.6;
const OUT_W = 1920;
const OUT_H = 1200;
const LINEN = '0xf8f2e9';
const edl = JSON.parse(await readFile(join(root, 'edl.json'), 'utf8'));

// Each recording the EDL reads: a repo-relative path (outside Git, under _review/)
// and the rectangle inside it that crops may use (the app window, or the display
// below the menu bar). A segment names its recording with `source`.
const sources = {};
for (const [name, { file, window }] of Object.entries(edl.sources)) {
  const path = join(repo, file);
  await stat(path).catch(() => { throw new Error(`Missing recording ${file} (source "${name}")`); });
  sources[name] = { path, window };
}

/** Grow a crop to the film's 16:10 frame around its center, kept inside the window. */
function frameFor([x, y, w, h], WINDOW) {
  let fw = w;
  let fh = h;
  if (w / h > ASPECT) fh = w / ASPECT; else fw = h * ASPECT;
  fw = Math.min(fw, WINDOW[2]);
  fh = Math.min(fh, WINDOW[3]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fx = clamp(x + w / 2 - fw / 2, WINDOW[0], WINDOW[0] + WINDOW[2] - fw);
  const fy = clamp(y + h / 2 - fh / 2, WINDOW[1], WINDOW[1] + WINDOW[3] - fh);
  return [fx, fy, fw, fh].map((v) => Math.round(v / 2) * 2);
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

const encode = ['-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-g', '15', '-keyint_min', '15',
  '-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-an', '-map_metadata', '-1'];

/** One segment → a 1920×1200, 30 fps clip of (out − in) / speed (+ hold) seconds. */
async function buildSegment(seg, dir) {
  if (!seg.crop) throw new Error(`${seg.id}: no crop — every segment needs framing`);
  const source = sources[seg.source];
  if (!source) throw new Error(`${seg.id}: unknown source "${seg.source}"`);
  const [cx, cy, cw, ch] = seg.crop;
  const hold = seg.hold ? `,tpad=stop_mode=clone:stop_duration=${seg.hold}` : '';
  const retime = `setpts=(PTS-STARTPTS)/${seg.speed},fps=30${hold}`;
  let filter;
  if (seg.mask) {
    // Only the crop survives, scaled to the frame width and centered on plain linen.
    const sw = Math.round(OUT_W * 0.86 / 2) * 2;
    const sh = Math.round((sw * ch) / cw / 2) * 2;
    filter = `color=c=${LINEN}:s=${OUT_W}x${OUT_H}:r=30[bg];` +
      `[0:v]crop=${cw}:${ch}:${cx}:${cy},scale=${sw}:${sh}:flags=lanczos,${retime}[fg];` +
      `[bg][fg]overlay=x=${(OUT_W - sw) / 2}:y=${(OUT_H - sh) / 2}:shortest=1,format=yuv420p,setsar=1[v]`;
  } else {
    const [fx, fy, fw, fh] = frameFor(seg.crop, source.window);
    filter = `[0:v]crop=${fw}:${fh}:${fx}:${fy},scale=${OUT_W}:${OUT_H}:flags=lanczos,${retime},format=yuv420p,setsar=1[v]`;
  }
  const length = (seg.out - seg.in) / seg.speed + (seg.hold ?? 0);
  const file = join(dir, `${seg.id}.mp4`);
  ffmpeg(['-ss', String(seg.in), '-t', (seg.out - seg.in).toFixed(3), '-i', source.path,
    '-filter_complex', filter, '-map', '[v]', '-t', length.toFixed(3), ...encode, file]);
  return { file, length: Math.round(length * 30) / 30 };
}

const takes = join(root, 'assets/takes');
await rm(takes, { recursive: true, force: true });
await mkdir(takes, { recursive: true });

// ---- Full cut: concatenated take + the offsets index.html places captions against.
const full = [];
let offset = 0;
for (const seg of edl.full) {
  const { file, length } = await buildSegment(seg, takes);
  full.push({ id: seg.id, beat: seg.beat, at: Number(offset.toFixed(3)), length, file });
  offset += length;
}
await writeFile(join(takes, 'full.txt'), full.map((s) => `file '${s.file}'`).join('\n'));
ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(takes, 'full.txt'), ...encode, '-movflags', '+faststart', join(takes, 'full.mp4')]);
await writeFile(join(takes, 'full.json'), JSON.stringify({ seconds: Number(offset.toFixed(3)), segments: full.map(({ file, ...s }) => s) }, null, 2));
console.log(`assets/takes/full.mp4  (${full.length} segments, ${offset.toFixed(2)} s)`);
for (const s of full) console.log(`  ${s.at.toFixed(2).padStart(6)}  ${s.length.toFixed(2)}  ${s.beat.padEnd(9)} ${s.id}`);

// ---- Teaser: silent hero loop with short cross-fades, last shot fading back into the first.
const XFADE = 0.3;
const teaser = [];
for (const seg of edl.teaser) teaser.push(await buildSegment(seg, takes));
// The first shot is read twice: once to open, once (as the last input) for the loop seam.
const inputs = [...teaser, teaser[0]].flatMap((t) => ['-i', t.file]);
const chains = [];
let label = '[0:v]';
let at = teaser[0].length;
for (let i = 1; i < teaser.length; i++) {
  const out = `[x${i}]`;
  chains.push(`${label}[${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${(at - XFADE).toFixed(3)}${out}`);
  label = out;
  at += teaser[i].length - XFADE;
}
// Loop seam: the tail fades into the first shot's opening frames and the film starts
// XFADE in, so the last frame flows straight into the first and the hero loop never jumps.
chains.push(`[${teaser.length}:v]trim=end=${XFADE},setpts=PTS-STARTPTS[head];` +
  `${label}[head]xfade=transition=fade:duration=${XFADE}:offset=${(at - XFADE).toFixed(3)},trim=start=${XFADE},setpts=PTS-STARTPTS[loop]`);
await mkdir(join(root, 'renders'), { recursive: true });
const teaserMp4 = join(root, 'renders/rotli-teaser.mp4');
ffmpeg([...inputs, '-filter_complex', chains.join(';'), '-map', '[loop]', '-r', '30', '-c:v', 'libx264', '-preset', 'slow',
  '-crf', '20', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', '-map_metadata', '-1', teaserMp4]);
ffmpeg(['-i', teaserMp4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-an', join(root, 'renders/rotli-teaser.webm')]);
ffmpeg(['-ss', '0.5', '-i', teaserMp4, '-frames:v', '1', '-q:v', '3', join(root, 'renders/rotli-teaser-poster.jpg')]);
console.log(`renders/rotli-teaser.{mp4,webm}  (${teaser.length} shots, ${(at - XFADE).toFixed(2)} s loop)`);
