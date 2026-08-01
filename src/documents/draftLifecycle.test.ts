import { describe, expect, test } from "bun:test";

import { PristineDocumentDrafts } from "./draftLifecycle";

describe("PristineDocumentDrafts", () => {
  test("claims an untouched document after its final tab closes", () => {
    const drafts = new PristineDocumentDrafts();
    drafts.track("storage/rotli/untitled.docx");

    expect(drafts.claimClosed(["storage/rotli/untitled.docx"], [])).toEqual(["storage/rotli/untitled.docx"]);
    expect(drafts.has("storage/rotli/untitled.docx")).toBe(false);
    expect(drafts.claimClosed(["storage/rotli/untitled.docx"], [])).toEqual([]);
  });

  test("keeps a pristine document while another tab is open", () => {
    const drafts = new PristineDocumentDrafts();
    drafts.track("draft.docx");

    expect(drafts.claimClosed(["draft.docx"], ["draft.docx"])).toEqual([]);
    expect(drafts.has("draft.docx")).toBe(true);
  });

  test("a content mutation permanently makes the document durable", () => {
    const drafts = new PristineDocumentDrafts();
    drafts.track("draft.docx");
    drafts.markChanged("draft.docx");

    expect(drafts.claimClosed(["draft.docx"], [])).toEqual([]);
  });
});
