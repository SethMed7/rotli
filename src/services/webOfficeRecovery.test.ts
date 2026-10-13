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
  officeDraftTokenAfterProtect,
  readOfficeDrafts,
  replayOfficeDrafts,
  snapshotBase64,
  writeOfficeDraft,
} from "./webOfficeRecovery";

const replayAbandoned = (
  store: ReturnType<typeof storage>,
  vault: string,
  dir: MemoryVaultDir,
  encoder?: (entry: OfficeDraft) => Promise<Uint8Array>,
) => replayOfficeDrafts(store, vault, dir, encoder, async () => true);

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("a draft added while replay is encoding remains journaled", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  writeOfficeDraft(store, "A", { ...draft(), sessionId: "tab-a" });
  let resume!: () => void;
  let started!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const encoding = new Promise<void>((resolve) => {
    started = resolve;
  });
  const replay = replayAbandoned(store, "A", dir, async (entry) => {
    started();
    await paused;
    return encode(entry);
  });
  await encoding;
  writeOfficeDraft(store, "A", { ...draft("storage/other.csv"), sessionId: "tab-b" });
  resume();
  await replay;
  expect(readOfficeDrafts(store, "A").map((item) => item.fileId)).toEqual(["storage/other.csv"]);
});

test("two editing sessions for one file replay both edits as separate copies", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  writeOfficeDraft(store, "A", { ...draft(), sessionId: "tab-a" });
  const second = new TextEncoder().encode("another edit");
  writeOfficeDraft(store, "A", {
    ...draft(),
    sessionId: "tab-b",
    snapshotBase64: b64(second),
  });
  expect(readOfficeDrafts(store, "A")).toHaveLength(2);
  const result = await replayAbandoned(store, "A", dir, encode);
  expect(result.saved).toBe(0);
  expect(result.keptAside).toHaveLength(2);
  expect(await dir.readBytes("storage/plan.csv")).toEqual(original);
  expect(await Promise.all(result.keptAside.map((path) => dir.readBytes(path)))).toEqual([edited, second]);
});

test("a live peer's draft is untouched by another tab's boot", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  const token = writeOfficeDraft(store, "A", { ...draft(), sessionId: "tab-a" }).token;
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        options: { ifAvailable?: boolean },
        callback: (lock: object | null) => unknown,
      ) => callback(options.ifAvailable ? null : {}),
    },
  });
  try {
    expect(await replayOfficeDrafts(store, "A", dir, encode)).toEqual({
      saved: 0,
      keptAside: [],
      unresolved: 0,
    });
    expect(await dir.readBytes("storage/plan.csv")).toEqual(original);
    expect(readOfficeDrafts(store, "A").map((entry) => entry.token)).toEqual([token]);
  } finally {
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

test("a dead session's draft replays after its Web Lock is released", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  writeOfficeDraft(store, "A", { ...draft(), sessionId: "closed-tab" });
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: { ifAvailable?: boolean },
        callback: (lock: object | null) => unknown,
      ) => callback({}),
    },
  });
  try {
    expect(await replayOfficeDrafts(store, "A", dir, encode)).toEqual({
      saved: 1,
      keptAside: [],
      unresolved: 0,
    });
    expect(await dir.readBytes("storage/plan.csv")).toEqual(edited);
    expect(readOfficeDrafts(store, "A")).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

test("two tabs replay one abandoned draft with one save and no sibling", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  writeOfficeDraft(store, "A", { ...draft(), sessionId: "closed-tab" });
  let releaseFirstWrite!: () => void;
  let firstWriteStarted!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const firstWriteSeen = new Promise<void>((resolve) => {
    firstWriteStarted = resolve;
  });
  const write = dir.writeBytes.bind(dir);
  let writes = 0;
  dir.writeBytes = async (path, bytes, revision) => {
    if (path === "storage/plan.csv" && revision) {
      writes += 1;
      if (writes === 1) {
        firstWriteStarted();
        await firstWriteGate;
      }
    }
    return write(path, bytes, revision);
  };
  const prior = Object.getOwnPropertyDescriptor(navigator, "locks");
  const tails = new Map<string, Promise<void>>();
  let secondReplayQueued!: () => void;
  const secondQueued = new Promise<void>((resolve) => {
    secondReplayQueued = resolve;
  });
  let requests = 0;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        name: string,
        _options: { mode: string },
        callback: (lock: object) => Promise<unknown>,
      ) => {
        requests += 1;
        if (requests === 2) secondReplayQueued();
        const previous = tails.get(name) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        tails.set(
          name,
          previous.then(() => held),
        );
        await previous;
        try {
          return await callback({});
        } finally {
          release();
        }
      },
    },
  });
  try {
    const first = replayAbandoned(store, "A", dir, encode);
    await firstWriteSeen;
    const second = replayAbandoned(store, "A", dir, encode);
    await secondQueued;
    releaseFirstWrite();
    const results = await Promise.all([first, second]);
    expect(results.reduce((count, result) => count + result.saved, 0)).toBe(1);
    expect(results.flatMap((result) => result.keptAside)).toEqual([]);
    expect(writes).toBe(1);
    expect(await dir.readBytes("storage/plan.csv")).toEqual(edited);
    expect(readOfficeDrafts(store, "A")).toEqual([]);
  } finally {
    if (prior) Object.defineProperty(navigator, "locks", prior);
    else Reflect.deleteProperty(navigator, "locks");
  }
});

test("a failed peer liveness check leaves its journal record byte-for-byte intact", async () => {
  const store = storage();
  const dir = new MemoryVaultDir();
  await dir.writeBytes("storage/plan.csv", original);
  writeOfficeDraft(store, "A", { ...draft(), sessionId: "other-tab" });
  const before = [...store.values];
  const result = await replayOfficeDrafts(store, "A", dir, encode, async () => {
    throw new Error("Web Locks unavailable");
  });
  expect(result).toEqual({ saved: 0, keptAside: [], unresolved: 0 });
  expect([...store.values]).toEqual(before);
  expect(await dir.readBytes("storage/plan.csv")).toEqual(original);
});

test("draft tokens include the editing session so a save cannot clear another tab", () => {
  const store = storage();
  const a = writeOfficeDraft(store, "A", { ...draft(), sessionId: "tab-a" });
  const b = writeOfficeDraft(store, "A", { ...draft(), sessionId: "tab-b" });
  expect(a.token).toStartWith("tab-a:");
  expect(b.token).toStartWith("tab-b:");
  clearOfficeDraft(store, "A", draft().fileId, a.token);
  expect(readOfficeDrafts(store, "A").map((item) => item.token)).toEqual([b.token]);
});

test("a successful save clears the older protected draft after a later quota refusal", () => {
  const store = storage();
  const first = writeOfficeDraft(store, "A", draft());
  const refused = writeOfficeDraft(store, "A", {
    ...draft(),
    snapshotBase64: "x".repeat(OFFICE_DRAFT_ENTRY_MAX_CHARS),
  });
  expect(refused.protected).toBe(false);
  const token = officeDraftTokenAfterProtect(first.token, refused.protected ? refused.token : null);
  clearOfficeDraft(store, "A", draft().fileId, token);
  expect(readOfficeDrafts(store, "A")).toEqual([]);
});

test("blocked storage enumeration leaves boot with no readable drafts", () => {
  const blocked = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    key: () => null,
    get length(): number {
      throw new Error("storage blocked");
    },
  };
  expect(readOfficeDrafts(blocked, "A")).toEqual([]);
});

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
  expect(await replayAbandoned(store, "B", dirB, encode)).toEqual({
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
  const result = await replayAbandoned(store, "A", dir, encode);
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
  const result = await replayAbandoned(store, "A", dir, encode);
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
      await replayAbandoned(store, "A", dir, async () => {
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
  expect([...store.values.keys()].some((key) => key.startsWith(`${officeDraftKey("A")}:draft:`))).toBe(true);
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

test("competing drafts for the same file share the total vault budget", () => {
  const store = storage();
  const payload = "x".repeat(Math.floor(OFFICE_DRAFT_TOTAL_MAX_CHARS / 2));
  const first = { ...draft(), sessionId: "tab-a", snapshotBase64: payload };
  const second = { ...draft(), sessionId: "tab-b", snapshotBase64: payload };
  expect(writeOfficeDraft(store, "A", first).protected).toBe(true);
  expect(writeOfficeDraft(store, "A", second).protected).toBe(false);
  expect(readOfficeDrafts(store, "A").map((item) => item.sessionId)).toEqual(["tab-a"]);
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
  expect((await replayAbandoned(store, "A", dir)).saved).toBe(1);
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
  expect((await replayAbandoned(store, "A", dir)).saved).toBe(1);
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
  expect((await replayAbandoned(store, "A", dir)).saved).toBe(1);
  const saved = await dir.readBytes(fileId);
  const reopened = await loadXlsx(saved.buffer as ArrayBuffer);
  expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual(["Kept"]);
  expect(reopened.worksheets[0]?.getCell(1, 1).value).toBe("recovered");
});
