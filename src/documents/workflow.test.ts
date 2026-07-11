import { describe, expect, test } from "bun:test";
import type { DocumentEncoder, DocumentFileReader, DocumentPreviewer, DocumentRepository } from "./ports";
import { createDocument, documentFileName, previewDocument } from "./workflow";

describe("document application workflows", () => {
  test("creation composes an encoder and repository without knowing either implementation", async () => {
    const writes: Array<{ name: string; base64: string }> = [];
    const encoder: DocumentEncoder = {
      extension: "DOCX",
      encode: async (draft) => `encoded:${draft.title}`,
    };
    const repository: DocumentRepository = {
      create: async (name, base64) => {
        writes.push({ name, base64 });
        return `storage/rotli/${name}`;
      },
    };

    const id = await createDocument({ encoder, repository }, { title: "Plan" }, 42);

    expect(id).toBe("storage/rotli/untitled-42.docx");
    expect(writes).toEqual([{ name: "untitled-42.docx", base64: "encoded:Plan" }]);
  });

  test("invalid adapter extensions fail before storage is called", async () => {
    expect(() => documentFileName("../", 42)).toThrow();
  });

  test("preview refuses oversized files before reading or parsing bytes", async () => {
    let reads = 0;
    let previews = 0;
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 101 }),
      readBase64: async () => {
        reads += 1;
        return "bytes";
      },
    };
    const previewer: DocumentPreviewer = {
      preview: async () => {
        previews += 1;
        return { srcDoc: "", warnings: [] };
      },
    };

    expect(await previewDocument({ reader, previewer, maxBytes: 100 }, "large.docx")).toEqual({
      kind: "too-large",
    });
    expect(reads).toBe(0);
    expect(previews).toBe(0);
  });

  test("preview passes bounded bytes through the selected adapter", async () => {
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 5 }),
      readBase64: async (_id, maxBytes) => `bytes:${maxBytes}`,
    };
    const previewer: DocumentPreviewer = {
      preview: async (base64) => ({ srcDoc: `<p>${base64}</p>`, warnings: [] }),
    };

    expect(await previewDocument({ reader, previewer, maxBytes: 100 }, "brief.docx")).toEqual({
      kind: "ready",
      srcDoc: "<p>bytes:101</p>",
      warnings: [],
    });
  });
});
