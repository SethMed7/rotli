export const DOCUMENT_PAGE_WIDTH = 816;
export const DOCUMENT_PAGE_GUTTER = 96;

/** Fit a Word page and its canvas gutter into the pane without horizontal pan. */
export function documentFitZoom(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.min(1, Math.max(0.1, viewportWidth / (DOCUMENT_PAGE_WIDTH + DOCUMENT_PAGE_GUTTER)));
}
