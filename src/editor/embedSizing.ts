export const EMBED_DEFAULT_HEIGHT = 240;
export const EMBED_MIN_HEIGHT = 180;
export const EMBED_MAX_HEIGHT = 960;
export const EMBED_VIEWPORT_GUTTER = 32;

export interface EmbedSizeState {
  height: number;
  collapsedHeight: number;
  expanded: boolean;
}

export function embedHeightLimit(viewportHeight: number): number {
  return Math.max(
    EMBED_MIN_HEIGHT,
    Math.min(EMBED_MAX_HEIGHT, Math.round(viewportHeight - EMBED_VIEWPORT_GUTTER)),
  );
}

export function clampEmbedHeight(height: number, viewportHeight: number): number {
  return Math.max(EMBED_MIN_HEIGHT, Math.min(embedHeightLimit(viewportHeight), Math.round(height)));
}

export function createEmbedSizeState(height = EMBED_DEFAULT_HEIGHT): EmbedSizeState {
  const safeHeight = Math.max(EMBED_MIN_HEIGHT, Math.round(height));
  return { height: safeHeight, collapsedHeight: safeHeight, expanded: false };
}

export function toggleEmbedExpanded(
  state: EmbedSizeState,
  viewportHeight: number,
): EmbedSizeState {
  if (state.expanded) {
    const height = clampEmbedHeight(state.collapsedHeight, viewportHeight);
    return { height, collapsedHeight: height, expanded: false };
  }
  return {
    height: embedHeightLimit(viewportHeight),
    collapsedHeight: clampEmbedHeight(state.height, viewportHeight),
    expanded: true,
  };
}

export function resizeEmbed(
  state: EmbedSizeState,
  height: number,
  viewportHeight: number,
): EmbedSizeState {
  const nextHeight = clampEmbedHeight(height, viewportHeight);
  return { ...state, height: nextHeight, collapsedHeight: nextHeight, expanded: false };
}

export function fitExpandedEmbed(
  state: EmbedSizeState,
  viewportHeight: number,
): EmbedSizeState {
  if (!state.expanded) return state;
  return { ...state, height: embedHeightLimit(viewportHeight) };
}
