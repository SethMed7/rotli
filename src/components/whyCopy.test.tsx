import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { WHY_COPY_LINES, WhyCopy } from "./whyCopy";

test("Why a copy? says the original is never touched, closed until asked", () => {
  const html = renderToStaticMarkup(<WhyCopy />);
  expect(html).toContain("<summary>Why a copy?</summary>");
  expect(html).not.toContain("<details open");
  expect(WHY_COPY_LINES.join(" ")).toContain("never moved, renamed, edited, or deleted by Rotli");
});
