#!/usr/bin/env node
// build_retrace.mjs — SMOOTH re-trace of the quokka-r (gate feedback 2026-06-11: v1 trace had
// crooked/lumpy edges — artifacts of the 131px source, not the design).
// Method: heavy upscale + gaussian blur + mid-threshold (curvature-limited smoothing that keeps the
// edge midline, so the silhouette stays the board's) → potrace with high alphaMax/optTolerance.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { potraceTrace } from '../../../TOOLS/lib/trace.mjs';
import { cleanup } from '../../../TOOLS/lib/cleanup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'source/r-mark-tight.png');
const MASK = join(HERE, 'source/r-mark-smooth.png');

const argv = process.argv.slice(2);
const num = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : +argv[i + 1]; };
const blur = num('--blur', 10);
const alphaMax = num('--alphamax', 1.3);
const optTolerance = num('--opttol', 0.6);

// 1) smooth mask: 1200% upscale → blur → hard mid re-threshold (twice: big then small radius)
execSync(`magick "${SRC}" -colorspace Gray -filter Lanczos -resize 1200% ` +
  `-blur 0x${blur} -threshold 50% -blur 0x${Math.max(2, blur / 2)} -threshold 50% ` +
  `-bordercolor white -border 40 "${MASK}"`);

// 2) trace with relaxed corner/curve settings (fewer, longer, smoother béziers)
const raw = await potraceTrace(MASK, { alphaMax, optTolerance });
const svg = cleanup(raw);
writeFileSync(join(HERE, 'r-mark.traced.svg'), svg);
const nodes = (svg.match(/[MLCQAZ]/gi) || []).length;
console.log(`smooth retrace → r-mark.traced.svg (~${nodes} cmds, blur=${blur} alphaMax=${alphaMax} optTol=${optTolerance})`);
