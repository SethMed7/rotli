import { describe, expect, test } from "bun:test";

import {
  documentBlockCommand,
  documentFormatHandle,
  documentHeadingCommand,
  documentMarkCommand,
} from "./format";

describe("document format intents", () => {
  test("map Rotli's inline marks to Univer's inline-format commands", () => {
    expect(documentMarkCommand("bold")).toBe("doc.command.set-inline-format-bold");
    expect(documentMarkCommand("italic")).toBe("doc.command.set-inline-format-italic");
    expect(documentMarkCommand("underline")).toBe("doc.command.set-inline-format-underline");
    expect(documentMarkCommand("strike")).toBe("doc.command.set-inline-format-strikethrough");
    expect(documentHeadingCommand(2)).toBe("doc.command.h2-heading");
    expect(documentBlockCommand("numbered")).toBe("doc.command.order-list");
  });

  test("Markdown-only intents run nothing", () => {
    const ran: string[] = [];
    const handle = documentFormatHandle((id) => ran.push(id));
    for (const mark of ["code", "highlight", "link"] as const) handle.toggleMark(mark);
    handle.toggleBlock("quote");
    handle.toggleBlock("checklist");
    expect(ran).toEqual([]);
    handle.toggleMark("bold");
    handle.toggleBlock("bullet");
    expect(ran).toEqual(["doc.command.set-inline-format-bold", "doc.command.bullet-list"]);
  });
});
