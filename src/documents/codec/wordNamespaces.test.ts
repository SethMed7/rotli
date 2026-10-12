import { describe, expect, test } from "bun:test";

import { editorWordXml } from "./wordNamespaces";

const TRANSITIONAL = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const STRICT = "http://purl.oclc.org/ooxml/wordprocessingml/main";

describe("editorWordXml", () => {
  test("leaves an ordinary w: document unchanged", () => {
    const xml = `<w:document xmlns:w="${TRANSITIONAL}"><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`;
    expect(editorWordXml(xml)).toBe(xml);
  });

  test("maps another WordprocessingML prefix, its attributes, and its declaration to w:", () => {
    const xml = `<x:document xmlns:x="${TRANSITIONAL}"><x:body><x:p><x:r><x:t x:space="preserve">Hi</x:t></x:r></x:p></x:body></x:document>`;
    expect(editorWordXml(xml)).toBe(
      `<w:document xmlns:w="${TRANSITIONAL}"><w:body><w:p><w:r><w:t w:space="preserve">Hi</w:t></w:r></w:p></w:body></w:document>`,
    );
  });

  test("maps the Strict namespace URI to the transitional one", () => {
    const xml = `<w:document xmlns:w="${STRICT}"><w:body/></w:document>`;
    expect(editorWordXml(xml)).toBe(`<w:document xmlns:w="${TRANSITIONAL}"><w:body/></w:document>`);
  });

  test("leaves prefixes bound to other namespaces alone", () => {
    const xml = `<w:document xmlns:w="${TRANSITIONAL}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><r:id/></w:body></w:document>`;
    expect(editorWordXml(xml)).toBe(xml);
  });
});
