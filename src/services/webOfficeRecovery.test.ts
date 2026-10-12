import { expect, test } from "bun:test";

import { decodeDocx } from "../documents/codec/docx";
import { createDocxBase64 } from "../documents/create";
import { fillFromCsvRows, loadXlsx, newWorkbook, saveXlsx } from "../sheets/codec/xlsx";
import { applyModelToWorkbook, buildSheetIdMap, workbookToModel } from "../sheets/engine/bridge";
import { bytesRevision, MemoryVaultDir } from "./vaultDir";
import {
  OFFICE_DRAFT_ENTRY_MAX_CHARS,
  OFFICE_DRAFT_TOTAL_MAX_CHARS,
  type OfficeDraft,
  clearOfficeDraft,
  officeDraftKey,
  readOfficeDrafts,
  replayOfficeDrafts,
  snapshotBase64,
  writeOfficeDraft,
} from "./webOfficeRecovery";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const original = new TextEncoder().encode("before");
const edited = new TextEncoder().encode("after");
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const draft = (fileId = "storage/plan.csv") => ({
  fileId,
  kind: "csv" as const,
  baseRevision: bytesRevision(original),
  sourceBase64: b64(original),
  snapshotBase64: b64(edited),
});
const encode = async (entry: OfficeDraft) =>
  Uint8Array.from(atob(entry.snapshotBase64), (c) => c.charCodeAt(0));

test("a change is journaled synchronously inside the autosave debounce window and vault-bound", () => {
  const store = storage();
  expect(writeOfficeDraft(store, "vault-A", draft())).toEqual({ protected: true, token: expect.any(String) });
  expect(readOfficeDrafts(store, "vault-A")).toHaveLength(1);
  expect(readOfficeDrafts(store, "vault-B")).toHaveLength(0);
});

test("a draft for vault A never replays into vault B", async () => {
  const store = storage();
  writeOfficeDraft(store, "A", draft());
  const dirB = new MemoryVaultDir();
  await dirB.writeBytes("storage/plan.csv", original);
  expect(await replayOfficeDrafts(store, "B", dirB, encode)).toEqual({
    saved: 0,
    keptAside: [],
    unresolved: 0,
  });
  expect(await dirB.readBytes("storage/plan.csv")).toEqual(original);
  expect(readOfficeDrafts(store, "A")).toHaveLength(1);
});

test("replay saves against the opened byte revision and clears only after confirmed write", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  const store = storage();
  writeOfficeDraft(store, "A", draft());
  const result = await replayOfficeDrafts(store, "A", dir, encode);
  expect(result).toEqual({ saved: 1, keptAside: [], unresolved: 0 });
  expect(await dir.readBytes("storage/plan.csv")).toEqual(edited);
  expect(readOfficeDrafts(store, "A")).toHaveLength(0);
});

test("a changed file keeps both versions in a free sibling and never clobbers", async () => {
  const dir = new MemoryVaultDir();
  const other = new TextEncoder().encode("external");
  await dir.writeBytes("storage/plan.csv", other);
  const store = storage();
  writeOfficeDraft(store, "A", draft());
  const result = await replayOfficeDrafts(store, "A", dir, encode);
  expect(result.keptAside).toEqual(["storage/plan (unsaved copy).csv"]);
  expect(await dir.readBytes("storage/plan.csv")).toEqual(other);
  expect(await dir.readBytes(result.keptAside[0]!)).toEqual(edited);
});

test("a refused save retains the draft; a newer draft survives an older save confirmation", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  const store = storage();
  const first = writeOfficeDraft(store, "A", draft());
  expect(
    (
      await replayOfficeDrafts(store, "A", dir, async () => {
        throw new Error("offline");
      })
    ).unresolved,
  ).toBe(1);
  expect(readOfficeDrafts(store, "A")).toHaveLength(1);
  writeOfficeDraft(store, "A", { ...draft(), snapshotBase64: b64(new TextEncoder().encode("newer")) });
  clearOfficeDraft(store, "A", draft().fileId, first.token);
  expect(readOfficeDrafts(store, "A")[0]?.snapshotBase64).toBe(b64(new TextEncoder().encode("newer")));
});

test("an oversized snapshot is refused without dropping the last protected draft", () => {
  const store = storage();
  writeOfficeDraft(store, "A", draft());
  expect(
    writeOfficeDraft(store, "A", { ...draft(), snapshotBase64: "a".repeat(OFFICE_DRAFT_ENTRY_MAX_CHARS) })
      .protected,
  ).toBe(false);
  expect(readOfficeDrafts(store, "A")[0]?.snapshotBase64).toBe(draft().snapshotBase64);
  expect(store.values.has(officeDraftKey("A"))).toBe(true);
});

test("the combined vault budget refuses another entry and retains the first", () => {
  const store = storage();
  const payload = "x".repeat(Math.floor(OFFICE_DRAFT_TOTAL_MAX_CHARS / 2));
  const first = { ...draft("storage/one.csv"), snapshotBase64: payload };
  const second = { ...draft("storage/two.csv"), snapshotBase64: payload };
  expect(writeOfficeDraft(store, "A", first).protected).toBe(true);
  expect(writeOfficeDraft(store, "A", second).protected).toBe(false);
  expect(readOfficeDrafts(store, "A").map((entry) => entry.fileId)).toEqual(["storage/one.csv"]);
});

test("a real DOCX model survives refresh and remains a valid Word package", async () => {
  const dir = new MemoryVaultDir();
  const fileId = "storage/letter.docx";
  const sourceBase64 = await createDocxBase64({
    title: "Letter",
    blocks: [{ kind: "paragraph", text: "before" }],
  });
  const source = Uint8Array.from(atob(sourceBase64), (c) => c.charCodeAt(0));
  await dir.writeBytes(fileId, source);
  const model = (await decodeDocx(sourceBase64, fileId)).document;
  model.content.push({ kind: "paragraph", paragraph: { runs: [{ text: "recovered paragraph" }] } });
  const store = storage();
  writeOfficeDraft(store, "A", {
    fileId,
    kind: "docx",
    baseRevision: bytesRevision(source),
    sourceBase64,
    snapshotBase64: snapshotBase64(model),
  });
  expect((await replayOfficeDrafts(store, "A", dir)).saved).toBe(1);
  const saved = b64(await dir.readBytes(fileId));
  expect((await decodeDocx(saved, fileId)).document.content).toContainEqual({
    kind: "paragraph",
    paragraph: { runs: [{ text: "recovered paragraph" }] },
  });
});

test("a real XLSX cell survives refresh and remains a valid workbook", async () => {
  const dir = new MemoryVaultDir();
  const fileId = "storage/budget.xlsx";
  const wb = fillFromCsvRows(newWorkbook(), "Budget", [["before"]]);
  const source = await saveXlsx(wb);
  const sourceBase64 = b64(source);
  await dir.writeBytes(fileId, source);
  const model = workbookToModel(wb, fileId);
  model.sheets[model.sheetOrder[0]!]!.cellData![0]![0] = { v: "recovered cell" };
  const store = storage();
  writeOfficeDraft(store, "A", {
    fileId,
    kind: "xlsx",
    baseRevision: bytesRevision(source),
    sourceBase64,
    snapshotBase64: snapshotBase64(model),
  });
  expect((await replayOfficeDrafts(store, "A", dir)).saved).toBe(1);
  const saved = await dir.readBytes(fileId);
  const reopened = await loadXlsx(saved.buffer as ArrayBuffer);
  expect(reopened.worksheets[0]?.getCell(1, 1).value).toBe("recovered cell");
});

test("XLSX replay keeps sheet identity after a prior save removed a sheet", async () => {
  const dir = new MemoryVaultDir();
  const fileId = "storage/reordered.xlsx";
  const wb = newWorkbook();
  wb.addWorksheet("Removed").getCell(1, 1).value = "old";
  wb.addWorksheet("Kept").getCell(1, 1).value = "before";
  const model = workbookToModel(wb, fileId);
  const idMap = buildSheetIdMap(wb, model);
  const removed = model.sheetOrder.shift()!;
  delete model.sheets[removed];
  applyModelToWorkbook(wb, model, idMap);
  const source = await saveXlsx(wb);
  await dir.writeBytes(fileId, source);
  model.sheets[model.sheetOrder[0]!]!.cellData![0]![0] = { v: "recovered" };
  const store = storage();
  writeOfficeDraft(store, "A", {
    fileId,
    kind: "xlsx",
    baseRevision: bytesRevision(source),
    sourceBase64: b64(source),
    snapshotBase64: snapshotBase64(model),
    sheetIdMap: [...idMap],
  });
  expect((await replayOfficeDrafts(store, "A", dir)).saved).toBe(1);
  const saved = await dir.readBytes(fileId);
  const reopened = await loadXlsx(saved.buffer as ArrayBuffer);
  expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Kept"]);
  expect(reopened.worksheets[0]?.getCell(1, 1).value).toBe("recovered");
});
