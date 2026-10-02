// Build time only: the footer scenery's quokka, made from the app's own canonical line art
// (src/assets/characters/base.svg, passed in by QuokkaScene.astro) rather than a new drawing.
// The traced outline is a list of straight segments far finer than a 100-pixel character
// needs, so it is thinned here (Douglas–Peucker, well under a pixel at that size) and written
// as compact relative path data. The outermost ring of the outline is the character's
// silhouette: filled on its own it is the body colour under the ink, the same two layers as
// the app's filled poses.

type Point = [number, number];

/** Under a tenth of a pixel at the scene's largest quokka (1254 units → ~120 px). */
const TOLERANCE = 1.4;

function rings(d: string): Point[][] {
  const out: Point[][] = [];
  let ring: Point[] = [];
  for (const [, command, args] of d.matchAll(/([MLZ])([^MLZ]*)/gi)) {
    const values = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (command.toUpperCase() === 'M') {
      if (ring.length > 0) out.push(ring);
      ring = [];
    }
    if (command.toUpperCase() === 'Z') {
      if (ring.length > 0) out.push(ring);
      ring = [];
      continue;
    }
    for (let i = 0; i + 1 < values.length; i += 2) ring.push([values[i], values[i + 1]]);
  }
  if (ring.length > 0) out.push(ring);
  return out;
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring split at its far point, so both halves simplify cleanly. */
function simplifyRing(ring: Point[]): Point[] {
  const [sx, sy] = ring[0];
  let far = 0;
  ring.forEach(([x, y], i) => {
    if (Math.hypot(x - sx, y - sy) > Math.hypot(ring[far][0] - sx, ring[far][1] - sy)) far = i;
  });
  if (far === 0) return ring;
  const a = simplify(ring.slice(0, far + 1), TOLERANCE);
  const b = simplify([...ring.slice(far), ring[0]], TOLERANCE);
  return [...a, ...b.slice(1, -1)];
}

function compact(ring: Point[]): string {
  const round = (n: number) => Math.round(n);
  let d = `M${round(ring[0][0])} ${round(ring[0][1])}l`;
  let [px, py] = [round(ring[0][0]), round(ring[0][1])];
  const parts: string[] = [];
  for (const [x, y] of ring.slice(1)) {
    const [rx, ry] = [round(x), round(y)];
    parts.push(`${rx - px}`, `${ry - py}`);
    [px, py] = [rx, ry];
  }
  // Negative numbers carry their own separator.
  d += parts.reduce((acc, part, i) => acc + (i > 0 && !part.startsWith('-') ? ' ' : '') + part, '');
  return `${d}z`;
}

const area = (ring: Point[]) => {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

/** The ink (every ring, filled even-odd like the source) and the body (the outer ring alone). */
export function quokkaArt(svg: string): { line: string; silhouette: string } {
  const source = svg.match(/\sd="([^"]+)"/)?.[1];
  if (!source) throw new Error('quokka art: the source SVG has no path data');
  const all = rings(source).map(simplifyRing);
  const outer = all.reduce((best, ring) => (area(ring) > area(best) ? ring : best));
  return { line: all.map(compact).join(''), silhouette: compact(outer) };
}
