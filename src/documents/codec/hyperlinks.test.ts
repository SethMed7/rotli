import { expect, test } from "bun:test";

import { hasForeignHyperlink, hyperlinks, hyperlinkUrl, withHyperlinkStyle } from "./hyperlinks";

const TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const RELS = `<Relationships><Relationship Id="rId1" Type="${TYPE}" Target="https://rotli.co/?a=1&amp;b=2" TargetMode="External"/><Relationship TargetMode="External" Target="file:///etc/passwd" Type="${TYPE}" Id="rId2"/><Relationship Id="rIdRotliLink1" Type="${TYPE}" Target="https://internal" /></Relationships>`;

test("only external web and mail relationships are links, in any attribute order", () => {
  const links = hyperlinks(RELS);
  expect(links.url("rId1")).toBe("https://rotli.co/?a=1&b=2");
  expect(links.url("rId2")).toBeUndefined();
  // no TargetMode="External": a package part, not a link
  expect(links.url("rIdRotliLink1")).toBeUndefined();
  expect(hyperlinkUrl(' r:id="rId1"', links)).toBe("https://rotli.co/?a=1&b=2");
  expect(hyperlinkUrl(' r:id="rId1" w:anchor="top"', links)).toBeUndefined();
});

test("a known link reuses its relationship; a new one gets a free id once", () => {
  const links = hyperlinks(RELS);
  expect(links.idFor("https://rotli.co/?a=1&b=2")).toBe("rId1");
  expect(links.added()).toBeNull();
  expect(links.idFor("mailto:hi@rotli.co")).toBe("rIdRotliLink2");
  expect(links.idFor("mailto:hi@rotli.co")).toBe("rIdRotliLink2");
  const added = links.added() ?? "";
  expect(added.match(/rIdRotliLink2/g)).toHaveLength(1);
  expect(added).toEndWith('Target="mailto:hi@rotli.co" TargetMode="External"/></Relationships>');
});

test("a paragraph with an anchor, unresolved, or self-closed link is foreign", () => {
  const links = hyperlinks(RELS);
  expect(hasForeignHyperlink('<w:p><w:hyperlink r:id="rId1"><w:r/></w:hyperlink></w:p>', links)).toBe(false);
  expect(hasForeignHyperlink('<w:p><w:hyperlink w:anchor="x"><w:r/></w:hyperlink></w:p>', links)).toBe(true);
  expect(hasForeignHyperlink('<w:p><w:hyperlink r:id="rId9"><w:r/></w:hyperlink></w:p>', links)).toBe(true);
  expect(hasForeignHyperlink('<w:p><w:hyperlink r:id="rId1"/></w:p>', links)).toBe(true);
});

test("Word's link style is added once", () => {
  const styles = withHyperlinkStyle("<w:styles></w:styles>") ?? "";
  expect(styles).toContain('w:styleId="Hyperlink"');
  expect(withHyperlinkStyle(styles)).toBeNull();
  expect(withHyperlinkStyle("")).toBeNull();
});
