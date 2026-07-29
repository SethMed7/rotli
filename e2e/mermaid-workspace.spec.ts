import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

const DIAGRAM_NOTE = `# Diagram workspace

\`\`\`mermaid
flowchart LR
  Start[Start] --> Next[Next step]
\`\`\`

After the diagram`;

async function createDiagramNote(page: import("@playwright/test").Page): Promise<void> {
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(DIAGRAM_NOTE);
  await expect(page.locator(".rotli-render-mermaid-trigger")).toBeVisible();
}

test("Mermaid diagrams open a keyboard-safe pan, zoom, and source workspace", async ({ page }) => {
  await gotoApp(page);
  await createDiagramNote(page);

  await page.locator(".rotli-render-mermaid-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Mermaid diagram" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".rotli-mermaid-diagram svg")).toBeVisible();
  await dialog.getByRole("button", { name: "More" }).click();
  await expect(dialog.getByRole("menuitem", { name: /Convert copy to Excalidraw/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  const canvas = dialog.getByLabel(/Mermaid diagram canvas/);
  const diagram = dialog.locator(".rotli-mermaid-diagram");
  await page.setViewportSize({ width: 680, height: 760 });
  await expect
    .poll(async () => {
      const [canvasBox, diagramBox] = await Promise.all([canvas.boundingBox(), diagram.boundingBox()]);
      if (!canvasBox || !diagramBox) return false;
      return diagramBox.x >= canvasBox.x && diagramBox.x + diagramBox.width <= canvasBox.x + canvasBox.width;
    })
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  const zoom = dialog.getByLabel("Zoom level");
  const initialZoom = await zoom.textContent();
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText(initialZoom ?? "");

  const beforeDrag = await diagram.getAttribute("style");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mermaid canvas has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 45, { steps: 5 });
  await page.mouse.up();
  await expect(diagram).not.toHaveAttribute("style", beforeDrag ?? "");

  await dialog.getByRole("button", { name: "Code" }).click();
  const source = dialog.getByLabel("Mermaid source");
  await source.fill("flowchart LR\n  Start[Updated] --> Next[Done]");
  await dialog.getByRole("button", { name: "Close Mermaid diagram" }).click();
  await expect(dialog.getByText("Discard unapplied diagram changes?")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("button", { name: "Apply to note" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content").last()).toContainText("Start[Updated]");
});

test("flowcharts can be visually edited without changing into Excalidraw", async ({ page }) => {
  await gotoApp(page);
  await createDiagramNote(page);

  await page.locator(".rotli-render-mermaid-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Mermaid diagram" });
  await dialog.getByRole("button", { name: "Visual" }).click();
  const visual = dialog.getByRole("region", { name: "Visual Mermaid flowchart editor" });
  await expect(visual).toBeVisible();
  await expect(visual.getByRole("button", { name: "Start, Process shape" })).toBeVisible();

  await visual.getByRole("button", { name: "+ Shape" }).click();
  await visual.getByRole("menuitem", { name: "Decision" }).click();
  await visual.getByLabel("Shape text").fill("Review");
  const reviewNode = visual.getByRole("button", { name: "Review, Decision shape" });
  const reviewWrap = reviewNode.locator("..");
  const positionBeforeDrag = await reviewWrap.getAttribute("style");
  const reviewBox = await reviewNode.boundingBox();
  if (!reviewBox) throw new Error("Visual Mermaid node has no bounding box");
  await page.mouse.move(reviewBox.x + reviewBox.width / 2, reviewBox.y + reviewBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(reviewBox.x + reviewBox.width / 2 + 46, reviewBox.y + reviewBox.height / 2 + 24);
  await page.mouse.up();
  await expect(reviewWrap).not.toHaveAttribute("style", positionBeforeDrag ?? "");
  await visual.getByRole("button", { name: "Set fill to Accent" }).click();
  await visual.getByRole("button", { name: "Draw arrow", exact: true }).click();
  await visual.getByRole("button", { name: "Next step, Process shape" }).click();
  await visual.getByLabel("Arrow text").fill("routes");

  await dialog.getByRole("button", { name: "Code", exact: true }).click();
  await expect(dialog.getByLabel("Mermaid source")).toHaveValue(/node3 -->\|routes\| Next/);
  await dialog.getByRole("button", { name: "View", exact: true }).click();
  await expect(dialog.locator(".rotli-mermaid-diagram svg")).toBeVisible();
  await dialog.getByRole("button", { name: "Visual", exact: true }).click();

  await visual.getByRole("button", { name: "Apply to note" }).click();
  await expect(dialog).toBeHidden();
  const editor = page.locator(".cm-content").last();
  await expect(editor).toContainText('node3@{ shape: diamond, label: "Review" }');
  await expect(editor).toContainText("node3 -->|routes| Next");
  await expect(editor).toContainText("style node3 fill:");
});

test("Visual mode refuses unsupported Mermaid syntax without rewriting it", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n\nAfter");
  await expect(page.locator(".rotli-render-mermaid-trigger")).toBeVisible();

  await page.locator(".rotli-render-mermaid-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Mermaid diagram" });
  await dialog.getByRole("button", { name: "Visual" }).click();
  await expect(dialog.getByText("Visual editing is not available for this source yet.")).toBeVisible();
  await expect(dialog.getByText("Your Mermaid source has not been changed.")).toBeVisible();
  await dialog.getByRole("button", { name: "Open Code" }).click();
  await expect(dialog.getByLabel("Mermaid source")).toHaveValue(/sequenceDiagram/);
});

test("the Mermaid slash command inserts a working starter diagram", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("/mermaid");
  await page.getByRole("menuitem", { name: /Mermaid/ }).click();

  await expect(editor).toContainText("flowchart LR");
  await expect(editor).toContainText("Start[Start] --> Next[Next step]");
});

test("Mermaid source converts to an editable Excalidraw scene", async ({ page }) => {
  await gotoApp(page);
  const scene = await page.evaluate(async () => {
    const modulePath = "/src/boards/engine/mermaid.ts";
    const converter = (await import(modulePath)) as {
      convertMermaidToBoardScene(source: string): Promise<{ elements: Array<{ type?: string }> }>;
    };
    const converted = await converter.convertMermaidToBoardScene(
      "flowchart LR\n  Start[Start] --> Next[Next step]",
    );
    return {
      count: converted.elements.length,
      types: converted.elements.map((element) => element.type),
    };
  });

  expect(scene.count).toBeGreaterThan(2);
  expect(scene.types).toContain("arrow");
  expect(scene.types).toContain("text");
});

test("the Visual canvas has its own camera: zoom controls and empty-space pan", async ({ page }) => {
  await gotoApp(page);
  await createDiagramNote(page);
  await page.locator(".rotli-render-mermaid-trigger").click();
  const dialog = page.getByRole("dialog", { name: "Mermaid diagram" });
  await dialog.getByRole("button", { name: "Visual" }).click();

  // corner zoom controls mirror View's − % + Fit
  const level = dialog.getByLabel("Canvas zoom level");
  await expect(level).toHaveText("100%");
  await dialog.getByRole("button", { name: "Zoom canvas in" }).click();
  await expect(level).toHaveText("120%");

  // dragging EMPTY canvas pans (the transform changes; nodes stay put)
  const stage = dialog.getByLabel(/Flowchart editing canvas/);
  const canvas = dialog.locator(".rotli-mermaid-visual-canvas");
  const before = await canvas.getAttribute("style");
  const box = await stage.boundingBox();
  if (!box) throw new Error("visual stage has no bounding box");
  // top-right of the stage is empty canvas (nodes flow from the left; the
  // zoom overlay rides the bottom-right corner)
  await page.mouse.move(box.x + box.width - 60, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 150, box.y + 110, { steps: 6 });
  await page.mouse.up();
  expect(await canvas.getAttribute("style")).not.toBe(before);
});
