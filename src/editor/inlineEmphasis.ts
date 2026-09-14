// `_x_` italics — the one underscore-emphasis grammar, shared by the live
// editor, the static renderer, and both copy lanes. CommonMark flanking: the
// opening `_` is not glued to a letter, digit, or `_` on its left, the closing
// `_` is not glued to one on its right, and the content neither starts nor ends
// with whitespace. So `snake_case_name`, `file_name.md`, and `__init__` stay
// prose. A closer inside a URL still being typed (`https://x.com/a_`) never
// ends the span, so a bare link keeps its underscores. `__x__` bold is not
// supported: CommonMark would bold `__init__`. Pure — no CodeMirror, no DOM.

const WORD = String.raw`[\p{L}\p{N}_]`;
const IN_URL = String.raw`(?:https?:\/\/|www\.)\S*`;

/** Group 1 is the italic text. Needs the `u` flag — build with underscoreEm. */
const UNDERSCORE_EM_SOURCE = String.raw`(?<!${WORD})_([^_\s](?:[^_]*[^_\s])?)(?<!${IN_URL})_(?!${WORD})`;

/** A fresh `_x_` matcher; `flags` adds to the required `u` (e.g. `"g"`). */
export function underscoreEm(flags = ""): RegExp {
  return new RegExp(UNDERSCORE_EM_SOURCE, `u${flags}`);
}
