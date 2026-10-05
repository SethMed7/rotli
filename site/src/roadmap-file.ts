// ROADMAP.md's text for the build: the /roadmap/ page, its Markdown twin, and the
// build's guard (astro.config.mjs). Builds run from site/ (locally, the Dockerfile,
// the site E2E lane) or from the repository root, so both are tried. The Dockerfile
// copies ROADMAP.md beside site/ for exactly this.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readRoadmapFile(): string {
  const candidates = [join(process.cwd(), 'ROADMAP.md'), join(process.cwd(), '..', 'ROADMAP.md')];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`ROADMAP.md not found (looked in ${candidates.join(', ')})`);
  return readFileSync(found, 'utf8');
}
