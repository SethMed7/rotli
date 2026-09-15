import { describe, expect, test } from "bun:test";

import type {
  DocumentEditorCodec,
  DocumentEncoder,
  DocumentFileReader,
  DocumentFileWriter,
  DocumentRepository,
} from "./ports";
import {
  createDocument,
  createNamedDocument,
  createUserNamedDocument,
  documentFileName,
  editDocument,
  namedDocumentFileName,
} from "./workflow";

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

  test("populated documents get a safe meaningful filename without exposing a path", async () => {
    const writes: string[] = [];
    const encoder: DocumentEncoder = { extension: "docx", encode: async () => "bytes" };
    const repository: DocumentRepository = {
      create: async (name) => {
        writes.push(name);
        return `storage/rotli/${name}`;
      },
    };
    expect(namedDocumentFileName("TanStack: Architecture / Guide", "docx", 42)).toBe(
      "tanstack-architecture-guide-42.docx",
    );
    await createNamedDocument(
      { encoder, repository },
      "TanStack: Architecture / Guide",
      { title: "Guide" },
      42,
    );
    expect(writes).toEqual(["tanstack-architecture-guide-42.docx"]);
  });

  test("a document a person names is created under exactly that name", async () => {
    const writes: string[] = [];
    const encoder: DocumentEncoder = { extension: "docx", encode: async () => "encoded" };
    const repository: DocumentRepository = {
      create: async (name) => {
        writes.push(name);
        return `storage/rotli/${name}`;
      },
    };
    const id = await createUserNamedDocument({ encoder, repository }, "  Quarterly plan / Q3 ");
    expect(id).toBe("storage/rotli/Quarterly plan - Q3.docx");
    await expect(createUserNamedDocument({ encoder, repository }, "   ")).rejects.toThrow("needs a name");
    expect(writes).toEqual(["Quarterly plan - Q3.docx"]);
  });

  test("editing refuses oversized files before reading or decoding bytes", async () => {
    let reads = 0;
    let decodes = 0;
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 101, revision: "r1" }),
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
    const writer: DocumentFileWriter = { writeBase64: async () => "r2" };

    expect(await editDocument({ reader, writer, codec, maxBytes: 100 }, "large.docx")).toEqual({
      kind: "too-large",
    });
    expect(reads).toBe(0);
    expect(decodes).toBe(0);
  });

  test("editing saves through the selected codec while retaining its source", async () => {
    const writes: string[] = [];
    const reader: DocumentFileReader = {
      stat: async () => ({ len: 5, revision: "r1" }),
      readBase64: async (_id, maxBytes) => `bytes:${maxBytes}`,
    };
    const writer: DocumentFileWriter = {
      writeBase64: async (_id, base64, backup, expectedRevision) => {
        writes.push(`${base64}:${backup}:${expectedRevision}`);
        return "r2";
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
    expect(writes).toEqual(["source:bytes:101:after:true:r1"]);
  });
});
