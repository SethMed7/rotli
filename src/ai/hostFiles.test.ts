// Chat's read_file over the vault's files, through the REAL tools with the
// corpus mocked: a workbook arrives by cell address, a Word document by
// numbered block, a damaged workbook says so, and a remote model never gets
// secret-shaped contents.
//
// The file-read port keeps these fakes inside this test file. No process-wide
// module replacement can change the desktop twin's real Tauri fallbacks.

import { expect, test } from "bun:test";

import ExcelJS from "exceljs";

import { b64FromBytes, saveXlsx } from "../sheets/codec/xlsx";
import { useLibrarianRules } from "../state/librarianRules";
import { useUiStore } from "../state/ui";
import {
  aiFileAccessById as accessById,
  type FileToolIo,
  makeFileTools as createFileTools,
} from "./hostFiles";
import { registeredToolSpecs } from "./toolSchemas";

const files: Record<string, string> = {};
const reads: string[] = [];
const documentReads: string[] = [];
let cachedList: ReturnType<typeof listed>[] | null = null;
let refreshes = 0;
let cacheEnabled = false;
const listed = (path: string) => ({
  id: path.includes("/") ? path : `storage/rotli/${path}`,
  title: path.split("/").at(-1) ?? "",
  kind: "file" as const,
});
const mockAiRead = async (id: string) => {
  reads.push(id);
  return files[id.replace("storage/rotli/", "")] ?? "";
};

const io: FileToolIo = {
  corpusList: async () => {
    if (!cacheEnabled) return { folders: [], notes: Object.keys(files).map(listed) };
    cachedList ??= Object.keys(files).map(listed);
    return { folders: [], notes: cachedList };
  },
  corpusListFresh: async () => {
    refreshes++;
    cachedList = Object.keys(files).map(listed);
    return { folders: [], notes: cachedList };
  },
  corpusFileBytesAi: mockAiRead,
  corpusFileTextAi: mockAiRead,
  readAiManagedDocument: (async (id: string) => {
    documentReads.push(id);
    return {
      kind: "ready",
      warnings: [],
      revision: "r1",
      sourceBase64: "",
      document: {
        id: "storage/rotli/brief.docx",
        title: "brief",
        content: [{ kind: "paragraph", paragraph: { namedStyle: "heading1", runs: [{ text: "Kickoff" }] } }],
      },
      save: async () => "r2",
    };
  }) as FileToolIo["readAiManagedDocument"],
};

const makeFileTools = (
  model: Parameters<typeof createFileTools>[0],
  opts: Parameters<typeof createFileTools>[1],
) => createFileTools(model, opts, io);
const aiFileAccessById = (id: string, local: boolean) => accessById(id, local, io);

const remote = {
  id: "m",
  label: "m",
  provider: "anthropic",
  endpoint: "https://api.anthropic.com",
  api: "",
  vision: false,
  isDefault: false,
} as Parameters<typeof makeFileTools>[0];
const onDevice = { ...remote, provider: "mlx", endpoint: "http://127.0.0.1:11435" };

const workbook = async (fill: (wb: ExcelJS.Workbook) => void) => {
  const wb = new ExcelJS.Workbook();
  fill(wb);
  return b64FromBytes(await saveXlsx(wb));
};

test("remote file tools refuse secret-free secure-home files before extraction", async () => {
  for (const ext of ["docx", "xlsx", "csv"]) {
    const id = `wiki/_secure/plan.${ext}`;
    files[id] = "ordinary project data";
    reads.length = 0;
    documentReads.length = 0;
    expect(await makeFileTools(remote, {}).readFile(id)).toMatch(/^blocked:/);
    expect(reads).toEqual([]);
    expect(documentReads).toEqual([]);
  }
});

test("on-device secure file reads honor the vault knob and taint the chat", async () => {
  files["wiki/_secure/local.csv"] = "task,status\nDraft,ready";
  const prior = useUiStore.getState().secureLocalAi;
  try {
    useUiStore.setState({ secureLocalAi: false });
    reads.length = 0;
    expect(await makeFileTools(onDevice, {}).readFile("wiki/_secure/local.csv")).toMatch(/^blocked:/);
    expect(reads).toEqual([]);
    useUiStore.setState({ secureLocalAi: true });
    let tainted = false;
    expect(
      await makeFileTools(onDevice, {
        onSecureNoteRead: () => {
          tainted = true;
        },
      }).readFile("wiki/_secure/local.csv"),
    ).toContain("Draft");
    expect(tainted).toBe(true);
  } finally {
    useUiStore.setState({ secureLocalAi: prior });
  }
});

test("an exact secure path cannot be unlocked by a duplicate ordinary filename", async () => {
  files["plan.csv"] = "ordinary,public";
  files["wiki/_secure/plan.csv"] = "ordinary,private";
  reads.length = 0;
  expect(await makeFileTools(remote, {}).readFile("wiki/_secure/plan.csv")).toMatch(/^blocked:/);
  expect(reads).toEqual([]);
});

test("a secure keyword in an ordinary folder blocks a remote file read", async () => {
  const prior = useLibrarianRules.getState().rules;
  try {
    useLibrarianRules.getState().setRules({ ...prior, secureKeywords: ["bank"] });
    files["storage/rotli/bank-plan.csv"] = "task,status\nDraft,ready";
    reads.length = 0;
    expect(await makeFileTools(remote, {}).readFile("storage/rotli/bank-plan.csv")).toMatch(/^blocked:/);
    expect(reads).toEqual([]);
  } finally {
    useLibrarianRules.getState().setRules(prior);
  }
});

test("every registered vault-content tool refuses a remote secure-home target", async () => {
  expect(registeredToolSpecs().map(({ name }) => name)).toEqual([
    "search_memory",
    "read_memory",
    "search_notes",
    "read_note",
    "create_note",
    "update_note",
    "open_note",
    "read_file",
    "web_search",
    "web_fetch",
    "generate_image",
    "create_document",
    "edit_document",
    "create_artifact",
    "draw_board",
  ]);
  files["wiki/_secure/plan.docx"] = "ordinary project data";
  reads.length = 0;
  documentReads.length = 0;
  const tools = makeFileTools(remote, {});
  for (const name of ["read_file", "edit_document"] as const) {
    const response =
      name === "read_file"
        ? await tools.readFile("wiki/_secure/plan.docx")
        : await tools.editDocument("wiki/_secure/plan.docx", []);
    expect(response).toMatch(/^blocked:/);
  }
  expect(reads).toEqual([]);
  expect(documentReads).toEqual([]);
});

test("an exact just-written file refreshes a stale list once; an unknown id stays blocked", async () => {
  cacheEnabled = true;
  cachedList = [];
  refreshes = 0;
  try {
    files["storage/rotli/fresh.csv"] = "task,status\nDraft,ready";
    expect(await aiFileAccessById("storage/rotli/fresh.csv", false)).toBeNull();
    expect(refreshes).toBe(1);
    cachedList = [];
    files["wiki/_secure/fresh.csv"] = "task,status\nDraft,ready";
    expect(await aiFileAccessById("wiki/_secure/fresh.csv", false)).toMatch(/^blocked:/);
    expect(refreshes).toBe(2);
    expect(await aiFileAccessById("storage/rotli/unknown.csv", false)).toMatch(/^blocked:/);
    expect(refreshes).toBe(3);
  } finally {
    cacheEnabled = false;
    cachedList = null;
  }
});

test("a workbook arrives by cell address, its dates as dates", async () => {
  files["budget.xlsx"] = await workbook((wb) => {
    wb.addWorksheet("Budget").addRow(["Due", new Date(Date.UTC(2026, 9, 1))]);
  });
  expect(await makeFileTools(remote, {}).readFile("budget.xlsx")).toBe(
    '## Sheet "Budget" (1 rows × 2 columns used)\nA1 "Due" | B1 2026-10-01',
  );
});

test("a damaged workbook says so instead of failing the turn", async () => {
  files["broken.xlsx"] = b64FromBytes(new TextEncoder().encode("not a zip"));
  expect(await makeFileTools(remote, {}).readFile("broken.xlsx")).toMatch(/isn't a workbook Rotli can read/);
});

test("a Word document arrives as numbered blocks", async () => {
  files["brief.docx"] = "";
  expect(await makeFileTools(remote, {}).readFile("brief.docx")).toBe("[1] Heading 1: Kickoff");
});

test("a remote model never gets a secret-shaped file; an on-device one does, and the chat is marked", async () => {
  files["keys.csv"] = "name,key\nprod,-----BEGIN RSA PRIVATE KEY-----";
  expect(await makeFileTools(remote, {}).readFile("keys.csv")).toMatch(/^blocked:/);
  let marked = false;
  const read = await makeFileTools(onDevice, { onSecureNoteRead: () => (marked = true) }).readFile(
    "keys.csv",
  );
  expect(read).toContain("PRIVATE KEY");
  expect(marked).toBe(true);
});
