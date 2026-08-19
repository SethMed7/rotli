import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(new URL("sidebar.tsx", import.meta.url), "utf8");
const sidebarHomeSource = readFileSync(new URL("sidebar/sidebarHome.tsx", import.meta.url), "utf8");
const sidebarSystemSource = readFileSync(new URL("sidebar/sidebarSystem.tsx", import.meta.url), "utf8");

test("Breve changes only its mode control in the vault header", () => {
  const header = sidebarSource.slice(
    sidebarSource.indexOf('<div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>'),
    sidebarSource.indexOf("{/* the FRONT switcher"),
  );

  expect(header).toContain("<QuokkaMark size={17} /> : <CoffeeGlyph size={16} />");
  expect(header).toContain("<NewFileGlyph size={16} />");
  expect(header).toContain("<NewFolderGlyph size={16} />");
  expect(header).toContain("<FoldGlyph size={16} />");
  expect(header).not.toContain('{sidebarMode !== "breve" && (');
});

test("System stays Library, Assets, Archive, and Trash for every active vault", () => {
  expect(sidebarSystemSource).toContain('<span className="fname">Library</span>');
  expect(sidebarSystemSource).not.toContain("AddedRootRow");
  expect(sidebarSystemSource).not.toContain('className="fsec">Folders');
  expect(sidebarHomeSource).toContain('{ id: DEST.storage, label: "Assets", Glyph: StorageGlyph }');
  expect(sidebarHomeSource).toContain('{ id: DEST.archive, label: "Archive", Glyph: ArchiveGlyph }');
  expect(sidebarHomeSource).toContain('{ id: DEST.trash, label: "Trash", Glyph: TrashGlyph }');
  expect(sidebarHomeSource).not.toContain('label: "Linked library"');
  expect(sidebarHomeSource).not.toContain("useCorpusRoots");
});
