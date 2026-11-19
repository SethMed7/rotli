// One answer per document: a CodeMirror `Text` never changes, so a pure scan of
// it can be computed once and shared by every consumer of that edit.

import type { Text } from "@codemirror/state";

/** `scan`, memoized per document (weakly, so old documents are collected).
 * The answer is shared between callers, so it is readonly. */
export function memoPerDoc<T>(scan: (doc: Text) => T[]): (doc: Text) => readonly T[] {
  const answers = new WeakMap<Text, readonly T[]>();
  return (doc) => {
    let answer = answers.get(doc);
    if (!answer) {
      answer = scan(doc);
      answers.set(doc, answer);
    }
    return answer;
  };
}
