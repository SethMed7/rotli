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

  test("maps a default-namespace Strict document to editor w: elements", () => {
    const xml = `<document xmlns="${STRICT}"><body><p><r><t>Private words</t></r></p></body></document>`;
    expect(editorWordXml(xml)).toBe(
      `<w:document xmlns:w="${TRANSITIONAL}"><w:body><w:p><w:r><w:t>Private words</w:t></w:r></w:p></w:body></w:document>`,
    );
  });

  test("leaves a prefixed foreign subtree's default namespace alone", () => {
    const xml = `<document xmlns="${STRICT}"><body><a:graphic xmlns:a="urn:art" xmlns="urn:art"><t>Drawing</t></a:graphic><p><r><t>Body</t></r></p></body></document>`;
    const normalized = editorWordXml(xml);
    expect(normalized).toContain('<a:graphic xmlns:a="urn:art" xmlns="urn:art"><t>Drawing</t></a:graphic>');
    expect(normalized).toContain("<w:p><w:r><w:t>Body</w:t></w:r></w:p>");
  });

  test("keeps prefixed DrawingML tags under a Word default namespace", () => {
    const xml = `<document xmlns="${STRICT}"><body><a:graphic xmlns:a="urn:art"><a:t>Drawing</a:t></a:graphic><p><r><t>Body</t></r></p></body></document>`;
    const normalized = editorWordXml(xml);
    expect(normalized).toContain('<a:graphic xmlns:a="urn:art"><a:t>Drawing</a:t></a:graphic>');
    expect(normalized).toContain("<w:p><w:r><w:t>Body</w:t></w:r></w:p>");
  });

  test("leaves prefixes bound to other namespaces alone", () => {
    const xml = `<w:document xmlns:w="${TRANSITIONAL}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><r:id/></w:body></w:document>`;
    expect(editorWordXml(xml)).toBe(xml);
  });
});
