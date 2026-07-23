export interface MermaidViewport {
  x: number;
  y: number;
  scale: number;
}

export interface MermaidPoint {
  x: number;
  y: number;
}

export const MERMAID_MIN_SCALE = 0.1;
export const MERMAID_MAX_SCALE = 4;
export const MERMAID_MAX_FIT_SCALE = 2;

export function clampMermaidScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, scale));
}

export function panMermaidViewport(viewport: MermaidViewport, delta: MermaidPoint): MermaidViewport {
  return {
    ...viewport,
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
  };
}

/** Keep the diagram point under `anchor` stationary while zoom changes. */
export function zoomMermaidViewportAt(
  viewport: MermaidViewport,
  requestedScale: number,
  anchor: MermaidPoint,
): MermaidViewport {
  const scale = clampMermaidScale(requestedScale);
  const previous = clampMermaidScale(viewport.scale);
  const ratio = scale / previous;
  return {
    scale,
    x: anchor.x - (anchor.x - viewport.x) * ratio,
    y: anchor.y - (anchor.y - viewport.y) * ratio,
  };
}

export function fitMermaidViewport(
  viewportSize: MermaidPoint,
  contentSize: MermaidPoint,
  padding = 36,
): MermaidViewport {
  if (viewportSize.x <= 0 || viewportSize.y <= 0 || contentSize.x <= 0 || contentSize.y <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const usableWidth = Math.max(1, viewportSize.x - padding * 2);
  const usableHeight = Math.max(1, viewportSize.y - padding * 2);
  const scale = clampMermaidScale(
    Math.min(MERMAID_MAX_FIT_SCALE, usableWidth / contentSize.x, usableHeight / contentSize.y),
  );
  return {
    scale,
    x: (viewportSize.x - contentSize.x * scale) / 2,
    y: (viewportSize.y - contentSize.y * scale) / 2,
  };
}
