import { describe, expect, test } from "bun:test";

import { topLevelNodes } from "./xml";

describe("topLevelNodes", () => {
  test("splits direct children and keeps each byte-for-byte", () => {
    const p = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>`;
    const tbl = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const sect = `<w:sectPr><w:pgSz w:w="12240"/></w:sectPr>`;
    expect(topLevelNodes(`${p}\n  ${tbl}${sect}`)).toEqual([p, tbl, sect]);
  });

  test("a nested element with the same name does not end its parent early", () => {
    const sdt = `<w:sdt><w:sdtContent><w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt><w:p><w:r><w:t>After</w:t></w:r></w:p></w:sdtContent></w:sdt>`;
    expect(topLevelNodes(`${sdt}<w:p/>`)).toEqual([sdt, "<w:p/>"]);
  });

  test("a tag that only starts like the parent's name is not the parent", () => {
    const p = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>`;
    expect(topLevelNodes(`${p}<w:p></w:p>`)).toEqual([p, "<w:p></w:p>"]);
  });

  test("comments stand alone and tag names match in any letter case", () => {
    const body = `<!-- note --><W:P><w:r><w:t>Hi</w:t></w:r></w:p>`;
    expect(topLevelNodes(body)).toEqual(["<!-- note -->", "<W:P><w:r><w:t>Hi</w:t></w:r></w:p>"]);
  });

  test("an unclosed element ends the split instead of swallowing the rest", () => {
    expect(topLevelNodes(`<w:p/><w:p><w:r>`)).toEqual(["<w:p/>"]);
  });
});
