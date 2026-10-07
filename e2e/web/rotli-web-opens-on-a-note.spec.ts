// Rotli Web opens on the freshest NOTE (2026-10-06). The startup fill took
// the freshest item of any kind, so a board saved after the last note opened
// as a broken note tab instead of the note.

import { expect, test } from "@playwright/test";

import { startWithFolder } from "./support";

const EMPTY_SCENE =
  '{"type":"excalidraw","version":2,"source":"rotli","elements":[],"appState":{},"files":{}}';

test("a folder whose newest file is a board still opens on its freshest note", async ({ page }) => {
  // planted in order, so the board is the newest file in the folder
  await startWithFolder(page, {
    "Plans.md": "# Plans\n\nThe week.\n",
    "Sketch.excalidraw": EMPTY_SCENE,
  });
  await expect(page.getByRole("tab", { selected: true })).toContainText("Plans");
  await expect(page.locator(".pane.focused .cm-content")).toContainText("The week.");
});
