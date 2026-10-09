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
import { makeFileTools } from "./hostFiles";

const files: Record<string, string> = {};
const listed = (title: string) => ({ id: `storage/rotli/${title}`, title, kind: "file" });

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusList: async () => ({ folders: [], notes: Object.keys(files).map(listed) }),
  corpusFileBytes: async (id: string) => files[id.replace("storage/rotli/", "")] ?? "",
  corpusFileText: async (id: string) => files[id.replace("storage/rotli/", "")] ?? "",
}));
void mock.module("../documents/composition", () => ({
  ...realDocuments,
  editManagedDocument: async () => ({
    kind: "ready",
    warnings: [],
    revision: "r1",
    document: {
      id: "storage/rotli/brief.docx",
      title: "brief",
      content: [{ kind: "paragraph", paragraph: { namedStyle: "heading1", runs: [{ text: "Kickoff" }] } }],
    },
    save: async () => "r2",
  }),
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
