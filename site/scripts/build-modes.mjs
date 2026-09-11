// Builds every SITE_MODE (or the ones named on the command line) into
// dist/<mode>/ so the outputs can be compared side by side. Each build inherits
// the current environment (SITE_URL, SOURCE_REPOSITORY_PUBLIC) and only sets
// SITE_MODE and CI. This is a review aid; deployments still run `astro build`
// with Railway's service variables.
//
//   bun run build:modes                 # full, dev, coming-soon
//   bun run build:modes dev coming-soon # a subset

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODES = ['full', 'dev', 'coming-soon'];
const requested = process.argv.slice(2);
const unknown = requested.filter((mode) => !MODES.includes(mode));
if (unknown.length > 0) {
  console.error(`Unknown SITE_MODE value(s): ${unknown.join(', ')}. Expected ${MODES.join(', ')}.`);
  process.exit(2);
}
const modes = requested.length > 0 ? requested : MODES;
const siteDir = fileURLToPath(new URL('..', import.meta.url));

for (const mode of modes) {
  console.log(`\n=== astro build · SITE_MODE=${mode} → dist/${mode}/`);
  const result = spawnSync('bunx', ['astro', 'build', '--outDir', `dist/${mode}`], {
    cwd: siteDir,
    stdio: 'inherit',
    env: { ...process.env, SITE_MODE: mode, CI: 'true' },
  });
  if (result.status !== 0) {
    console.error(`Build failed for SITE_MODE=${mode}.`);
    process.exit(result.status ?? 1);
  }
}
