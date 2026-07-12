export const DOCUMENT_PAGE_WIDTH = 816;
export const DOCUMENT_PAGE_HEIGHT = 1056;
export const DOCUMENT_PAGE_GUTTER = 96;
export const DOCUMENT_PAGE_VERTICAL_GUTTER = 40;

/** Fit one complete Word page into the pane on open and resize. */
export function documentFitZoom(viewportWidth: number, viewportHeight?: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  const widthRatio = viewportWidth / (DOCUMENT_PAGE_WIDTH + DOCUMENT_PAGE_GUTTER);
  const heightRatio = Number.isFinite(viewportHeight) && (viewportHeight ?? 0) > 0
    ? (viewportHeight as number) / (DOCUMENT_PAGE_HEIGHT + DOCUMENT_PAGE_VERTICAL_GUTTER)
    : 1;
  return Math.min(1, Math.max(0.1, Math.min(widthRatio, heightRatio)));
}
