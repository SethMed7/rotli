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

/** Mount a one-paragraph document full-window and park a collapsed caret in it. */
async function mountPlainDocument(page: import("@playwright/test").Page, id: string) {
  await gotoApp(page);
  await page.evaluate(async (documentId) => {
    const enginePath = "/src/documents/engine/univer.ts";
    const { mountDocumentEditor } = await import(/* @vite-ignore */ enginePath);
    const host = document.createElement("div");
    host.id = "keys-host";
    host.style.cssText = "position: fixed; inset: 0; z-index: 9999; background: white";
    document.body.append(host);
    const handle = mountDocumentEditor(host, {
      id: documentId,
      title: "Keys",
      content: [
        { kind: "paragraph", paragraph: { runs: [{ text: "Plain" }] } },
        { kind: "paragraph", paragraph: { runs: [{ text: "Second paragraph" }] } },
      ],
    });
    (window as unknown as { __keysDoc: unknown }).__keysDoc = handle;
    await handle.ready;
  }, id);
  const canvas = page.locator("#keys-host canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("document canvas has no box");
  // the first paragraph's line (the page is fitted, so it sits near the top)
  const first = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#keys-host canvas")!;
    const ctx = canvas.getContext("2d")!;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4]! < 80) return { x, y };
    return null;
  });
  if (!first) throw new Error("no text painted on the document canvas");
  const scale = box.width / (await canvas.evaluate((element: HTMLCanvasElement) => element.width));
  await page.mouse.click(box.x + (first.x + 12) * scale, box.y + (first.y + 4) * scale);
  await page.waitForTimeout(200);
}

async function savedText(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const handle = (window as unknown as { __keysDoc: { save(): unknown } }).__keysDoc;
    const saved = handle.save() as { content: { paragraph?: { runs: { text: string }[] } }[] };
    return saved.content.map((content) => (content.paragraph?.runs ?? []).map((run) => run.text).join(""));
  });
}

test("typing in a document never resizes its canvas (no per-keystroke flicker)", async ({ page }) => {
  await mountPlainDocument(page, "typing-flicker.docx");
  await page.evaluate(() => {
    const probe = window as unknown as { __sizes: string[]; __stop: boolean };
    probe.__sizes = [];
    probe.__stop = false;
    const canvas = document.querySelector<HTMLCanvasElement>("#keys-host canvas")!;
    const sample = () => {
      if (probe.__stop) return;
      probe.__sizes.push(`${canvas.width}x${canvas.height}`);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.type("steady", { delay: 60 });
  await page.waitForTimeout(250);
  const sizes = await page.evaluate(() => {
    const probe = window as unknown as { __sizes: string[]; __stop: boolean };
    probe.__stop = true;
    return [...new Set(probe.__sizes)];
  });
  expect((await savedText(page)).join("")).toContain("steady");
  expect(sizes).toHaveLength(1);
});

test("Tab in a plain document paragraph inserts a tab", async ({ page }) => {
  await mountPlainDocument(page, "plain-tab.docx");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await page.waitForTimeout(150);
  expect((await savedText(page)).join("")).toContain("\tx");
});

test("the native Select All menu command selects the whole document", async ({ page }) => {
  await mountPlainDocument(page, "select-all.docx");
  // macOS Edit → Select All (⌘A) reaches WebKit as a selectAll: editing command,
  // which fires selectstart on the focused editable instead of a keydown.
  await page.evaluate(() => {
    const editor = document.querySelector('#keys-host [data-u-comp="editor"]');
    if (!editor) throw new Error("Univer's input element is missing");
    editor.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  await page.keyboard.type("Z");
  await page.waitForTimeout(150);
  // Univer's own Select All first selects only the caret's paragraph; one
  // Select All must take the whole document, every paragraph included.
  expect(await savedText(page)).toEqual(["Z"]);
});

test("the native Undo menu command undoes the last document edit", async ({ page }) => {
  await mountPlainDocument(page, "menu-undo.docx");
  await page.keyboard.type("oops");
  await page.waitForTimeout(700);
  expect((await savedText(page)).join("")).toContain("oops");
  // macOS Edit → Undo reaches WebKit as undo:, which fires beforeinput
  // (historyUndo) on the focused editable instead of a keydown.
  await page.evaluate(() => {
    const editor = document.querySelector('#keys-host [data-u-comp="editor"]');
    if (!editor) throw new Error("Univer's input element is missing");
    editor.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(300);
  expect((await savedText(page)).join("")).not.toContain("oops");
});
