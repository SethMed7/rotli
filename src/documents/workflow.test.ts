import { describe, expect, test } from "bun:test";

import type {
  DocumentEditorCodec,
  DocumentEncoder,
  DocumentFileReader,
  DocumentFileWriter,
  DocumentRepository,
} from "./ports";
import { createDocument, documentFileName, editDocument } from "./workflow";

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

  test("editing refuses oversized files before reading or decoding bytes", async () => {
    let reads = 0;
    let decodes = 0;
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 101 }),
      readBase64: async () => {
        reads += 1;
        return "bytes";
      },
    };
    const codec: DocumentEditorCodec<string> = {
      decode: async () => {
        decodes += 1;
        return {
          source: "source",
          document: { id: "large.docx", title: "Large", content: [] },
          warnings: [],
        };
      },
      encode: async () => "encoded",
    };
    const writer: DocumentFileWriter = { writeBase64: async () => {} };

    expect(await editDocument({ reader, writer, codec, maxBytes: 100 }, "large.docx")).toEqual({
      kind: "too-large",
    });
    expect(reads).toBe(0);
    expect(decodes).toBe(0);
  });

  test("editing saves through the selected codec while retaining its source", async () => {
    const writes: string[] = [];
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 5 }),
      readBase64: async (_id, maxBytes) => `bytes:${maxBytes}`,
    };
    const writer: DocumentFileWriter = {
      writeBase64: async (_id, base64, backup) => {
        writes.push(`${base64}:${backup}`);
      },
    };
    const codec: DocumentEditorCodec<string> = {
      decode: async (base64) => ({
        source: `source:${base64}`,
        document: {
          id: "brief.docx",
          title: "Brief",
          content: [{ kind: "paragraph", paragraph: { runs: [{ text: "before" }] } }],
        },
        warnings: [],
      }),
      encode: async (source, document) =>
        `${source}:${document.content[0]?.kind === "paragraph" ? document.content[0].paragraph.runs[0]?.text : ""}`,
    };

    const result = await editDocument({ reader, writer, codec, maxBytes: 100 }, "brief.docx");
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("expected an editable document");
    await result.save({
      ...result.document,
      content: [{ kind: "paragraph", paragraph: { runs: [{ text: "after" }] } }],
    });
    expect(writes).toEqual(["source:bytes:101:after:true"]);
  });
});
