// Third review of pull request 267, #5: hard-linked files no longer vanish
// silently. The listing says what it left out (Rust walk, Helper walk); these
// tests cover what the person sees: the sidebar notice, the line under search
// results, an open note that became hard-linked, and Rotli Web through the
// Helper.
import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { HardLinkedNote } from "../../editor/hardLinkedNote";
import { INDEPENDENT_COPY, isHardLinkRefusal } from "../../lib/hardLinks";
import { HelperVaultDir } from "../../lib/helperVaultDir";
import { FolderNotesService } from "../../services/folderNotes";
import { MemoryVaultDir } from "../../services/vaultDir";
import type { SkippedFile } from "../../types";
import { HIDE_FILES, SHOW_FILES, SearchSkippedLine, SkippedFilesNoticeView } from "./skippedFilesNotice";

const linked = (path: string): SkippedFile => ({ path, reason: "hardLink" });

describe("the sidebar notice", () => {
  test("absent while nothing is left out", () => {
    expect(renderToStaticMarkup(<SkippedFilesNoticeView files={[]} />)).toBe("");
  });

  test("one sentence, singular or plural, with a labelled control and no badge", () => {
    const one = renderToStaticMarkup(<SkippedFilesNoticeView files={[linked("wiki/Ledger.md")]} />);
    expect(one).toContain("1 file wasn’t opened because it has a hard link. Your file is still on disk.");
    const two = renderToStaticMarkup(
      <SkippedFilesNoticeView files={[linked("wiki/Ledger.md"), linked("Storage/scan.pdf")]} />,
    );
    expect(two).toContain(
      "2 files weren’t opened because they have hard links. Your files are still on disk.",
    );
    expect(two).toContain('aria-expanded="false"');
    expect(two).toContain(SHOW_FILES);
    // closed, the paths wait behind the control; nothing counts or alarms
    expect(two).not.toContain("Storage/scan.pdf");
    expect(two).not.toMatch(/class="[^"]*(count|badge|alert)/);
  });

  test("opened, it lists every path and the one line on an independent copy", () => {
    const open = renderToStaticMarkup(
      <SkippedFilesNoticeView files={[linked("wiki/Ledger.md"), linked("Storage/scan.pdf")]} defaultOpen />,
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain(HIDE_FILES);
    expect(open).toContain("wiki/Ledger.md");
    expect(open).toContain("Storage/scan.pdf");
    expect(open).toContain(INDEPENDENT_COPY);
  });
});

describe("search", () => {
  test("one line under the results while a query is typed", () => {
    expect(renderToStaticMarkup(<SearchSkippedLine query="harbor" count={2} />)).toContain(
      "2 files weren’t searched because they have hard links.",
    );
    expect(renderToStaticMarkup(<SearchSkippedLine query="harbor" count={1} />)).toContain(
      "1 file wasn’t searched because it has a hard link.",
    );
    expect(renderToStaticMarkup(<SearchSkippedLine query="" count={2} />)).toBe("");
    expect(renderToStaticMarkup(<SearchSkippedLine query="harbor" count={0} />)).toBe("");
  });
});

describe("a note open when it became hard-linked", () => {
  test("Rust's refusal is recognised, and the note shows the notice in its place", () => {
    // the words fsutil::open_own_file answers with, as an editor read surfaces them
    expect(
      isHardLinkRefusal(
        new Error("read wiki/Ledger.md: this file has a hard link, so Rotli doesn't open it"),
      ),
    ).toBe(true);
    expect(isHardLinkRefusal(new Error("read wiki/Ledger.md: not found"))).toBe(false);
    const view = renderToStaticMarkup(<HardLinkedNote />);
    expect(view).toContain("This note wasn’t opened because it has a hard link. Your file is still on disk.");
    expect(view).toContain(INDEPENDENT_COPY);
  });
});

describe("Rotli Web through the Helper", () => {
  const helperWith = (answer: unknown) =>
    new HelperVaultDir(
      async (cmd, args) => {
        if (cmd !== "vault_walk") throw new Error(`unexpected ${cmd}`);
        expect(args.skipped).toBe(true);
        return answer;
      },
      { ping: async () => true, unreachable: () => false, freshMs: 60_000 },
    );

  test("a Helper that names what it left out reaches the notes service", async () => {
    const dir = helperWith({
      entries: [{ path: "wiki", kind: "directory", lastModified: 1, size: 0 }],
      skipped: [{ path: "wiki/Ledger.md", reason: "hardLink" }],
    });
    expect(await new FolderNotesService(dir).listSkipped()).toEqual([linked("wiki/Ledger.md")]);
    expect(await dir.list("")).toEqual([{ name: "wiki", kind: "directory" }]);
  });

  test("an older Helper's bare walk still lists, with nothing named", async () => {
    const dir = helperWith([{ path: "wiki", kind: "directory", lastModified: 1, size: 0 }]);
    expect(await new FolderNotesService(dir).listSkipped()).toEqual([]);
    expect(await dir.list("")).toEqual([{ name: "wiki", kind: "directory" }]);
  });

  test("a folder opened in the browser can't tell, and says nothing", async () => {
    expect(await new FolderNotesService(new MemoryVaultDir()).listSkipped()).toEqual([]);
  });
});
