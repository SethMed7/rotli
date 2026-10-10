// The quokka mark (the app's own src/assets/characters/_logo.svg), as every page inlines it. The
// file has only a viewBox, so a page painted before its stylesheet arrived showed it as wide as
// the window, in link blue (the owner, 2026-10-08: "a giant blue logo" on a slow refresh). The
// mark carries a size of its own here; each place that shows it still sizes it in CSS.
import raw from '../../src/assets/characters/_logo.svg?raw';

export const mark = raw.replace('<svg ', '<svg width="28" height="28" ');
