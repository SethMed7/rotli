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

test("a toolbar format chosen at a collapsed caret applies to the next typed text", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const enginePath = "/src/documents/engine/univer.ts";
    const { mountDocumentEditor } = await import(/* @vite-ignore */ enginePath);
    const model = {
      id: "pending-style.docx",
      title: "Pending style",
      content: [{ kind: "paragraph", paragraph: { runs: [{ text: "Plain" }] } }],
    };
    const host = document.createElement("div");
    host.id = "pending-style-host";
    host.style.cssText = "position: fixed; inset: 0; z-index: 9999; background: white";
    document.body.append(host);
    const handle = mountDocumentEditor(host, model);
    (window as unknown as { __pendingStyle: unknown }).__pendingStyle = handle;
    await handle.ready;
  });

  // Place a collapsed caret in the paragraph with a real click (its offset
  // does not matter: the typed characters must form their own bold run).
  const canvas = page.locator("#pending-style-host canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("document canvas has no box");
  const bold = page
    .locator('#pending-style-host [data-u-command="doc.command.set-inline-format-bold"]:visible')
    .first();
  await expect(bold).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  // A person pauses between placing the caret and reaching for the toolbar;
  // let the click's own selection settle so it cannot clear the armed style.
  await page.waitForTimeout(200);
  await bold.click();
  // Let any post-mutation canvas relayout (microtask + frame) settle first.
  await page.waitForTimeout(200);
  await page.keyboard.type("xy");

  const runs = await page.evaluate(() => {
    const handle = (window as unknown as { __pendingStyle: { save(): unknown; dispose(): void } })
      .__pendingStyle;
    const saved = handle.save() as {
      content: { kind: string; paragraph?: { runs: { text: string; style?: { bold?: boolean } }[] } }[];
    };
    handle.dispose();
    return saved.content.flatMap((content) => content.paragraph?.runs ?? []);
  });
  expect(runs.map((run) => run.text).join("")).toContain("xy");
  expect(runs.find((run) => run.text === "xy")?.style?.bold).toBe(true);
});
