import { expect, test } from "bun:test";

import { cellEditValue, cellSourceValue, flattenCellBreaks, inlineCell, plainCellLabel } from "./tableCell";

test("a <br> in a cell renders as a line break while other HTML stays escaped", () => {
  expect(inlineCell("one<br>two <b>x</b>")).toBe("one<br>two &lt;b&gt;x&lt;/b&gt;");
  expect(inlineCell("a<br/>**b**")).toBe("a<br><strong>b</strong>");
});

test("the cell editor shows real lines and writes them back as <br>", () => {
  expect(cellEditValue("one<br>two<BR />three")).toBe("one\ntwo\nthree");
  expect(cellSourceValue("one\ntwo\r\nthree")).toBe("one<br>two<br>three");
  expect(cellSourceValue(cellEditValue("stays<br>put"))).toBe("stays<br>put");
});

test("plain readers flatten a break to a space", () => {
  expect(flattenCellBreaks("one<br>two")).toBe("one two");
  expect(plainCellLabel("**Owner**<br>name", 3)).toBe("Owner name");
  expect(plainCellLabel("", 3)).toBe("column 4");
});
