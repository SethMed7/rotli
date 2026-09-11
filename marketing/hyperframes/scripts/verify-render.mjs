// Post-render evidence: container/codec metadata, loudness and true peak, and a
// written verification report. Fails on any hard mismatch so `bun run build`
// cannot report success with a wrong file.
import { spawnSync } from 'node:child_process';
import { stat, writeFile } from 'node:fs/promises';

import { composition, root } from './composition.mjs';

const file = `${root}renders/rotli-launch-promo.mp4`;
const { seconds: declared } = await composition();
const expect = { width: 1920, height: 1080, fps: '30/1', codec: 'h264', minSeconds: declared - 0.1, maxSeconds: declared + 0.2 };

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout + r.stderr;
};

const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
const video = probe.streams.find((s) => s.codec_type === 'video');
const audio = probe.streams.find((s) => s.codec_type === 'audio');
const seconds = Number(probe.format.duration);
const problems = [];
if (video.codec_name !== expect.codec) problems.push(`video codec ${video.codec_name}`);
if (video.width !== expect.width || video.height !== expect.height) problems.push(`size ${video.width}x${video.height}`);
if (video.r_frame_rate !== expect.fps) problems.push(`fps ${video.r_frame_rate}`);
if (video.pix_fmt !== 'yuv420p') problems.push(`pix_fmt ${video.pix_fmt} (players expect yuv420p)`);
if (!audio) problems.push('no audio stream');
if (seconds < expect.minSeconds || seconds > expect.maxSeconds) problems.push(`duration ${seconds}s (composition declares ${declared}s)`);

const ebur = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).split('Summary:').pop();
const lufs = Number(ebur.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
const truePeak = Number(ebur.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
const lra = Number(ebur.match(/LRA:\s+(-?[\d.]+) LU/)?.[1]);
if (!(truePeak <= -1.0)) problems.push(`true peak ${truePeak} dBTP (clipping risk)`);

const size = (await stat(file)).size;
const report = `# Render verification — ${new Date().toISOString()}

| Check | Value |
|---|---|
| File | renders/rotli-launch-promo.mp4 (${(size / 1e6).toFixed(2)} MB) |
| Container / video | ${probe.format.format_name} · ${video.codec_name} ${video.profile ?? ''} · ${video.pix_fmt} |
| Dimensions / fps | ${video.width}×${video.height} · ${video.r_frame_rate} |
| Duration | ${seconds.toFixed(3)} s (${video.nb_frames ?? '?'} frames; composition declares ${declared} s) |
| Audio | ${audio ? `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch` : 'none'} |
| Integrated loudness | ${lufs} LUFS |
| Loudness range | ${lra} LU |
| True peak | ${truePeak} dBTP |
| Renderer tags | ${probe.format.tags?.hyperframes_renderer ?? '-'} ${probe.format.tags?.hyperframes_version ?? ''} |
| Result | ${problems.length ? `FAIL: ${problems.join('; ')}` : 'PASS'} |
`;
await writeFile(`${root}renders/verification.md`, report);
console.log(report);
if (problems.length) process.exit(1);
