// Auto-pairing as a pure rule: openers insert their closer, a typed closer
// steps over the waiting one, and typing a whole well-formed string by hand
// always yields exactly that string.

import { describe, expect, test } from "bun:test";

import { autoPairEdit } from "./autoPair";

/** Replay keystrokes through the rule the way the input handler applies it;
 * returns the text with `|` at the caret. */
function type(keys: string, initial = "", caret = initial.length): string {
  let text = initial;
  let col = caret;
  for (const ch of keys) {
    const edit = autoPairEdit(text, col, ch, text.charAt(col));
    if (edit) {
      text = text.slice(0, col) + edit.insert + text.slice(col + edit.replace);
      col += edit.cursorOffset;
    } else {
      text = text.slice(0, col) + ch + text.slice(col);
      col += 1;
    }
  }
  return `${text.slice(0, col)}|${text.slice(col)}`;
}

describe("single-char pairs: [ ( `", () => {
  test("an opener inserts its closer with the caret between", () => {
    expect(type("[")).toBe("[|]");
    expect(type("(")).toBe("(|)");
    expect(type("`")).toBe("`|`");
    expect(type("[[")).toBe("[[|]]");
  });

  test("a typed closer steps over the waiting one: [] + ] is [] not []]", () => {
    expect(type("[]")).toBe("[]|");
    expect(type("()")).toBe("()|");
    expect(type("`x`")).toBe("`x`|");
  });

  test("no closer when text is glued to the caret's right; unclosed text is left alone", () => {
    expect(type("[", "word", 0)).toBe("[|word");
    expect(type("]", "a ]", 2)).toBe("a ]|]");
    expect(type("[word")).toBe("[word|]");
  });

  test("inside a backtick span nothing pairs", () => {
    expect(type("`[(")).toBe("`[(|`");
    expect(type("**", "`a", 2)).toBe("`a**|");
  });

  test("three backticks type a fence opener, never four", () => {
    expect(type("```")).toBe("```|");
    expect(type("```js")).toBe("```js|");
  });
});

describe("[[ wikilinks", () => {
  test("[[ closes to [[]] and typing the closers by hand steps over them", () => {
    expect(type("[[pric")).toBe("[[pric|]]");
    expect(type("[[Pricing]]")).toBe("[[Pricing]]|");
  });
});

describe("double delimiters: ** == ~~", () => {
  test("the second delimiter char opens a pair; the closer steps over", () => {
    expect(type("**")).toBe("**|**");
    expect(type("==hi")).toBe("==hi|==");
    expect(type("~~x~~")).toBe("~~x~~|");
    expect(type("**bold**")).toBe("**bold**|");
  });

  test("a third delimiter in an empty pair collapses: *** and ~~~ type as written", () => {
    expect(type("***")).toBe("***|");
    expect(type("~~~")).toBe("~~~|");
    expect(type("===")).toBe("===|");
  });

  test("_ and a single * never pair (snake_case, bullets, italics)", () => {
    expect(type("_")).toBe("_|");
    expect(type("snake_case")).toBe("snake_case|");
    expect(type("*")).toBe("*|");
    expect(type("* item")).toBe("* item|");
    expect(type("*x*")).toBe("*x*|");
  });

  test("a delimiter typed against text that is not an opener does nothing special", () => {
    expect(type("*", "a*", 2)).toBe("a**|");
    expect(type("2**3")).toBe("2**3|");
    expect(type("a==b")).toBe("a==b|");
    expect(type("x", "****", 2)).toBe("**x|**");
  });
});

describe("typing a well-formed line by hand yields exactly that line", () => {
  const lines = [
    "[]",
    "[ ]",
    "[x]",
    "[][]",
    "[#] ",
    "[True|False] ",
    "- [ ] task",
    "1. [x][ ] passed",
    "[text](https://example.com)",
    "[](sethmedina.com)",
    "see [[Pricing]] and [[X|shown]]",
    "`a` and `b`",
    "**bold** and **more**",
    "**a *b***",
    "*x* and **y**",
    "==a== b ~~c~~",
    "(x) and (y)",
  ];
  for (const line of lines) {
    test(JSON.stringify(line), () => {
      expect(type(line)).toBe(`${line}|`);
    });
  }
});
