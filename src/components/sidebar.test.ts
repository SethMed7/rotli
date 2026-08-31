import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(new URL("sidebar.tsx", import.meta.url), "utf8");
const sidebarHomeSource = readFileSync(new URL("sidebar/sidebarHome.tsx", import.meta.url), "utf8");
const sidebarSystemSource = readFileSync(new URL("sidebar/sidebarSystem.tsx", import.meta.url), "utf8");
const sidebarChatSource = readFileSync(new URL("sidebar/sidebarChat.tsx", import.meta.url), "utf8");
const notesStyles = readFileSync(new URL("../styles/notes.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
const tauriSource = readFileSync(new URL("../lib/tauri.ts", import.meta.url), "utf8");

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

test("chat rows reveal one keyboard-safe action without recoloring the provider mark", () => {
  expect(sidebarChatSource).toContain('className="sb-chatrow-open"');
  expect(sidebarChatSource).toContain('className="sb-chataction"');
  expect(sidebarChatSource).toContain("openChatActions(c, rect.right, rect.bottom)");

  const hoverRules = notesStyles.slice(
    notesStyles.indexOf(".sb-chattrail {"),
    notesStyles.indexOf(".sb-chatrow.sel .sb-chatmodel"),
  );
  expect(hoverRules).toContain(".sb-chatrow:focus-within .sb-chataction");
  expect(hoverRules).toContain("pointer-events: auto");

  const openAiSelected = notesStyles.slice(
    notesStyles.indexOf(".sb-chatrow.sel .sb-chatmark.openai"),
    notesStyles.indexOf("/* the per-chat model chip"),
  );
  expect(openAiSelected).toContain("color: var(--text)");
  expect(openAiSelected).not.toContain("var(--selected-icon)");
});

test("file drops wait for Rust to issue native import grants", () => {
  expect(appSource).toContain("onNativeDropAuthorized((event) =>");
  expect(appSource).not.toContain("onDragDropEvent");
  expect(appSource).not.toContain("getCurrentWebview");
  expect(tauriSource).toContain('listen<AuthorizedNativeDrop>("rotli:native-drop-authorized"');
});
