// The text-grammar keymap, exercised through a minimal fake view (the commands
// only read view.state and call view.dispatch). press() mirrors CodeMirror's
// precedence: bindings for a key run in rotliKeymap order until one consumes.
// Locks the paper-cut sweep fixes (2026-07-27): fenced code is grammar-free,
// numbered lists renumber on Enter (listNumbers.ts), the empty-item exit ramp needs the caret
// past the marker, the task shorthand normalizes tabs and upgrades bullets,
// and Tab is never stuck on a ragged table row.

import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { rotliKeymap } from "./cmKeymap";
import { listNumbering } from "./listNumbers";

type FakeView = EditorView & { state: EditorState };

function viewOf(doc: string, head: number, anchor = head): FakeView {
  // the renumbering filter rides along, as it does in the real editor
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [listNumbering],
  });
  return {
    get state() {
      return state;
    },
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as unknown as FakeView;
}

function press(view: FakeView, key: string, shift = false): boolean {
  for (const b of rotliKeymap) {
    if (b.key !== key) continue;
    const run = shift ? b.shift : b.run;
    if (run?.(view as EditorView)) return true;
  }
  return false;
}

/** Typing a run of characters (CM's default input) — lets a test replay a whole
 * keystroke flow, not just one command. */
function typeText(view: FakeView, s: string): void {
  view.dispatch(view.state.replaceSelection(s));
}

const text = (view: FakeView) => view.state.doc.toString();
const head = (view: FakeView) => view.state.selection.main.head;

describe("fenced code is grammar-free (#8)", () => {
  test("Space after any task-state token inside a fence types normally", () => {
    for (const token of ["[]", "[/]", "[x]"]) {
      const doc = `\`\`\`js\n${token}\n\`\`\``;
      const v = viewOf(doc, doc.indexOf(token) + token.length);
      expect(press(v, "Space")).toBe(false);
      expect(text(v)).toBe(doc);
    }
  });

  test("Enter after a dash line inside a fence never continues a list", () => {
    const doc = "```yaml\n- item\n```";
    const v = viewOf(doc, doc.indexOf("- item") + 6);
    expect(press(v, "Enter")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Space after [][] inside a fence types normally (never becomes a result)", () => {
    const doc = "```js\n[][]\n```";
    const v = viewOf(doc, doc.indexOf("[][]") + 4);
    expect(press(v, "Space")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Space after () inside a fence types normally (never becomes a choice)", () => {
    const doc = "```js\n()\n```";
    const v = viewOf(doc, doc.indexOf("()") + 2);
    expect(press(v, "Space")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Tab on a dash line inside a fence is a soft tab at the caret, not a line indent", () => {
    const doc = "```yaml\n- item\n```";
    const at = doc.indexOf("- item") + 6;
    const v = viewOf(doc, at);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("```yaml\n- item  \n```");
  });
});

describe("numbered lists renumber on Enter (#9)", () => {
  test("inserting an item mid-list bumps every following sibling", () => {
    const doc = "1. alpha\n2. beta\n3. gamma";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. alpha\n2. \n3. beta\n4. gamma");
  });

  test("nested deeper items ride along untouched; renumbering stops at the list's end", () => {
    const doc = "1. alpha\n  1. deep\n2. beta\n\n1. other";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. alpha\n2. \n  1. deep\n3. beta\n\n1. other");
  });

  test("bullet Enter still carries a plain marker (no renumber pass)", () => {
    const doc = "- alpha\n- beta";
    const v = viewOf(doc, doc.indexOf("alpha") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- alpha\n- \n- beta");
  });

  test("an ordered task continues counting up AND resets to unchecked (2026-08-03)", () => {
    const doc = "1. [x] done step\n2. [ ] next step";
    const v = viewOf(doc, doc.indexOf("done step") + 9);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. [x] done step\n2. [ ] \n3. [ ] next step");
  });
});

describe("the empty-item exit ramp needs the caret past the marker (#11)", () => {
  test("Enter at column 0 of an empty item falls through (default newline above)", () => {
    const doc = "- alpha\n- ";
    const v = viewOf(doc, doc.indexOf("\n") + 1); // start of line 2
    expect(press(v, "Enter")).toBe(false);
    expect(text(v)).toBe(doc);
  });

  test("Enter after the marker of an empty item still exits the list", () => {
    const doc = "- alpha\n- ";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- alpha\n");
  });
});

describe("the []+Space task shorthand (#14, #15)", () => {
  test("preserves explicit in-progress and done states while adding the portable list marker", () => {
    const cases = [
      { source: "[/]", expected: "- [/] " },
      { source: "- [/]", expected: "- [/] " },
      { source: "[x]", expected: "- [x] " },
      { source: "[X]", expected: "- [x] " },
      { source: "- [x]", expected: "- [x] " },
    ];

    for (const { source, expected } of cases) {
      const view = viewOf(source, source.length);
      expect(press(view, "Space")).toBe(true);
      expect(text(view)).toBe(expected);
      expect(head(view)).toBe(expected.length);
    }
  });

  test("normalizes a pasted tab indent into spaces so the task is a real task", () => {
    const doc = "\t[]";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("  - [ ] ");
  });

  test("upgrades an existing bullet: '- []'+Space becomes a task", () => {
    const doc = "- []";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("- [ ] ");
    expect(head(v)).toBe(6);
  });

  test("an indented bullet upgrades in place", () => {
    const doc = "  - []";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Space")).toBe(true);
    expect(text(v)).toBe("  - [ ] ");
  });
});

describe("the [][]+Space result shorthand", () => {
  test("creates an unanswered exclusive result without changing [] tasks", () => {
    const result = viewOf("[][]", 4);
    expect(press(result, "Space")).toBe(true);
    expect(text(result)).toBe("- [ ][ ] ");
    expect(head(result)).toBe(9);

    const task = viewOf("[]", 2);
    expect(press(task, "Space")).toBe(true);
    expect(text(task)).toBe("- [ ] ");
  });

  test("adds portable list structure to labeled result controls", () => {
    const result = viewOf("[True][False]", 13);
    expect(press(result, "Space")).toBe(true);
    expect(text(result)).toBe("- [True][False] ");
    expect(head(result)).toBe(16);
  });

  test("normalizes indent and upgrades an existing bullet", () => {
    const tabbed = viewOf("\t[][]", 5);
    expect(press(tabbed, "Space")).toBe(true);
    expect(text(tabbed)).toBe("  - [ ][ ] ");

    const bullet = viewOf("- [][]", 6);
    expect(press(bullet, "Space")).toBe(true);
    expect(text(bullet)).toBe("- [ ][ ] ");
  });

  test("Enter continues a test suite with an unanswered pair", () => {
    const doc = "- [ ][x] API boots";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- [ ][x] API boots\n- [ ][ ] ");
  });

  test("ordered result rows count up and renumber following siblings", () => {
    const doc = "1. [x][ ] first\n2. [ ][x] second";
    const v = viewOf(doc, doc.indexOf("first") + 5);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. [x][ ] first\n2. [ ][ ] \n3. [ ][x] second");
  });

  test("Enter on an empty result row exits the list", () => {
    const doc = "- [ ][ ] ";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("");
  });
});

describe("the ()+Space multiple-choice shorthand", () => {
  test("creates an unselected option and does not change task/result shorthands", () => {
    const choice = viewOf("()", 2);
    expect(press(choice, "Space")).toBe(true);
    expect(text(choice)).toBe("- ( ) ");
    expect(head(choice)).toBe(6);
  });

  test("normalizes indent and upgrades an existing bullet for a choice", () => {
    const tabbed = viewOf("\t( )", 4);
    expect(press(tabbed, "Space")).toBe(true);
    expect(text(tabbed)).toBe("  - ( ) ");

    const bullet = viewOf("- ()", 4);
    expect(press(bullet, "Space")).toBe(true);
    expect(text(bullet)).toBe("- ( ) ");
  });

  test("Enter continues the group with an unselected option", () => {
    const doc = "- (x) Red";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("- (x) Red\n- ( ) ");
  });

  test("ordered options count up and renumber following siblings", () => {
    const doc = "1. (x) Red\n2. ( ) Blue";
    const v = viewOf(doc, doc.indexOf("Red") + 3);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("1. (x) Red\n2. ( ) \n3. ( ) Blue");
  });

  test("Enter on an empty option exits the list", () => {
    const v = viewOf("- ( ) ", 6);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("");
  });

  test("Tab with a text caret indents choice and result rows as Markdown", () => {
    const choice = viewOf("- ( ) Blue", 10);
    expect(press(choice, "Tab")).toBe(true);
    expect(text(choice)).toBe("  - ( ) Blue");

    const result = viewOf("- [ ][ ] API", 12);
    expect(press(result, "Tab")).toBe(true);
    expect(text(result)).toBe("  - [ ][ ] API");
  });
});

describe("Tab on a ragged table row (#3)", () => {
  test("skips the missing cells and appends a row instead of sticking", () => {
    const doc = "| a | b | c |\n| --- | --- | --- |\n| x |";
    const v = viewOf(doc, doc.indexOf("x"));
    expect(press(v, "Tab")).toBe(true);
    // the row was ragged and 'x' was the last real cell → Tab grows the table
    expect(v.state.doc.lines).toBe(4);
    expect(text(v)).toContain("x");
  });

  test("a full row still hops cell to cell", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const v = viewOf(doc, doc.indexOf("1"));
    expect(press(v, "Tab")).toBe(true);
    const sel = v.state.selection.main;
    expect(text(v).slice(sel.from, sel.to)).toBe("2");
  });
});

// the maintainer, 2026-07-28: Shift-Tab on tab-indented bullets (external editors, LLM
// output) was dead — the outdent grammar only spoke spaces. Tab/Shift-Tab now
// NORMALIZE tab indents to the app's two-space levels as part of the gesture.
describe("tab-indented lists (foreign notes)", () => {
  test("Shift-Tab outdents a tab-indented bullet one level", () => {
    const doc = "- alpha\n\t- child";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Tab", true)).toBe(true);
    expect(text(v)).toBe("- alpha\n- child");
  });

  test("two tabs normalize and drop one level", () => {
    const doc = "\t\t- deep";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Tab", true)).toBe(true);
    expect(text(v)).toBe("  - deep");
  });

  test("Tab on a tab-indented bullet nests one MORE level, normalized", () => {
    const doc = "\t- child";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("    - child");
  });

  test("Enter continues a tab-indented item as a sibling", () => {
    const doc = "\t- child";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Enter")).toBe(true);
    expect(text(v)).toBe("\t- child\n\t- ");
  });

  test("a task keeps its checkbox through Shift-Tab", () => {
    const doc = "- [ ] a\n  - [x] b";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Tab", true)).toBe(true);
    expect(text(v)).toBe("- [ ] a\n- [x] b");
  });
});

// the maintainer, 2026-08-01 (still on v0.62.0): bullets, then a third line that had left
// the list — typing the text FIRST and then pressing Tab shoved two invisible
// spaces in at the caret instead of moving the line, so the "- " typed next
// stranded at the end and the line read literally as "test  -". Tab indents the
// LINE now, like ⇧Tab has always outdented any line; only fenced code keeps the
// soft tab at the caret (indentation there is the user's code).
describe("Tab indents the LINE, not the caret", () => {
  test("the reported flow: bullets, leave the list, type, Tab — nothing strands", () => {
    const v = viewOf("", 0);
    typeText(v, "- hello");
    press(v, "Enter");
    typeText(v, "okay");
    press(v, "Enter");
    press(v, "Enter"); // the empty-item exit ramp → a plain line
    typeText(v, "test");
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("- hello\n- okay\n  test");
    typeText(v, "!"); // the caret rode the shift instead of sitting behind it
    expect(text(v)).toBe("- hello\n- okay\n  test!");
  });

  test("a paragraph indents from column 0 and the caret lands after the indent", () => {
    const v = viewOf("test", 0);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("  test");
    expect(head(v)).toBe(2);
  });

  test("an empty line still takes a plain two-space indent", () => {
    const v = viewOf("", 0);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("  ");
    expect(head(v)).toBe(2);
  });

  test("Tab with text selected indents the line instead of eating the selection", () => {
    const v = viewOf("test", 4, 1); // "est" selected
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("  test");
  });

  test("nesting a bullet is unchanged (the app's own flow)", () => {
    const v = viewOf("", 0);
    typeText(v, "- hello");
    press(v, "Enter");
    typeText(v, "okay");
    press(v, "Enter");
    press(v, "Tab");
    typeText(v, "test");
    expect(text(v)).toBe("- hello\n- okay\n  - test");
  });
});

describe("Tab outside a table", () => {
  test("indents a bullet even when the note holds a table elsewhere", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n\n- item";
    const v = viewOf(doc, doc.length);
    expect(press(v, "Tab")).toBe(true);
    expect(text(v)).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n\n  - item");
  });
});
