// Pure viewport math for the Graph view: screen ↔ graph coordinates, fitting
// the drawing to the pane, pointer hit tests, and arrow-key travel between
// nodes. No DOM here, so every rule is unit-testable.

export interface View {
  /** Pan, in screen pixels from the pane's center. */
  x: number;
  y: number;
  /** Zoom: screen pixels per graph unit. */
  k: number;
}

export interface Point {
  id: string;
  x: number;
  y: number;
  r: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function toScreen(view: View, width: number, height: number, x: number, y: number): [number, number] {
  return [width / 2 + view.x + x * view.k, height / 2 + view.y + y * view.k];
}

export function toGraph(view: View, width: number, height: number, sx: number, sy: number): [number, number] {
  return [(sx - width / 2 - view.x) / view.k, (sy - height / 2 - view.y) / view.k];
}

/** Zoom by `factor` keeping the graph point under (sx, sy) still. */
export function zoomAt(
  view: View,
  width: number,
  height: number,
  sx: number,
  sy: number,
  factor: number,
): View {
  const k = clampZoom(view.k * factor);
  const [gx, gy] = toGraph(view, width, height, sx, sy);
  return { k, x: sx - width / 2 - gx * k, y: sy - height / 2 - gy * k };
}

/** The view that shows every point with `pad` pixels to spare, never zoomed
 * in past 1.4 (a three-note graph shouldn't fill the screen with dots). */
export function fitView(points: readonly Point[], width: number, height: number, pad = 48): View {
  if (points.length === 0 || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x - p.r);
    minY = Math.min(minY, p.y - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const k = clampZoom(Math.min(1.4, (width - pad * 2) / spanX, (height - pad * 2) / spanY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: -cx * k, y: -cy * k };
}

/** The point under graph coordinate (gx, gy), allowing `slop` graph units of
 * forgiveness so small dots stay easy to hit. Nearest wins. */
export function hitTest(points: readonly Point[], gx: number, gy: number, slop: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const p of points) {
    const distance = Math.hypot(p.x - gx, p.y - gy);
    if (distance <= p.r + slop && distance < bestDistance) {
      best = p.id;
      bestDistance = distance;
    }
  }
  return best;
}

export type Direction = "left" | "right" | "up" | "down";

const VECTORS: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** Keyboard travel: the nearest point roughly in `direction` from `from`
 * (within a 45° half-cone either side), weighting straight-ahead points. */
export function nextInDirection(points: readonly Point[], from: string, direction: Direction): string | null {
  const origin = points.find((p) => p.id === from);
  if (!origin) return null;
  const [dx, dy] = VECTORS[direction];
  let best: string | null = null;
  let bestScore = Infinity;
  for (const p of points) {
    if (p.id === from) continue;
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const distance = Math.hypot(vx, vy);
    if (distance === 0) continue;
    const along = (vx * dx + vy * dy) / distance;
    if (along < Math.SQRT1_2) continue;
    const score = distance * (2 - along);
    if (score < bestScore) {
      best = p.id;
      bestScore = score;
    }
  }
  return best;
}
