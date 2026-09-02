// Source-shape law for the Quick Note window (the maintainer, 2026-09-01):
// a note born there is a FULL note. The quick webview cannot write the Main
// manifest (it holds EMPTY_MAIN), so it announces the id and the MAIN window
// files it — otherwise the note carries a capture's on-disk shape and the
// Captures board claims it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const quickSource = readFileSync(new URL("quickNote.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");

test("the quick window announces a newborn note and main files it into Main", () => {
  const create = quickSource.slice(
    quickSource.indexOf("const newNote = () => {"),
    quickSource.indexOf("const openPicker"),
  );
  expect(create).toContain("emitQuickCreated({ id: noteId })");
  expect(create).toContain("fileQuickNoteInMain(noteId)");
  const listener = appSource.slice(
    appSource.indexOf("onQuickCreated(("),
    appSource.indexOf("onQuickCreated((") + 80,
  );
  expect(listener).toContain("fileQuickNoteInMain(id)");
  // main-only: the quick and capture webviews must never write the manifest
  const gate = appSource.slice(
    appSource.indexOf("onQuickCreated((") - 120,
    appSource.indexOf("onQuickCreated(("),
  );
  expect(gate).toContain('if (surface !== "main") return;');
});
