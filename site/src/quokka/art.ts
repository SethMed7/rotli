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

/**
 * The traced poses (waving.svg, celebrating.svg) are potrace output: one path of absolute and
 * relative moves, relative cubics and lines, in a 10 240-unit flipped space under the root
 * group's transform. They arrive with their decoration (celebrating's confetti) as separate
 * rings outside the body. This keeps every ring whose start lies inside the outline (the
 * outline itself, the face, the paws) and drops the rest, rewriting each kept ring to start
 * with an absolute move so it no longer depends on the ring before it. The outline alone is
 * also returned as the silhouette that takes the body colour.
 */
export function tracedPose(svg: string): { line: string; silhouette: string; transform: string; viewBox: number } {
  const d = svg.match(/\sd="([^"]+)"/)?.[1];
  const transform = svg.match(/<g transform="([^"]+)"/)?.[1];
  const viewBox = Number(svg.match(/viewBox="0 0 ([\d.]+)/)?.[1]);
  if (!d || !transform || !viewBox) throw new Error('quokka art: not a traced pose');
  const tokens = d.match(/[MmCcLlZz]|-?\d*\.?\d+/g) ?? [];
  type Ring = { start: Point; points: Point[]; body: string };
  const out: Ring[] = [];
  let ring: Ring | null = null;
  let [x, y] = [0, 0];
  let [sx, sy] = [0, 0];
  let command = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) command = tokens[i++]!;
    if (command === 'z' || command === 'Z') {
      if (ring) ring.body += 'z';
      [x, y] = [sx, sy];
      continue;
    }
    if (command === 'M' || command === 'm') {
      const [dx, dy] = [num(), num()];
      [x, y] = command === 'M' ? [dx, dy] : [x + dx, y + dy];
      [sx, sy] = [x, y];
      ring = { start: [x, y], points: [[x, y]], body: '' };
      out.push(ring);
      command = command === 'M' ? 'L' : 'l';
      continue;
    }
    if (!ring) break;
    if (command === 'c') {
      const values = [num(), num(), num(), num(), num(), num()];
      ring.body += `c${values.join(' ')}`;
      [x, y] = [x + values[4]!, y + values[5]!];
    } else if (command === 'l') {
      const [dx, dy] = [num(), num()];
      ring.body += `l${dx} ${dy}`;
      [x, y] = [x + dx, y + dy];
    } else {
      throw new Error(`quokka art: unexpected command ${command}`);
    }
    ring.points.push([x, y]);
  }
  const outer = out.reduce((best, r) => (area(r.points) > area(best.points) ? r : best));
  const inside = ([px, py]: Point) => {
    let hit = false;
    const pts = outer.points;
    for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
      const [ax, ay] = pts[a]!;
      const [bx, by] = pts[b]!;
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  const kept = out.filter((r) => r === outer || inside(r.start));
  const path = (r: Ring) => `M${r.start[0]} ${r.start[1]}${r.body}`;
  return {
    line: kept.map(path).join(''),
    // The outline alone, filled, is the body colour under the line (as quokkaArt's is).
    silhouette: path(outer),
    transform,
    viewBox,
  };
}
