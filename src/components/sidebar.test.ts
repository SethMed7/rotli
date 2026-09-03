import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebarSource = readFileSync(new URL("sidebar.tsx", import.meta.url), "utf8");
const sidebarHomeSource = readFileSync(new URL("sidebar/sidebarHome.tsx", import.meta.url), "utf8");
const sidebarSystemSource = readFileSync(new URL("sidebar/sidebarSystem.tsx", import.meta.url), "utf8");
const sidebarChatSource = readFileSync(new URL("sidebar/sidebarChat.tsx", import.meta.url), "utf8");
const notesStyles = readFileSync(new URL("../styles/notes.css", import.meta.url), "utf8");
const tauriSource = readFileSync(new URL("../lib/tauri.ts", import.meta.url), "utf8");
const dropSource = readFileSync(new URL("../editor/nativeFileDrop.ts", import.meta.url), "utf8");

test("Breve is a labelled segment of the front switcher, not a header icon", () => {
  const header = sidebarSource.slice(
    sidebarSource.indexOf('<div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>'),
    sidebarSource.indexOf("{/* the FRONT switcher"),
  );

  // the header row keeps only creation + fold controls; the old unlabeled
  // coffee toggle (audit 2026-09-02 §1.3) is gone
  expect(header).not.toContain("sb-breve-toggle");
  expect(header).not.toContain("CoffeeGlyph");
  expect(header).toContain("<NewFileGlyph size={16} />");
  expect(header).toContain("<NewFolderGlyph size={16} />");
  expect(header).toContain("<FoldGlyph size={16} />");
  // the switcher and the utility footer stay visible in Breve mode, so the
  // way back to Home/Chat and the Settings/Librarian doors never vanish
  expect(sidebarSource).not.toContain('{sidebarMode !== "breve" && (');
  expect(sidebarSource).toContain('breveActive={sidebarMode === "breve"}');
  expect(sidebarSource).toContain('onBreve={() => dispatch("view.breve")}');
  expect(sidebarSource).not.toContain('{sidebarMode === "notes" && <SidebarFooter />}');
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
  expect(dropSource).toContain("onNativeDropAuthorized((event) =>");
  expect(dropSource).not.toContain("onDragDropEvent");
  expect(dropSource).not.toContain("getCurrentWebview");
  expect(tauriSource).toContain('listen<AuthorizedNativeDrop>("rotli:native-drop-authorized"');
});

test("editor drops resolve nested hits and import into the note's own root", () => {
  const editorDrop = dropSource.slice(
    dropSource.indexOf("const target = editorAt(hits)"),
    dropSource.indexOf("await invalidateNotes();", dropSource.indexOf("const target = editorAt(hits)")),
  );
  expect(dropSource).toContain("nativeDropPoints(px, py, window.devicePixelRatio || 1)");
  expect(editorDrop).toContain("editorAt(hits)");
  expect(editorDrop).toContain("rootIdOf(view.state.facet(noteIdFacet))");
  expect(editorDrop).toContain("corpusImportFile(rootId, path)");
  expect(editorDrop).not.toContain('corpusImportFile("default"');
});

test("byte-backed webview image drops keep the guarded asset fallback", () => {
  expect(dropSource).toContain('window.addEventListener("drop", onDrop, true)');
  expect(dropSource).toContain("importImageFilesAtDrop(view, files");
  expect(dropSource).toContain("corpusCreateImageAsset(rootId, name, base64)");
});

test("chat drops partition with the chat's own image predicate; editor drops accept embeds", () => {
  const chatDrop = dropSource.slice(
    dropSource.indexOf("if (chatAttach) {"),
    dropSource.indexOf("const target = editorAt(hits)"),
  );
  // an .svg routed to chat by the editor's wider predicate was refused there
  // AND never imported — the router must ask the chat what it accepts
  expect(chatDrop).toContain("paths.filter(isChatImagePath)");
  expect(chatDrop).not.toContain("paths.filter(isImagePath)");
  const editorDrop = dropSource.slice(
    dropSource.indexOf("const target = editorAt(hits)"),
    dropSource.indexOf("await invalidateNotes();", dropSource.indexOf("const target = editorAt(hits)")),
  );
  expect(editorDrop).toContain("paths.filter(isEmbeddablePath)");
});
