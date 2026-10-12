// Chat's read_file over the vault's files, through the REAL tools with the
// corpus mocked: a workbook arrives by cell address, a Word document by
// numbered block, a damaged workbook says so, and a remote model never gets
// secret-shaped contents.
//
// `mock.module` is process-wide and outlives this file, so each mock spreads
// the real module and afterAll puts the real ones back.

import { afterAll, expect, mock, test } from "bun:test";

import ExcelJS from "exceljs";

import * as realDocuments from "../documents/composition";
import * as realTauri from "../lib/tauri";
import { b64FromBytes, saveXlsx } from "../sheets/codec/xlsx";
import { useLibrarianRules } from "../state/librarianRules";
import { useUiStore } from "../state/ui";
import { makeFileTools } from "./hostFiles";
import { registeredToolSpecs } from "./toolSchemas";

const files: Record<string, string> = {};
const reads: string[] = [];
const documentReads: string[] = [];
const listed = (path: string) => ({
  id: path.includes("/") ? path : `storage/rotli/${path}`,
  title: path.split("/").at(-1),
  kind: "file",
});
const mockAiRead = async (id: string) => {
  reads.push(id);
  return files[id.replace("storage/rotli/", "")] ?? "";
};

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusList: async () => ({ folders: [], notes: Object.keys(files).map(listed) }),
  corpusFileBytesAi: mockAiRead,
  corpusFileTextAi: mockAiRead,
}));
void mock.module("../documents/composition", () => ({
  ...realDocuments,
  readAiManagedDocument: async (id: string) => {
    documentReads.push(id);
    return {
      kind: "ready",
      warnings: [],
      revision: "r1",
      document: {
        id: "storage/rotli/brief.docx",
        title: "brief",
        content: [{ kind: "paragraph", paragraph: { namedStyle: "heading1", runs: [{ text: "Kickoff" }] } }],
      },
      save: async () => "r2",
    };
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
  void mock.module("../documents/composition", () => realDocuments);
});

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

test("every registered file-reading chat tool refuses a secure-home target", async () => {
  const fileTools = registeredToolSpecs()
    .filter(({ name }) => /^(read|edit|apply|extract|convert)_.*(file|document|sheet|csv)$/.test(name))
    .map(({ name }) => name);
  expect(fileTools.sort()).toEqual(["edit_document", "read_file"]);
  files["wiki/_secure/plan.docx"] = "ordinary project data";
  reads.length = 0;
  documentReads.length = 0;
  const tools = makeFileTools(remote, {});
  for (const name of fileTools) {
    const response =
      name === "read_file"
        ? await tools.readFile("wiki/_secure/plan.docx")
        : await tools.editDocument("wiki/_secure/plan.docx", []);
    expect(response).toMatch(/^blocked:/);
  }
  expect(reads).toEqual([]);
  expect(documentReads).toEqual([]);
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
