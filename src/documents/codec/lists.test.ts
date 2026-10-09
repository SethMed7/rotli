import { expect, test } from "bun:test";

import { listKindOf, listKinds, listProps } from "./lists";

const NUMBERING = `<w:numbering><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="8"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="6"><w:abstractNumId w:val="8"/></w:num></w:numbering>`;

test("a file's own numbering decides each list's kind", () => {
  const kinds = listKinds(NUMBERING);
  expect(listKindOf("5", kinds)).toBe("number");
  expect(listKindOf("6", kinds)).toBe("bullet");
  // unknown ids fall back to Rotli's own: 2 numbered, else bullet
  expect(listKindOf("2", new Map())).toBe("number");
  expect(listKindOf(undefined, new Map())).toBe("bullet");
});

test("a list keeps its numbering while its kind holds, else takes the file's of that kind", () => {
  const kinds = listKinds(NUMBERING);
  const original = '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr>';
  expect(listProps("number", original, kinds)).toBe(original);
  expect(listProps("bullet", original, kinds)).toContain('w:numId w:val="6"');
  expect(listProps(undefined, original, kinds)).toBe("");
});
