import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("DOCX list paragraphs use Univer's registered presets", async ({ page }) => {
  await gotoApp(page);

  const result = await page.evaluate(async () => {
    const enginePath = "/src/documents/engine/univer.ts";
    const { documentToSnapshot, mountDocumentEditor } = await import(enginePath);
    const model = {
      id: "list-regression.docx",
      title: "List regression",
      content: [
        {
          kind: "paragraph",
          paragraph: { runs: [{ text: "Bullet" }], list: "bullet" },
        },
        {
          kind: "paragraph",
          paragraph: { runs: [{ text: "Number" }], list: "number" },
        },
      ],
    } as const;
    const snapshot = documentToSnapshot(model);
    const host = document.createElement("div");
    host.style.cssText = "width: 900px; height: 700px";
    document.body.append(host);
    const handle = mountDocumentEditor(host, model);
    try {
      await handle.ready;
      return {
        listTypes: snapshot.body?.paragraphs?.map(
          (paragraph: { bullet?: { listType?: string } }) => paragraph.bullet?.listType,
        ),
        ready: true,
      };
    } finally {
      handle.dispose();
      host.remove();
    }
  });

  expect(result.listTypes).toEqual(["BULLET_LIST", "ORDER_LIST"]);
  expect(result.ready).toBe(true);
});

test("a PDF keeps its viewer header and offers an editable DOCX copy", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    // A reused Vite server can have hot-reloaded this module under a timestamped
    // URL. Import that exact instance so the test drives the store mounted by
    // React instead of creating a second, disconnected Zustand store.
    const panesPath = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => new URL(name).pathname === "/src/state/panes.ts");
    if (!panesPath) throw new Error("the mounted panes module could not be located");
    const { usePanesStore } = await import(/* @vite-ignore */ panesPath);
    usePanesStore.getState().openFile("storage/reference.pdf", { newTab: true });
  });

  const header = page.locator(".file-head");
  await expect(header).toContainText("reference.pdf");
  await expect(header.getByRole("button", { name: "Convert to DOCX" })).toBeVisible();
  await expect(header.getByRole("button", { name: /Open externally/ })).toBeVisible();
});
