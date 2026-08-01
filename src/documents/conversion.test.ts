import { describe, expect, test } from "bun:test";

import { convertLegacyDocument } from "./conversion";

describe("legacy document conversion workflow", () => {
  test("converts only the explicit local-conversion family", async () => {
    const calls: string[] = [];
    const converter = {
      convertToManagedDocx: async (id: string) => {
        calls.push(id);
        return "storage/rotli/legacy.docx";
      },
    };
    await expect(convertLegacyDocument(converter, "storage/legacy.doc")).resolves.toBe(
      "storage/rotli/legacy.docx",
    );
    await expect(convertLegacyDocument(converter, "storage/notes.rtf")).resolves.toBe(
      "storage/rotli/legacy.docx",
    );
    await expect(convertLegacyDocument(converter, "storage/draft.odt")).resolves.toBe(
      "storage/rotli/legacy.docx",
    );
    await expect(convertLegacyDocument(converter, "storage/reference.pdf")).resolves.toBe(
      "storage/rotli/legacy.docx",
    );
    expect(calls).toHaveLength(4);
  });

  test("rejects formats without a faithful local route before calling the host", async () => {
    let called = false;
    const converter = {
      convertToManagedDocx: async () => {
        called = true;
        return "";
      },
    };
    await expect(convertLegacyDocument(converter, "storage/design.pages")).rejects.toThrow(
      "does not have a faithful local DOCX conversion path",
    );
    expect(called).toBe(false);
  });
});
