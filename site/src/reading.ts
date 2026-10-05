// How far down an article the window is (WritingPage.astro): the share of the article's
// text that has scrolled past the top of the reading area, under the pinned header. It
// measures the article alone, not the page: the head above it, the related links and the
// footer below it do not count, so the end of the article reads 100%. It is where the
// window is, not proof that anyone read anything, and it is never recorded or sent.

export interface ArticleBox {
  /** The article's top edge, in viewport coordinates. */
  top: number;
  height: number;
}

export interface Reading {
  /** 0 at the start of the article, 1 once its last line is in view. */
  fraction: number;
  /** Whole percent, for the label. */
  percent: number;
  /** The whole article fits in the window at once, so there is nothing to track. */
  fits: boolean;
}

export function readingProgress(article: ArticleBox, viewportHeight: number, headerBottom: number): Reading {
  const visible = viewportHeight - headerBottom;
  const span = article.height - visible;
  if (span <= 0) return { fraction: 1, percent: 100, fits: true };
  const fraction = Math.min(1, Math.max(0, (headerBottom - article.top) / span));
  return { fraction, percent: Math.round(fraction * 100), fits: false };
}
